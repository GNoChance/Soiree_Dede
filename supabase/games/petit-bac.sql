-- =============================================================================
-- JEU « petit-bac » (Petit bac multi-écrans) — idempotent (create or replace).
-- Dépend de schema.sql (_normalize_word, game_action, start_match, finish_match).
--
-- Phases : writing -> validation -> round_score -> (writing … ) -> finished.
-- Les réponses en cours d'écriture restent dans `server.answers` (privé) ;
-- le state public n'expose que `progress` (nb de cases remplies par joueur).
-- Chaque joueur récupère SES réponses dans match_secrets ({round, answers}).
-- =============================================================================

-- Normalisation d'une réponse : minuscules, sans article de tête
-- (le/la/les/l'/un/une), sans accents, espaces ni ponctuation, et sans s/x final
-- si le résultat fait plus de 3 caractères (lion = lions). Miroir : normalizeAnswer (logic.ts).
create or replace function public._pb_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when char_length(n) > 3 and n ~ '[sx]$' then left(n, -1) else n end
    from (select public._normalize_word(
            regexp_replace(lower(btrim(coalesce(p, ''))), '^(l\s*[''’`]\s*|(le|la|les|un|une)\s+)', '')) as n) t
$$;

-- Première lettre acceptée : celle du texte sans article OU du texte brut
-- (« La Réunion », « L'Italie » valent pour la lettre L). Miroir : autoStatus (logic.ts).
create or replace function public._pb_letter_ok(p text, p_letter text)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select left(public._pb_norm(p), 1) = lower(p_letter)
      or left(public._normalize_word(lower(btrim(coalesce(p, '')))), 1) = lower(p_letter)
$$;
-- Nettoyage d'une saisie : espaces normalisés, 60 caractères max.
create or replace function public._pb_clean(p text)
returns text language sql immutable
set search_path = public, extensions
as $$ select left(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), 60) $$;

-- Démarre la manche p_round (lettre déjà tirée dans server.letters).
create or replace function public._pb_start_round(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_letter text := p_server->'letters'->>(p_round - 1);
  v_start  timestamptz := now() + interval '4 seconds';  -- temps de l'animation de tirage
  v_zero   jsonb;
begin
  select jsonb_object_agg(x, 0) into v_zero from jsonb_array_elements_text(p_state->'players') x;
  p_state := p_state || jsonb_build_object(
    'phase', 'writing',
    'round', p_round,
    'letter', v_letter,
    'letters_used', coalesce(p_state->'letters_used', '[]'::jsonb) || to_jsonb(v_letter),
    'starts_at', v_start,
    'deadline', v_start + make_interval(secs => (p_state->>'duration')::integer),
    'progress', v_zero,
    'validation', null);
  p_server := p_server || jsonb_build_object('answers', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- (Re)construit validation.answers à partir des réponses privées :
-- {catId: {uid: {text, norm, auto: null|'empty'|'letter'}}}.
create or replace function public._pb_build_answers(p_state jsonb, p_server jsonb)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(c->>'id', (
    select jsonb_object_agg(x.pl, jsonb_build_object(
             'text', x.t,
             'norm', public._pb_norm(x.t),
             'auto', case when public._pb_norm(x.t) = '' then 'empty'
                          when not public._pb_letter_ok(x.t, p_state->>'letter') then 'letter'
                          else null end))
      from (select pl, coalesce(p_server->'answers'->pl->>(c->>'id'), '') as t
              from jsonb_array_elements_text(p_state->'players') pl) x)), '{}'::jsonb)
  from jsonb_array_elements(p_state->'categories') c
$$;

create or replace function public._pb_to_validation(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'validation',
    'validation', jsonb_build_object(
      'cat_index', 0,
      'deadline', to_jsonb(now() + interval '15 seconds'),
      'answers', public._pb_build_answers(p_state, p_server),
      'contests', '{}'::jsonb));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Catégorie suivante (ou scores après la dernière) : hôte (next_category) ou tick à l'échéance.
create or replace function public._pb_advance(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cur integer := (p_state#>>'{validation,cat_index}')::integer;
begin
  if v_cur + 1 >= jsonb_array_length(p_state->'categories') then
    return public._pb_score(p_state, p_server);
  end if;
  p_state := jsonb_set(p_state, '{validation,cat_index}', to_jsonb(v_cur + 1));
  p_state := jsonb_set(p_state, '{validation,deadline}', to_jsonb(now() + interval '15 seconds'), true);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Compteur de trophées de la manche : det[pl][key] += 1.
create or replace function public._pb_bump(p_det jsonb, p_pl text, p_key text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_det || jsonb_build_object(p_pl,
    coalesce(p_det->p_pl, '{}'::jsonb) || jsonb_build_object(p_key, coalesce((p_det->p_pl->>p_key)::integer, 0) + 1))
$$;

-- Barème de la manche : unique valide 2, valide partagée 1, refusée/vide 0.
-- Refusée si contestée par la majorité stricte des AUTRES joueurs (et au moins 2 contestations :
-- à 2 joueurs, une contestation seule ne refuse rien).
create or replace function public._pb_score(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_cat     text;
  pl        text;
  a         jsonb;
  v_cnt     integer;
  v_status  text;
  v_pts     integer;
  v_valid   jsonb;
  v_cd      jsonb;
  v_detail  jsonb := '{}'::jsonb;
  v_points  jsonb;
  v_uniq    jsonb;
  v_det     jsonb := '{}'::jsonb;
  v_c       text;
begin
  select jsonb_object_agg(x, 0) into v_points from jsonb_array_elements_text(p_state->'players') x;
  v_uniq := v_points;

  for v_cat in select c->>'id' from jsonb_array_elements(p_state->'categories') c loop
    v_valid := '{}'::jsonb;
    v_cd := '{}'::jsonb;
    for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
      a := p_state#>array['validation', 'answers', v_cat, pl];
      v_cnt := coalesce(jsonb_array_length(p_state#>array['validation', 'contests', v_cat, pl]), 0);
      if a is null or a->>'auto' is not null then
        v_status := coalesce(a->>'auto', 'empty');
      elsif v_cnt >= 2 and v_cnt * 2 > v_n - 1 then   -- à 2 joueurs : jamais refusée par un seul 👎
        v_status := 'refused';
      else
        v_status := 'valid';
        v_valid := v_valid || jsonb_build_object(pl, a->>'norm');
      end if;
      v_cd := v_cd || jsonb_build_object(pl, jsonb_build_object(
                'text', coalesce(a->>'text', ''), 'status', v_status, 'pts', 0, 'contests', v_cnt));
    end loop;

    for pl in select key from jsonb_each_text(v_valid) loop
      select count(*) into v_cnt from jsonb_each_text(v_valid) where value = v_valid->>pl;
      v_pts := case when v_cnt > 1 then 1 else 2 end;
      v_cd := jsonb_set(v_cd, array[pl], (v_cd->pl) || jsonb_build_object(
                'status', case when v_cnt > 1 then 'shared' else 'unique' end, 'pts', v_pts));
      v_points := jsonb_set(v_points, array[pl], to_jsonb((v_points->>pl)::integer + v_pts));
      if v_pts = 2 then
        v_uniq := jsonb_set(v_uniq, array[pl], to_jsonb((v_uniq->>pl)::integer + 1));
      end if;
    end loop;
    v_detail := v_detail || jsonb_build_object(v_cat, v_cd);

    -- Compteurs de trophées : refusées, partagées, vides, grille pleine, contestations abouties
    for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
      v_status := v_cd->pl->>'status';
      if v_status = 'refused' then
        v_det := public._pb_bump(v_det, pl, 'refused');
        for v_c in select x from jsonb_array_elements_text(
                     coalesce(p_state#>array['validation', 'contests', v_cat, pl], '[]'::jsonb)) x loop
          v_det := public._pb_bump(v_det, v_c, 'lawyer');
        end loop;
      elsif v_status = 'shared' then
        v_det := public._pb_bump(v_det, pl, 'shared');
      elsif v_status = 'empty' then
        v_det := public._pb_bump(v_det, pl, 'empty');
      end if;
      if v_status in ('unique', 'shared') then v_det := public._pb_bump(v_det, pl, 'valid'); end if;
    end loop;
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'round_score',
    'score_deadline', to_jsonb(now() + interval '20 seconds'),  -- animation des scores + lecture, puis tick -> manche suivante
    'validation', null,
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'uniques', (select jsonb_object_agg(key, value::integer + coalesce((v_uniq->>key)::integer, 0))
                  from jsonb_each_text(coalesce(p_state->'uniques', v_points))),
    'last_round', jsonb_build_object(
        'round', p_state->'round', 'letter', p_state->'letter',
        'points', v_points, 'uniques', v_uniq, 'detail', v_detail),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'round', p_state->'round', 'letter', p_state->'letter', 'points', v_points, 'det', v_det,
        -- moments de fin de partie : mot valide le plus long, réponse la plus contestée (null si rien)
        'longest', (select jsonb_build_object('pl', e.pl, 'text', e.d->>'text', 'cat', e.cat)
                      from (select c.key as cat, x.key as pl, x.value as d
                              from jsonb_each(v_detail) c, jsonb_each(c.value) x) e
                     where e.d->>'status' in ('unique', 'shared')
                     order by char_length(e.d->>'text') desc, e.cat, e.pl limit 1),
        'hot', (select jsonb_build_object('pl', e.pl, 'text', e.d->>'text', 'cat', e.cat,
                                          'contests', (e.d->>'contests')::integer, 'status', e.d->>'status')
                  from (select c.key as cat, x.key as pl, x.value as d
                          from jsonb_each(v_detail) c, jsonb_each(c.value) x) e
                 where (e.d->>'contests')::integer > 0 and e.d->>'text' <> ''
                 order by (e.d->>'contests')::integer desc, e.cat, e.pl limit 1))));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].points.
create or replace function public._pb_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select coalesce((e.v->'points'->>p_pl)::integer, 0) as mine,
           coalesce((select max(value::integer) from jsonb_each_text(e.v->'points')), 0) as mx,
           coalesce((e.v->'det'->p_pl->>'refused')::integer, 0) as refused,
           coalesce((e.v->'det'->p_pl->>'shared')::integer, 0) as shared,
           coalesce((e.v->'det'->p_pl->>'empty')::integer, 0) as empty,
           coalesce((e.v->'det'->p_pl->>'valid')::integer, 0) as valid,
           coalesce((e.v->'det'->p_pl->>'lawyer')::integer, 0) as lawyer
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) as e(v)
  )
  select jsonb_build_object(
    'uniques', coalesce((p_state->'uniques'->>p_pl)::integer, 0),
    'refused', coalesce(sum(refused), 0),
    'shared', coalesce(sum(shared), 0),
    'max_empty', coalesce(max(empty), 0),
    'full_grids', count(*) filter (where valid >= jsonb_array_length(p_state->'categories')),
    'lawyer', coalesce(sum(lawyer), 0),
    'zero_rounds', count(*) filter (where mine = 0),
    'perfect_rounds', count(*) filter (where mine = 2 * jsonb_array_length(p_state->'categories')),
    'best_rounds', count(*) filter (where mine > 0 and mine = mx),
    'regular', case when count(*) >= 3 and min(mine) >= 8 then 1 else 0 end,
    'grand_slam', case when count(*) >= 4 and bool_and(mine = mx and mx > 0) then 1 else 0 end)
  from h
$$;

create or replace function public._pb_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
begin
  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', t.value::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', public._pb_tstats(p_state, t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Options : {"categories":[{"id","label","emoji"}] (1-12), "duration":90|120|180|300,
--            "rounds":1-15, "letters":["A",…] (lettres tirables, défaut A-V sans K/Q)}
create or replace function public.game_petit_bac_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_cats    jsonb := p_options->'categories';
  v_letters text[];
  v_dur     integer;
  v_rounds  integer;
  v_seq     jsonb;
  v_zero    jsonb;
  v_state   jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;

  if v_cats is null or jsonb_typeof(v_cats) <> 'array'
     or jsonb_array_length(v_cats) not between 1 and 12 then
    raise exception 'invalid_categories';
  end if;
  if exists (select 1 from jsonb_array_elements(v_cats) c
              where jsonb_typeof(c) <> 'object'
                 or coalesce(c->>'id', '') !~ '^[a-z0-9_-]{1,40}$'
                 or char_length(btrim(coalesce(c->>'label', ''))) not between 1 and 40
                 or char_length(coalesce(c->>'emoji', '')) > 16)
     or (select count(distinct c->>'id') from jsonb_array_elements(v_cats) c) <> jsonb_array_length(v_cats) then
    raise exception 'invalid_categories';
  end if;
  select jsonb_agg(jsonb_build_object('id', c->>'id', 'label', btrim(c->>'label'),
                                      'emoji', coalesce(c->>'emoji', '')) order by o)
    into v_cats from jsonb_array_elements(v_cats) with ordinality as t(c, o);

  if jsonb_typeof(p_options->'letters') = 'array' then
    v_letters := array(select distinct upper(x) from jsonb_array_elements_text(p_options->'letters') x
                        where upper(x) ~ '^[A-Z]$');
  end if;
  if coalesce(cardinality(v_letters), 0) = 0 then
    v_letters := string_to_array('A,B,C,D,E,F,G,H,I,J,L,M,N,O,P,R,S,T,U,V', ',');
  end if;

  v_dur := coalesce(nullif(p_options->>'duration', '')::integer, 120);
  if v_dur not in (90, 120, 180, 300) then v_dur := 120; end if;
  v_rounds := coalesce(nullif(p_options->>'rounds', '')::integer, 5);
  v_rounds := least(greatest(v_rounds, 1), 15, cardinality(v_letters));

  -- Lettres de toute la partie tirées d'avance, sans répétition (secret serveur).
  select jsonb_agg(l) into v_seq
    from (select l from unnest(v_letters) l order by random() limit v_rounds) t;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'petit-bac',
    'phase', 'writing',
    'round', 1,
    'total_rounds', v_rounds,
    'players', to_jsonb(p_players),
    'categories', v_cats,
    'duration', v_dur,
    'letter', null,
    'letters_used', '[]'::jsonb,
    'starts_at', null,
    'deadline', null,
    'progress', v_zero,
    'validation', null,
    'scores', v_zero,
    'uniques', v_zero,
    'last_round', null,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);

  return public._pb_start_round(v_state, jsonb_build_object('letters', v_seq, 'answers', '{}'::jsonb), 1)
         || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

create or replace function public.game_petit_bac_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_me       text := p_actor::text;
  v_player   boolean := (p_state->'players') ? p_actor::text;
  v_round    integer := (p_state->>'round')::integer;
  v_ans      jsonb;
  v_mine     jsonb;
  v_filled   integer;
  v_cat      text;
  v_idx      integer;
  v_cur      integer;
  v_ncat     integer := jsonb_array_length(p_state->'categories');
  v_target   text;
  v_value    boolean;
  v_list     jsonb;
  v_contests jsonb;
  v_res      jsonb;
begin
  -- ---------------------------------------------------------------- save
  if v_type = 'save' then
    if not v_player then raise exception 'not_a_player'; end if;
    v_ans := p_action->'answers';
    if v_ans is null or jsonb_typeof(v_ans) <> 'object' then raise exception 'invalid_action'; end if;
    -- Sauvegarde hors délai / d'une autre manche : ignorée sans erreur
    -- (tolérance réseau : acceptée jusqu'à 2 s après l'échéance, même si la
    -- validation a déjà commencé — les réponses affichées sont alors recalculées).
    if (p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round'))
       or v_phase not in ('writing', 'validation')
       or now() > (p_state->>'deadline')::timestamptz + interval '2 seconds' then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;

    v_mine := coalesce(p_server->'answers'->v_me, '{}'::jsonb);
    select v_mine || coalesce(jsonb_object_agg(c->>'id', public._pb_clean(v_ans->>(c->>'id'))), '{}'::jsonb)
      into v_mine
      from jsonb_array_elements(p_state->'categories') c
     where jsonb_typeof(v_ans->(c->>'id')) = 'string';
    select count(*) into v_filled from jsonb_each_text(v_mine) where value <> '';

    p_server := jsonb_set(p_server, array['answers', v_me], v_mine, true);
    p_state := jsonb_set(p_state, array['progress', v_me], to_jsonb(v_filled), true);
    if v_phase = 'validation' then
      p_state := jsonb_set(p_state, '{validation,answers}', public._pb_build_answers(p_state, p_server));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server,
      'secrets', jsonb_build_object(v_me, jsonb_build_object('round', v_round, 'answers', v_mine)));

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'writing' and now() >= (p_state->>'deadline')::timestamptz then
      return public._pb_to_validation(p_state, p_server);
    end if;
    -- Validation : la catégorie avance seule à son échéance (state anciens sans deadline : inchangés).
    if v_phase = 'round_score' and p_state->>'score_deadline' is not null
       and now() >= (p_state->>'score_deadline')::timestamptz then
      if v_round >= (p_state->>'total_rounds')::integer then
        return public._pb_finish(p_state, p_server);
      end if;
      return public._pb_start_round(p_state - 'forced' - 'score_deadline', p_server, v_round + 1);
    end if;
    if v_phase = 'validation' and p_state#>>'{validation,deadline}' is not null
       and now() >= (p_state#>>'{validation,deadline}')::timestamptz then
      return public._pb_advance(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- end_round
  elsif v_type = 'end_round' then
    -- « STOP ! » : l'hôte à tout moment ; un joueur seulement s'il a rempli toutes ses cases.
    if not p_is_host and not v_player then raise exception 'not_a_player'; end if;
    if v_phase <> 'writing' then raise exception 'wrong_phase'; end if;
    -- Les dernières réponses du joueur peuvent voyager avec l'action (pas de course avec la sauvegarde auto).
    if v_player and jsonb_typeof(p_action->'answers') = 'object' then
      v_res := public.game_petit_bac_action(p_state, p_server, p_actor, p_is_host,
                 jsonb_build_object('type', 'save', 'round', v_round, 'answers', p_action->'answers'));
      p_state := v_res->'state';
      p_server := v_res->'server';
    end if;
    if not p_is_host and coalesce((p_state#>>array['progress', v_me])::integer, 0) < v_ncat then
      raise exception 'not_finished';
    end if;
    -- L'échéance devient « maintenant » : la tolérance de 2 s s'applique aussi.
    p_state := p_state || jsonb_build_object('deadline', least(now(), (p_state->>'deadline')::timestamptz),
                                             'forced', true);
    return public._pb_to_validation(p_state, p_server);

  -- ---------------------------------------------------------------- contest
  elsif v_type = 'contest' then
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    if not v_player then raise exception 'not_a_player'; end if;
    v_cat := p_action->>'category';
    select o - 1 into v_idx
      from jsonb_array_elements(p_state->'categories') with ordinality as t(c, o)
     where c->>'id' = v_cat;
    if v_idx is null then raise exception 'invalid_action'; end if;
    v_cur := (p_state#>>'{validation,cat_index}')::integer;
    if v_idx > v_cur then raise exception 'wrong_phase'; end if;
    v_target := p_action->>'target';
    if v_target is null or not ((p_state->'players') ? v_target) then raise exception 'invalid_target'; end if;
    if v_target = v_me then raise exception 'cannot_vote_self'; end if;
    if p_state#>>array['validation', 'answers', v_cat, v_target, 'auto'] is not null then
      raise exception 'invalid_target';  -- déjà refusée automatiquement
    end if;
    v_value := coalesce((p_action->>'value')::boolean, true);

    v_contests := coalesce(p_state#>'{validation,contests}', '{}'::jsonb);
    select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_list
      from (select x from jsonb_array_elements_text(coalesce(v_contests#>array[v_cat, v_target], '[]'::jsonb)) x
             where x <> v_me
            union
            select v_me where v_value) t;
    v_contests := v_contests || jsonb_build_object(v_cat,
                    coalesce(v_contests->v_cat, '{}'::jsonb) || jsonb_build_object(v_target, v_list));
    p_state := jsonb_set(p_state, '{validation,contests}', v_contests);
    -- Contestation sur la catégorie en cours : on laisse au moins 8 s pour en discuter (jamais raccourci).
    if v_value and v_idx = v_cur and p_state#>>'{validation,deadline}' is not null then
      p_state := jsonb_set(p_state, '{validation,deadline}', to_jsonb(greatest(
        (p_state#>>'{validation,deadline}')::timestamptz, now() + interval '8 seconds')));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- next_category
  elsif v_type = 'next_category' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    return public._pb_advance(p_state, p_server);

  -- ---------------------------------------------------------------- close_validation
  elsif v_type = 'close_validation' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'validation' then raise exception 'wrong_phase'; end if;
    return public._pb_score(p_state, p_server);

  -- ---------------------------------------------------------------- next_round
  elsif v_type = 'next_round' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'round_score' then raise exception 'wrong_phase'; end if;
    if v_round >= (p_state->>'total_rounds')::integer then
      return public._pb_finish(p_state, p_server);
    end if;
    return public._pb_start_round(p_state - 'forced', p_server, v_round + 1);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._pb_norm(text) from public, anon, authenticated;
revoke all on function public._pb_letter_ok(text, text) from public, anon, authenticated;
revoke all on function public._pb_advance(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_clean(text) from public, anon, authenticated;
revoke all on function public._pb_start_round(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._pb_build_answers(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_bump(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._pb_to_validation(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_score(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._pb_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_petit_bac_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_petit_bac_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
