-- =============================================================================
-- STATS FUN — idempotent, après stats.sql. Une seule RPC : fun_stats(p_profile uuid) -> jsonb.
-- Tout est dérivé de matches / match_players / soirees (parties terminées). Heures en Europe/Paris.
-- Seuils : 10 parties au total (sinon enough = false), 5 parties par tranche / jeu / jour / pote.
-- Les PHRASES sont composées côté front (src/features/stats/funStats.ts) à partir de ces chiffres.
-- =============================================================================

-- Mes parties terminées (une ligne par partie) : base commune des calculs.
create or replace function public._fun_rows(p_profile uuid)
returns table (match_id uuid, game_id text, won boolean, n integer, fin timestamptz, soiree_id uuid)
language sql stable security definer
set search_path = public, extensions
as $$
  select x.match_id, x.game_id, x.won, (select count(*)::int from public.match_players y where y.match_id = x.match_id),
         m.finished_at, m.soiree_id
    from public.match_players x join public.matches m on m.id = x.match_id
   where x.profile_id = p_profile and m.status = 'finished' and m.finished_at is not null
$$;
revoke all on function public._fun_rows(uuid) from public, anon, authenticated;

create or replace function public.fun_stats(p_profile uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_total  integer;
  v_wins   integer;
  v_slots  jsonb;
  v_days   jsonb;
  v_games  jsonb;
  v_streak jsonb;
  v_mates  jsonb;
  v_duel   jsonb;
  v_soiree jsonb;
begin
  perform public._require_profile();
  if not exists (select 1 from public.profiles where id = p_profile) then raise exception 'profile_not_found'; end if;

  select count(*), count(*) filter (where won) into v_total, v_wins from public._fun_rows(p_profile);
  if v_total < 10 then
    return jsonb_build_object('enough', false, 'games', v_total, 'needed', 10);
  end if;

  -- tranches horaires : matin 6-12, aprem 12-18, soir 18-23, nuit 23-6
  select coalesce(jsonb_agg(jsonb_build_object('slot', s, 'played', c, 'wins', w) order by s), '[]'::jsonb) into v_slots
    from (select case when h >= 6 and h < 12 then 'matin' when h >= 12 and h < 18 then 'aprem'
                      when h >= 18 and h < 23 then 'soir' else 'nuit' end as s,
                 count(*) as c, count(*) filter (where won) as w
            from (select won, extract(hour from fin at time zone 'Europe/Paris')::int as h from public._fun_rows(p_profile)) t
           group by 1) z;

  select coalesce(jsonb_agg(jsonb_build_object('dow', d, 'played', c, 'wins', w) order by d), '[]'::jsonb) into v_days
    from (select extract(isodow from fin at time zone 'Europe/Paris')::int as d, count(*) as c, count(*) filter (where won) as w
            from public._fun_rows(p_profile) group by 1) z;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', game_id, 'played', c, 'wins', w) order by c desc), '[]'::jsonb) into v_games
    from (select game_id, count(*) as c, count(*) filter (where won) as w from public._fun_rows(p_profile) group by 1) z;

  -- séries (îlots de victoires / défaites consécutives)
  with o as (
    select won, row_number() over (order by fin, match_id) as rn,
           row_number() over (partition by won order by fin, match_id) as rw from public._fun_rows(p_profile)
  ), runs as (select won, count(*) as len from o group by won, rn - rw)
  select jsonb_build_object('win', coalesce(max(len) filter (where won), 0), 'loss', coalesce(max(len) filter (where not won), 0))
    into v_streak from runs;

  -- potes : parties jouées ensemble (même partie) et mes victoires en leur compagnie
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', pr.id, 'slug', pr.slug, 'nickname', pr.nickname,
           'equipped_tenue', pr.equipped_tenue, 'together', t.c, 'wins', t.w) order by t.c desc, pr.sort_order), '[]'::jsonb) into v_mates
    from (select y.profile_id, count(*) as c, count(*) filter (where me.won) as w
            from public._fun_rows(p_profile) me join public.match_players y on y.match_id = me.match_id and y.profile_id <> p_profile
           group by 1) t join public.profiles pr on pr.id = t.profile_id;

  -- duels (parties à 2) : qui me bat le plus / qui je bats le plus
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', pr.id, 'slug', pr.slug, 'nickname', pr.nickname,
           'equipped_tenue', pr.equipped_tenue, 'my_wins', t.w, 'their_wins', t.l) order by pr.sort_order), '[]'::jsonb) into v_duel
    from (select y.profile_id, count(*) filter (where me.won and not y.won) as w, count(*) filter (where y.won and not me.won) as l
            from public._fun_rows(p_profile) me join public.match_players y on y.match_id = me.match_id and y.profile_id <> p_profile
           where me.n = 2 group by 1) t join public.profiles pr on pr.id = t.profile_id;

  -- soirée la plus longue (durée réelle de la soirée) et soirée la plus chargée en parties
  select jsonb_build_object('soiree_id', s.id, 'minutes', greatest(0, round(extract(epoch from (s.ended_at - coalesce(s.started_at, s.created_at))) / 60))::int,
           'games', g.c, 'day', coalesce(s.started_at, s.created_at))
    into v_soiree
    from (select soiree_id, count(*) as c from public._fun_rows(p_profile) group by 1) g
    join public.soirees s on s.id = g.soiree_id
   where s.ended_at is not null
   order by (s.ended_at - coalesce(s.started_at, s.created_at)) desc limit 1;

  return jsonb_build_object('enough', true, 'games', v_total, 'wins', v_wins,
    'slots', v_slots, 'days', v_days, 'per_game', v_games, 'streak', v_streak,
    'mates', v_mates, 'duels', v_duel, 'longest_soiree', v_soiree,
    'soirees', (select count(distinct soiree_id) from public._fun_rows(p_profile)));
end $$;

revoke all on function public.fun_stats(uuid) from public, anon;
grant execute on function public.fun_stats(uuid) to authenticated;
