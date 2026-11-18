-- =============================================================================
-- RÉCAP DE SOIRÉE (lot C, « façon Wrapped ») — idempotent, exécuté en features/*
-- (après chat.sql : soiree_messages ; _soiree_standings de stats.sql est résolu à l'exécution).
--
-- Le chat est PURGÉ quand la soirée passe à 'ended' (trigger soirees_chat_purge).
-- Les stats de chat / stickers sont donc figées dans `soiree_recaps` par un trigger
-- AFTER UPDATE OF status nommé `soirees_a_recap` : les triggers AFTER d'une même table
-- s'exécutent par ordre alphabétique, « soirees_a_recap » passe avant « soirees_chat_purge ».
--
-- jsonb du récap (version 1) :
--   { version, soiree_id, has_chat (bool : stats de chat disponibles),
--     started_at, ended_at, duration_min, games_played, distinct_games, players_count,
--     players:[{profile_id,slug,nickname,equipped_tenue}],
--     games:[{game_id,played}]  (le plus joué d'abord, ex-aequo par id),
--     top_game:{game_id,played}|null,
--     awards:[{id, profile_id, value, extra}] }
--   RPC soiree_recap ajoute à la volée : standings:[...], winner_ids:[...] (cf. stats.sql).
-- Awards (au plus un lauréat par award, ex-aequo départagés par sort_order du profil) :
--   serie    : plus longue série de victoires consécutives (ses propres parties), >= 2
--   deuxieme : parties terminées 2e (non gagnant, >= 3 joueurs), >= 2
--   bluff    : victoires « en tant qu'infiltré » à Undercover (stats.undercover_won_as_undercover)
--              + victoires côté loup à Loup-garou (state.roles[pid] = 'loup' et won), >= 1
--              extra {as_undercover, as_wolf}
--   pasdebol : parties finies à la dernière place (>= 3 joueurs, >= 3 placements différents,
--              pas gagnant), >= 2
--   bavard   : messages texte envoyés, >= 5            (chat requis)
--   sticker  : sticker le plus envoyé de la soirée (>= 2 envois) ; profile_id = qui l'a le plus
--              envoyé, value = ses envois, extra {expression, total, tenue}   (chat requis)
-- La « Star de la soirée » est le 1er du classement (standings), pas stockée ici.
-- =============================================================================

create table if not exists public.soiree_recaps (
  soiree_id  uuid primary key references public.soirees(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.soiree_recaps enable row level security;
revoke all on table public.soiree_recaps from anon, authenticated;

create or replace function public._soiree_recap_compute(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  s        public.soirees%rowtype;
  v_chat   boolean;
  v_games  jsonb;
  v_pl     jsonb;
  v_awards jsonb;
  v_end    timestamptz;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then return null; end if;
  v_end := coalesce(s.ended_at, now());
  v_chat := exists (select 1 from public.soiree_messages where soiree_id = p_soiree_id);

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'played', g.n) order by g.n desc, g.game_id), '[]'::jsonb)
    into v_games
    from (select m.game_id, count(*)::int as n
            from public.matches m
           where m.soiree_id = p_soiree_id and m.status = 'finished'
             and exists (select 1 from public.match_players x where x.match_id = m.id)
           group by m.game_id) g;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                               'equipped_tenue', p.equipped_tenue) order by p.sort_order), '[]'::jsonb)
    into v_pl
    from public.profiles p
   where p.id in (select profile_id from public.soiree_players where soiree_id = p_soiree_id
                  union select x.profile_id from public.match_players x join public.matches m on m.id = x.match_id
                         where m.soiree_id = p_soiree_id
                  union select profile_id from public.soiree_messages where soiree_id = p_soiree_id);

  with mp as (
    select x.profile_id, x.match_id, m.game_id, m.finished_at, x.won, x.placement, x.stats, m.state,
           count(*) over (partition by x.match_id) as n,
           max(x.placement) over (partition by x.match_id) as maxp,
           (select count(distinct y.placement) from public.match_players y where y.match_id = x.match_id) as np
      from public.match_players x join public.matches m on m.id = x.match_id
     where m.soiree_id = p_soiree_id and m.status = 'finished'
  ), t as (
    select profile_id, won,
           row_number() over (partition by profile_id order by finished_at, match_id) as rn,
           row_number() over (partition by profile_id, won order by finished_at, match_id) as rw
      from mp
  ), streaks as (
    select profile_id, count(*)::int as len from t where won group by profile_id, rn - rw
  ), cand as (
    select 'serie'::text as id, profile_id, max(len) as value, '{}'::jsonb as extra
      from streaks group by profile_id having max(len) >= 2
    union all
    select 'deuxieme', profile_id, count(*)::int, '{}'::jsonb
      from mp where placement = 2 and not won and n >= 3 group by profile_id having count(*) >= 2
    union all
    select 'pasdebol', profile_id, count(*)::int, '{}'::jsonb
      from mp where placement = maxp and placement > 1 and not won and n >= 3 and np >= 3
     group by profile_id having count(*) >= 2
    union all
    select 'bluff', b.profile_id, b.u + b.w, jsonb_build_object('as_undercover', b.u, 'as_wolf', b.w)
      from (select profile_id,
                   coalesce(sum(case when game_id = 'undercover' then coalesce((stats->>'undercover_won_as_undercover')::int, 0) else 0 end), 0)::int as u,
                   count(*) filter (where game_id = 'loup-garou' and won and state->'roles'->>(profile_id::text) = 'loup')::int as w
              from mp group by profile_id) b
     where b.u + b.w >= 1
    union all
    select 'bavard', profile_id, count(*)::int, '{}'::jsonb
      from public.soiree_messages where soiree_id = p_soiree_id and kind = 'text'
     group by profile_id having count(*) >= 5
    union all
    select 'sticker', z.profile_id, z.c, jsonb_build_object('expression', top.body, 'total', top.total,
             'tenue', (select q.tenue from public.soiree_messages q
                        where q.soiree_id = p_soiree_id and q.kind = 'sticker' and q.body = top.body and q.profile_id = z.profile_id
                        order by q.id desc limit 1))
      from (select body, count(*)::int as total from public.soiree_messages
             where soiree_id = p_soiree_id and kind = 'sticker'
             group by body having count(*) >= 2 order by count(*) desc, body limit 1) top
      cross join lateral (select q.profile_id, count(*)::int as c from public.soiree_messages q
                           where q.soiree_id = p_soiree_id and q.kind = 'sticker' and q.body = top.body
                           group by q.profile_id order by count(*) desc, q.profile_id limit 1) z
    union all
    select 'devin', r.profile_id, count(*) filter (where r.ok)::int, jsonb_build_object('bets', count(*)::int)
      from public._prono_resolved() r where r.soiree_id = p_soiree_id
     group by r.profile_id having count(*) filter (where r.ok) >= 1
  ), best as (
    select distinct on (c.id) c.id, c.profile_id, c.value, c.extra
      from cand c join public.profiles p on p.id = c.profile_id
     order by c.id, c.value desc, p.sort_order
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'profile_id', profile_id, 'value', value, 'extra', extra)
                            order by array_position(array['serie','bluff','deuxieme','pasdebol','bavard','sticker','devin'], id)), '[]'::jsonb)
    into v_awards from best;

  return jsonb_build_object(
    'version', 1, 'soiree_id', p_soiree_id, 'has_chat', v_chat,
    'started_at', coalesce(s.started_at, s.created_at), 'ended_at', s.ended_at,
    'duration_min', greatest(0, round(extract(epoch from (v_end - coalesce(s.started_at, s.created_at))) / 60))::int,
    'games_played', (select coalesce(sum((e->>'played')::int), 0) from jsonb_array_elements(v_games) e),
    'distinct_games', jsonb_array_length(v_games),
    'players_count', jsonb_array_length(v_pl),
    'players', v_pl,
    'games', v_games,
    'top_game', v_games->0,
    'awards', v_awards);
end $$;

-- Trigger : fige le récap à la fin de la soirée (avant la purge du chat).
-- Ne doit JAMAIS empêcher la fin de la soirée : toute erreur est avalée.
create or replace function public._soiree_recap_store()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  begin
    insert into public.soiree_recaps(soiree_id, data)
    values (new.id, public._soiree_recap_compute(new.id))
    on conflict (soiree_id) do nothing;
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists soirees_a_recap on public.soirees;
create trigger soirees_a_recap after update of status on public.soirees
  for each row when (new.status = 'ended' and old.status is distinct from 'ended')
  execute function public._soiree_recap_store();

-- Récap d'une soirée TERMINÉE (mêmes règles d'accès que soiree_history_detail).
-- Sans récap stocké (soirée terminée avant ce lot) : calcul à la volée, sans stats de chat (has_chat=false).
-- → jsonb décrit ci-dessus + standings + winner_ids.
-- Erreurs : soiree_not_found, not_in_soiree, soiree_not_ended.
create or replace function public.soiree_recap(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  s    public.soirees%rowtype;
  v_d  jsonb;
  v_st jsonb;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if not (s.host_id = v_me
          or exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = s.id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  if s.status <> 'ended' then raise exception 'soiree_not_ended'; end if;

  select data into v_d from public.soiree_recaps where soiree_id = s.id;
  if v_d is null then v_d := public._soiree_recap_compute(s.id); end if;
  v_st := public._soiree_standings(s.id);
  return v_d || jsonb_build_object(
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

revoke all on function public._soiree_recap_compute(uuid) from public, anon, authenticated;
revoke all on function public._soiree_recap_store() from public, anon, authenticated;
revoke all on function public.soiree_recap(uuid) from public, anon;
grant execute on function public.soiree_recap(uuid) to authenticated;
