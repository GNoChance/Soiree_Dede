-- =============================================================================
-- STATS (lot B) — idempotent, exécuté APRÈS schema.sql (features/*).
-- Classement de soirée, historique des soirées, profil / statistiques.
-- Tout est DÉRIVÉ de soirees / soiree_players / matches / match_players :
-- aucune table nouvelle, juste des RPC security definer renvoyant du jsonb.
--
-- BARÈME DE SOIRÉE (par partie terminée, par joueur) — _soiree_points :
--   gagnant (won)                              = 3 pts (équipes : toute l'équipe gagnante)
--   perdant d'un duel (partie à 2 joueurs)     = 1 pt  (participation)
--   2e place (placement 2)                     = 2 pts
--   3e place (placement 3)                     = 1 pt
--   non gagnant avec placement 1 (égalité)     = 1 pt
--   autres                                     = 0 pt
-- Classement : points décroissants, puis victoires, puis moins de parties jouées ;
-- ex-aequo = même rang (rang « compétition » : 1, 1, 3).
-- Seules les parties terminées comptent (match_players n'existe qu'à la fin).
-- =============================================================================

create index if not exists matches_soiree_finished_idx on public.matches(soiree_id) where status = 'finished';

create or replace function public._soiree_points(p_won boolean, p_placement integer, p_n integer)
returns integer language sql immutable
as $$
  select case
    when p_won then 3
    when p_n = 2 then 1
    when p_placement = 2 then 2
    when p_placement = 3 then 1
    when p_placement = 1 then 1
    else 0
  end
$$;

-- Classement brut : jsonb [{profile_id, slug, nickname, equipped_tenue, points, wins, games, rank}].
-- Inclut les membres actuels (même à 0 partie) et ceux qui ont joué puis sont partis.
create or replace function public._soiree_standings(p_soiree_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  with mp as (
    select x.profile_id, x.won,
           public._soiree_points(x.won, x.placement, count(*) over (partition by x.match_id)::int) as pts
      from public.match_players x
      join public.matches mt on mt.id = x.match_id
     where mt.soiree_id = p_soiree_id and mt.status = 'finished'
  ), members as (
    select sp.profile_id from public.soiree_players sp where sp.soiree_id = p_soiree_id
    union
    select profile_id from mp
  ), agg as (
    select mb.profile_id,
           coalesce(sum(mp.pts), 0)::int as points,
           count(*) filter (where mp.won)::int as wins,
           count(mp.profile_id)::int as games
      from members mb left join mp on mp.profile_id = mb.profile_id
     group by mb.profile_id
  ), ranked as (
    select a.*, rank() over (order by a.points desc, a.wins desc, a.games asc) as rk
      from agg a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', r.profile_id, 'slug', p.slug, 'nickname', p.nickname,
           'equipped_tenue', p.equipped_tenue,
           'points', r.points, 'wins', r.wins, 'games', r.games, 'rank', r.rk)
         order by r.rk, p.sort_order), '[]'::jsonb)
    from ranked r join public.profiles p on p.id = r.profile_id
$$;

-- Classement de la soirée (membres, ou anciens joueurs d'une de ses parties).
-- → {soiree_id, status, games_played, standings:[...], winner_ids:[uuid]}
--   (winner_ids vide tant que personne n'a de point). Erreurs : soiree_not_found, not_in_soiree.
create or replace function public.soiree_standings(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  v_st     jsonb;
  v_status text;
begin
  select status into v_status from public.soirees where id = p_soiree_id;
  if v_status is null then raise exception 'soiree_not_found'; end if;
  if not (public.is_soiree_member(p_soiree_id)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = p_soiree_id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  v_st := public._soiree_standings(p_soiree_id);
  return jsonb_build_object(
    'soiree_id', p_soiree_id, 'status', v_status,
    'games_played', (select count(*) from public.matches where soiree_id = p_soiree_id and status = 'finished'),
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

-- Mes soirées terminées, la plus récente d'abord (50 au plus).
-- → [{id, host:{id,slug,nickname,equipped_tenue}, started_at, ended_at, duration_min, games_played,
--     players:[{profile_id,slug,nickname,equipped_tenue}], winner:{profile_id,slug,nickname,equipped_tenue,points}|null}]
create or replace function public.my_soirees_history()
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'host', (select jsonb_build_object('id', h.id, 'slug', h.slug, 'nickname', h.nickname, 'equipped_tenue', h.equipped_tenue)
                 from public.profiles h where h.id = s.host_id),
      'started_at', coalesce(s.started_at, s.created_at),
      'ended_at', s.ended_at,
      'duration_min', greatest(0, round(extract(epoch from (s.ended_at - coalesce(s.started_at, s.created_at))) / 60))::int,
      'games_played', (select count(*) from public.matches m where m.soiree_id = s.id and m.status = 'finished'),
      'players', (select coalesce(jsonb_agg(e - 'points' - 'wins' - 'games' - 'rank'), '[]'::jsonb)
                    from jsonb_array_elements(st.j) e),
      'winner', (select e - 'wins' - 'games' - 'rank' from jsonb_array_elements(st.j) e
                  where (e->>'rank')::int = 1 and (e->>'points')::int > 0 limit 1)
    ) order by s.sort_end desc), '[]'::jsonb)
    into v_out
    from (
      select so.*, coalesce(so.ended_at, so.created_at) as sort_end
        from public.soirees so
       where so.status = 'ended'
         and (so.host_id = v_me
              or exists (select 1 from public.soiree_players sp where sp.soiree_id = so.id and sp.profile_id = v_me)
              or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                          where m.soiree_id = so.id and x.profile_id = v_me))
       order by coalesce(so.ended_at, so.created_at) desc
       limit 50
    ) s
    cross join lateral (select public._soiree_standings(s.id) as j) st;
  return v_out;
end $$;

-- Détail d'une soirée où j'étais.
-- → {soiree_id, status, host, started_at, ended_at, duration_min,
--    matches:[{id, game_id, finished_at, players:int, winners:[{profile_id,slug,nickname,equipped_tenue}]}] (ordre chronologique),
--    standings:[...], winner_ids:[...]}. Erreurs : soiree_not_found, not_in_soiree.
create or replace function public.soiree_history_detail(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  s    public.soirees%rowtype;
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
  v_st := public._soiree_standings(s.id);
  return jsonb_build_object(
    'soiree_id', s.id, 'status', s.status,
    'host', (select jsonb_build_object('id', h.id, 'slug', h.slug, 'nickname', h.nickname, 'equipped_tenue', h.equipped_tenue)
               from public.profiles h where h.id = s.host_id),
    'started_at', coalesce(s.started_at, s.created_at), 'ended_at', s.ended_at,
    'duration_min', greatest(0, round(extract(epoch from (coalesce(s.ended_at, now()) - coalesce(s.started_at, s.created_at))) / 60))::int,
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'game_id', m.game_id, 'finished_at', m.finished_at,
               'players', (select count(*) from public.match_players x where x.match_id = m.id),
               'winners', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
                                  order by p.sort_order), '[]'::jsonb)
                             from public.match_players x join public.profiles p on p.id = x.profile_id
                            where x.match_id = m.id and x.won)
             ) order by m.finished_at), '[]'::jsonb)
        from public.matches m where m.soiree_id = s.id and m.status = 'finished'),
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

-- Profil / statistiques d'un joueur (lisible par tout joueur connecté, comme les classements).
-- → {profile:{id,slug,nickname,equipped_tenue,xp,level}, games_played, wins, win_rate (0..100), soirees,
--    favorite_game:{game_id,played}|null, best_game:{game_id,played,wins,win_rate}|null,
--    rival:{profile_id,slug,nickname,equipped_tenue,losses}|null, per_game:[{game_id,played,wins}]}
-- Jeu préféré = le plus joué. Meilleur jeu = meilleur taux de victoire parmi les jeux joués >= 3 fois,
-- sinon celui qui a le plus de victoires (>= 1 victoire exigée). Rival = adversaire qui a gagné le plus
-- de parties où je n'ai pas gagné (minimum 2). Erreur : profile_not_found.
create or replace function public.profile_stats(p_profile_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  p        public.profiles%rowtype;
  v_pg     jsonb;
  v_played int;
  v_wins   int;
begin
  select * into p from public.profiles where id = p_profile_id;
  if not found then raise exception 'profile_not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'played', g.played, 'wins', g.wins)
                            order by g.played desc, g.wins desc, g.game_id), '[]'::jsonb),
         coalesce(sum(g.played), 0)::int, coalesce(sum(g.wins), 0)::int
    into v_pg, v_played, v_wins
    from (select x.game_id, count(*)::int as played, count(*) filter (where x.won)::int as wins
            from public.match_players x join public.matches m on m.id = x.match_id and m.status = 'finished'
           where x.profile_id = p_profile_id
           group by x.game_id) g;

  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                   'equipped_tenue', p.equipped_tenue, 'xp', p.xp, 'level', public.level_for_xp(p.xp)),
    'games_played', v_played,
    'wins', v_wins,
    'win_rate', case when v_played > 0 then round(v_wins * 100.0 / v_played)::int else 0 end,
    'soirees', (select count(*) from (
                  select soiree_id from public.soiree_players where profile_id = p_profile_id
                  union
                  select m.soiree_id from public.match_players x join public.matches m on m.id = x.match_id
                   where x.profile_id = p_profile_id) u),
    'favorite_game', (select jsonb_build_object('game_id', e->>'game_id', 'played', (e->>'played')::int)
                        from jsonb_array_elements(v_pg) e limit 1),
    'best_game', (
      select jsonb_build_object('game_id', e->>'game_id', 'played', (e->>'played')::int, 'wins', (e->>'wins')::int,
                                'win_rate', round((e->>'wins')::numeric * 100 / (e->>'played')::numeric)::int)
        from jsonb_array_elements(v_pg) e
       where (e->>'wins')::int > 0
       order by ((e->>'played')::int >= 3) desc,
                case when (e->>'played')::int >= 3 then (e->>'wins')::numeric / (e->>'played')::numeric else 0 end desc,
                (e->>'wins')::int desc, (e->>'played')::int desc
       limit 1),
    'rival', (
      select jsonb_build_object('profile_id', r.pid, 'slug', pr.slug, 'nickname', pr.nickname,
                                'equipped_tenue', pr.equipped_tenue, 'losses', r.n)
        from (select w.profile_id as pid, count(*)::int as n
                from public.match_players me
                join public.matches m on m.id = me.match_id and m.status = 'finished'
                join public.match_players w on w.match_id = me.match_id and w.won and w.profile_id <> me.profile_id
               where me.profile_id = p_profile_id and not me.won
               group by w.profile_id
              having count(*) >= 2
               order by count(*) desc, w.profile_id limit 1) r
        join public.profiles pr on pr.id = r.pid),
    'per_game', v_pg);
end $$;

revoke all on function public._soiree_points(boolean, integer, integer) from public, anon, authenticated;
revoke all on function public._soiree_standings(uuid) from public, anon, authenticated;
revoke all on function public.soiree_standings(uuid) from public, anon;
revoke all on function public.my_soirees_history() from public, anon;
revoke all on function public.soiree_history_detail(uuid) from public, anon;
revoke all on function public.profile_stats(uuid) from public, anon;
grant execute on function public.soiree_standings(uuid) to authenticated;
grant execute on function public.my_soirees_history() to authenticated;
grant execute on function public.soiree_history_detail(uuid) to authenticated;
grant execute on function public.profile_stats(uuid) to authenticated;
