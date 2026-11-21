-- =============================================================================
-- FACE-A-FACE : bilan entre le joueur connecte et un autre joueur — idempotent.
-- Parties jouees ensemble (match_players), victoires de chacun, duels directs
-- (parties a exactement 2 joueurs : eux deux), jeu ou chacun domine l'autre.
-- =============================================================================

create or replace function public.head_to_head(p_other uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_res jsonb;
begin
  if p_other is null or p_other = v_me
     or not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'unknown_profile';
  end if;
  with common as (
    select a.match_id, a.game_id, a.won as me_won, b.won as other_won,
           a.placement as me_pl, b.placement as other_pl, m.finished_at,
           (select count(*) from public.match_players x where x.match_id = a.match_id) as n
      from public.match_players a
      join public.match_players b on b.match_id = a.match_id and b.profile_id = p_other
      join public.matches m on m.id = a.match_id and m.status = 'finished'
     where a.profile_id = v_me
  ),
  per_game as (
    select game_id, count(*)::int as played,
           count(*) filter (where me_pl < other_pl)::int as me_ahead,
           count(*) filter (where other_pl < me_pl)::int as other_ahead
      from common group by game_id
  )
  select jsonb_build_object(
    'played',          (select count(*)::int from common),
    'me_wins',         (select count(*)::int from common where me_won),
    'other_wins',      (select count(*)::int from common where other_won),
    'duels',           (select count(*)::int from common where n = 2),
    'me_duel_wins',    (select count(*)::int from common where n = 2 and me_won),
    'other_duel_wins', (select count(*)::int from common where n = 2 and other_won),
    -- jeu ou chacun domine l'autre : meilleur ecart de classement (min. 2 parties communes)
    'me_best_game', (select jsonb_build_object('game_id', game_id, 'ahead', me_ahead, 'played', played)
                       from per_game where played >= 2 and me_ahead > other_ahead
                      order by me_ahead - other_ahead desc, played desc, game_id limit 1),
    'other_best_game', (select jsonb_build_object('game_id', game_id, 'ahead', other_ahead, 'played', played)
                          from per_game where played >= 2 and other_ahead > me_ahead
                         order by other_ahead - me_ahead desc, played desc, game_id limit 1),
    'last', (select jsonb_build_object('game_id', game_id, 'finished_at', finished_at,
                                       'winner', case when me_won and not other_won then 'me'
                                                      when other_won and not me_won then 'other' else null end)
               from common order by finished_at desc nulls last limit 1),
    'other', (select jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                        'equipped_tenue', p.equipped_tenue)
                from public.profiles p where p.id = p_other)
  ) into v_res;
  return v_res;
end $$;

revoke all on function public.head_to_head(uuid) from public, anon;
grant execute on function public.head_to_head(uuid) to authenticated;
