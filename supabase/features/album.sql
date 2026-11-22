-- =============================================================================
-- ALBUM SOUVENIR — idempotent, exécuté en features/* (les fonctions référencent recap / stats / trophées
-- à l'exécution seulement, l'ordre alphabétique de chargement n'a donc pas d'importance).
-- Une soirée terminée = une page d'album. `album_year(p_year)` renvoie, en un appel, toutes les soirées
-- TERMINÉES de l'année (Europe/Paris) auxquelles l'appelant a participé (hôte, membre ou joueur d'une partie),
-- de la plus ancienne à la plus récente (max 150) :
--   { year, soirees:[ { soiree_id, started_at, ended_at, duration_min, host:{...}|null,
--       games_played, distinct_games, players:[...], games:[{game_id,played}],
--       matches:[{game_id, finished_at, winners:[{profile_id,slug,nickname,equipped_tenue}]}],
--       standings:[...], winner_ids:[...], awards:[...],
--       highlights:{
--         margin: {profile_id, points, lead} | null     -- plus grosse victoire (écart sur le 2e)
--         trophies: [{profile_id, name}]                -- trophées débloqués pendant la soirée (6 max)
--         words: [{profile_id, text, category, letter}] -- mots uniques du Petit Bac (dernière manche, 3 max)
--         dilemma: {a, b, count_a, count_b} | null      -- dilemme « Tu préfères » le plus partagé (>= 3 votes)
--       } } ] }
-- Aucune table : tout est lu dans soiree_recaps / matches.state / trophy_unlocks.
-- Erreur : album_invalid_year.
-- =============================================================================

create or replace function public._album_soiree(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  s          public.soirees%rowtype;
  v_rec      jsonb;
  v_st       jsonb;
  v_matches  jsonb;
  v_margin   jsonb;
  v_trophies jsonb;
  v_words    jsonb;
  v_dil      jsonb;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then return null; end if;
  select data into v_rec from public.soiree_recaps where soiree_id = s.id;
  if v_rec is null then v_rec := public._soiree_recap_compute(s.id); end if;
  v_st := public._soiree_standings(s.id);

  select coalesce(jsonb_agg(jsonb_build_object('game_id', m.game_id, 'finished_at', m.finished_at,
           'winners', coalesce((select jsonb_agg(jsonb_build_object('profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                   'equipped_tenue', p.equipped_tenue) order by p.sort_order)
                                  from public.match_players x join public.profiles p on p.id = x.profile_id
                                 where x.match_id = m.id and x.won), '[]'::jsonb))
         order by m.finished_at, m.id), '[]'::jsonb)
    into v_matches
    from public.matches m
   where m.soiree_id = s.id and m.status = 'finished'
     and exists (select 1 from public.match_players x where x.match_id = m.id);

  -- plus grosse victoire : écart de points entre le 1er et le 2e (>= 1 point d'avance)
  select jsonb_build_object('profile_id', a->>'profile_id', 'points', (a->>'points')::int,
                            'lead', (a->>'points')::int - coalesce((b->>'points')::int, 0))
    into v_margin
    from (select v_st->0 as a, v_st->1 as b) t
   where jsonb_array_length(v_st) >= 2 and (a->>'points')::int > 0 and (a->>'rank')::int = 1
     and (a->>'points')::int - coalesce((b->>'points')::int, 0) >= 1;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', t.profile_id, 'name', t.name) order by t.at), '[]'::jsonb)
    into v_trophies
    from (select u.profile_id, tr.name, u.unlocked_at as at
            from public.trophy_unlocks u join public.trophies tr on tr.id = u.trophy_id
           where u.unlocked_at >= coalesce(s.started_at, s.created_at)
             and u.unlocked_at <= coalesce(s.ended_at, now()) + interval '5 minutes'
             and u.profile_id in (select profile_id from public.soiree_players where soiree_id = s.id
                                  union select x.profile_id from public.match_players x join public.matches m on m.id = x.match_id
                                         where m.soiree_id = s.id)
           order by u.unlocked_at limit 6) t;

  -- Petit Bac : mots uniques (2 pts) de la dernière manche de chaque partie, les plus longs d'abord
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', w.pl, 'text', w.txt, 'category', w.cat, 'letter', w.letter)
                            order by w.len desc, w.txt), '[]'::jsonb)
    into v_words
    from (select pl.key as pl, pl.value->>'text' as txt, length(pl.value->>'text') as len,
                 coalesce((select c->>'label' from jsonb_array_elements(m.state->'categories') c where c->>'id' = cat.key), cat.key) as cat,
                 m.state#>>'{last_round,letter}' as letter
            from public.matches m,
                 jsonb_each(coalesce(m.state#>'{last_round,detail}', '{}'::jsonb)) cat,
                 jsonb_each(cat.value) pl
           where m.soiree_id = s.id and m.game_id = 'petit-bac' and m.status = 'finished'
             and pl.value->>'status' = 'unique' and length(coalesce(pl.value->>'text', '')) >= 3
           order by length(pl.value->>'text') desc, pl.value->>'text' limit 3) w;

  -- Tu préfères : le dilemme qui a le plus divisé le groupe
  select jsonb_build_object('a', h.e#>>'{dilemma,a}', 'b', h.e#>>'{dilemma,b}',
                            'count_a', (h.e#>>'{counts,a}')::int, 'count_b', (h.e#>>'{counts,b}')::int)
    into v_dil
    from (select e from public.matches m, jsonb_array_elements(coalesce(m.state->'history', '[]'::jsonb)) e
           where m.soiree_id = s.id and m.game_id = 'tu-preferes' and m.status = 'finished'
             and coalesce((e#>>'{counts,a}')::int, 0) + coalesce((e#>>'{counts,b}')::int, 0) >= 3
             and e#>>'{dilemma,a}' is not null
           order by abs(coalesce((e#>>'{counts,a}')::int, 0) - coalesce((e#>>'{counts,b}')::int, 0)),
                    e#>>'{dilemma,a}'
           limit 1) h;

  return jsonb_build_object(
    'soiree_id', s.id, 'started_at', coalesce(s.started_at, s.created_at), 'ended_at', s.ended_at,
    'duration_min', v_rec->'duration_min',
    'host', (select jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
               from public.profiles p where p.id = s.host_id),
    'games_played', v_rec->'games_played', 'distinct_games', v_rec->'distinct_games',
    'players', v_rec->'players', 'games', v_rec->'games', 'awards', v_rec->'awards',
    'matches', v_matches, 'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb),
    'highlights', jsonb_build_object('margin', v_margin, 'trophies', v_trophies, 'words', v_words, 'dilemma', v_dil));
end $$;

create or replace function public.album_year(p_year integer)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_profile();
  v_from timestamptz;
  v_to   timestamptz;
begin
  if p_year is null or p_year < 2024 or p_year > 2100 then raise exception 'album_invalid_year'; end if;
  v_from := make_timestamptz(p_year, 1, 1, 0, 0, 0, 'Europe/Paris');
  v_to   := make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'Europe/Paris');
  return jsonb_build_object('year', p_year, 'soirees', coalesce((
    select jsonb_agg(public._album_soiree(z.id) order by z.at, z.id)
      from (select s.id, coalesce(s.started_at, s.created_at) as at
              from public.soirees s
             where s.status = 'ended'
               and coalesce(s.started_at, s.created_at) >= v_from and coalesce(s.started_at, s.created_at) < v_to
               and (s.host_id = v_me
                    or exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
                    or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                                where m.soiree_id = s.id and x.profile_id = v_me))
             order by 2, 1 limit 150) z), '[]'::jsonb));
end $$;

revoke all on function public._album_soiree(uuid) from public, anon, authenticated;
revoke all on function public.album_year(integer) from public, anon;
grant execute on function public.album_year(integer) to authenticated;
