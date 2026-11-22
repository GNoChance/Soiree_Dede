-- =============================================================================
-- MON ANNEE (Wrapped annuel) - idempotent, execute en features/* (apres stats, trophees, tenues, daily).
-- year_wrapped(p_year) : stats du joueur CONNECTE pour l'annee civile (heure de Paris).
-- jsonb : { year, profile:{id,slug,nickname,equipped_tenue}, games_played, wins, win_rate, soirees,
--   distinct_games,
--   favorite_game:{game_id,played}|null, best_game:{game_id,played,wins,win_rate}|null,
--   longest_soiree:{soiree_id,minutes,started_at,games}|null,
--   latest_match:{at:'HH:MI', hour, game_id, day}|null  (parties jouees entre 18h et 5h59, la plus tardive),
--   night_games (parties finies entre 0h et 5h59),
--   rival:{profile_id,slug,nickname,equipped_tenue,losses}|null  (>= 2 defaites contre lui),
--   buddy:{profile_id,slug,nickname,equipped_tenue,together}|null, distinct_mates,
--   trophies:{count, recent:[{id,name}]}, tenues:{count, recent:[{id,label,emoji}]},
--   daily:{days, best_streak},
--   personality:{id} }
-- ids de personnalite : noctambule, champion, assidu, collectionneur, sociable, touche_a_tout, fidele,
--   bon_joueur, curieux
-- Volatile (table temporaire locale a la transaction) : appelee en POST par rpc().
-- =============================================================================

create or replace function public.year_wrapped(p_year integer)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  p        public.profiles%rowtype;
  v_from   timestamp;
  v_to     timestamp;
  v_pg     jsonb;
  v_played int;
  v_wins   int;
  v_soir   int;
  v_long   jsonb;
  v_late   jsonb;
  v_night  int;
  v_rival  jsonb;
  v_buddy  jsonb;
  v_mates  int;
  v_trc    int;
  v_trl    jsonb;
  v_tnc    int;
  v_tnl    jsonb;
  v_dd     int;
  v_ds     int;
  v_dg     int;
  v_rate   int;
  v_pers   text;
begin
  if p_year is null or p_year < 2000 or p_year > 2200 then raise exception 'invalid_year'; end if;
  select * into p from public.profiles where id = v_me;
  v_from := make_timestamp(p_year, 1, 1, 0, 0, 0);
  v_to   := make_timestamp(p_year + 1, 1, 1, 0, 0, 0);

  create temp table if not exists _ywm (mid uuid, sid uuid, game_id text, at_p timestamp, won boolean) on commit drop;
  truncate _ywm;
  insert into _ywm
    select m.id, m.soiree_id, m.game_id, (m.finished_at at time zone 'Europe/Paris'), x.won
      from public.match_players x join public.matches m on m.id = x.match_id
     where x.profile_id = v_me and m.status = 'finished' and m.finished_at is not null
       and (m.finished_at at time zone 'Europe/Paris') >= v_from and (m.finished_at at time zone 'Europe/Paris') < v_to;

  select count(*)::int, count(*) filter (where won)::int into v_played, v_wins from _ywm;
  v_rate := case when v_played > 0 then round(v_wins * 100.0 / v_played)::int else 0 end;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'played', g.played, 'wins', g.wins)
                            order by g.played desc, g.wins desc, g.game_id), '[]'::jsonb)
    into v_pg
    from (select game_id, count(*)::int as played, count(*) filter (where won)::int as wins from _ywm group by game_id) g;
  v_dg := jsonb_array_length(v_pg);

  select count(distinct sid)::int into v_soir from _ywm;

  select jsonb_build_object('soiree_id', s.id, 'minutes', round(extract(epoch from (s.ended_at - s.started_at)) / 60)::int,
                            'started_at', s.started_at,
                            'games', (select count(*)::int from _ywm y where y.sid = s.id))
    into v_long
    from public.soirees s
   where s.id in (select sid from _ywm) and s.started_at is not null and s.ended_at is not null
   order by (s.ended_at - s.started_at) desc, s.id
   limit 1;

  -- « le plus tard » : de 18h a 5h59, on mesure en heures decalees (0h = 24h, 5h = 29h)
  select jsonb_build_object('at', to_char(y.at_p, 'HH24:MI'), 'hour', extract(hour from y.at_p)::int,
                            'game_id', y.game_id, 'day', to_char(y.at_p, 'YYYY-MM-DD'))
    into v_late
    from _ywm y
   where extract(hour from y.at_p) >= 18 or extract(hour from y.at_p) < 6
   order by (extract(epoch from y.at_p::time) / 3600.0 + case when extract(hour from y.at_p) < 18 then 24 else 0 end) desc
   limit 1;
  select count(*)::int into v_night from _ywm y where extract(hour from y.at_p) < 6;

  select jsonb_build_object('profile_id', r.pid, 'slug', pr.slug, 'nickname', pr.nickname,
                            'equipped_tenue', pr.equipped_tenue, 'losses', r.n)
    into v_rival
    from (select w.profile_id as pid, count(*)::int as n
            from _ywm me
            join public.match_players w on w.match_id = me.mid and w.won and w.profile_id <> v_me
            join public.profiles gw on gw.id = w.profile_id and not gw.is_guest  -- invites exclus
           where not me.won
           group by w.profile_id
          having count(*) >= 2
           order by count(*) desc, w.profile_id limit 1) r
    join public.profiles pr on pr.id = r.pid and not pr.is_guest;

  select count(*)::int into v_mates
    from (select distinct o.profile_id from _ywm me join public.match_players o on o.match_id = me.mid and o.profile_id <> v_me
            join public.profiles go on go.id = o.profile_id and not go.is_guest) d;
  select jsonb_build_object('profile_id', r.pid, 'slug', pr.slug, 'nickname', pr.nickname,
                            'equipped_tenue', pr.equipped_tenue, 'together', r.n)
    into v_buddy
    from (select o.profile_id as pid, count(*)::int as n
            from _ywm me join public.match_players o on o.match_id = me.mid and o.profile_id <> v_me
            join public.profiles go on go.id = o.profile_id and not go.is_guest
           group by o.profile_id order by count(*) desc, o.profile_id limit 1) r
    join public.profiles pr on pr.id = r.pid and not pr.is_guest;

  select count(*)::int into v_trc from public.trophy_unlocks u
   where u.profile_id = v_me and (u.unlocked_at at time zone 'Europe/Paris') >= v_from and (u.unlocked_at at time zone 'Europe/Paris') < v_to;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by t.at desc), '[]'::jsonb) into v_trl
    from (select tr.id, tr.name, u.unlocked_at as at from public.trophy_unlocks u join public.trophies tr on tr.id = u.trophy_id
           where u.profile_id = v_me and (u.unlocked_at at time zone 'Europe/Paris') >= v_from and (u.unlocked_at at time zone 'Europe/Paris') < v_to
           order by u.unlocked_at desc limit 3) t;

  select count(*)::int into v_tnc from public.tenue_unlocks u
   where u.profile_id = v_me and (u.unlocked_at at time zone 'Europe/Paris') >= v_from and (u.unlocked_at at time zone 'Europe/Paris') < v_to;
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'emoji', t.emoji) order by t.at desc), '[]'::jsonb) into v_tnl
    from (select te.id, te.label, te.emoji, u.unlocked_at as at from public.tenue_unlocks u join public.tenues te on te.id = u.tenue_id
           where u.profile_id = v_me and (u.unlocked_at at time zone 'Europe/Paris') >= v_from and (u.unlocked_at at time zone 'Europe/Paris') < v_to
           order by u.unlocked_at desc limit 3) t;

  -- defi du jour : jours termines et plus longue serie de jours consecutifs dans l'annee
  select coalesce(max(c), 0)::int into v_ds
    from (select count(*) over (partition by grp) as c
            from (select day, day - (row_number() over (order by day))::int as grp
                    from public.daily_runs
                   where profile_id = v_me and finished_at is not null and day >= v_from::date and day < v_to::date) a) b;
  select count(*)::int into v_dd from public.daily_runs
   where profile_id = v_me and finished_at is not null and day >= v_from::date and day < v_to::date;

  v_pers := case
    when v_played = 0 then 'curieux'
    when v_night >= 3 and v_night * 100 >= v_played * 15 then 'noctambule'
    when v_played >= 10 and v_rate >= 55 then 'champion'
    when v_ds >= 7 then 'assidu'
    when v_trc >= 8 then 'collectionneur'
    when v_mates >= 6 then 'sociable'
    when v_dg >= 8 then 'touche_a_tout'
    when v_soir >= 8 then 'fidele'
    else 'bon_joueur' end;

  return jsonb_build_object(
    'year', p_year,
    'profile', jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue),
    'games_played', v_played, 'wins', v_wins, 'win_rate', v_rate, 'soirees', v_soir,
    'distinct_games', v_dg,
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
    'longest_soiree', v_long,
    'latest_match', v_late,
    'night_games', v_night,
    'rival', v_rival,
    'buddy', v_buddy,
    'distinct_mates', v_mates,
    'trophies', jsonb_build_object('count', v_trc, 'recent', v_trl),
    'tenues', jsonb_build_object('count', v_tnc, 'recent', v_tnl),
    'daily', jsonb_build_object('days', v_dd, 'best_streak', v_ds),
    'personality', jsonb_build_object('id', v_pers));
end $$;

revoke all on function public.year_wrapped(integer) from public, anon;
grant execute on function public.year_wrapped(integer) to authenticated;
