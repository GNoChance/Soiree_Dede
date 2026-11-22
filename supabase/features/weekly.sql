-- =============================================================================
-- CLASSEMENT DE LA SEMAINE + « VICTORIEUX DE LA SEMAINE » — idempotent, après schema.sql.
-- Aucune table : tout est dérivé de match_players / matches (parties terminées).
--
-- Semaine = lundi 00:00 -> dimanche 23:59:59 (fuseau Europe/Paris), comme daily_week_board.
-- Date d'une victoire = matches.finished_at. Une semaine appartient au lundi qui l'ouvre.
-- Classement : victoires desc, puis points desc, puis moins de parties jouées ; rang « compétition ».
-- Champion d'une semaine TERMINÉE : le(s) joueur(s) ayant le plus de victoires (tous jeux),
-- au moins 1 victoire ; ex-aequo = tous champions. La semaine en cours n'en désigne jamais.
-- =============================================================================

create index if not exists matches_finished_at_idx on public.matches(finished_at) where status = 'finished';

-- Lundi (date Paris) de la semaine en cours.
create or replace function public._week_start_now()
returns date language sql stable
as $$ select date_trunc('week', now() at time zone 'Europe/Paris')::date $$;

-- Champions de chaque semaine terminée (jeux confondus, ex-aequo inclus).
-- Ne renvoie que les champions des semaines terminées : (week_start lundi, profile_id, wins).
create or replace function public._weekly_champions_all()
returns table (week_start date, profile_id uuid, wins integer)
language sql stable security definer
set search_path = public, extensions
as $$
  with w as (
    select date_trunc('week', m.finished_at at time zone 'Europe/Paris')::date as ws,
           x.profile_id, count(*)::int as wins
      from public.match_players x
      join public.matches m on m.id = x.match_id and m.status = 'finished' and m.finished_at is not null
      join public.profiles gp on gp.id = x.profile_id and not gp.is_guest  -- invités exclus (guest.sql)
     where x.won
     group by 1, 2
  ), top as (
    select w.*, max(w.wins) over (partition by w.ws) as best from w
  )
  select t.ws, t.profile_id, t.wins
    from top t
   where t.wins = t.best and t.wins >= 1 and t.ws < public._week_start_now()
$$;

-- Classement de la semaine en cours (général si p_game est null, sinon pour ce jeu).
-- -> {week_start, week_end (dimanche), ends_at (timestamptz, fin de semaine),
--     rows:[{profile_id, slug, nickname, equipped_expression, equipped_tenue, level, wins, games_played, points, rank}],
--     last_week:{week_start, week_end, wins, champions:[{profile_id, slug, nickname, equipped_tenue}]}|null}
-- rows contient tous les joueurs (0 partie incluse), le front filtre.
create or replace function public.leaderboard_week(p_game text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_start date := public._week_start_now();
  v_from  timestamptz := v_start::timestamp at time zone 'Europe/Paris';
  v_to    timestamptz := (v_start + 7)::timestamp at time zone 'Europe/Paris';
  v_last  date;
begin
  perform public._require_profile();
  select max(c.week_start) into v_last from public._weekly_champions_all() c;
  return jsonb_build_object(
    'week_start', v_start,
    'week_end', v_start + 6,
    'ends_at', v_to,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', r.id, 'slug', r.slug, 'nickname', r.nickname,
               'equipped_expression', r.equipped_expression, 'equipped_tenue', r.equipped_tenue,
               'level', public.level_for_xp(r.xp), 'wins', r.wins, 'games_played', r.games,
               'points', r.pts, 'rank', r.rk) order by r.rk, r.sort_order)
        from (
          select a.*, rank() over (order by a.wins desc, a.pts desc, a.games asc) as rk
            from (
              select p.id, p.slug, p.nickname, p.equipped_expression, p.equipped_tenue, p.xp, p.sort_order,
                     count(mp.profile_id) filter (where mp.won)::int as wins,
                     count(mp.profile_id)::int as games,
                     coalesce(sum(mp.points), 0)::int as pts
                from public.profiles p
                left join (
                  select x.profile_id, x.won, x.points
                    from public.match_players x
                    join public.matches m on m.id = x.match_id
                   where m.status = 'finished' and m.finished_at >= v_from and m.finished_at < v_to
                     and (p_game is null or x.game_id = p_game)
                ) mp on mp.profile_id = p.id
               where not p.is_guest  -- invités exclus (guest.sql)
               group by p.id
            ) a
        ) r), '[]'::jsonb),
    'last_week', case when v_last is null then null else (
      select jsonb_build_object(
               'week_start', v_last, 'week_end', v_last + 6, 'wins', max(c.wins),
               'champions', jsonb_agg(jsonb_build_object(
                  'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
                  order by p.sort_order))
        from public._weekly_champions_all() c join public.profiles p on p.id = c.profile_id
       where c.week_start = v_last) end);
end $$;

-- Semaines gagnées (« Victorieux de la semaine »), plus récentes d'abord.
-- p_profile = un joueur -> ses semaines ; null -> toutes les semaines gagnées par tous (hall of fame).
-- -> [{week_start, week_end, wins, profile_id, slug, nickname, equipped_tenue}]
create or replace function public.weekly_champions(p_profile uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  perform public._require_profile();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'week_start', c.week_start, 'week_end', c.week_start + 6, 'wins', c.wins,
             'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
             order by c.week_start desc, p.sort_order)
      from public._weekly_champions_all() c
      join public.profiles p on p.id = c.profile_id
     where p_profile is null or c.profile_id = p_profile), '[]'::jsonb);
end $$;

revoke all on function public._week_start_now() from public, anon, authenticated;
revoke all on function public._weekly_champions_all() from public, anon, authenticated;
revoke all on function public.leaderboard_week(text) from public, anon;
revoke all on function public.weekly_champions(uuid) from public, anon;
grant execute on function public.leaderboard_week(text) to authenticated;
grant execute on function public.weekly_champions(uuid) to authenticated;
