-- MORCEAU 4 / 5 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

-- ===== games\dessine-devine.sql =====
-- =============================================================================
-- JEU « dessine-devine » (Dessine & devine) — idempotent, à recoller sans risque.
-- Contrat complet : src/games/dessine-devine/types.ts (en-tête).
--
-- Options (p_options de start_match), préparées par le front de l'hôte :
--   {"rounds": 1|2|3, "draw_seconds": 60|80|100, "difficulty": "facile|mixte|difficile",
--    "choices": [[{"word":"chat","aliases":["minou"],"difficulty":1}, x3], ...]}
--   `choices` = au moins rounds × nb_joueurs triplets (un par tour).
-- Le mot à dessiner n'est JAMAIS dans le state public avant la révélation du tour :
-- il vit dans `server` et dans le secret du dessinateur.
-- =============================================================================

-- Horodatage ISO-8601 UTC millisecondes (parsable partout, Safari compris).
create or replace function public._dd_iso(p timestamptz)
returns text language sql immutable
set search_path = public, extensions
as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

-- Normalisation d'une proposition / d'un mot : casse, accents, ligatures,
-- ponctuation, articles en tête (le, la, les, l', un, une, des, du, de, d', au, aux).
create or replace function public._dd_norm(p text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  s    text;
  prev text;
  base text;
  i    integer := 0;
begin
  s := lower(translate(
    replace(replace(replace(replace(coalesce(p, ''), 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'));
  s := btrim(regexp_replace(s, '[^a-z0-9]+', ' ', 'g'));
  base := replace(s, ' ', '');
  loop
    prev := s;
    s := regexp_replace(s, '^(l|d|le|la|les|un|une|des|du|de|au|aux) ', '');
    i := i + 1;
    exit when s = prev or i >= 3;
  end loop;
  s := replace(s, ' ', '');
  if s = '' then return base; end if;
  return s;
end $$;

-- Distance de Levenshtein (implémentation maison : pas de dépendance à fuzzystrmatch).
create or replace function public._dd_levenshtein(a text, b text)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  la   integer := char_length(coalesce(a, ''));
  lb   integer := char_length(coalesce(b, ''));
  prev integer[];
  cur  integer[];
  i    integer;
  j    integer;
  cost integer;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  if abs(la - lb) > 4 then return abs(la - lb); end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $$;

-- Compare une proposition au mot (+ alias). Renvoie 'found' | 'close' | 'wrong'.
-- Tolérance (sur le mot normalisé) : ≤ 3 car. = exact ; ≤ 6 car. = 1 faute ; au-delà = 2.
-- 'close' = une faute de plus que la tolérance, ou proposition qui contient le mot
-- (ex. « un gros chat ») : jamais affichée publiquement (elle trahirait le mot).
create or replace function public._dd_match(p_guess text, p_word jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  g      text := public._dd_norm(p_guess);
  c      text;
  t      text;
  tol    integer;
  d      integer;
  v_close boolean := false;
begin
  if g = '' then return 'wrong'; end if;
  for c in
    select p_word->>'word'
    union all
    select x from jsonb_array_elements_text(coalesce(p_word->'aliases', '[]'::jsonb)) x
  loop
    t := public._dd_norm(c);
    continue when t = '';
    tol := case when char_length(t) <= 3 then 0 when char_length(t) <= 6 then 1 else 2 end;
    d := public._dd_levenshtein(g, t);
    if d <= tol then return 'found'; end if;
    if d = tol + 1 or (char_length(t) >= 3 and position(t in g) > 0) then v_close := true; end if;
  end loop;
  return case when v_close then 'close' else 'wrong' end;
end $$;

-- Caractère « séparateur » (affiché tel quel dans l'indice).
create or replace function public._dd_is_sep(p_ch text)
returns boolean language sql immutable
set search_path = public, extensions
as $$ select p_ch in (' ', '-', '''', '’', '.', ',', '&') $$;

-- Indice public : lettres masquées par '_' sauf indices révélés (1-based).
create or replace function public._dd_mask(p_word text, p_revealed jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  r  text := '';
  ch text;
  i  integer;
begin
  for i in 1..char_length(p_word) loop
    ch := substr(p_word, i, 1);
    if public._dd_is_sep(ch) or coalesce(p_revealed, '[]'::jsonb) @> to_jsonb(i) then
      r := r || ch;
    else
      r := r || '_';
    end if;
  end loop;
  return r;
end $$;

create or replace function public._dd_letter_count(p_word text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select count(*)::integer from generate_series(1, char_length(p_word)) i
   where not public._dd_is_sep(substr(p_word, i, 1))
$$;

-- Démarre le tour p_turn : choix du mot par le dessinateur (15 s).
create or replace function public._dd_start_turn(p_state jsonb, p_server jsonb, p_turn integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := jsonb_array_length(p_state->'order');
  v_drawer text := p_state->'order'->>((p_turn - 1) % v_n);
  v_ch     jsonb := p_server->'choices'->(p_turn - 1);
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'choosing',
    'turn', p_turn,
    'round', ((p_turn - 1) / v_n) + 1,
    'drawer', v_drawer,
    'deadline', public._dd_iso(now() + make_interval(secs => (p_state->>'choose_seconds')::integer)),
    'started_at', null,
    'next_hint_at', null,
    'hint', null,
    'word_length', null,
    'found', '[]'::jsonb,
    'turn_points', '{}'::jsonb,
    'feed', '[]'::jsonb,
    'last_turn', null);
  p_server := p_server || jsonb_build_object('word', null, 'revealed', '[]'::jsonb, 'hints_left', '[]'::jsonb,
                                             'fm', '{}'::jsonb, 'close_turn', '[]'::jsonb);
  return jsonb_build_object(
    'state', p_state,
    'server', p_server,
    'secrets', jsonb_build_object(v_drawer, jsonb_build_object(
      'turn', p_turn, 'role', 'drawer', 'choices', v_ch, 'word', null)));
end $$;

-- Le dessinateur a choisi (ou choix auto) : phase de dessin.
create or replace function public._dd_begin_drawing(p_state jsonb, p_server jsonb, p_index integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_turn    integer := (p_state->>'turn')::integer;
  v_word    jsonb := p_server->'choices'->(v_turn - 1)->p_index;
  v_text    text := v_word->>'word';
  v_secs    integer := (p_state->>'draw_seconds')::integer;
  v_letters integer := public._dd_letter_count(v_text);
  v_max     integer := v_letters / 3;            -- jamais plus d'1/3 des lettres
  v_first   integer := (v_max + 1) / 2;          -- révélées à 50 %
  v_start   timestamptz := now();
begin
  p_server := p_server || jsonb_build_object(
    'word', v_word,
    'revealed', '[]'::jsonb,
    -- plan des indices : [{at, count}] (count = nb de lettres révélées au total à cette échéance)
    'hints_left', case
      when v_max <= 0 then '[]'::jsonb
      when v_max = v_first then jsonb_build_array(
        jsonb_build_object('at', public._dd_iso(v_start + make_interval(secs => v_secs * 0.5)), 'count', v_first))
      else jsonb_build_array(
        jsonb_build_object('at', public._dd_iso(v_start + make_interval(secs => v_secs * 0.5)), 'count', v_first),
        jsonb_build_object('at', public._dd_iso(v_start + make_interval(secs => v_secs * 0.75)), 'count', v_max))
    end);
  p_state := p_state || jsonb_build_object(
    'phase', 'drawing',
    'started_at', public._dd_iso(v_start),
    -- dessinateur absent : s'il n'a pas posé un premier trait (drawing_started) d'ici là, le tour est passé
    'drawn', false,
    'draw_check_at', public._dd_iso(v_start + interval '25 seconds'),
    'deadline', public._dd_iso(v_start + make_interval(secs => v_secs)),
    'next_hint_at', p_server->'hints_left'->0->'at',
    'hint', public._dd_mask(v_text, '[]'::jsonb),
    'word_length', v_letters);
  return jsonb_build_object(
    'state', p_state,
    'server', p_server,
    'secrets', jsonb_build_object(p_state->>'drawer', jsonb_build_object(
      'turn', v_turn, 'role', 'drawer', 'choices', p_server->'choices'->(v_turn - 1),
      'word', v_text, 'aliases', coalesce(v_word->'aliases', '[]'::jsonb))));
end $$;

-- Révèle les indices dus (now() >= at).
create or replace function public._dd_apply_hints(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_text   text := p_server->'word'->>'word';
  v_target integer;
  v_pick   integer;
begin
  while jsonb_array_length(coalesce(p_server->'hints_left', '[]'::jsonb)) > 0
        and (p_server->'hints_left'->0->>'at')::timestamptz <= now() loop
    v_target := (p_server->'hints_left'->0->>'count')::integer;
    while jsonb_array_length(p_server->'revealed') < v_target loop
      select i into v_pick from generate_series(1, char_length(v_text)) i
       where not public._dd_is_sep(substr(v_text, i, 1))
         and not (p_server->'revealed' @> to_jsonb(i))
       order by random() limit 1;
      exit when v_pick is null;
      p_server := jsonb_set(p_server, '{revealed}', (p_server->'revealed') || to_jsonb(v_pick));
    end loop;
    p_server := jsonb_set(p_server, '{hints_left}', (p_server->'hints_left') - 0);
  end loop;
  p_state := p_state || jsonb_build_object(
    'hint', public._dd_mask(v_text, p_server->'revealed'),
    'next_hint_at', p_server->'hints_left'->0->'at');
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Fin du tour : révélation du mot (4 s).
create or replace function public._dd_end_turn(p_state jsonb, p_server jsonb, p_skipped boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_word jsonb := p_server->'word';
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'deadline', public._dd_iso(now() + make_interval(secs => (p_state->>'reveal_seconds')::integer)),
    'next_hint_at', null,
    'draw_check_at', null, 'idle_drawer', null,
    'hint', case when v_word is null then null else to_jsonb(v_word->>'word') end,
    'last_turn', jsonb_build_object(
      'turn', p_state->'turn', 'drawer', p_state->'drawer',
      'word', v_word->>'word', 'found', p_state->'found',
      'points', p_state->'turn_points', 'skipped', p_skipped,
      'idle', coalesce((p_state->>'idle_drawer')::boolean, false)),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'turn', p_state->'turn', 'drawer', p_state->'drawer',
      'word', v_word->>'word', 'found', p_state->'found', 'skipped', p_skipped,
      -- trophées : difficulté du mot, « Presque ! » reçus (1 par joueur et par tour), chrono de chaque trouvaille
      'diff', coalesce((v_word->>'difficulty')::integer, 2),
      'close', coalesce(p_server->'close_turn', '[]'::jsonb),
      'fm', coalesce(p_server->'fm', '{}'::jsonb))));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].
create or replace function public._dd_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select e.o, e.v->>'drawer' as drawer, coalesce((e.v->>'skipped')::boolean, false) as skipped,
           jsonb_array_length(e.v->'found') as nf,
           coalesce((e.v->'found') ? p_pl, false) as me_found,
           coalesce((e.v->'found'->>0) = p_pl, false) as first,
           coalesce((e.v->'close') ? p_pl, false) as closed,
           coalesce((e.v->>'diff')::integer, 0) as diff,
           (e.v->'fm'->p_pl->>'r')::numeric as rem,
           (e.v->'fm'->p_pl->>'e')::numeric as el,
           coalesce((e.v->'fm'->p_pl->>'nh')::boolean, false) as nohint
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
  ), n as (
    select jsonb_array_length(p_state->'players') as np
  ), g as (
    select h.*, h.o - row_number() over (partition by h.me_found order by h.o) as grp
      from h where drawer <> p_pl and not skipped
  )
  select jsonb_build_object(
    'unfound', (select count(*) from h where drawer = p_pl and not skipped and nf = 0),
    'found_count', (select count(*) from h where drawer <> p_pl and me_found),
    'first_finds', (select count(*) from h where first),
    'close_count', (select count(*) from h where drawer <> p_pl and closed),
    'late_finds', (select count(*) from h where me_found and rem <= 5),
    'fast_finds', (select count(*) from h where me_found and el < 10),
    'no_hint_finds', (select count(*) from h where me_found and nohint),
    'hard_perfect', (select count(*) from h, n where drawer = p_pl and not skipped and diff = 3 and np > 1 and nf = np - 1),
    'perfect_drawings', (select count(*) from h, n where drawer = p_pl and not skipped and np > 1 and nf = np - 1),
    'miss_streak', coalesce((select max(c) from (select count(*) as c from g where not me_found group by grp) x), 0),
    'masterpiece', case when (select np from n) >= 4 and exists (select 1 from h where drawer = p_pl)
        and not exists (select 1 from h, n where skipped
                          or (drawer = p_pl and nf < np - 1) or (drawer <> p_pl and not me_found)) then 1 else 0 end)
$$;

create or replace function public._dd_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
begin
  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');
  -- points (XP) = score / 100 arrondi : un mot trouvé ≈ 1-2 points, comme les autres jeux.
  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', round(t.value::integer / 100.0)::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', jsonb_build_object('score', t.value::integer) || public._dd_tstats(p_state, t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'deadline', null, 'next_hint_at', null,
    'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- -----------------------------------------------------------------------------
create or replace function public.game_dessine_devine_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_rounds integer;
  v_secs   integer;
  v_diff   text;
  v_ch     jsonb := p_options->'choices';
  v_turns  integer;
  v_order  jsonb;
  v_zero   jsonb;
  v_clean  jsonb;
  v_state  jsonb;
begin
  if v_n < 3 then raise exception 'not_enough_players'; end if;
  v_rounds := least(greatest(coalesce(nullif(p_options->>'rounds', '')::integer, 1), 1), 3);
  v_secs := coalesce(nullif(p_options->>'draw_seconds', '')::integer, 80);
  if v_secs not in (60, 80, 100) then v_secs := 80; end if;
  v_diff := coalesce(p_options->>'difficulty', 'mixte');
  if v_diff not in ('facile', 'mixte', 'difficile') then v_diff := 'mixte'; end if;
  v_turns := v_rounds * v_n;

  if v_ch is null or jsonb_typeof(v_ch) <> 'array' then raise exception 'missing_words'; end if;
  if jsonb_array_length(v_ch) < v_turns then raise exception 'not_enough_words'; end if;
  -- Validation + nettoyage : triplets de {word, aliases[], difficulty}.
  if exists (
    select 1 from jsonb_array_elements(v_ch) with ordinality as t(trip, o)
     where o <= v_turns and (jsonb_typeof(trip) <> 'array' or jsonb_array_length(trip) <> 3
        or exists (select 1 from jsonb_array_elements(trip) w
                    where jsonb_typeof(w) <> 'object' or jsonb_typeof(w->'word') <> 'string'
                       or char_length(btrim(w->>'word')) not between 1 and 40
                       or public._dd_norm(w->>'word') = ''
                       or (w ? 'aliases' and jsonb_typeof(w->'aliases') not in ('array', 'null')))))
  then
    raise exception 'invalid_words';
  end if;
  select jsonb_agg(
           (select jsonb_agg(jsonb_build_object(
                     'word', btrim(regexp_replace(w->>'word', '\s+', ' ', 'g')),
                     'aliases', coalesce((select jsonb_agg(left(btrim(a), 40))
                                            from (select a from jsonb_array_elements_text(
                                                    case when jsonb_typeof(w->'aliases') = 'array' then w->'aliases' else '[]'::jsonb end) a
                                                  where jsonb_typeof(to_jsonb(a)) = 'string' and btrim(a) <> '' limit 8) s), '[]'::jsonb),
                     'difficulty', least(greatest(coalesce(nullif(w->>'difficulty', '')::integer, 2), 1), 3))
                     order by wo)
              from jsonb_array_elements(trip) with ordinality as x(w, wo))
           order by o)
    into v_clean
    from jsonb_array_elements(v_ch) with ordinality as t(trip, o)
   where o <= v_turns;

  select jsonb_agg(p order by random()) into v_order from unnest(p_players) p;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'dessine-devine',
    'phase', 'choosing',
    'players', to_jsonb(p_players),
    'order', v_order,
    'round', 1,
    'total_rounds', v_rounds,
    'turn', 1,
    'total_turns', v_turns,
    'difficulty', v_diff,
    'draw_seconds', v_secs,
    'choose_seconds', 15,
    'reveal_seconds', 4,
    'scores', v_zero,
    'feed_seq', 0,
    'history', '[]'::jsonb,
    'winners', null,
    'results', null);

  return public._dd_start_turn(v_state, jsonb_build_object('choices', v_clean), 1);
end $$;

-- -----------------------------------------------------------------------------
-- Actions
-- -----------------------------------------------------------------------------
create or replace function public.game_dessine_devine_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_turn    integer := (p_state->>'turn')::integer;
  v_idx     integer;
  v_text    text;
  v_res     text;
  v_seq     integer;
  v_feed    jsonb;
  v_frac    double precision;
  v_pts     integer;
  v_rank    integer;
  v_nguess  integer;
  v_start   timestamptz;
  v_end     timestamptz;
  v_out     jsonb;
  v_secrets jsonb := '{}'::jsonb;
begin
  -- ---------------------------------------------------------------- choose_word
  if v_type = 'choose_word' then
    if v_phase <> 'choosing' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'drawer' then raise exception 'not_drawer'; end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then
      raise exception 'invalid_choice';
    end;
    if v_idx is null or v_idx not between 0 and 2 then raise exception 'invalid_choice'; end if;
    return public._dd_begin_drawing(p_state, p_server, v_idx);

  -- ---------------------------------------------------------------------- guess
  elsif v_type = 'guess' then
    if v_phase <> 'drawing' then raise exception 'wrong_phase'; end if;
    if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
    if v_me = p_state->>'drawer' then raise exception 'drawer_cannot_guess'; end if;
    if p_state->'found' ? v_me then raise exception 'already_found'; end if;
    v_text := btrim(regexp_replace(coalesce(p_action->>'text', ''), '\s+', ' ', 'g'));
    if v_text = '' then raise exception 'invalid_guess'; end if;
    v_text := left(v_text, 40);
    -- Échéance dépassée (tick pas encore reçu) : on ne compte plus.
    if now() >= (p_state->>'deadline')::timestamptz then raise exception 'wrong_phase'; end if;

    v_res := public._dd_match(v_text, p_server->'word');
    v_seq := coalesce((p_state->>'feed_seq')::integer, 0) + 1;
    v_feed := coalesce(p_state->'feed', '[]'::jsonb);

    if v_res = 'found' then
      v_start := (p_state->>'started_at')::timestamptz;
      v_end := (p_state->>'deadline')::timestamptz;
      v_frac := greatest(0, least(1, extract(epoch from (v_end - now())) / greatest(extract(epoch from (v_end - v_start)), 1)));
      v_rank := jsonb_array_length(p_state->'found') + 1;
      v_pts := 100 + round(100 * v_frac)::integer
             + case v_rank when 1 then 30 when 2 then 20 when 3 then 10 else 0 end;
      p_state := p_state || jsonb_build_object(
        'found', (p_state->'found') || to_jsonb(v_me),
        'scores', (p_state->'scores')
                  || jsonb_build_object(v_me, coalesce((p_state->'scores'->>v_me)::integer, 0) + v_pts)
                  || jsonb_build_object(p_state->>'drawer', coalesce((p_state->'scores'->>(p_state->>'drawer'))::integer, 0) + 40),
        'turn_points', coalesce(p_state->'turn_points', '{}'::jsonb)
                  || jsonb_build_object(v_me, v_pts)
                  || jsonb_build_object(p_state->>'drawer', coalesce((p_state->'turn_points'->>(p_state->>'drawer'))::integer, 0) + 40),
        'feed_seq', v_seq,
        'feed', v_feed || jsonb_build_array(jsonb_build_object('n', v_seq, 'p', v_me, 'k', 'found', 'pts', v_pts)));
      p_server := p_server || jsonb_build_object('fm', coalesce(p_server->'fm', '{}'::jsonb) || jsonb_build_object(v_me,
        jsonb_build_object('e', round(extract(epoch from (now() - v_start))::numeric, 1),
                           'r', round(extract(epoch from (v_end - now()))::numeric, 1),
                           'nh', (p_state->>'next_hint_at') is not null
                                 and now() < (p_state->>'next_hint_at')::timestamptz)));
      v_secrets := jsonb_build_object(v_me, jsonb_build_object(
        'turn', v_turn, 'role', 'guesser', 'found', true, 'word', p_server->'word'->>'word'));
      -- Tout le monde a trouvé -> fin de tour anticipée.
      v_nguess := jsonb_array_length(p_state->'players') - 1;
      if jsonb_array_length(p_state->'found') >= v_nguess then
        v_out := public._dd_end_turn(p_state, p_server, false);
        return v_out || jsonb_build_object('secrets', v_secrets);
      end if;
      return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);

    elsif v_res = 'close' then
      -- « Presque ! » privé : rien dans le state public, secret du joueur mis à jour.
      v_secrets := jsonb_build_object(v_me, jsonb_build_object(
        'turn', v_turn, 'role', 'guesser', 'found', false,
        'close', jsonb_build_object('text', v_text, 'n', v_seq)));
      p_state := p_state || jsonb_build_object('feed_seq', v_seq);
      if not (coalesce(p_server->'close_turn', '[]'::jsonb) ? v_me) then
        p_server := p_server || jsonb_build_object('close_turn', coalesce(p_server->'close_turn', '[]'::jsonb) || to_jsonb(v_me));
      end if;
      return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);

    else
      v_feed := v_feed || jsonb_build_array(jsonb_build_object('n', v_seq, 'p', v_me, 'k', 'guess', 't', v_text));
      if jsonb_array_length(v_feed) > 60 then
        v_feed := (select jsonb_agg(e order by o) from jsonb_array_elements(v_feed) with ordinality as x(e, o)
                    where o > jsonb_array_length(v_feed) - 60);
      end if;
      p_state := p_state || jsonb_build_object('feed_seq', v_seq, 'feed', v_feed);
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;

  -- ------------------------------------------------------------- drawing_started
  elsif v_type = 'drawing_started' then
    -- tardif / rejoué / pas le dessinateur : ignoré sans erreur (idempotent)
    if v_phase <> 'drawing' or v_me <> p_state->>'drawer' then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    return jsonb_build_object('state', p_state || jsonb_build_object('drawn', true, 'draw_check_at', null), 'server', p_server);

  -- ----------------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'choosing' then
      if now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      return public._dd_begin_drawing(p_state, p_server, floor(random() * 3)::integer);
    elsif v_phase = 'drawing' then
      if now() >= (p_state->>'deadline')::timestamptz then
        return public._dd_end_turn(p_state, p_server, false);
      end if;
      -- dessinateur absent (parties en cours sans draw_check_at : ignoré)
      if p_state->>'draw_check_at' is not null and not coalesce((p_state->>'drawn')::boolean, false)
         and now() >= (p_state->>'draw_check_at')::timestamptz then
        return public._dd_end_turn(p_state || jsonb_build_object('idle_drawer', true), p_server, true);
      end if;
      if p_state->>'next_hint_at' is not null and now() >= (p_state->>'next_hint_at')::timestamptz then
        return public._dd_apply_hints(p_state, p_server);
      end if;
      return jsonb_build_object('state', p_state, 'server', p_server);
    elsif v_phase = 'reveal' then
      if now() < (p_state->>'deadline')::timestamptz then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      if v_turn >= (p_state->>'total_turns')::integer then
        return public._dd_finish(p_state, p_server);
      end if;
      return public._dd_start_turn(p_state, p_server, v_turn + 1);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ------------------------------------------------------------------ skip_turn
  elsif v_type = 'skip_turn' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('choosing', 'drawing') then raise exception 'wrong_phase'; end if;
    return public._dd_end_turn(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : fonctions internes, appelées uniquement via start_match / game_action.
-- -----------------------------------------------------------------------------
revoke all on function public._dd_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._dd_norm(text) from public, anon, authenticated;
revoke all on function public._dd_levenshtein(text, text) from public, anon, authenticated;
revoke all on function public._dd_match(text, jsonb) from public, anon, authenticated;
revoke all on function public._dd_is_sep(text) from public, anon, authenticated;
revoke all on function public._dd_mask(text, jsonb) from public, anon, authenticated;
revoke all on function public._dd_letter_count(text) from public, anon, authenticated;
revoke all on function public._dd_start_turn(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._dd_begin_drawing(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._dd_apply_hints(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dd_end_turn(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._dd_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dd_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_dessine_devine_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_dessine_devine_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\devine-en-equipe.sql =====
-- =============================================================================
-- JEU « devine-en-equipe » (Devine en équipe) — idempotent, à recoller sans risque.
-- Contrat complet : src/games/devine-en-equipe/types.ts (en-tête).
--
-- 2 équipes (red / blue), 3 manches avec LES MÊMES mots :
--   1 « Décris » (tout sauf le mot) · 2 « Un seul mot » · 3 « Mime ».
-- Passages chronométrés : l'orateur fait deviner son équipe ; « found » = +1 point
-- d'équipe (et +1 point individuel pour l'orateur), « pass » = la carte retourne
-- en FIN de pioche (autorisé dans les 3 manches). Pioche vide = fin de manche ; le
-- temps restant (≥ 5 s) est conservé par le même orateur au début de la manche
-- suivante (règle classique). À l'échéance, la carte en cours retourne en fin de pioche.
--
-- Options (p_options de start_match), préparées par le front de l'hôte :
--   {"words": [{"word":"Astérix","kind":"perso"}, {"word":"parapluie","kind":"objet"}, …] (10-60),
--    "turn_seconds": 30|45|60,
--    "teams": {"red":[uuid…], "blue":[uuid…]}   (facultatif : sinon tirage au sort)}
--
-- Le mot courant n'est JAMAIS dans le state public : il vit dans `server` et dans
-- les secrets de l'orateur et de l'équipe adverse (qui surveille la triche). Les
-- coéquipiers de l'orateur reçoivent un secret {role:'teammate', word:null}.
-- =============================================================================

-- Horodatage ISO-8601 UTC millisecondes (parsable partout, Safari compris).
create or replace function public._dee_iso(p timestamptz)
returns text language sql immutable
set search_path = public, extensions
as $$ select to_char(p at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;

create or replace function public._dee_other(p_team text)
returns text language sql immutable
set search_path = public, extensions
as $$ select case when p_team = 'red' then 'blue' else 'red' end $$;

-- Membre d'une équipe à l'indice p_idx (rotation modulo la taille de l'équipe).
create or replace function public._dee_member(p_state jsonb, p_team text, p_idx integer)
returns text language sql immutable
set search_path = public, extensions
as $$
  select p_state->'teams'->p_team->>(p_idx % jsonb_array_length(p_state->'teams'->p_team))
$$;

-- Pioche mélangée : indices 0..n-1 du deck.
create or replace function public._dee_shuffled(p_n integer)
returns jsonb language sql volatile
set search_path = public, extensions
as $$ select coalesce(jsonb_agg(i order by random()), '[]'::jsonb) from generate_series(0, p_n - 1) i $$;

-- Secrets de la carte courante (pile[0]) : orateur (+ carte suivante pour un
-- affichage instantané) et équipe adverse ; coéquipiers (mot masqué) si demandé.
create or replace function public._dee_card_secrets(p_state jsonb, p_server jsonb, p_with_teammates boolean)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_team    text := p_state->>'team';
  v_speaker text := p_state->>'speaker';
  v_pile    jsonb := p_server->'pile';
  v_cur     jsonb := p_server->'deck'->((v_pile->>0)::integer);
  v_next    jsonb := case when jsonb_array_length(v_pile) > 1
                          then p_server->'deck'->((v_pile->>1)::integer) else null end;
  v_base    jsonb := jsonb_build_object(
                       'turn_no', p_state->'turn_no', 'card_no', p_state->'card_no', 'round', p_state->'round');
  v_out     jsonb;
  p         text;
begin
  v_out := jsonb_build_object(v_speaker, v_base || jsonb_build_object(
    'role', 'speaker', 'word', v_cur->>'word', 'kind', v_cur->>'kind',
    'next_word', v_next->>'word', 'next_kind', v_next->>'kind'));
  for p in select jsonb_array_elements_text(p_state->'teams'->public._dee_other(v_team)) loop
    v_out := v_out || jsonb_build_object(p, v_base || jsonb_build_object(
      'role', 'watcher', 'word', v_cur->>'word', 'kind', v_cur->>'kind'));
  end loop;
  if p_with_teammates then
    for p in select jsonb_array_elements_text(p_state->'teams'->v_team) loop
      continue when p = v_speaker;
      v_out := v_out || jsonb_build_object(p, v_base || jsonb_build_object('role', 'teammate', 'word', null));
    end loop;
  end if;
  return v_out;
end $$;

-- Écran « Au tour de X — prêt ? » pour l'équipe/orateur courants.
create or replace function public._dee_ready(p_state jsonb, p_budget integer, p_carried boolean)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select p_state || jsonb_build_object(
    'phase', 'ready',
    'turn_no', coalesce((p_state->>'turn_no')::integer, 0) + 1,
    'budget', p_budget,
    'carried', p_carried,
    -- Échéance ~45 s : orateur absent → le tick saute le passage (comme skip_turn de l'hôte).
    'deadline', public._dee_iso(now() + make_interval(secs => coalesce((p_state->>'ready_seconds')::integer, 45))),
    'started_at', null,
    'turn_found', 0,
    'turn_passed', 0,
    'turn_words', '[]'::jsonb)
$$;

-- Rotation : l'équipe courante avance d'un orateur, puis la main passe à l'autre équipe.
create or replace function public._dee_rotate(p_state jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_team text := p_state->>'team';
  v_next text := public._dee_other(v_team);
  v_idx  jsonb := p_state->'next_idx';
begin
  v_idx := v_idx || jsonb_build_object(v_team, (v_idx->>v_team)::integer + 1);
  return p_state || jsonb_build_object(
    'next_idx', v_idx,
    'team', v_next,
    'speaker', public._dee_member(p_state, v_next, (v_idx->>v_next)::integer));
end $$;

create or replace function public._dee_recap(p_state jsonb, p_reason text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'turn_no', p_state->'turn_no', 'round', p_state->'round',
    'team', p_state->'team', 'speaker', p_state->'speaker',
    'found', coalesce(p_state->'turn_words', '[]'::jsonb),
    'passed', coalesce((p_state->>'turn_passed')::integer, 0),
    'reason', p_reason)
$$;

-- Compteurs de trophées par orateur (state.tstat[pid]) : appelé à la fin d'un passage joué.
-- Cumul : empty_turns, found_r3 (mots en manche Mime), carries ; record : max_passed, best_r2, best_turn.
create or replace function public._dee_note(p_state jsonb, p_carry boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_pid   text := p_state->>'speaker';
  v_st    jsonb := coalesce(p_state->'tstat'->v_pid, '{}'::jsonb);
  v_found integer := coalesce((p_state->>'turn_found')::integer, 0);
  v_pass  integer := coalesce((p_state->>'turn_passed')::integer, 0);
  v_round integer := coalesce((p_state->>'round')::integer, 0);
begin
  if v_pid is null or p_state->>'phase' <> 'playing' or p_state->>'started_at' is null then return p_state; end if;
  v_st := v_st || jsonb_build_object(
    'empty_turns', coalesce((v_st->>'empty_turns')::integer, 0) + case when v_found = 0 then 1 else 0 end,
    'max_passed', greatest(coalesce((v_st->>'max_passed')::integer, 0), v_pass),
    'best_turn', greatest(coalesce((v_st->>'best_turn')::integer, 0), v_found),
    'found_r3', coalesce((v_st->>'found_r3')::integer, 0) + case when v_round = 3 then v_found else 0 end,
    'best_r2', greatest(coalesce((v_st->>'best_r2')::integer, 0), case when v_round = 2 then v_found else 0 end),
    'carries', coalesce((v_st->>'carries')::integer, 0) + case when p_carry then 1 else 0 end);
  return p_state || jsonb_build_object('tstat',
    coalesce(p_state->'tstat', '{}'::jsonb) || jsonb_build_object(v_pid, v_st));
end $$;

-- Fin d'un passage (échéance, saut par l'hôte) : la carte en cours retourne en
-- fin de pioche, rotation, écran « prêt ? » suivant.
create or replace function public._dee_end_passage(p_state jsonb, p_server jsonb, p_reason text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_pile jsonb := p_server->'pile';
begin
  if p_state->>'phase' = 'playing' and jsonb_array_length(v_pile) > 1 then
    p_server := p_server || jsonb_build_object('pile', (v_pile - 0) || jsonb_build_array(v_pile->0));
  end if;
  p_state := public._dee_note(p_state, false);
  p_state := p_state || jsonb_build_object('last_turn', public._dee_recap(p_state, p_reason), 'carry_seconds', null);
  p_state := public._dee_rotate(p_state);
  p_state := public._dee_ready(p_state, (p_state->>'turn_seconds')::integer, false);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql).
create or replace function public._dee_tstats(p_state jsonb, p_pid text, p_team text, p_won boolean)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with s as (
    select coalesce((p_state->'speaker_points'->>p_pid)::integer, 0) as mine,
           (select coalesce(max(coalesce((p_state->'speaker_points'->>m)::integer, 0)), 0)
              from jsonb_array_elements_text(p_state->'teams'->p_team) m) as team_max,
           (select coalesce(max(value::integer), 0) from jsonb_each_text(coalesce(p_state->'speaker_points', '{}'::jsonb))) as all_max
  )
  select jsonb_build_object(
    'empty_turns', coalesce((p_state->'tstat'->p_pid->>'empty_turns')::integer, 0),
    'max_passed', coalesce((p_state->'tstat'->p_pid->>'max_passed')::integer, 0),
    'best_turn', coalesce((p_state->'tstat'->p_pid->>'best_turn')::integer, 0),
    'found_r3', coalesce((p_state->'tstat'->p_pid->>'found_r3')::integer, 0),
    'best_r2', coalesce((p_state->'tstat'->p_pid->>'best_r2')::integer, 0),
    'carries', coalesce((p_state->'tstat'->p_pid->>'carries')::integer, 0),
    'best_in_team', case when mine > 0 and mine >= team_max then 1 else 0 end,
    'sweep', case when jsonb_array_length(coalesce(p_state->'round_scores', '[]'::jsonb)) >= 3
        and not exists (select 1 from jsonb_array_elements(p_state->'round_scores') r
                         where (r->>p_team)::integer <= (r->>(case when p_team = 'red' then 'blue' else 'red' end))::integer)
        then 1 else 0 end,
    'mvp', case when p_won and mine >= 10 and mine >= all_max then 1 else 0 end)
  from s
$$;

create or replace function public._dee_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_red     integer := (p_state->'scores'->>'red')::integer;
  v_blue    integer := (p_state->'scores'->>'blue')::integer;
  v_winners jsonb;
  v_results jsonb;
begin
  v_winners := case when v_red > v_blue then '["red"]'::jsonb
                    when v_blue > v_red then '["blue"]'::jsonb
                    else '["red","blue"]'::jsonb end;
  select jsonb_agg(jsonb_build_object(
           'profile_id', t.pid,
           -- XP raisonnable : 1 point pour 3 mots trouvés comme orateur (le détail reste dans stats.found).
           'points', ceil(coalesce((p_state->'speaker_points'->>t.pid)::integer, 0) / 3.0)::integer,
           'won', v_winners ? t.team,
           'placement', case when v_winners ? t.team then 1 else 2 end,
           'stats', jsonb_build_object('found', coalesce((p_state->'speaker_points'->>t.pid)::integer, 0), 'team', t.team)
                    || public._dee_tstats(p_state, t.pid, t.team, v_winners ? t.team))
         order by case when v_winners ? t.team then 1 else 2 end, t.team, t.pid)
    into v_results
    from (select x as pid, 'red' as team from jsonb_array_elements_text(p_state->'teams'->'red') x
          union all
          select x, 'blue' from jsonb_array_elements_text(p_state->'teams'->'blue') x) t;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'deadline', null, 'started_at', null, 'carry_seconds', null,
    'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Pioche vide pendant un passage : fin de manche (ou de partie après la 3e).
create or replace function public._dee_round_complete(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_left integer;
begin
  v_left := greatest(0, floor(extract(epoch from ((p_state->>'deadline')::timestamptz - now())))::integer);
  -- Du rab : pioche vidée avec au moins 5 s gardées pour la manche suivante.
  p_state := public._dee_note(p_state, v_left >= 5
                                       and (p_state->>'round')::integer < (p_state->>'total_rounds')::integer);
  p_state := p_state || jsonb_build_object('last_turn', public._dee_recap(p_state, 'empty'));
  if (p_state->>'round')::integer >= (p_state->>'total_rounds')::integer then
    return public._dee_finish(p_state, p_server);
  end if;
  if v_left >= 5 then
    -- Même équipe, même orateur au début de la manche suivante, avec le temps restant.
    p_state := p_state || jsonb_build_object('carry_seconds', least(v_left, (p_state->>'turn_seconds')::integer));
  else
    p_state := public._dee_rotate(p_state) || jsonb_build_object('carry_seconds', null);
  end if;
  p_state := p_state || jsonb_build_object('phase', 'round_end', 'deadline', null, 'started_at', null, 'pile_left', 0);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- -----------------------------------------------------------------------------
create or replace function public.game_devine_en_equipe_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_words  jsonb := p_options->'words';
  v_secs   integer;
  v_deck   jsonb;
  v_teams  jsonb := p_options->'teams';
  v_red    jsonb;
  v_blue   jsonb;
  v_all    text[];
  v_shuf   text[];
  v_first  text;
  v_state  jsonb;
begin
  if v_n < 4 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;

  v_secs := coalesce(nullif(p_options->>'turn_seconds', '')::integer, 30);
  if v_secs not in (30, 45, 60) then v_secs := 30; end if;

  -- Mots : chaînes ou {word, kind}. 10 à 60 cartes.
  if v_words is null or jsonb_typeof(v_words) <> 'array' then raise exception 'missing_words'; end if;
  if jsonb_array_length(v_words) < 10 then raise exception 'not_enough_words'; end if;
  if jsonb_array_length(v_words) > 60 then raise exception 'invalid_words'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_words) w
     where not (
       (jsonb_typeof(w) = 'string' and char_length(btrim(w #>> '{}')) between 1 and 60)
       or (jsonb_typeof(w) = 'object' and jsonb_typeof(w->'word') = 'string'
           and char_length(btrim(w->>'word')) between 1 and 60)))
  then
    raise exception 'invalid_words';
  end if;
  select jsonb_agg(jsonb_build_object(
           'word', btrim(regexp_replace(case when jsonb_typeof(w) = 'string' then w #>> '{}' else w->>'word' end, '\s+', ' ', 'g')),
           'kind', case when jsonb_typeof(w) = 'object' and w->>'kind' = 'perso' then 'perso' else 'objet' end)
         order by o)
    into v_deck
    from jsonb_array_elements(v_words) with ordinality as t(w, o);

  -- Équipes : composées par l'hôte (partition exacte des joueurs, ≥ 2 chacune) ou au hasard.
  v_all := array(select p::text from unnest(p_players) p);
  if v_teams is not null and jsonb_typeof(v_teams) = 'object' then
    if jsonb_typeof(v_teams->'red') <> 'array' or jsonb_typeof(v_teams->'blue') <> 'array' then
      raise exception 'invalid_teams';
    end if;
    begin
      select coalesce(jsonb_agg(x::uuid::text order by random()), '[]'::jsonb) into v_red
        from jsonb_array_elements_text(v_teams->'red') x;
      select coalesce(jsonb_agg(x::uuid::text order by random()), '[]'::jsonb) into v_blue
        from jsonb_array_elements_text(v_teams->'blue') x;
    exception when others then
      raise exception 'invalid_teams';
    end;
    if jsonb_array_length(v_red) < 2 or jsonb_array_length(v_blue) < 2
       or jsonb_array_length(v_red) + jsonb_array_length(v_blue) <> v_n
       or exists (select 1 from jsonb_array_elements_text(v_red || v_blue) x where not (x = any(v_all)))
       or (select count(distinct x) from jsonb_array_elements_text(v_red || v_blue) x) <> v_n
    then
      raise exception 'invalid_teams';
    end if;
  else
    v_shuf := array(select x from unnest(v_all) x order by random());
    select jsonb_agg(v_shuf[i] order by i) into v_red from generate_series(1, v_n) i where i % 2 = 1;
    select jsonb_agg(v_shuf[i] order by i) into v_blue from generate_series(1, v_n) i where i % 2 = 0;
  end if;

  v_first := case when random() < 0.5 then 'red' else 'blue' end;

  v_state := jsonb_build_object(
    'game', 'devine-en-equipe',
    'phase', 'ready',
    'players', to_jsonb(p_players),
    'teams', jsonb_build_object('red', v_red, 'blue', v_blue),
    'round', 1,
    'total_rounds', 3,
    'total_words', jsonb_array_length(v_deck),
    'turn_seconds', v_secs,
    'team', v_first,
    'next_idx', jsonb_build_object('red', 0, 'blue', 0),
    'speaker', case when v_first = 'red' then v_red->>0 else v_blue->>0 end,
    'turn_no', 0,
    'card_no', 0,
    'pile_left', jsonb_array_length(v_deck),
    'carry_seconds', null,
    'scores', jsonb_build_object('red', 0, 'blue', 0),
    'round_scores', jsonb_build_array(
      jsonb_build_object('red', 0, 'blue', 0), jsonb_build_object('red', 0, 'blue', 0), jsonb_build_object('red', 0, 'blue', 0)),
    'speaker_points', (select jsonb_object_agg(p::text, 0) from unnest(p_players) p),
    'last_turn', null,
    'winners', null,
    'results', null);
  v_state := public._dee_ready(v_state, v_secs, false);

  return jsonb_build_object(
    'state', v_state,
    'server', jsonb_build_object('deck', v_deck, 'pile', public._dee_shuffled(jsonb_array_length(v_deck))),
    'secrets', '{}'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- Actions
-- -----------------------------------------------------------------------------
create or replace function public.game_devine_en_equipe_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_phase text := p_state->>'phase';
  v_me    text := p_actor::text;
  v_team  text := p_state->>'team';
  v_round integer := (p_state->>'round')::integer;
  v_idx   integer;
  v_pile  jsonb := p_server->'pile';
  v_card  jsonb;
  v_carry integer;
  v_n     integer;
begin
  -- ---------------------------------------------------------------------- ready
  if v_type = 'ready' then
    if v_phase <> 'ready' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'speaker' then raise exception 'not_speaker'; end if;
    p_state := p_state || jsonb_build_object(
      'phase', 'playing',
      'card_no', (p_state->>'card_no')::integer + 1,
      'started_at', public._dee_iso(now()),
      'deadline', public._dee_iso(now() + make_interval(secs => (p_state->>'budget')::integer)),
      'pile_left', jsonb_array_length(v_pile));
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', public._dee_card_secrets(p_state, p_server, true));

  -- --------------------------------------------------------------- found / pass
  elsif v_type in ('found', 'pass') then
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if v_me <> p_state->>'speaker' then raise exception 'not_speaker'; end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then
      raise exception 'invalid_action';
    end;
    -- Double appui / carte périmée : ignoré sans erreur.
    if v_idx is null or v_idx <> (p_state->>'card_no')::integer then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    -- Échéance dépassée (+ 1,5 s de tolérance réseau) : le passage se termine, rien ne compte.
    if now() >= (p_state->>'deadline')::timestamptz + interval '1.5 seconds' then
      return public._dee_end_passage(p_state, p_server, 'time');
    end if;
    v_card := p_server->'deck'->((v_pile->>0)::integer);

    if v_type = 'found' then
      v_pile := v_pile - 0;
      p_server := p_server || jsonb_build_object('pile', v_pile);
      p_state := jsonb_set(p_state, array['round_scores', (v_round - 1)::text, v_team],
                           to_jsonb((p_state->'round_scores'->(v_round - 1)->>v_team)::integer + 1));
      p_state := p_state || jsonb_build_object(
        'scores', (p_state->'scores') || jsonb_build_object(v_team, (p_state->'scores'->>v_team)::integer + 1),
        'speaker_points', (p_state->'speaker_points')
                          || jsonb_build_object(v_me, coalesce((p_state->'speaker_points'->>v_me)::integer, 0) + 1),
        'turn_found', (p_state->>'turn_found')::integer + 1,
        'turn_words', coalesce(p_state->'turn_words', '[]'::jsonb) || jsonb_build_array(v_card->>'word'),
        'pile_left', jsonb_array_length(v_pile));
      if jsonb_array_length(v_pile) = 0 then
        return public._dee_round_complete(p_state, p_server);
      end if;
    else
      -- Passer : la carte retourne en fin de pioche.
      p_server := p_server || jsonb_build_object('pile', (v_pile - 0) || jsonb_build_array(v_pile->0));
      p_state := p_state || jsonb_build_object('turn_passed', (p_state->>'turn_passed')::integer + 1);
    end if;
    p_state := p_state || jsonb_build_object('card_no', (p_state->>'card_no')::integer + 1);
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', public._dee_card_secrets(p_state, p_server, false));

  -- ----------------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'playing' and now() >= (p_state->>'deadline')::timestamptz then
      return public._dee_end_passage(p_state, p_server, 'time');
    elsif v_phase = 'ready' and nullif(p_state->>'deadline', '') is not null
          and now() >= (p_state->>'deadline')::timestamptz then
      return public._dee_end_passage(p_state, p_server, 'skip');
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ------------------------------------------------------------------ skip_turn
  elsif v_type = 'skip_turn' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('ready', 'playing') then raise exception 'wrong_phase'; end if;
    return public._dee_end_passage(p_state, p_server, 'skip');

  -- ----------------------------------------------------------------- next_round
  elsif v_type = 'next_round' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'round_end' then raise exception 'wrong_phase'; end if;
    v_n := jsonb_array_length(p_server->'deck');
    v_carry := nullif(p_state->>'carry_seconds', '')::integer;
    p_server := p_server || jsonb_build_object('pile', public._dee_shuffled(v_n));
    p_state := p_state || jsonb_build_object('round', v_round + 1, 'pile_left', v_n, 'carry_seconds', null);
    p_state := public._dee_ready(p_state, coalesce(v_carry, (p_state->>'turn_seconds')::integer), v_carry is not null);
    return jsonb_build_object('state', p_state, 'server', p_server);

  else
    raise exception 'unknown_action';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Droits : fonctions internes, appelées uniquement via start_match / game_action.
-- -----------------------------------------------------------------------------
revoke all on function public._dee_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._dee_other(text) from public, anon, authenticated;
revoke all on function public._dee_member(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._dee_shuffled(integer) from public, anon, authenticated;
revoke all on function public._dee_card_secrets(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._dee_ready(jsonb, integer, boolean) from public, anon, authenticated;
revoke all on function public._dee_rotate(jsonb) from public, anon, authenticated;
revoke all on function public._dee_recap(jsonb, text) from public, anon, authenticated;
revoke all on function public._dee_note(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._dee_end_passage(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._dee_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dee_tstats(jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public._dee_round_complete(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_devine_en_equipe_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_devine_en_equipe_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\echecs.sql =====
-- =============================================================================
-- JEU « Échecs » (id echecs) — jeu en DUEL (socle supabase/features/duel.sql).
-- Règles officielles complètes, toutes vérifiées par le serveur : roque,
-- prise en passant, promotion au choix, échec, mat, pat ; nuls automatiques
-- (répétition triple, 50 coups, matériel insuffisant) ; abandon (à tout moment,
-- hook board_offturn) ; nul proposé / accepté. Pendule par joueur (3 / 5 / 10 min,
-- défaite au temps) ou « sans pendule » (60 s par coup, coup légal au hasard).
-- Conception : docs/superpowers/specs/2026-11-19-echecs-design.md.
--
-- Position : chaîne de 64 caractères, index 0 = a8 … 7 = h8 … 56 = a1 … 63 = h1
-- ('.' = vide, MAJUSCULES = Blancs, lettres anglaises KQRBNP). Ligne = idx / 8
-- (0 = 8e rangée), colonne = idx % 8 (0 = a).
-- Coup encodé en entier (moteur interne) : from + 64 * to + 4096 * promo
-- (promo 0 = aucune, 1 dame, 2 tour, 3 fou, 4 cavalier).
--
-- Plateau public (state.board, miroir TS src/games/echecs/types.ts) :
--   {"sq": "<64>", "white": uid, "black": uid, "side": "w"|"b", "castle": "KQkq" ("" = aucun),
--    "ep": idx|null, "half": n, "full": n,
--    "moves": {"<from>": [to, …]},       -- coups légaux du camp au trait (source de vérité du front)
--    "check": bool, "last": {"from", "to"}|null,
--    "captured": {"w": "<pièces prises PAR les Blancs>", "b": "<… par les Noirs>"},
--    "cadence": "blitz3"|"rapid5"|"slow10"|"none", "clock": {uid: ms}|null,
--    "turn_started_at": ISO, "draw_offer": uid|null,
--    "end": {"reason": mate|stalemate|repetition|fifty|material|time|resign|agreement, "winner": uid|null}|null}
-- Privé (server) : {"positions": {clé: n}, "tstats": {uid: compteurs des trophées}}.
-- Coups ({"type":"move","move":…} du socle) :
--   {from, to, promo?, offer_draw?}  (0..63 ; promo q|r|b|n obligatoire quand un pion arrive au bout)
--   {type:"resign"} (à tout moment) · {type:"accept_draw"} (à son tour, nul proposé par l'adversaire)
--   {type:"flag"} (chute du drapeau, renvoyé par board_auto ; revérifié à l'heure serveur)
-- =============================================================================

-- Case p_i attaquée par le camp p_by ('w'|'b') ?
create or replace function public._echecs_attacked(p_sq text, p_i integer, p_by text)
returns boolean language plpgsql immutable strict
set search_path = public, extensions
as $$
declare
  r   integer := p_i / 8;
  c   integer := p_i % 8;
  w   boolean := p_by = 'w';
  kn  integer[] := array[-2,-1, -2,1, -1,-2, -1,2, 1,-2, 1,2, 2,-1, 2,1];
  kg  integer[] := array[-1,-1, -1,0, -1,1, 0,-1, 0,1, 1,-1, 1,0, 1,1];
  dirs integer[] := array[-1,0, 1,0, 0,-1, 0,1, -1,-1, -1,1, 1,-1, 1,1];
  pP  text; pN text; pB text; pR text; pQ text; pK text;
  rr  integer;
  cc  integer;
  dr  integer;
  dc  integer;
  ch  text;
  k   integer;
begin
  if w then pP := 'P'; pN := 'N'; pB := 'B'; pR := 'R'; pQ := 'Q'; pK := 'K';
  else pP := 'p'; pN := 'n'; pB := 'b'; pR := 'r'; pQ := 'q'; pK := 'k';
  end if;
  -- Pions : un pion blanc attaque vers le haut, il est donc une rangée plus bas (r + 1).
  rr := case when w then r + 1 else r - 1 end;
  if rr between 0 and 7 then
    if c > 0 and substr(p_sq, rr * 8 + c, 1) = pP then return true; end if;
    if c < 7 and substr(p_sq, rr * 8 + c + 2, 1) = pP then return true; end if;
  end if;
  for k in 0 .. 7 loop
    rr := r + kn[k * 2 + 1];
    cc := c + kn[k * 2 + 2];
    if rr between 0 and 7 and cc between 0 and 7 and substr(p_sq, rr * 8 + cc + 1, 1) = pN then return true; end if;
    rr := r + kg[k * 2 + 1];
    cc := c + kg[k * 2 + 2];
    if rr between 0 and 7 and cc between 0 and 7 and substr(p_sq, rr * 8 + cc + 1, 1) = pK then return true; end if;
  end loop;
  -- Pièces à longue portée : 4 directions de tour puis 4 de fou.
  for k in 0 .. 7 loop
    dr := dirs[k * 2 + 1];
    dc := dirs[k * 2 + 2];
    rr := r + dr;
    cc := c + dc;
    while rr between 0 and 7 and cc between 0 and 7 loop
      ch := substr(p_sq, rr * 8 + cc + 1, 1);
      if ch <> '.' then
        if ch = pQ or (k < 4 and ch = pR) or (k >= 4 and ch = pB) then return true; end if;
        exit;
      end if;
      rr := rr + dr;
      cc := cc + dc;
    end loop;
  end loop;
  return false;
end $$;

-- Position après le coup p_m (pièces seulement : roque, prise en passant et promotion compris).
create or replace function public._echecs_after(p_sq text, p_m integer)
returns text language plpgsql immutable strict
set search_path = public, extensions
as $$
declare
  f   integer := p_m & 63;
  t   integer := (p_m >> 6) & 63;
  pr  integer := p_m >> 12;
  pc  text := substr(p_sq, f + 1, 1);
  cap text := substr(p_sq, t + 1, 1);
  np  text := pc;
  s   text;
begin
  if pr > 0 then
    np := substr('QRBN', pr, 1);
    if pc = 'p' then np := lower(np); end if;
  end if;
  s := overlay(overlay(p_sq placing '.' from f + 1 for 1) placing np from t + 1 for 1);
  if (pc = 'K' or pc = 'k') and abs(t - f) = 2 then
    if t > f then  -- petit roque : tour h -> f
      s := overlay(overlay(s placing '.' from f + 4 for 1) placing (case when pc = 'K' then 'R' else 'r' end) from f + 2 for 1);
    else           -- grand roque : tour a -> d
      s := overlay(overlay(s placing '.' from f - 3 for 1) placing (case when pc = 'K' then 'R' else 'r' end) from f for 1);
    end if;
  elsif (pc = 'P' or pc = 'p') and f % 8 <> t % 8 and cap = '.' then
    -- prise en passant : le pion pris est sur la rangée de départ, colonne d'arrivée
    s := overlay(s placing '.' from (f / 8) * 8 + t % 8 + 1 for 1);
  end if;
  return s;
end $$;

-- Position suivante (pos = {sq, side, castle, ep, half, full}) après le coup p_m, supposé légal :
-- pièces, trait, droits de roque, case de prise en passant, compteurs.
create or replace function public._echecs_apply(p_pos jsonb, p_m integer)
returns jsonb language plpgsql immutable strict
set search_path = public, extensions
as $$
declare
  f      integer := p_m & 63;
  t      integer := (p_m >> 6) & 63;
  v_sq   text := p_pos->>'sq';
  v_side text := p_pos->>'side';
  v_c    text := coalesce(p_pos->>'castle', '');
  v_pc   text := substr(p_pos->>'sq', (p_m & 63) + 1, 1);
  v_capt boolean := substr(p_pos->>'sq', ((p_m >> 6) & 63) + 1, 1) <> '.';
begin
  if v_pc = 'K' then v_c := translate(v_c, 'KQ', ''); end if;
  if v_pc = 'k' then v_c := translate(v_c, 'kq', ''); end if;
  if f = 63 or t = 63 then v_c := replace(v_c, 'K', ''); end if;
  if f = 56 or t = 56 then v_c := replace(v_c, 'Q', ''); end if;
  if f = 7 or t = 7 then v_c := replace(v_c, 'k', ''); end if;
  if f = 0 or t = 0 then v_c := replace(v_c, 'q', ''); end if;
  return jsonb_build_object(
    'sq', public._echecs_after(v_sq, p_m),
    'side', case when v_side = 'w' then 'b' else 'w' end,
    'castle', v_c,
    'ep', case when upper(v_pc) = 'P' and abs(t - f) = 16 then (f + t) / 2 end,
    'half', case when upper(v_pc) = 'P' or v_capt then 0 else coalesce((p_pos->>'half')::integer, 0) + 1 end,
    'full', coalesce((p_pos->>'full')::integer, 1) + case when v_side = 'b' then 1 else 0 end);
end $$;

-- Pseudo-coups du camp p_side (sans vérifier que son roi reste à l'abri ; le roque, lui, est complet).
create or replace function public._echecs_pseudo_moves(p_sq text, p_side text, p_castle text, p_ep integer)
returns integer[] language plpgsql immutable
set search_path = public, extensions
as $$
declare
  w     boolean := p_side = 'w';
  opp   text := case when p_side = 'w' then 'b' else 'w' end;
  v     integer[] := '{}';
  kn    integer[] := array[-2,-1, -2,1, -1,-2, -1,2, 1,-2, 1,2, 2,-1, 2,1];
  kg    integer[] := array[-1,-1, -1,0, -1,1, 0,-1, 0,1, 1,-1, 1,0, 1,1];
  dirs  integer[] := array[-1,0, 1,0, 0,-1, 0,1, -1,-1, -1,1, 1,-1, 1,1];
  i     integer;
  r     integer;
  c     integer;
  pc    text;
  up    text;
  a     integer;
  rr    integer;
  cc    integer;
  dr    integer;
  dc    integer;
  t     integer;
  ch    text;
  ca    integer;
  k     integer;
  k0    integer;
  k1    integer;
  dir   integer;
  pr    integer;
begin
  for i in 0 .. 63 loop
    pc := substr(p_sq, i + 1, 1);
    continue when pc = '.';
    a := ascii(pc);
    continue when (w and a > 90) or (not w and a < 97);
    r := i / 8;
    c := i % 8;
    up := upper(pc);
    if up = 'P' then
      dir := case when w then -1 else 1 end;
      rr := r + dir;
      continue when rr < 0 or rr > 7;
      -- avance d'une case (+ deux depuis la rangée de départ)
      t := rr * 8 + c;
      if substr(p_sq, t + 1, 1) = '.' then
        if rr = 0 or rr = 7 then
          for pr in 1 .. 4 loop v := v || (i + 64 * t + 4096 * pr); end loop;
        else
          v := v || (i + 64 * t);
          if r = (case when w then 6 else 1 end) and substr(p_sq, t + 8 * dir + 1, 1) = '.' then
            v := v || (i + 64 * (t + 8 * dir));
          end if;
        end if;
      end if;
      -- prises (dont en passant)
      foreach dc in array array[-1, 1] loop
        cc := c + dc;
        continue when cc < 0 or cc > 7;
        t := rr * 8 + cc;
        ch := substr(p_sq, t + 1, 1);
        ca := ascii(ch);
        if (ch <> '.' and ((w and ca >= 97) or (not w and ca <= 90))) or (ch = '.' and t = p_ep) then
          if rr = 0 or rr = 7 then
            for pr in 1 .. 4 loop v := v || (i + 64 * t + 4096 * pr); end loop;
          else
            v := v || (i + 64 * t);
          end if;
        end if;
      end loop;
    elsif up = 'N' or up = 'K' then
      for k in 0 .. 7 loop
        if up = 'N' then rr := r + kn[k * 2 + 1]; cc := c + kn[k * 2 + 2];
        else rr := r + kg[k * 2 + 1]; cc := c + kg[k * 2 + 2];
        end if;
        continue when rr < 0 or rr > 7 or cc < 0 or cc > 7;
        t := rr * 8 + cc;
        ch := substr(p_sq, t + 1, 1);
        ca := ascii(ch);
        if ch = '.' or (w and ca >= 97) or (not w and ca <= 90) then v := v || (i + 64 * t); end if;
      end loop;
      -- roque : droits, roi et tour en place, cases libres, roi ni en échec, ni traversant une case attaquée
      if up = 'K' and coalesce(p_castle, '') <> '' then
        if w and i = 60 then
          if strpos(p_castle, 'K') > 0 and substr(p_sq, 64, 1) = 'R' and substr(p_sq, 62, 2) = '..'
             and not public._echecs_attacked(p_sq, 60, opp) and not public._echecs_attacked(p_sq, 61, opp)
             and not public._echecs_attacked(p_sq, 62, opp) then
            v := v || (60 + 64 * 62);
          end if;
          if strpos(p_castle, 'Q') > 0 and substr(p_sq, 57, 1) = 'R' and substr(p_sq, 58, 3) = '...'
             and not public._echecs_attacked(p_sq, 60, opp) and not public._echecs_attacked(p_sq, 59, opp)
             and not public._echecs_attacked(p_sq, 58, opp) then
            v := v || (60 + 64 * 58);
          end if;
        elsif not w and i = 4 then
          if strpos(p_castle, 'k') > 0 and substr(p_sq, 8, 1) = 'r' and substr(p_sq, 6, 2) = '..'
             and not public._echecs_attacked(p_sq, 4, opp) and not public._echecs_attacked(p_sq, 5, opp)
             and not public._echecs_attacked(p_sq, 6, opp) then
            v := v || (4 + 64 * 6);
          end if;
          if strpos(p_castle, 'q') > 0 and substr(p_sq, 1, 1) = 'r' and substr(p_sq, 2, 3) = '...'
             and not public._echecs_attacked(p_sq, 4, opp) and not public._echecs_attacked(p_sq, 3, opp)
             and not public._echecs_attacked(p_sq, 2, opp) then
            v := v || (4 + 64 * 2);
          end if;
        end if;
      end if;
    else
      -- tour : directions 0-3 ; fou : 4-7 ; dame : toutes
      k0 := case when up = 'B' then 4 else 0 end;
      k1 := case when up = 'R' then 3 else 7 end;
      for k in k0 .. k1 loop
        dr := dirs[k * 2 + 1];
        dc := dirs[k * 2 + 2];
        rr := r + dr;
        cc := c + dc;
        while rr between 0 and 7 and cc between 0 and 7 loop
          t := rr * 8 + cc;
          ch := substr(p_sq, t + 1, 1);
          if ch = '.' then
            v := v || (i + 64 * t);
          else
            ca := ascii(ch);
            if (w and ca >= 97) or (not w and ca <= 90) then v := v || (i + 64 * t); end if;
            exit;
          end if;
          rr := rr + dr;
          cc := cc + dc;
        end loop;
      end loop;
    end if;
  end loop;
  return v;
end $$;

-- Coups légaux : pseudo-coups qui ne laissent pas son propre roi en échec.
create or replace function public._echecs_legal_moves(p_sq text, p_side text, p_castle text, p_ep integer)
returns integer[] language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v   integer[] := '{}';
  m   integer;
  s   text;
  kc  text := case when p_side = 'w' then 'K' else 'k' end;
  opp text := case when p_side = 'w' then 'b' else 'w' end;
begin
  foreach m in array public._echecs_pseudo_moves(p_sq, p_side, p_castle, p_ep) loop
    s := public._echecs_after(p_sq, m);
    if not public._echecs_attacked(s, strpos(s, kc) - 1, opp) then v := v || m; end if;
  end loop;
  return v;
end $$;

-- Matériel insuffisant (nul automatique) : rois seuls, un seul fou ou cavalier,
-- ou uniquement des fous tous sur des cases de même couleur.
create or replace function public._echecs_insufficient(p_sq text)
returns boolean language plpgsql immutable strict
set search_path = public, extensions
as $$
declare
  v_rest  text := translate(p_sq, '.Kk', '');
  v_color integer := null;
  i       integer;
begin
  if v_rest = '' then return true; end if;
  if length(v_rest) = 1 and v_rest in ('B', 'b', 'N', 'n') then return true; end if;
  if v_rest !~ '^[Bb]+$' then return false; end if;
  for i in 0 .. 63 loop
    if substr(p_sq, i + 1, 1) in ('B', 'b') then
      if v_color is null then v_color := (i / 8 + i % 8) % 2;
      elsif v_color <> (i / 8 + i % 8) % 2 then return false;
      end if;
    end if;
  end loop;
  return true;
end $$;

-- Le camp p_side peut-il encore mater ? (pendule : temps écoulé contre roi seul / roi + fou / roi + cavalier = nul)
create or replace function public._echecs_can_mate(p_sq text, p_side text)
returns boolean language sql immutable strict
set search_path = public, extensions
as $$
  select not (v = '' or v in ('B', 'N'))
    from (select upper(translate(p_sq, case when p_side = 'w' then '.Kkqrbnp' else '.KkQRBNP' end, '')) as v) t;
$$;

-- Matériel (pion 1, cavalier 3, fou 3, tour 5, dame 9) du camp p_side.
create or replace function public._echecs_material(p_sq text, p_side text)
returns integer language sql immutable strict
set search_path = public, extensions
as $$
  select coalesce(sum(case ch when 'P' then 1 when 'N' then 3 when 'B' then 3 when 'R' then 5 when 'Q' then 9 else 0 end), 0)::integer
    from regexp_split_to_table(case when p_side = 'w' then translate(p_sq, 'kqrbnp', '') else upper(translate(p_sq, 'KQRBNP', '')) end, '') ch;
$$;

-- Clé de répétition : pièces, trait, droits de roque, prise en passant (seulement si elle est jouable).
create or replace function public._echecs_key(p_sq text, p_side text, p_castle text, p_ep integer, p_legal integer[])
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  m     integer;
  v_ep  text := '-';
begin
  if p_ep is not null then
    foreach m in array p_legal loop
      if (m >> 6) & 63 = p_ep and upper(substr(p_sq, (m & 63) + 1, 1)) = 'P' then v_ep := p_ep::text; exit; end if;
    end loop;
  end if;
  return p_sq || p_side || coalesce(nullif(p_castle, ''), '-') || v_ep;
end $$;

-- Coups légaux au format public {"<from>": [to, …]} (une promotion = une seule case d'arrivée).
create or replace function public._echecs_moves_json(p_legal integer[])
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(f::text, ts), '{}'::jsonb)
    from (select f, jsonb_agg(t order by t) as ts
            from (select distinct m & 63 as f, (m >> 6) & 63 as t from unnest(p_legal) as m) d
           group by f) g;
$$;

-- Position FEN -> {sq, side, castle, ep, half, full} (position de départ, tests).
create or replace function public._echecs_fen(p_fen text)
returns jsonb language plpgsql immutable strict
set search_path = public, extensions
as $$
declare
  v_parts text[] := regexp_split_to_array(trim(p_fen), '\s+');
  v_sq    text := '';
  ch      text;
  v_ep    integer := null;
begin
  foreach ch in array regexp_split_to_array(replace(v_parts[1], '/', ''), '') loop
    if ch ~ '^[1-8]$' then v_sq := v_sq || repeat('.', ch::integer);
    elsif ch ~ '^[KQRBNPkqrbnp]$' then v_sq := v_sq || ch;
    else raise exception 'invalid_fen';
    end if;
  end loop;
  if length(v_sq) <> 64 then raise exception 'invalid_fen'; end if;
  if coalesce(v_parts[4], '-') ~ '^[a-h][36]$' then
    v_ep := (8 - substr(v_parts[4], 2, 1)::integer) * 8 + ascii(substr(v_parts[4], 1, 1)) - 97;
  end if;
  return jsonb_build_object(
    'sq', v_sq,
    'side', case when coalesce(v_parts[2], 'w') = 'b' then 'b' else 'w' end,
    'castle', case when coalesce(v_parts[3], '-') = '-' then '' else v_parts[3] end,
    'ep', v_ep,
    'half', coalesce(nullif(v_parts[5], '')::integer, 0),
    'full', coalesce(nullif(v_parts[6], '')::integer, 1));
end $$;

-- Millisecondes de pendule à la cadence p_cadence (null = sans pendule).
create or replace function public._echecs_clock_ms(p_cadence text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_cadence when 'blitz3' then 180000 when 'rapid5' then 300000 when 'slow10' then 600000 end;
$$;

-- Temps restant (ms) au joueur au trait, à l'heure serveur (null = sans pendule).
create or replace function public._echecs_left(p_board jsonb)
returns bigint language sql stable
set search_path = public, extensions
as $$
  select case when p_board->'clock' is null or jsonb_typeof(p_board->'clock') <> 'object' then null
              else (p_board->'clock'->>(case when p_board->>'side' = 'w' then p_board->>'white' else p_board->>'black' end))::bigint
                   - floor(extract(epoch from (now() - (p_board->>'turn_started_at')::timestamptz)) * 1000)::bigint end;
$$;

create or replace function public._echecs_tstats0()
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select '{"moves":0,"captures":0,"queens_lost":0,"castles":0,"en_passants":0,"promotions":0,"stalemate_blunders":0}'::jsonb;
$$;

-- tstats[p][k] += n
create or replace function public._echecs_tinc(p_t jsonb, p text, p_k text, p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_t, array[p, p_k], to_jsonb(coalesce((p_t->p->>p_k)::integer, 0) + p_n));
$$;

-- Fin de manche : plateau figé (end, plus de coups), bilan 'game' pour les trophées.
create or replace function public._echecs_finish(p_board jsonb, p_server jsonb, p_reason text, p_winner text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'board', p_board || jsonb_build_object('moves', '{}'::jsonb, 'draw_offer', null,
                                           'end', jsonb_build_object('reason', p_reason, 'winner', p_winner)),
    'server', p_server,
    'outcome', case when p_winner is null then 'draw' else 'win' end,
    'winner', p_winner,
    'game', jsonb_build_object('reason', p_reason, 'p', coalesce(p_server->'tstats', '{}'::jsonb)));
$$;

-- Chute du drapeau du joueur au trait : défaite, ou nul si l'adversaire ne peut plus mater.
create or replace function public._echecs_flag(p_board jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_side  text := p_board->>'side';
  v_mover text := case when v_side = 'w' then p_board->>'white' else p_board->>'black' end;
  v_opp   text := case when v_side = 'w' then p_board->>'black' else p_board->>'white' end;
begin
  p_board := jsonb_set(p_board, array['clock', v_mover], '0'::jsonb);
  if public._echecs_can_mate(p_board->>'sq', case when v_side = 'w' then 'b' else 'w' end) then
    return public._echecs_finish(p_board, p_server, 'time', v_opp);
  end if;
  return public._echecs_finish(p_board, p_server, 'time', null);
end $$;

-- ---------------------------------------------------------------- hooks du socle

-- p_ctx.options.cadence : blitz3 | rapid5 (défaut) | slow10 | none. Blancs = starter de la manche.
create or replace function public.game_echecs_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_cad   text := coalesce(p_ctx->'options'->>'cadence', 'rapid5');
  v_white text := coalesce(p_ctx->>'starter', p_a);
  v_black text := case when v_white = p_a then p_b else p_a end;
  v_pos   jsonb := public._echecs_fen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  v_legal integer[];
  v_ms    integer;
begin
  if v_cad not in ('blitz3', 'rapid5', 'slow10', 'none') then v_cad := 'rapid5'; end if;
  v_ms := public._echecs_clock_ms(v_cad);
  v_legal := public._echecs_legal_moves(v_pos->>'sq', 'w', v_pos->>'castle', null);
  return jsonb_build_object(
    'board', v_pos || jsonb_build_object(
      'white', v_white, 'black', v_black,
      'moves', public._echecs_moves_json(v_legal), 'check', false, 'last', null,
      'captured', jsonb_build_object('w', '', 'b', ''),
      'cadence', v_cad,
      'clock', case when v_ms is not null then jsonb_build_object(v_white, v_ms, v_black, v_ms) end,
      'turn_started_at', public._duel_iso(now()),
      'draw_offer', null, 'end', null),
    'server', jsonb_build_object(
      'positions', jsonb_build_object(public._echecs_key(v_pos->>'sq', 'w', v_pos->>'castle', null, v_legal), 1),
      'tstats', jsonb_build_object(v_white, public._echecs_tstats0(), v_black, public._echecs_tstats0())),
    'turn_seconds', coalesce(v_ms / 1000.0, 60));
end $$;

create or replace function public.game_echecs_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_type   text := p_move->>'type';
  v_side   text := p_board->>'side';
  v_opp    text := case when p_board->>'side' = 'w' then 'b' else 'w' end;
  v_mover  text := case when p_board->>'side' = 'w' then p_board->>'white' else p_board->>'black' end;
  v_other  text := case when p_board->>'side' = 'w' then p_board->>'black' else p_board->>'white' end;
  v_me     text;
  v_left   bigint := public._echecs_left(p_board);
  v_server jsonb := coalesce(p_server, '{}'::jsonb);
  v_t      jsonb;
  v_sq     text := p_board->>'sq';
  v_castle text := coalesce(p_board->>'castle', '');
  v_ep     integer := (p_board->>'ep')::integer;
  v_legal  integer[];
  v_nlegal integer[];
  f        integer;
  t        integer;
  v_pr     integer := 0;
  v_m      integer;
  v_pc     text;
  v_cap    text;
  v_isep   boolean;
  v_nsq    text;
  v_nep    integer;
  v_half   integer;
  v_full   integer;
  v_check  boolean;
  v_key    text;
  v_rep    integer;
  v_clock  jsonb := p_board->'clock';
  v_secs   numeric;
  v_board  jsonb;
  v_pos    jsonb;
begin
  if p_actor = p_board->>'white' then v_me := 'w';
  elsif p_actor = p_board->>'black' then v_me := 'b';
  else raise exception 'invalid_move';
  end if;
  if jsonb_typeof(p_board->'end') = 'object' then raise exception 'invalid_move'; end if;
  v_t := coalesce(v_server->'tstats', jsonb_build_object(p_board->>'white', public._echecs_tstats0(), p_board->>'black', public._echecs_tstats0()));
  v_server := v_server || jsonb_build_object('tstats', v_t);

  -- Abandon : à tout moment (aussi hors de son tour, via board_offturn).
  if v_type = 'resign' then
    if (select count(*) from jsonb_object_keys(p_move)) <> 1 then raise exception 'invalid_move'; end if;
    return public._echecs_finish(p_board, v_server, 'resign', case when v_me = 'w' then p_board->>'black' else p_board->>'white' end);
  end if;

  -- Tout le reste se joue à son tour.
  if v_me <> v_side then raise exception 'not_your_turn'; end if;

  if v_type = 'flag' then
    if (select count(*) from jsonb_object_keys(p_move)) <> 1 then raise exception 'invalid_move'; end if;
    if v_left is null or v_left > 50 then raise exception 'invalid_move'; end if;
    return public._echecs_flag(p_board, v_server);
  end if;

  if v_type is null then
    -- Format strict : {from, to, promo?, offer_draw?}
    if exists (select 1 from jsonb_object_keys(p_move) k where k not in ('from', 'to', 'promo', 'offer_draw'))
       or jsonb_typeof(p_move->'from') is distinct from 'number' or jsonb_typeof(p_move->'to') is distinct from 'number'
       or p_move->>'from' !~ '^\d{1,2}$' or p_move->>'to' !~ '^\d{1,2}$'
       or (p_move ? 'promo' and (jsonb_typeof(p_move->'promo') <> 'string' or p_move->>'promo' not in ('q', 'r', 'b', 'n')))
       or (p_move ? 'offer_draw' and jsonb_typeof(p_move->'offer_draw') <> 'boolean') then
      raise exception 'invalid_move';
    end if;
    f := (p_move->>'from')::integer;
    t := (p_move->>'to')::integer;
    if f > 63 or t > 63 then raise exception 'invalid_move'; end if;
  elsif v_type <> 'accept_draw' then
    raise exception 'invalid_move';
  end if;

  -- Pendule : coup arrivé après la chute du drapeau = défaite au temps.
  if v_left is not null and v_left <= 0 then
    return public._echecs_flag(p_board, v_server);
  end if;

  if v_type = 'accept_draw' then
    if (select count(*) from jsonb_object_keys(p_move)) <> 1 then raise exception 'invalid_move'; end if;
    if p_board->>'draw_offer' is distinct from v_other then raise exception 'no_draw_offer'; end if;
    return public._echecs_finish(p_board, v_server, 'agreement', null);
  end if;

  -- Coup normal : doit figurer parmi les coups légaux (recalculés).
  v_legal := public._echecs_legal_moves(v_sq, v_side, v_castle, v_ep);
  if (f + 64 * t + 4096) = any(v_legal) then
    if not (p_move ? 'promo') then raise exception 'promotion_required'; end if;
    v_pr := strpos('qrbn', p_move->>'promo');
  elsif p_move ? 'promo' then
    raise exception 'invalid_move';
  end if;
  v_m := f + 64 * t + 4096 * v_pr;
  if not (v_m = any(v_legal)) then raise exception 'invalid_move'; end if;

  v_pc := substr(v_sq, f + 1, 1);
  v_cap := substr(v_sq, t + 1, 1);
  v_isep := upper(v_pc) = 'P' and f % 8 <> t % 8 and v_cap = '.';
  if v_isep then v_cap := case when v_side = 'w' then 'p' else 'P' end; end if;
  v_pos := public._echecs_apply(p_board, v_m);   -- (ne lit que sq, side, castle, half, full du plateau)
  v_nsq := v_pos->>'sq';
  v_castle := v_pos->>'castle';
  v_nep := (v_pos->>'ep')::integer;
  v_half := (v_pos->>'half')::integer;
  v_full := (v_pos->>'full')::integer;
  v_nlegal := public._echecs_legal_moves(v_nsq, v_opp, v_castle, v_nep);
  v_check := public._echecs_attacked(v_nsq, strpos(v_nsq, case when v_opp = 'w' then 'K' else 'k' end) - 1, v_side);

  -- Répétition
  v_key := public._echecs_key(v_nsq, v_opp, v_castle, v_nep, v_nlegal);
  v_rep := coalesce((v_server->'positions'->>v_key)::integer, 0) + 1;
  v_server := jsonb_set(v_server, '{positions}', coalesce(v_server->'positions', '{}'::jsonb) || jsonb_build_object(v_key, v_rep));

  -- Compteurs des trophées
  v_t := public._echecs_tinc(v_t, p_actor, 'moves', 1);
  if v_cap <> '.' then
    v_t := public._echecs_tinc(v_t, p_actor, 'captures', 1);
    if upper(v_cap) = 'Q' then v_t := public._echecs_tinc(v_t, v_other, 'queens_lost', 1); end if;
  end if;
  if v_isep then v_t := public._echecs_tinc(v_t, p_actor, 'en_passants', 1); end if;
  if upper(v_pc) = 'K' and abs(t - f) = 2 then v_t := public._echecs_tinc(v_t, p_actor, 'castles', 1); end if;
  if v_pr > 0 then v_t := public._echecs_tinc(v_t, p_actor, 'promotions', 1); end if;

  -- Pendule
  if v_left is not null then
    v_clock := jsonb_set(v_clock, array[p_actor], to_jsonb(v_left));
    v_secs := (v_clock->>v_other)::numeric / 1000;
  else
    v_secs := 60;
  end if;

  v_board := p_board || jsonb_build_object(
    'sq', v_nsq, 'side', v_opp, 'castle', v_castle, 'ep', v_nep, 'half', v_half, 'full', v_full,
    'moves', public._echecs_moves_json(v_nlegal), 'check', v_check,
    'last', jsonb_build_object('from', f, 'to', t),
    'captured', case when v_cap <> '.'
                     then jsonb_set(p_board->'captured', array[v_side], to_jsonb(coalesce(p_board->'captured'->>v_side, '') || v_cap))
                     else p_board->'captured' end,
    'clock', v_clock,
    'turn_started_at', public._duel_iso(now()),
    'draw_offer', case when coalesce((p_move->>'offer_draw')::boolean, false) then p_actor end);

  -- Issue : le mat prime sur les nuls automatiques.
  if cardinality(v_nlegal) = 0 then
    if v_check then
      v_server := v_server || jsonb_build_object('tstats', v_t);
      return public._echecs_finish(v_board, v_server, 'mate', p_actor);
    end if;
    if public._echecs_material(v_nsq, v_side) - public._echecs_material(v_nsq, v_opp) >= 5 then
      v_t := public._echecs_tinc(v_t, p_actor, 'stalemate_blunders', 1);
    end if;
    v_server := v_server || jsonb_build_object('tstats', v_t);
    return public._echecs_finish(v_board, v_server, 'stalemate', null);
  end if;
  v_server := v_server || jsonb_build_object('tstats', v_t);
  if public._echecs_insufficient(v_nsq) then return public._echecs_finish(v_board, v_server, 'material', null); end if;
  if v_rep >= 3 then return public._echecs_finish(v_board, v_server, 'repetition', null); end if;
  if v_half >= 100 then return public._echecs_finish(v_board, v_server, 'fifty', null); end if;
  return jsonb_build_object('board', v_board, 'server', v_server, 'outcome', null, 'turn_seconds', v_secs);
end $$;

-- Hors de son tour : seul l'abandon est permis.
create or replace function public.game_echecs_board_offturn(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
begin
  if p_move->>'type' is distinct from 'resign' then raise exception 'not_your_turn'; end if;
  return public.game_echecs_board_move(p_board, p_server, p_actor, p_move);
end $$;

-- Échéance : pendule écoulée -> chute du drapeau ; sinon (sans pendule) un coup légal au hasard (promotion : dame).
create or replace function public.game_echecs_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_left bigint := public._echecs_left(p_board);
  v      jsonb;
begin
  if v_left is not null and v_left <= 50 then return '{"type":"flag"}'::jsonb; end if;
  select jsonb_build_object('from', k::integer, 'to', (t #>> '{}')::integer)
         || case when upper(substr(p_board->>'sq', k::integer + 1, 1)) = 'P' and (t #>> '{}')::integer / 8 in (0, 7)
                 then '{"promo":"q"}'::jsonb else '{}'::jsonb end
    into v
    from jsonb_each(coalesce(p_board->'moves', '{}'::jsonb)) as e(k, ts), jsonb_array_elements(ts) as t
   order by random() limit 1;
  return coalesce(v, '{"type":"resign"}'::jsonb);
end $$;

-- ---------------------------------------------------------------- trophées

-- Hook de trophées du socle duel (_duel_tstats) : compteurs agrégés sur les manches de la session.
-- « Coups » = coups du joueur (pas des demi-coups).
create or replace function public.game_echecs_trophy_stats(p_state jsonb, p_pl text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'fast_mated', count(*) filter (where lost and g->>'reason' = 'mate' and coalesce((g->'p'->p_pl->>'moves')::integer, 0) <= 10),
    'queens_lost', coalesce(sum((g->'p'->p_pl->>'queens_lost')::integer), 0),
    'stalemate_blunders', coalesce(sum((g->'p'->p_pl->>'stalemate_blunders')::integer), 0),
    'captures', coalesce(sum((g->'p'->p_pl->>'captures')::integer), 0),
    'max_moves', coalesce(max((g->'p'->p_pl->>'moves')::integer), 0),
    'castles', coalesce(sum((g->'p'->p_pl->>'castles')::integer), 0),
    'en_passants', coalesce(sum((g->'p'->p_pl->>'en_passants')::integer), 0),
    'promotions', coalesce(sum((g->'p'->p_pl->>'promotions')::integer), 0),
    'mates', count(*) filter (where won and g->>'reason' = 'mate'),
    'fast_mates', count(*) filter (where won and g->>'reason' = 'mate' and coalesce((g->'p'->p_pl->>'moves')::integer, 0) <= 15))
  from public._duel_games_x(p_state, p_pl)
$$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

create or replace function public.game_echecs_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  return public._duel_start('echecs', p_players, p_options);
end $$;

create or replace function public.game_echecs_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('echecs', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._echecs_attacked(text, integer, text) from public, anon, authenticated;
revoke all on function public._echecs_after(text, integer) from public, anon, authenticated;
revoke all on function public._echecs_apply(jsonb, integer) from public, anon, authenticated;
revoke all on function public._echecs_pseudo_moves(text, text, text, integer) from public, anon, authenticated;
revoke all on function public._echecs_legal_moves(text, text, text, integer) from public, anon, authenticated;
revoke all on function public._echecs_insufficient(text) from public, anon, authenticated;
revoke all on function public._echecs_can_mate(text, text) from public, anon, authenticated;
revoke all on function public._echecs_material(text, text) from public, anon, authenticated;
revoke all on function public._echecs_key(text, text, text, integer, integer[]) from public, anon, authenticated;
revoke all on function public._echecs_moves_json(integer[]) from public, anon, authenticated;
revoke all on function public._echecs_fen(text) from public, anon, authenticated;
revoke all on function public._echecs_clock_ms(text) from public, anon, authenticated;
revoke all on function public._echecs_left(jsonb) from public, anon, authenticated;
revoke all on function public._echecs_tstats0() from public, anon, authenticated;
revoke all on function public._echecs_tinc(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._echecs_finish(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._echecs_flag(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_echecs_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_echecs_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_echecs_board_offturn(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_echecs_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_echecs_trophy_stats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_echecs_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_echecs_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\kems.sql =====
-- =============================================================================
-- JEU « kems » (Kems, le jeu de cartes de la cour de récré) — idempotent (create or replace).
-- Dépend de schema.sql (game_action, start_match, finish_match).
-- Conception : docs/superpowers/specs/2026-11-19-kems-design.md (section 10 = décisions).
--
-- 2 à 4 équipes (red, blue, green, yellow : ordre fixe) de EXACTEMENT 2 joueurs ; les autres sont
-- sur le banc (p_players hors équipes, absents de state.players : ils regardent).
-- Cartes : 4 joueurs = 32 cartes (7 -> As), 6 ou 8 joueurs = 52 cartes. Id d'une carte = valeur + couleur
-- (« 7H », « 10S », « AD »…) ; couleurs S (pique) H (coeur) D (carreau) C (trèfle).
-- Phases : signs (les équipes choisissent leur signe, « Prêt » ou 45 s) -> playing (échanges simultanés,
-- balayage du centre, KEMS / CONTRE-KEMS) -> reveal (6 s, mains retournées) -> playing … -> finished.
--
-- Secrets : les mains ne sont JAMAIS dans le state public avant la révélation. server.hands = {joueur: [4 cartes]}
-- (autoritaire) ; match_secrets[joueur] = {round, hand, square, sign_ideas, v}. state.hand_ver[joueur] augmente à
-- chaque nouvelle main (le front relit son secret). game_action verrouille la ligne du match : les échanges
-- simultanés sont sérialisés, le premier arrivé gagne (le 2e reçoit card_taken).
-- Le signe, lui, se fait dans la vraie vie : le serveur ne le connaît pas (il ne distribue que des idées).
-- =============================================================================

-- Mélange d'un tableau jsonb.
create or replace function public._kems_shuffle(p jsonb)
returns jsonb language sql volatile
set search_path = public, extensions
as $$ select coalesce(jsonb_agg(x order by random()), '[]'::jsonb) from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x $$;

-- Une main de 4 cartes est-elle un carré (4 cartes de même valeur) ?
create or replace function public._kems_square(p_hand jsonb)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select coalesce(jsonb_typeof(p_hand) = 'array' and jsonb_array_length(p_hand) = 4
         and (select count(distinct left(c, -1)) from jsonb_array_elements_text(p_hand) c) = 1, false)
$$;

-- Ajoute p_delta au compteur p_key du joueur p_pid (server.pstats).
create or replace function public._kems_bump(p_server jsonb, p_pid text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select case when p_server->'pstats' ? p_pid
    then jsonb_set(p_server, array['pstats', p_pid, p_key],
                   to_jsonb(coalesce((p_server->'pstats'->p_pid->>p_key)::integer, 0) + p_delta))
    else p_server end
$$;

-- Idem pour les compteurs d'équipe publics (state.tstats : kems, counters, errors, countered).
create or replace function public._kems_tbump(p_state jsonb, p_team text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_state, array['tstats', p_team, p_key],
                   to_jsonb(coalesce((p_state->'tstats'->p_team->>p_key)::integer, 0) + p_delta))
$$;

-- Secret d'un joueur (main, carré, idées de signe). La version vient de state.hand_ver (déjà incrémentée).
create or replace function public._kems_secret(p_state jsonb, p_server jsonb, p_pid text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'round', (p_state->>'round')::integer,
    'hand', coalesce(p_server->'hands'->p_pid, '[]'::jsonb),
    'square', public._kems_square(p_server->'hands'->p_pid),
    'sign_ideas', coalesce(p_server->'signs'->p_pid, '[]'::jsonb),
    'v', coalesce((p_state->'hand_ver'->>p_pid)::integer, 1))
$$;

-- state.deadline = prochaine échéance du tick pendant « playing » (balayage auto ou manche blanche).
create or replace function public._kems_playing_deadline(p_state jsonb)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select p_state || jsonb_build_object('deadline', to_jsonb(least(
    (p_state->'sweep'->>'deadline')::timestamptz, (p_state->>'round_deadline')::timestamptz)))
$$;

-- Distribue la manche p_round : paquet mélangé, 4 cartes par joueur, 4 au centre. Renvoie {state, server, secrets}.
create or replace function public._kems_deal(p_state jsonb, p_server jsonb, p_round integer)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_players text[] := array(select jsonb_array_elements_text(p_state->'players'));
  v_n       integer := array_length(v_players, 1);
  v_ranks   text[] := case when array_length(v_players, 1) <= 4
                           then array['7', '8', '9', '10', 'J', 'Q', 'K', 'A']
                           else array['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] end;
  v_deck    text[];
  v_i       integer;
  v_pid     text;
  v_hands   jsonb := '{}'::jsonb;
  v_ver     jsonb := coalesce(p_state->'hand_ver', '{}'::jsonb);
  v_secrets jsonb := '{}'::jsonb;
  v_sq      jsonb := '{}'::jsonb;
begin
  select array_agg(r || s order by random()) into v_deck
    from unnest(v_ranks) r, unnest(array['S', 'H', 'D', 'C']) s;
  for v_i in 1 .. v_n loop
    v_pid := v_players[v_i];
    v_hands := v_hands || jsonb_build_object(v_pid, to_jsonb(v_deck[(v_i - 1) * 4 + 1 : v_i * 4]));
    v_ver := v_ver || jsonb_build_object(v_pid, coalesce((v_ver->>v_pid)::integer, 0) + 1);
    if public._kems_square(v_hands->v_pid) then
      p_server := public._kems_bump(p_server, v_pid, 'squares', 1);
      v_sq := v_sq || jsonb_build_object(v_pid, p_round);
    end if;
  end loop;

  p_state := p_state || jsonb_build_object(
    'phase', 'playing', 'round', p_round, 'ready', '[]'::jsonb, 'hand_ver', v_ver,
    'center', to_jsonb(v_deck[v_n * 4 + 1 : v_n * 4 + 4]),
    'deck_count', array_length(v_deck, 1) - v_n * 4 - 4,
    'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', to_jsonb(now() + interval '10 seconds')),
    'round_deadline', to_jsonb(now() + interval '180 seconds'),
    'feed', '[]'::jsonb, 'call', null);
  p_state := public._kems_playing_deadline(p_state);
  p_server := p_server || jsonb_build_object(
    'deck', to_jsonb(v_deck[v_n * 4 + 5 : array_length(v_deck, 1)]), 'discard', '[]'::jsonb,
    'hands', v_hands, 'round_started_at', to_jsonb(now()),
    'sq_counted', coalesce(p_server->'sq_counted', '{}'::jsonb) || v_sq, 'last_swap', '{}'::jsonb);
  foreach v_pid in array v_players loop
    v_secrets := v_secrets || jsonb_build_object(v_pid, public._kems_secret(p_state, p_server, v_pid));
  end loop;
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
end $$;

-- Balaie le centre : 4 nouvelles cartes (pioche vide -> la défausse est remélangée, sans le centre balayé).
create or replace function public._kems_sweep(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_swept jsonb := p_state->'center';
  v_deck  jsonb := p_server->'deck';
  v_new   jsonb;
  v_need  integer;
begin
  v_new := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_deck) with ordinality t(x, o) where o <= 4);
  v_deck := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_deck) with ordinality t(x, o) where o > 4);
  v_need := 4 - jsonb_array_length(v_new);
  if v_need > 0 then
    v_deck := public._kems_shuffle(p_server->'discard');
    v_new := v_new || (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_deck) with ordinality t(x, o) where o <= v_need);
    v_deck := (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from jsonb_array_elements(v_deck) with ordinality t(x, o) where o > v_need);
    p_server := p_server || jsonb_build_object('discard', '[]'::jsonb);
  end if;
  p_server := p_server || jsonb_build_object('deck', v_deck, 'discard', (p_server->'discard') || v_swept);
  p_state := p_state || jsonb_build_object(
    'center', v_new, 'deck_count', jsonb_array_length(v_deck),
    'sweeps', coalesce((p_state->>'sweeps')::integer, 0) + 1,
    'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', to_jsonb(now() + interval '10 seconds')));
  return jsonb_build_object('state', public._kems_playing_deadline(p_state), 'server', p_server);
end $$;

-- Fin de partie : équipes à l'objectif = gagnantes (co-vainqueurs possibles) ; un résultat par membre d'équipe.
create or replace function public._kems_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_results jsonb;
  v_t       jsonb;
  v_m       text;
  v_target  integer := (p_state->>'target')::integer;
begin
  -- Poker face : victoire sans erreur de l'équipe et sans contre réussi contre elle
  for v_t in select t from jsonb_array_elements(p_state->'teams') t where (t->>'score')::integer >= v_target loop
    if coalesce((p_state->'tstats'->(v_t->>'id')->>'errors')::integer, 0) = 0
       and coalesce((p_state->'tstats'->(v_t->>'id')->>'countered')::integer, 0) = 0 then
      for v_m in select jsonb_array_elements_text(v_t->'players') loop
        p_server := public._kems_bump(p_server, v_m, 'clean_win', 1);
      end loop;
    end if;
  end loop;
  with t as (
    select x->>'id' as id, x->'players' as players, (x->>'score')::integer as score
      from jsonb_array_elements(p_state->'teams') x
  ), r as (
    select t.*, dense_rank() over (order by score desc) as rk from t
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', m, 'points', r.score, 'won', r.score >= v_target, 'placement', r.rk,
           'stats', coalesce(p_server->'pstats'->m, '{}'::jsonb))), '[]'::jsonb)
    into v_results
    from r, jsonb_array_elements_text(r.players) m;
  p_state := p_state || jsonb_build_object('phase', 'finished', 'results', v_results, 'deadline', null,
    'winners', (select jsonb_agg(x->>'id') from jsonb_array_elements(p_state->'teams') x where (x->>'score')::integer >= v_target));
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Fin de manche : applique p_call.deltas aux scores, retourne les mains (state.call) puis révélation ou fin de partie.
create or replace function public._kems_end_round(p_state jsonb, p_server jsonb, p_call jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_teams jsonb;
begin
  select jsonb_agg(t || jsonb_build_object('score',
           (t->>'score')::integer + coalesce((p_call->'deltas'->>(t->>'id'))::integer, 0)) order by o)
    into v_teams from jsonb_array_elements(p_state->'teams') with ordinality x(t, o);
  p_call := p_call || jsonb_build_object('hands', p_server->'hands', 'round', p_state->'round',
    'holders', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_each(p_server->'hands') e(k, v) where public._kems_square(v)));
  p_state := p_state || jsonb_build_object(
    'teams', v_teams, 'call', p_call, 'phase', 'reveal',
    'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', null),
    'deadline', to_jsonb(now() + interval '6 seconds'));
  if exists (select 1 from jsonb_array_elements(v_teams) t where (t->>'score')::integer >= (p_state->>'target')::integer) then
    return public._kems_finish(p_state, p_server);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_kems_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_in      jsonb := p_options->'teams';
  v_colors  text[] := array['red', 'blue', 'green', 'yellow'];
  v_c       text;
  v_k       text;
  v_members jsonb;
  v_teams   jsonb := '[]'::jsonb;
  v_players jsonb := '[]'::jsonb;
  v_seen    text[] := '{}';
  v_m       text;
  v_target  integer := case when p_options->>'target' in ('3', '5', '7') then (p_options->>'target')::integer else 5 end;
  v_pool    jsonb := case when jsonb_typeof(p_options->'signs') = 'array' then p_options->'signs' else '[]'::jsonb end;
  v_signs   jsonb := '{}'::jsonb;
  v_ideas   jsonb;
  v_pstats  jsonb := '{}'::jsonb;
  v_tstats  jsonb := '{}'::jsonb;
  v_ver     jsonb := '{}'::jsonb;
  v_secrets jsonb := '{}'::jsonb;
  v_bench   jsonb;
  v_state   jsonb;
  v_server  jsonb;
begin
  if v_in is null or jsonb_typeof(v_in) <> 'object' then raise exception 'invalid_teams'; end if;
  for v_k in select jsonb_object_keys(v_in) loop
    if not (v_k = any(v_colors)) then raise exception 'invalid_teams'; end if;
  end loop;
  foreach v_c in array v_colors loop
    continue when not (v_in ? v_c);
    v_members := v_in->v_c;
    if jsonb_typeof(v_members) <> 'array' or jsonb_array_length(v_members) <> 2 then raise exception 'invalid_teams'; end if;
    for v_m in select jsonb_array_elements_text(v_members) loop
      if v_m = any(v_seen) or not (v_m::uuid = any(p_players)) then raise exception 'invalid_teams'; end if;
      v_seen := v_seen || v_m;
    end loop;
    v_teams := v_teams || jsonb_build_array(jsonb_build_object('id', v_c, 'players', v_members, 'score', 0));
    v_players := v_players || v_members;
    v_tstats := v_tstats || jsonb_build_object(v_c, jsonb_build_object('kems', 0, 'counters', 0, 'errors', 0, 'countered', 0));
    -- 3 idées de signe par équipe, les mêmes pour les deux coéquipiers
    select coalesce(jsonb_agg(left(x, 80)), '[]'::jsonb) into v_ideas
      from (select x from jsonb_array_elements_text(v_pool) x where btrim(x) <> '' order by random() limit 3) q;
    for v_m in select jsonb_array_elements_text(v_members) loop
      v_signs := v_signs || jsonb_build_object(v_m, v_ideas);
    end loop;
  end loop;
  if jsonb_array_length(v_teams) not between 2 and 4 then raise exception 'invalid_teams'; end if;

  for v_m in select jsonb_array_elements_text(v_players) loop
    v_pstats := v_pstats || jsonb_build_object(v_m, jsonb_build_object(
      'false_kems', 0, 'countered', 0, 'false_counters', 0, 'squares', 0, 'team_kems', 0,
      'counters_ok', 0, 'fast_kems', 0, 'clean_win', 0, 'double_kems', 0));
    v_ver := v_ver || jsonb_build_object(v_m, 1);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(p) order by o), '[]'::jsonb) into v_bench
    from unnest(p_players) with ordinality t(p, o) where not (p::text = any(v_seen));

  v_state := jsonb_build_object(
    'game', 'kems', 'phase', 'signs', 'players', v_players, 'bench', v_bench, 'round', 0, 'target', v_target,
    'teams', v_teams, 'ready', '[]'::jsonb, 'center', '[]'::jsonb, 'deck_count', 0,
    'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', null), 'round_deadline', null,
    'deadline', to_jsonb(now() + interval '45 seconds'), 'feed', '[]'::jsonb, 'swaps', 0, 'sweeps', 0,
    'hand_ver', v_ver, 'call', null, 'tstats', v_tstats);
  v_server := jsonb_build_object('signs', v_signs, 'pstats', v_pstats, 'hands', '{}'::jsonb, 'deck', '[]'::jsonb,
    'discard', '[]'::jsonb, 'sq_counted', '{}'::jsonb, 'last_swap', '{}'::jsonb);
  for v_m in select jsonb_array_elements_text(v_players) loop
    v_secrets := v_secrets || jsonb_build_object(v_m, public._kems_secret(v_state, v_server, v_m));
  end loop;
  return jsonb_build_object('state', v_state, 'server', v_server, 'secrets', v_secrets);
end $$;

create or replace function public.game_kems_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_team    jsonb;
  v_partner text;
  v_n       integer := jsonb_array_length(p_state->'players');
  v_unchanged jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_give    text;
  v_take    text;
  v_hand    jsonb;
  v_ms      bigint;
  v_votes   jsonb;
  v_res     jsonb;
  v_call    jsonb;
  v_deltas  jsonb;
  v_tid     text;
  v_target  jsonb;
  v_others  text[];
  v_ok      boolean;
  v_double  boolean;
  v_m       text;
  v_ver     jsonb;
  v_started timestamptz;
begin
  select t into v_team from jsonb_array_elements(p_state->'teams') t where t->'players' ? v_me;
  if v_team is not null then
    select x into v_partner from jsonb_array_elements_text(v_team->'players') x where x <> v_me limit 1;
  end if;

  -- ---------------------------------------------------------------- ready
  if v_type = 'ready' then
    if v_phase <> 'signs' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    if not ((p_state->'ready') ? v_me) then
      p_state := p_state || jsonb_build_object('ready', (p_state->'ready') || to_jsonb(v_me));
    end if;
    if jsonb_array_length(p_state->'ready') >= v_n then return public._kems_deal(p_state, p_server, 1); end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- swap {give, take} (identifiants de cartes)
  elsif v_type = 'swap' then
    if v_phase <> 'playing' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    if jsonb_typeof(p_action->'give') <> 'string' or jsonb_typeof(p_action->'take') <> 'string' then raise exception 'invalid_action'; end if;
    v_give := p_action->>'give';
    v_take := p_action->>'take';
    -- double appui : un échange du même joueur moins de 250 ms après le précédent est ignoré
    v_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
    if v_ms - coalesce((p_server->'last_swap'->>v_me)::bigint, 0) < 250 then return v_unchanged; end if;
    v_hand := p_server->'hands'->v_me;
    if not (v_hand ? v_give) then raise exception 'not_in_hand'; end if;
    if not ((p_state->'center') ? v_take) then raise exception 'card_taken'; end if;
    v_hand := (select jsonb_agg(case when c = v_give then v_take else c end order by o) from jsonb_array_elements_text(v_hand) with ordinality t(c, o));
    p_state := p_state || jsonb_build_object(
      'center', (select jsonb_agg(case when c = v_take then v_give else c end order by o) from jsonb_array_elements_text(p_state->'center') with ordinality t(c, o)),
      'swaps', coalesce((p_state->>'swaps')::integer, 0) + 1,
      'feed', (jsonb_build_array(jsonb_build_object('n', coalesce((p_state->>'swaps')::integer, 0) + 1, 'by', v_me, 'took', v_take, 'gave', v_give))
               || (p_state->'feed')) - 6,
      'sweep', jsonb_build_object('votes', '[]'::jsonb, 'deadline', to_jsonb(now() + interval '10 seconds')),
      'hand_ver', (p_state->'hand_ver') || jsonb_build_object(v_me, coalesce((p_state->'hand_ver'->>v_me)::integer, 0) + 1));
    p_state := public._kems_playing_deadline(p_state);
    p_server := p_server || jsonb_build_object(
      'hands', (p_server->'hands') || jsonb_build_object(v_me, v_hand),
      'last_swap', coalesce(p_server->'last_swap', '{}'::jsonb) || jsonb_build_object(v_me, v_ms));
    -- carré réuni : compté une fois par manche
    if public._kems_square(v_hand) and (p_server->'sq_counted'->>v_me) is distinct from (p_state->>'round') then
      p_server := public._kems_bump(p_server, v_me, 'squares', 1);
      p_server := p_server || jsonb_build_object('sq_counted', (p_server->'sq_counted') || jsonb_build_object(v_me, (p_state->>'round')::integer));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', jsonb_build_object(v_me, public._kems_secret(p_state, p_server, v_me)));

  -- ---------------------------------------------------------------- sweep (bascule du vote « Suivantes »)
  elsif v_type = 'sweep' then
    if v_phase <> 'playing' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    v_votes := p_state->'sweep'->'votes';
    if v_votes ? v_me then
      v_votes := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(v_votes) x where x <> v_me);
    else
      v_votes := v_votes || to_jsonb(v_me);
    end if;
    p_state := p_state || jsonb_build_object('sweep', (p_state->'sweep') || jsonb_build_object('votes', v_votes));
    if jsonb_array_length(v_votes) >= v_n then return public._kems_sweep(p_state, p_server); end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- kems : le PARTENAIRE du détenteur du carré
  elsif v_type = 'kems' then
    if v_phase <> 'playing' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    v_tid := v_team->>'id';
    v_ok := public._kems_square(p_server->'hands'->v_partner);
    if v_ok then
      v_double := public._kems_square(p_server->'hands'->v_me);
      v_started := (p_server->>'round_started_at')::timestamptz;
      v_deltas := jsonb_build_object(v_tid, case when v_double then 2 else 1 end);
      p_state := public._kems_tbump(p_state, v_tid, 'kems', 1);
      for v_m in select jsonb_array_elements_text(v_team->'players') loop
        p_server := public._kems_bump(p_server, v_m, 'team_kems', 1);
        if v_double then p_server := public._kems_bump(p_server, v_m, 'double_kems', 1); end if;
        if extract(epoch from now() - v_started) < 20 then p_server := public._kems_bump(p_server, v_m, 'fast_kems', 1); end if;
      end loop;
    else
      v_double := false;
      v_deltas := (select coalesce(jsonb_object_agg(t->>'id', 1), '{}'::jsonb) from jsonb_array_elements(p_state->'teams') t where t->>'id' <> v_tid);
      p_state := public._kems_tbump(p_state, v_tid, 'errors', 1);
      p_server := public._kems_bump(p_server, v_me, 'false_kems', 1);
    end if;
    v_call := jsonb_build_object('type', 'kems', 'by', v_me, 'team', v_tid, 'target', null, 'ok', v_ok, 'double', v_double, 'deltas', v_deltas);
    return public._kems_end_round(p_state, p_server, v_call);

  -- ---------------------------------------------------------------- counter {team} : CONTRE-KEMS
  elsif v_type = 'counter' then
    if v_phase <> 'playing' then return v_unchanged; end if;
    if v_team is null then raise exception 'not_in_match'; end if;
    v_tid := v_team->>'id';
    v_others := array(select t->>'id' from jsonb_array_elements(p_state->'teams') t where t->>'id' <> v_tid);
    if p_action->>'team' is null or jsonb_typeof(p_action->'team') = 'null' then
      if array_length(v_others, 1) <> 1 then raise exception 'invalid_action'; end if;
      v_target := to_jsonb(v_others[1]);
    elsif (p_action->>'team') = any(v_others) then
      v_target := to_jsonb(p_action->>'team');
    else
      raise exception 'invalid_action';
    end if;
    select t into v_res from jsonb_array_elements(p_state->'teams') t where t->>'id' = (v_target #>> '{}');
    v_ok := exists (select 1 from jsonb_array_elements_text(v_res->'players') x where public._kems_square(p_server->'hands'->x));
    if v_ok then
      v_deltas := jsonb_build_object(v_tid, 1);
      p_state := public._kems_tbump(public._kems_tbump(p_state, v_tid, 'counters', 1), v_target #>> '{}', 'countered', 1);
      p_server := public._kems_bump(p_server, v_me, 'counters_ok', 1);
      for v_m in select jsonb_array_elements_text(v_res->'players') loop
        p_server := public._kems_bump(p_server, v_m, 'countered', 1);
      end loop;
    else
      v_deltas := (select coalesce(jsonb_object_agg(t->>'id', 1), '{}'::jsonb) from jsonb_array_elements(p_state->'teams') t where t->>'id' <> v_tid);
      p_state := public._kems_tbump(p_state, v_tid, 'errors', 1);
      p_server := public._kems_bump(p_server, v_me, 'false_counters', 1);
    end if;
    v_call := jsonb_build_object('type', 'counter', 'by', v_me, 'team', v_tid, 'target', v_target, 'ok', v_ok, 'double', false, 'deltas', v_deltas);
    return public._kems_end_round(p_state, p_server, v_call);

  -- ---------------------------------------------------------------- tick (idempotent)
  elsif v_type = 'tick' then
    if v_phase = 'signs' and now() >= (p_state->>'deadline')::timestamptz then
      return public._kems_deal(p_state, p_server, 1);
    elsif v_phase = 'playing' then
      if now() >= (p_state->>'round_deadline')::timestamptz then
        -- manche blanche : on redistribue sans point
        return public._kems_end_round(p_state, p_server, jsonb_build_object(
          'type', 'timeout', 'by', null, 'team', null, 'target', null, 'ok', false, 'double', false, 'deltas', '{}'::jsonb));
      elsif now() >= (p_state->'sweep'->>'deadline')::timestamptz then
        return public._kems_sweep(p_state, p_server);
      end if;
    elsif v_phase = 'reveal' and now() >= (p_state->>'deadline')::timestamptz then
      return public._kems_deal(p_state, p_server, (p_state->>'round')::integer + 1);
    end if;
    return v_unchanged;

  -- ---------------------------------------------------------------- next (hôte : passer la révélation)
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then return v_unchanged; end if;
    return public._kems_deal(p_state, p_server, (p_state->>'round')::integer + 1);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._kems_shuffle(jsonb) from public, anon, authenticated;
revoke all on function public._kems_square(jsonb) from public, anon, authenticated;
revoke all on function public._kems_bump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._kems_tbump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._kems_secret(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._kems_playing_deadline(jsonb) from public, anon, authenticated;
revoke all on function public._kems_deal(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._kems_sweep(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._kems_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._kems_end_round(jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_kems_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.game_kems_start(uuid[], jsonb) from public, anon, authenticated;


-- ===== games\le-plus-proche.sql =====
-- =============================================================================
-- JEU « le-plus-proche » : estimations chiffrées multi-écrans
-- =============================================================================
-- Idempotent (create or replace). Contrat : src/games/le-plus-proche/types.ts.
--
-- p_options : {"duration": 30, "questions": [{id, theme, difficulty, prompt, unit?, answer:number, note?}]}
-- Les réponses de référence (answer, note) et les estimations des joueurs restent dans
-- match_server_state jusqu'à la révélation. Chaque joueur retrouve SA saisie dans son
-- secret {"round", "value", "answered": true} (rechargement de page).
--
-- Phases : question -> reveal -> question ... -> finished.
--   question : fin quand tous ont répondu (valeur ou « je ne sais pas »), à l'échéance
--              (tick) ou par l'hôte (reveal).
--   reveal   : échéance auto (animation + 10 s) puis tick -> suite ; l'hôte peut enchaîner (next).
--   Accélérateur : quand il ne manque qu'un joueur, la deadline passe à now()+8 s si elle est plus loin.
-- Toute action portant un "round" différent de la manche courante est ignorée sans erreur.
--
-- Points d'une manche : classement par écart absolu |estimation - réponse| (ex-aequo =
-- même rang, rang « sportif » : 1, 1, 3…) : rang 1 = 3 pts, rang 2 = 2 pts, rang 3 = 1 pt.
-- Bonus +5 si l'estimation est EXACTE : arrondie au nombre de décimales de la réponse de
-- référence, elle lui est égale (réponse entière 1665 : 1665 ou 1665,4 sont exactes,
-- 1666 non ; réponse 3,14 : 3,141 est exacte). Une estimation exacte compte comme
-- un écart nul pour le classement.

-- Valeur absolue maximale acceptée (questions et estimations) : 1e15
-- (au-delà, les nombres JS perdent leur précision entière).
create or replace function public._lpp_num(p jsonb)
returns numeric language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'number' then return null; end if;
  v := (p #>> '{}')::numeric;
  if abs(v) > 1e15 then return null; end if;
  return trim_scale(round(v, 6));
end $$;

-- Ouvre la manche d'index p_idx (0-based).
create or replace function public._lpp_open(p_state jsonb, p_server jsonb, p_idx integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_q   jsonb := p_server->'questions'->p_idx;
  v_now timestamptz := now();
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'question',
    'round', p_idx + 1,
    'started_at', to_jsonb(v_now),
    'deadline', to_jsonb(v_now + make_interval(secs => (p_state->>'duration')::integer)),
    'question', v_q - 'answer' - 'note' - 'decimals',
    'answered', '[]'::jsonb);
  p_server := p_server || jsonb_build_object('answers', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_le_plus_proche_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_in   jsonb := p_options->'questions';
  v_dur  integer;
  v_qs   jsonb := '[]'::jsonb;
  e      jsonb;
  v_ans  numeric;
  v_zero jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_in is null or jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) = 0 then
    raise exception 'missing_questions';
  end if;
  begin
    v_dur := coalesce(nullif(p_options->>'duration', '')::integer, 30);
  exception when others then v_dur := 30;
  end;
  v_dur := least(greatest(v_dur, 10), 120);

  for e in select value from jsonb_array_elements(v_in) with ordinality t(value, o) order by o limit 30 loop
    v_ans := public._lpp_num(e->'answer');
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'prompt') <> 'string'
       or char_length(btrim(e->>'prompt')) = 0 or char_length(e->>'prompt') > 500
       or v_ans is null then
      raise exception 'invalid_questions';
    end if;
    v_qs := v_qs || jsonb_build_array(jsonb_build_object(
      'id', left(coalesce(e->>'id', ''), 40),
      'theme', left(coalesce(e->>'theme', ''), 40),
      'difficulty', case when e->>'difficulty' in ('1', '2', '3') then (e->>'difficulty')::integer end,
      'prompt', e->>'prompt',
      'unit', case when jsonb_typeof(e->'unit') = 'string' and btrim(e->>'unit') <> ''
                   then left(btrim(e->>'unit'), 30) end,
      'answer', v_ans,
      'decimals', least(scale(v_ans), 6),
      'note', case when jsonb_typeof(e->'note') = 'string' and btrim(e->>'note') <> ''
                   then left(btrim(e->>'note'), 400) end));
  end loop;

  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  return public._lpp_open(
    jsonb_build_object(
      'game', 'le-plus-proche',
      'round', 1,
      'total_rounds', jsonb_array_length(v_qs),
      'duration', v_dur,
      'players', to_jsonb(p_players),
      'scores', v_zero,
      'exacts', v_zero,
      'last_reveal', null,
      'history', '[]'::jsonb,
      'winners', null,
      'results', null),
    jsonb_build_object('questions', v_qs),
    0) || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Révélation : classement de la manche, points, publication des estimations.
create or replace function public._lpp_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_round   integer := (p_state->>'round')::integer;
  v_q       jsonb := p_server->'questions'->(v_round - 1);
  v_ans     numeric := (v_q->>'answer')::numeric;
  v_dec     integer := coalesce((v_q->>'decimals')::integer, 0);
  v_answers jsonb := coalesce(p_server->'answers', '{}'::jsonb);
  v_ranking jsonb;
  v_points  jsonb;
  v_exact   jsonb;
  v_reveal  jsonb;
begin
  with a as (
    select key as pid, (value #>> '{}')::numeric as v
      from jsonb_each(v_answers) where jsonb_typeof(value) = 'number'
  ), d as (
    select pid, v, round(v, v_dec) = v_ans as exact, abs(v - v_ans) as gap from a
  ), r as (
    select pid, v, exact, gap,
           rank() over (order by case when exact then 0 else gap end) as rk
      from d
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', pid, 'value', v, 'gap', gap, 'rank', rk, 'exact', exact,
           'points', case rk when 1 then 3 when 2 then 2 when 3 then 1 else 0 end
                     + case when exact then 5 else 0 end)
         order by rk, gap, pid), '[]'::jsonb)
    into v_ranking from r;

  select coalesce(jsonb_object_agg(x->>'profile_id', (x->>'points')::integer), '{}'::jsonb)
    into v_points from jsonb_array_elements(v_ranking) x where (x->>'points')::integer > 0;
  select coalesce(jsonb_object_agg(x->>'profile_id', 1), '{}'::jsonb)
    into v_exact from jsonb_array_elements(v_ranking) x where (x->>'exact')::boolean;

  v_reveal := jsonb_build_object(
    'round', v_round,
    'question', p_state->'question',
    'answer', v_ans,
    'note', v_q->'note',
    'answers', v_answers,
    'ranking', v_ranking,
    'points', v_points);

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    -- Passage automatique à la suite : animation (~2,5 s + 0,4 s/joueur) + 10 s de lecture.
    'deadline', to_jsonb(now() + make_interval(secs => 12.5 + 0.4 * jsonb_array_length(p_state->'players'))),
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'exacts', (select jsonb_object_agg(key, value::integer + coalesce((v_exact->>key)::integer, 0))
                 from jsonb_each_text(p_state->'exacts')),
    'last_reveal', v_reveal,
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(
      v_reveal - 'points' - 'question' || jsonb_build_object(
        'id', v_q->'id', 'theme', v_q->'theme', 'prompt', v_q->'prompt', 'unit', v_q->'unit')));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].ranking.
create or replace function public._lpp_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with h as (
    select e.o, (e.v->>'answer')::numeric as ans, e.v->'ranking' as rk
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
  ), m as (
    select h.o, h.ans,
           (select r from jsonb_array_elements(h.rk) r where r->>'profile_id' = p_pl limit 1) as me,
           jsonb_array_length(h.rk) as n,
           (select max((r->>'rank')::integer) from jsonb_array_elements(h.rk) r) as maxrank,
           (select count(*) from jsonb_array_elements(h.rk) r where (r->>'rank')::integer = 1) as nfirst
      from h
  ), x as (
    select m.o, m.ans, m.n, m.maxrank, m.nfirst, (m.me is not null) as ans_ok,
           coalesce((m.me->>'rank')::integer, 0) as rank, coalesce((m.me->>'points')::integer, 0) as pts,
           coalesce((m.me->>'exact')::boolean, false) as exact,
           (m.me->>'value')::numeric as val, (m.me->>'gap')::numeric as gap
      from m
  ), g1 as (
    select x.*, x.o - row_number() over (partition by (x.pts = 0) order by x.o) as grp from x
  ), g2 as (
    select x.*, x.o - row_number() over (partition by (x.rank = 1) order by x.o) as grp from x
  )
  select jsonb_build_object(
    'farthest', (select count(*) from x where ans_ok and n >= 3 and rank = maxrank and rank > 1),
    'way_off', (select count(*) from x where ans_ok and ans <> 0 and (abs(val) >= 10 * abs(ans) or abs(val) <= abs(ans) / 10)),
    'scoreless_run', coalesce((select max(c) from (select count(*) as c from g1 where pts = 0 group by grp) z), 0),
    'closest', (select count(*) from x where rank = 1),
    'seconds', (select count(*) from x where rank = 2),
    'tied_closest', (select count(*) from x where rank = 1 and nfirst >= 2),
    'near_miss', (select count(*) from x where rank = 1 and not exact and ans <> 0 and gap < abs(ans) * 0.01),
    'scored_all', case when (select count(*) from x) >= 8 and not exists (select 1 from x where pts = 0) then 1 else 0 end,
    'closest_run', coalesce((select max(c) from (select count(*) as c from g2 where rank = 1 group by grp) z), 0))
$$;

create or replace function public._lpp_finish(p_state jsonb, p_server jsonb)
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
           'stats', jsonb_build_object('exacts', coalesce((p_state->'exacts'->>t.key)::integer, 0))
                    || public._lpp_tstats(p_state, t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

create or replace function public.game_le_plus_proche_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type     text := p_action->>'type';
  v_phase    text := p_state->>'phase';
  v_round    integer := (p_state->>'round')::integer;
  v_total    integer := (p_state->>'total_rounds')::integer;
  v_deadline timestamptz := (p_state->>'deadline')::timestamptz;
  v_me       text := p_actor::text;
  v_same     jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_val      numeric;
  v_res      jsonb;
begin
  if v_type is null or v_type not in ('answer', 'reveal', 'next', 'tick') then
    raise exception 'unknown_action';
  end if;
  if v_phase not in ('question', 'reveal') then return v_same; end if;
  if p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round') then
    return v_same;
  end if;

  if v_type = 'tick' then
    if v_deadline is null or now() < v_deadline then return v_same; end if;
    if v_phase = 'question' then return public._lpp_reveal(p_state, p_server); end if;
    if v_round >= v_total then return public._lpp_finish(p_state, p_server); end if;
    return public._lpp_open(p_state, p_server, v_round);

  elsif v_type = 'reveal' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'question' then return v_same; end if;
    return public._lpp_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then return v_same; end if;
    if v_round >= v_total then return public._lpp_finish(p_state, p_server); end if;
    return public._lpp_open(p_state, p_server, v_round);
  end if;

  -- answer : {"value": number|null, "round"} ; null = « je ne sais pas ».
  if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
  if v_phase <> 'question' then return v_same; end if;
  if not (p_action ? 'value') then raise exception 'invalid_number'; end if;
  if jsonb_typeof(p_action->'value') = 'null' then
    v_val := null;
  elsif jsonb_typeof(p_action->'value') = 'number' then
    v_val := public._lpp_num(p_action->'value');
    if v_val is null then raise exception 'number_out_of_range'; end if;
  else
    raise exception 'invalid_number';
  end if;
  -- Échéance dépassée : la saisie tardive n'est pas prise, on révèle.
  if v_deadline is not null and now() >= v_deadline then
    return public._lpp_reveal(p_state, p_server);
  end if;

  p_server := jsonb_set(p_server, array['answers', v_me], coalesce(to_jsonb(v_val), 'null'::jsonb), true);
  if not (p_state->'answered' ? v_me) then
    p_state := jsonb_set(p_state, '{answered}', (p_state->'answered') || to_jsonb(v_me));
  end if;

  if not exists (select 1 from jsonb_array_elements_text(p_state->'players') pl
                  where not (p_state->'answered' ? pl)) then
    v_res := public._lpp_reveal(p_state, p_server);
  else
    -- Accélérateur : il ne manque plus qu'un joueur -> 8 s max (jamais allongé).
    if (select count(*) from jsonb_array_elements_text(p_state->'players') pl
         where not (p_state->'answered' ? pl)) = 1
       and v_deadline > now() + interval '8 seconds' then
      p_state := p_state || jsonb_build_object('deadline', to_jsonb(now() + interval '8 seconds'));
    end if;
    v_res := jsonb_build_object('state', p_state, 'server', p_server);
  end if;
  return v_res || jsonb_build_object('secrets', jsonb_build_object(v_me, jsonb_build_object(
    'round', v_round, 'value', v_val, 'answered', true)));
end $$;

revoke all on function public._lpp_num(jsonb) from public, anon, authenticated;
revoke all on function public._lpp_open(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._lpp_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lpp_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lpp_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public.game_le_plus_proche_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_le_plus_proche_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\loup-garou.sql =====
-- =============================================================================
-- JEU « Loup-garou » (id loup-garou) — jeu de rôles caché multi-écrans
-- Idempotent (create or replace). Dispatché par start_match / game_action.
-- Contrat complet (state public, secrets, actions, choix de règles) :
--   src/games/loup-garou/types.ts
--
-- Rôles : loup, villageois, voyante, sorciere, cupidon, chasseur, protecteur.
-- Phases : roles -> night(step) -> reveal(dawn) -> [hunter -> reveal(hunter)]
--          -> day -> vote -> reveal(vote) -> [hunter…] -> night … -> finished
-- Étapes de nuit (ordre) : cupidon, amoureux (nuit 1 seulement) -> voyante ->
--   protecteur -> loups -> sorciere. Une étape existe si le rôle est dans la
--   composition (publique), qu'il soit vivant ou non : durée minimale + aléa
--   pour ne pas trahir qui est mort.
-- Rien de secret dans le state public : rôles, votes des loups, résultats de la
-- voyante, potions, amoureux et cible des loups vivent dans `server` + secrets.
-- =============================================================================

create or replace function public._lg_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Composition suggérée selon le nombre de joueurs (miroir de suggestComposition
-- dans src/games/loup-garou/types.ts). Les villageois complètent.
create or replace function public._lg_suggest(p_n integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select (case
    when p_n <= 5 then '{"loup":1,"voyante":1,"sorciere":1,"chasseur":0,"cupidon":0,"protecteur":0}'
    when p_n = 6  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":0,"protecteur":0}'
    when p_n = 7  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":0}'
    when p_n = 8  then '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":1}'
    else               '{"loup":2,"voyante":1,"sorciere":1,"chasseur":1,"cupidon":1,"protecteur":1}'
  end)::jsonb;
$$;

-- Durées des étapes de nuit (secondes) : minimum (même si le rôle est mort) et maximum.
create or replace function public._lg_step_min(p_step text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_step when 'cupidon' then 15 when 'amoureux' then 10 when 'voyante' then 12
                     when 'protecteur' then 10 when 'loups' then 18 when 'sorciere' then 12 else 10 end;
$$;

create or replace function public._lg_step_max(p_step text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select case p_step when 'cupidon' then 45 when 'amoureux' then 10 when 'voyante' then 40
                     when 'protecteur' then 35 when 'loups' then 75 when 'sorciere' then 45 else 30 end;
$$;

-- Joueurs vivants ayant le rôle p_role (ordre de `alive`).
create or replace function public._lg_alive_role(p_state jsonb, p_server jsonb, p_role text)
returns text[] language sql immutable
set search_path = public, extensions
as $$
  select coalesce(array_agg(a order by o), '{}'::text[])
    from jsonb_array_elements_text(p_state->'alive') with ordinality as t(a, o)
   where p_server->'roles'->>a = p_role;
$$;

-- Étapes de la nuit courante (state.night), selon la composition publique.
create or replace function public._lg_steps(p_state jsonb)
returns text[] language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v text[] := '{}';
  c jsonb  := p_state->'composition';
begin
  if coalesce((p_state->>'night')::integer, 1) = 1 and coalesce((c->>'cupidon')::integer, 0) > 0 then
    v := array_append(v, 'cupidon');
    v := array_append(v, 'amoureux');
  end if;
  if coalesce((c->>'voyante')::integer, 0) > 0 then v := array_append(v, 'voyante'); end if;
  if coalesce((c->>'protecteur')::integer, 0) > 0 then v := array_append(v, 'protecteur'); end if;
  v := array_append(v, 'loups');
  if coalesce((c->>'sorciere')::integer, 0) > 0 then v := array_append(v, 'sorciere'); end if;
  return v;
end $$;

-- Joueurs qui doivent agir pendant l'étape (vivants avec le rôle).
create or replace function public._lg_actors(p_state jsonb, p_server jsonb, p_step text)
returns text[] language plpgsql immutable
set search_path = public, extensions
as $$
begin
  return case p_step
    when 'cupidon'    then public._lg_alive_role(p_state, p_server, 'cupidon')
    when 'voyante'    then public._lg_alive_role(p_state, p_server, 'voyante')
    when 'protecteur' then public._lg_alive_role(p_state, p_server, 'protecteur')
    when 'loups'      then public._lg_alive_role(p_state, p_server, 'loup')
    when 'sorciere'   then case
      when coalesce((p_server->'potions'->>'life')::boolean, false)
        or coalesce((p_server->'potions'->>'death')::boolean, false)
      then public._lg_alive_role(p_state, p_server, 'sorciere') else '{}'::text[] end
    else '{}'::text[] end;
end $$;

create or replace function public._lg_pair(p_state jsonb, p_server jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select jsonb_build_object('state', p_state, 'server', p_server); $$;

-- Début d'une étape de nuit. Échéance : max si un acteur vivant doit agir,
-- sinon min + aléa (0-6 s) pour simuler une hésitation.
create or replace function public._lg_begin_step(p_state jsonb, p_server jsonb, p_step text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_min    integer := public._lg_step_min(p_step);
  v_max    integer := public._lg_step_max(p_step);
  v_actors text[];
  v_secs   double precision;
begin
  p_server := p_server || jsonb_build_object('done', false);
  if p_step = 'loups' then p_server := p_server || jsonb_build_object('wolf_votes', '{}'::jsonb); end if;
  if p_step = 'amoureux' then p_server := p_server || jsonb_build_object('lovers_known', true); end if;
  v_actors := public._lg_actors(p_state, p_server, p_step);
  v_secs := case when p_step = 'amoureux' then v_max
                 when cardinality(v_actors) = 0 then v_min + random() * 6
                 else v_max end;
  p_state := p_state || jsonb_build_object(
    'phase', 'night', 'step', p_step,
    'step_started', public._lg_iso(now()), 'step_max', v_max,
    'deadline', public._lg_iso(now() + make_interval(secs => v_secs)));
  return public._lg_pair(p_state, p_server);
end $$;

-- L'acteur a fini : l'étape se termine au plus tôt à début + min (+ aléa 0-3 s).
create or replace function public._lg_mark_done(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_min_end timestamptz := (p_state->>'step_started')::timestamptz
                           + make_interval(secs => public._lg_step_min(p_state->>'step'));
begin
  p_server := p_server || jsonb_build_object('done', true);
  p_state := p_state || jsonb_build_object('deadline',
    public._lg_iso(greatest(now(), v_min_end) + make_interval(secs => random() * 3)));
  return public._lg_pair(p_state, p_server);
end $$;

create or replace function public._lg_cur(p_server jsonb, p_key text, p_val jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_server || jsonb_build_object('cur', coalesce(p_server->'cur', '{}'::jsonb) || jsonb_build_object(p_key, p_val));
$$;

-- Tue un joueur (si vivant) : rôle révélé, chasseur en attente, chagrin de l'amoureux.
create or replace function public._lg_kill(p_state jsonb, p_server jsonb, p_id text, p_cause text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_role  text := p_server->'roles'->>p_id;
  v_entry jsonb;
  v_other text;
begin
  if p_id is null or not coalesce((p_state->'alive') ? p_id, false) then
    return public._lg_pair(p_state, p_server);
  end if;
  p_state := p_state || jsonb_build_object('alive',
    (select coalesce(jsonb_agg(a order by o), '[]'::jsonb)
       from jsonb_array_elements_text(p_state->'alive') with ordinality as t(a, o) where a <> p_id));
  v_entry := jsonb_build_object('id', p_id, 'role', v_role, 'cause', p_cause,
                                'night', coalesce((p_state->>'night')::integer, 0),
                                'when', coalesce(p_state->'reveal'->>'kind', 'dawn'));
  p_state := p_state || jsonb_build_object('dead', coalesce(p_state->'dead', '[]'::jsonb) || jsonb_build_array(v_entry));
  if jsonb_typeof(p_state->'reveal') = 'object' then
    p_state := jsonb_set(p_state, '{reveal,deaths}',
                         coalesce(p_state->'reveal'->'deaths', '[]'::jsonb) || jsonb_build_array(v_entry));
  end if;
  if v_role = 'chasseur' then
    p_state := p_state || jsonb_build_object('hunter_pending', p_id);
  end if;
  if coalesce(p_server->'lovers', '[]'::jsonb) ? p_id then
    select x into v_other from jsonb_array_elements_text(p_server->'lovers') x where x <> p_id limit 1;
    return public._lg_kill(p_state, p_server, v_other, 'chagrin');
  end if;
  return public._lg_pair(p_state, p_server);
end $$;

-- Camp d'un joueur : 'amoureux' (couple mixte loup + non-loup), 'loups' ou 'village'.
create or replace function public._lg_camp(p_server jsonb, p_id text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_l jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
begin
  if jsonb_array_length(v_l) = 2 and v_l ? p_id
     and ((p_server->'roles'->>(v_l->>0)) = 'loup') <> ((p_server->'roles'->>(v_l->>1)) = 'loup') then
    return 'amoureux';
  end if;
  return case when p_server->'roles'->>p_id = 'loup' then 'loups' else 'village' end;
end $$;

-- Vainqueur ou null.
--  * amoureux mixtes vivants : gagnent s'ils sont les 2 derniers ; les loups
--    « purs » gagnent s'ils sont au moins aussi nombreux que les autres vivants.
--  * sinon : village si plus aucun loup vivant ; loups si loups >= autres vivants.
create or replace function public._lg_winner(p_state jsonb, p_server jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_alive  text[] := array(select jsonb_array_elements_text(p_state->'alive'));
  v_n      integer := cardinality(v_alive);
  v_wolves integer := cardinality(public._lg_alive_role(p_state, p_server, 'loup'));
  v_l      jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
  v_pure   integer;
begin
  if jsonb_array_length(v_l) = 2 and public._lg_camp(p_server, v_l->>0) = 'amoureux'
     and (v_l->>0) = any(v_alive) and (v_l->>1) = any(v_alive) then
    if v_n = 2 then return 'amoureux'; end if;
    v_pure := v_wolves - 1;
    if v_pure > 0 and v_pure >= v_n - v_pure then return 'loups'; end if;
    return null;
  end if;
  if v_wolves = 0 then return 'village'; end if;
  if v_wolves >= v_n - v_wolves then return 'loups'; end if;
  return null;
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql), lues dans dead / history / nights.
create or replace function public._lg_tstats(p_state jsonb, p_server jsonb, p_pl text, p_winner text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_roles   jsonb := coalesce(p_server->'roles', '{}'::jsonb);
  v_role    text := v_roles->>p_pl;
  v_won     boolean := public._lg_camp(p_server, p_pl) = p_winner;
  v_alive   boolean := coalesce((p_state->'alive') ? p_pl, false);
  v_hist    jsonb := coalesce(p_state->'history', '[]'::jsonb);
  v_recv    integer;
  v_wvotes  integer;
  v_powers  integer := 0;
  v_wolves_alive integer;
  v_wolves_start integer;
begin
  -- votes du village contre moi / votes que j'ai donnés à un loup (révélations de vote)
  select count(*) filter (where v.value = p_pl),
         count(*) filter (where v.key = p_pl and v_roles->>v.value = 'loup')
    into v_recv, v_wvotes
    from jsonb_array_elements(v_hist) h, jsonb_each_text(coalesce(h->'votes', '{}'::jsonb)) v
   where h->>'kind' = 'vote';

  -- pouvoirs réussis
  if v_role = 'voyante' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'seer' is not null and v_roles->>(n->>'seer') = 'loup';
  elsif v_role = 'sorciere' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'saved' is not null;
  elsif v_role = 'protecteur' then
    select count(*) into v_powers from jsonb_array_elements(coalesce(p_server->'nights', '[]'::jsonb)) n
     where n->>'protect' is not null and n->>'protect' = n->>'wolves';
  elsif v_role = 'chasseur' then
    select count(*) into v_powers from jsonb_array_elements(v_hist) h
     where h->>'kind' = 'hunter' and h->>'hunter' = p_pl and h->>'target' is not null
       and v_roles->>(h->>'target') = 'loup';
  end if;

  select count(*) filter (where v.value = 'loup' and (p_state->'alive') ? v.key),
         count(*) filter (where v.value = 'loup')
    into v_wolves_alive, v_wolves_start
    from jsonb_each_text(v_roles) v;

  return jsonb_build_object(
    'first_night_death', case when exists (select 1 from jsonb_array_elements(coalesce(p_state->'dead', '[]'::jsonb)) d
        where d->>'id' = p_pl and d->>'cause' = 'night' and (d->>'night')::integer = 1) then 1 else 0 end,
    'lynched_innocent', case when v_role <> 'loup' and exists (select 1 from jsonb_array_elements(coalesce(p_state->'dead', '[]'::jsonb)) d
        where d->>'id' = p_pl and d->>'cause' = 'vote') then 1 else 0 end,
    'died', case when v_alive then 0 else 1 end,
    'survived', case when v_alive then 1 else 0 end,
    'wolf_votes', v_wvotes,
    'won_village', case when v_won and public._lg_camp(p_server, p_pl) = 'village' then 1 else 0 end,
    'won_wolf', case when v_won and v_role = 'loup' then 1 else 0 end,
    'powers', v_powers,
    'simple_win', case when v_won and v_role = 'villageois' and v_alive then 1 else 0 end,
    'lamb', case when v_won and v_role = 'loup' and v_recv = 0 then 1 else 0 end,
    'lone_wolf', case when v_won and v_role = 'loup' and v_alive and v_wolves_alive = 1 and v_wolves_start >= 2 then 1 else 0 end);
end $$;

-- Fin de partie : rôles, amoureux et chronique des nuits rendus publics.
create or replace function public._lg_finish(p_state jsonb, p_server jsonb, p_winner text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_results jsonb := '[]'::jsonb;
  p         text;
  v_won     boolean;
  v_alive   boolean;
begin
  for p in select jsonb_array_elements_text(p_state->'players') loop
    v_won := public._lg_camp(p_server, p) = p_winner;
    v_alive := (p_state->'alive') ? p;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', p, 'won', v_won,
      'points', case when v_won and v_alive then 3 when v_won then 2 else 0 end,
      'placement', case when v_won then 1 else 2 end,
      'stats', public._lg_tstats(p_state, p_server, p, p_winner)));
  end loop;
  p_state := p_state || jsonb_build_object(
    'phase', 'finished', 'winner', p_winner, 'step', null, 'deadline', null, 'hunter', null,
    'roles', p_server->'roles', 'lovers', coalesce(p_server->'lovers', '[]'::jsonb),
    'chronicle', coalesce(p_server->'nights', '[]'::jsonb), 'results', v_results);
  return public._lg_pair(p_state, p_server);
end $$;

create or replace function public._lg_begin_night(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'night', coalesce((p_state->>'night')::integer, 0) + 1,
    'reveal', null, 'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false, 'first_vote', null);
  p_server := p_server || jsonb_build_object(
    'cur', jsonb_build_object('night', (p_state->>'night')::integer),
    'victim', null, 'protected', null, 'saved', false, 'poison', null);
  return public._lg_begin_step(p_state, p_server, (public._lg_steps(p_state))[1]);
end $$;

-- Fin de la nuit : morts (victime des loups sauf protégée/sauvée, empoisonné).
create or replace function public._lg_resolve_night(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_victim text := p_server->>'victim';
  v_r      jsonb;
  v_n      integer;
  v_cur    jsonb;
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'reveal', 'step', null, 'after', 'day',
    'reveal', jsonb_build_object('kind', 'dawn', 'night', (p_state->>'night')::integer, 'deaths', '[]'::jsonb));
  if v_victim is not null and v_victim is distinct from p_server->>'protected'
     and not coalesce((p_server->>'saved')::boolean, false) then
    v_r := public._lg_kill(p_state, p_server, v_victim, 'night');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  if p_server->>'poison' is not null then
    v_r := public._lg_kill(p_state, p_server, p_server->>'poison', 'night');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  v_cur := coalesce(p_server->'cur', '{}'::jsonb) || jsonb_build_object(
    'night', (p_state->>'night')::integer,
    'deaths', (select coalesce(jsonb_agg(d->'id'), '[]'::jsonb) from jsonb_array_elements(p_state->'reveal'->'deaths') d));
  p_server := p_server || jsonb_build_object(
    'nights', coalesce(p_server->'nights', '[]'::jsonb) || jsonb_build_array(v_cur),
    'cur', null, 'last_protected', p_server->'protected', 'protected', null,
    'victim', null, 'saved', false, 'poison', null, 'wolf_votes', '{}'::jsonb, 'done', false);
  v_n := jsonb_array_length(p_state->'reveal'->'deaths');
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(secs => 10 + 4 * v_n)));
  return public._lg_pair(p_state, p_server);
end $$;

-- Fin d'une étape de nuit (échéance) : choix par défaut puis étape suivante.
create or replace function public._lg_end_step(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_step   text := p_state->>'step';
  v_steps  text[] := public._lg_steps(p_state);
  v_idx    integer;
  v_wolves text[];
  v_target text;
begin
  if v_step = 'loups' then
    v_wolves := public._lg_alive_role(p_state, p_server, 'loup');
    -- Majorité des loups vivants ; égalité -> tirage parmi les ex-aequo ; aucun vote -> personne.
    select t into v_target from (
      select value as t, count(*) as c
        from jsonb_each_text(coalesce(p_server->'wolf_votes', '{}'::jsonb))
       where key = any(v_wolves) and (p_state->'alive') ? value
       group by value) x
     order by c desc, random() limit 1;
    p_server := p_server || jsonb_build_object('victim', v_target);
    p_server := public._lg_cur(p_server, 'wolves', to_jsonb(v_target));
  end if;
  v_idx := array_position(v_steps, v_step);
  if v_idx is not null and v_idx < cardinality(v_steps) then
    return public._lg_begin_step(p_state, p_server, v_steps[v_idx + 1]);
  end if;
  return public._lg_resolve_night(p_state, p_server);
end $$;

create or replace function public._lg_begin_vote(p_state jsonb, p_server jsonb, p_candidates jsonb, p_revote boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'vote', 'votes', '{}'::jsonb, 'candidates', p_candidates, 'revote', p_revote,
    'deadline', public._lg_iso(now() + interval '75 seconds'));
  return public._lg_pair(p_state, p_server);
end $$;

-- Dépouillement : majorité relative ; 1re égalité -> revote entre ex-aequo ;
-- 2e égalité -> personne n'est éliminé ; aucun vote -> personne.
create or replace function public._lg_tally(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_counts  jsonb;
  v_max     integer;
  v_tied    jsonb;
  v_elim    text;
  v_outcome text;
  v_r       jsonb;
begin
  select coalesce(jsonb_object_agg(t, c), '{}'::jsonb), max(c) into v_counts, v_max from (
    select value as t, count(*)::integer as c
      from jsonb_each_text(coalesce(p_state->'votes', '{}'::jsonb))
     where (p_state->'alive') ? key and (p_state->'alive') ? value
     group by value) x;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_tied
    from jsonb_each_text(v_counts) where value::integer = v_max;

  if v_max is null then
    v_outcome := 'none';
  elsif jsonb_array_length(v_tied) = 1 then
    v_outcome := 'majority';
    v_elim := v_tied->>0;
  elsif not coalesce((p_state->>'revote')::boolean, false) then
    p_state := p_state || jsonb_build_object('first_vote',
      jsonb_build_object('votes', p_state->'votes', 'counts', v_counts, 'tied', v_tied));
    return public._lg_begin_vote(p_state, p_server, v_tied, true);
  else
    v_outcome := 'tie';
  end if;

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal', 'after', 'night',
    'reveal', jsonb_build_object('kind', 'vote', 'night', (p_state->>'night')::integer,
                                 'votes', p_state->'votes', 'counts', v_counts, 'tied', v_tied,
                                 'outcome', v_outcome, 'eliminated', v_elim,
                                 'revote', coalesce((p_state->>'revote')::boolean, false),
                                 'deaths', '[]'::jsonb));
  if v_elim is not null then
    v_r := public._lg_kill(p_state, p_server, v_elim, 'vote');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(
    secs => 10 + 4 * jsonb_array_length(p_state->'reveal'->'deaths'))));
  return public._lg_pair(p_state, p_server);
end $$;

-- Tir du chasseur (p_target null = pas de tir).
create or replace function public._lg_hunter_done(p_state jsonb, p_server jsonb, p_target text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_r jsonb;
begin
  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'reveal', jsonb_build_object('kind', 'hunter', 'night', (p_state->>'night')::integer,
                                 'hunter', p_state->'hunter', 'target', p_target, 'deaths', '[]'::jsonb),
    'hunter', null);
  if p_target is not null then
    v_r := public._lg_kill(p_state, p_server, p_target, 'chasseur');
    p_state := v_r->'state'; p_server := v_r->'server';
  end if;
  p_state := p_state || jsonb_build_object('deadline', public._lg_iso(now() + make_interval(
    secs => 8 + 4 * jsonb_array_length(p_state->'reveal'->'deaths'))));
  return public._lg_pair(p_state, p_server);
end $$;

-- Après une révélation : chasseur en attente, sinon victoire, sinon jour / nuit.
create or replace function public._lg_after_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_w text;
begin
  if jsonb_typeof(p_state->'reveal') = 'object' then
    p_state := p_state || jsonb_build_object('history',
      coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(p_state->'reveal'));
  end if;
  if p_state->>'hunter_pending' is not null then
    p_state := p_state || jsonb_build_object(
      'phase', 'hunter', 'hunter', p_state->'hunter_pending', 'hunter_pending', null,
      'deadline', public._lg_iso(now() + interval '40 seconds'));
    return public._lg_pair(p_state, p_server);
  end if;
  v_w := public._lg_winner(p_state, p_server);
  if v_w is not null then
    return public._lg_finish(p_state, p_server, v_w);
  end if;
  if p_state->>'after' = 'day' then
    p_state := p_state || jsonb_build_object(
      'phase', 'day', 'reveal', null, 'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false,
      'first_vote', null,
      'deadline', public._lg_iso(now() + make_interval(secs => coalesce((p_state->>'debate_seconds')::integer, 180))));
    return public._lg_pair(p_state, p_server);
  end if;
  return public._lg_begin_night(p_state, p_server);
end $$;

-- Secrets de tous les joueurs (+ meneur non joueur), recalculés à chaque action.
create or replace function public._lg_secrets(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_out    jsonb := '{}'::jsonb;
  p        text;
  r        text;
  s        jsonb;
  v_step   text := case when p_state->>'phase' = 'night' then p_state->>'step' end;
  v_actors text[] := case when p_state->>'phase' = 'night'
                          then public._lg_actors(p_state, p_server, p_state->>'step') else '{}'::text[] end;
  v_known  boolean := coalesce((p_server->>'lovers_known')::boolean, false);
  v_lovers jsonb := coalesce(p_server->'lovers', '[]'::jsonb);
  v_wolves jsonb;
  v_other  text;
begin
  select coalesce(jsonb_agg(a order by o), '[]'::jsonb) into v_wolves
    from jsonb_array_elements_text(p_state->'players') with ordinality as t(a, o)
   where p_server->'roles'->>a = 'loup';
  for p in select jsonb_array_elements_text(p_state->'players') loop
    r := p_server->'roles'->>p;
    s := jsonb_build_object('role', r, 'night', coalesce((p_state->>'night')::integer, 0),
                            'step', v_step, 'acting', p = any(v_actors),
                            'done', p = any(v_actors) and coalesce((p_server->>'done')::boolean, false));
    if r = 'loup' then
      s := s || jsonb_build_object('wolves', v_wolves,
        'wolf_votes', case when v_step = 'loups' then coalesce(p_server->'wolf_votes', '{}'::jsonb) else '{}'::jsonb end);
    elsif r = 'voyante' then
      s := s || jsonb_build_object('seer', coalesce(p_server->'seer', '[]'::jsonb));
    elsif r = 'sorciere' then
      s := s || jsonb_build_object('potions', p_server->'potions',
        'victim', case when v_step = 'sorciere' then p_server->'victim' else 'null'::jsonb end);
    elsif r = 'protecteur' then
      s := s || jsonb_build_object('last_protected', coalesce(p_server->'last_protected', 'null'::jsonb));
    end if;
    if v_known and v_lovers ? p then
      select x into v_other from jsonb_array_elements_text(v_lovers) x where x <> p limit 1;
      s := s || jsonb_build_object('lover', jsonb_build_object(
        'id', v_other, 'role', p_server->'roles'->>v_other,
        'mixed', public._lg_camp(p_server, p) = 'amoureux'));
    end if;
    v_out := v_out || jsonb_build_object(p, s);
  end loop;
  if p_state->>'narrator' is not null then
    v_out := v_out || jsonb_build_object(p_state->>'narrator', jsonb_build_object(
      'narrator', true, 'roles', p_server->'roles', 'step', v_step,
      'lovers', case when v_known then v_lovers else '[]'::jsonb end));
  end if;
  return v_out;
end $$;

create or replace function public._lg_out(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
begin
  if p_state->>'phase' = 'finished' then
    return jsonb_build_object('state', p_state, 'server', p_server,
                              'secrets', public._lg_secrets(p_state, p_server), 'results', p_state->'results');
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', public._lg_secrets(p_state, p_server));
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage
-- Options : {"composition": {"loup":2,"voyante":1,"sorciere":1,"chasseur":1,
--            "cupidon":1,"protecteur":1}, "debate_seconds": 180, "host_plays": true}
-- Composition absente -> suggestion automatique. host_plays=false : l'hôte (appelant
-- de start_match) est retiré des joueurs et devient meneur (secret : tous les rôles).
-- -----------------------------------------------------------------------------
create or replace function public.game_loup_garou_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_opts    jsonb := coalesce(p_options, '{}'::jsonb);
  v_host    text := public.current_profile_id()::text;
  v_players text[] := array(select x::text from unnest(p_players) x);
  v_narr    text;
  v_n       integer;
  v_comp    jsonb;
  v_l       integer;
  v_sum     integer;
  v_k       text;
  v_v       integer;
  v_deck    text[] := '{}';
  v_roles   jsonb := '{}'::jsonb;
  v_debate  integer := coalesce((v_opts->>'debate_seconds')::integer, 180);
  v_state   jsonb;
  v_server  jsonb;
  i         integer;
begin
  if v_host is not null and coalesce((v_opts->>'host_plays')::boolean, true) = false then
    v_players := array_remove(v_players, v_host);
  end if;
  if v_host is not null and not (v_host = any(v_players)) then v_narr := v_host; end if;
  v_n := cardinality(v_players);
  if v_n < 5 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;

  v_comp := case when jsonb_typeof(v_opts->'composition') = 'object' then v_opts->'composition'
                 else public._lg_suggest(v_n) end;
  begin
    v_l := coalesce((v_comp->>'loup')::integer, 0);
    v_sum := v_l;
    foreach v_k in array array['voyante', 'sorciere', 'chasseur', 'cupidon', 'protecteur'] loop
      v_v := coalesce((v_comp->>v_k)::integer, 0);
      if v_v not in (0, 1) then raise exception 'invalid_composition'; end if;
      v_sum := v_sum + v_v;
      if v_v = 1 then v_deck := array_append(v_deck, v_k); end if;
    end loop;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_composition';
  end;
  if v_l < 1 or v_l * 2 >= v_n or v_sum > v_n then raise exception 'invalid_composition'; end if;
  for i in 1 .. v_l loop v_deck := array_append(v_deck, 'loup'); end loop;
  for i in 1 .. v_n - v_sum loop v_deck := array_append(v_deck, 'villageois'); end loop;

  select jsonb_object_agg(p, r) into v_roles
    from (select p, row_number() over () as k from unnest(v_players) as p) a
    join (select r, row_number() over () as k from (select r from unnest(v_deck) as r order by random()) z) b
      using (k);

  if v_debate < 30 or v_debate > 900 then v_debate := 180; end if;

  v_state := jsonb_build_object(
    'game', 'loup-garou', 'phase', 'roles',
    'players', to_jsonb(v_players), 'alive', to_jsonb(v_players), 'narrator', v_narr,
    'composition', jsonb_build_object(
      'loup', v_l, 'villageois', v_n - v_sum,
      'voyante', coalesce((v_comp->>'voyante')::integer, 0),
      'sorciere', coalesce((v_comp->>'sorciere')::integer, 0),
      'chasseur', coalesce((v_comp->>'chasseur')::integer, 0),
      'cupidon', coalesce((v_comp->>'cupidon')::integer, 0),
      'protecteur', coalesce((v_comp->>'protecteur')::integer, 0)),
    'debate_seconds', v_debate,
    'night', 0, 'step', null, 'step_started', null, 'step_max', null,
    'deadline', public._lg_iso(now() + interval '120 seconds'),
    'votes', '{}'::jsonb, 'candidates', '[]'::jsonb, 'revote', false, 'first_vote', null,
    'reveal', null, 'after', null, 'hunter', null, 'hunter_pending', null,
    'dead', '[]'::jsonb, 'history', '[]'::jsonb,
    'winner', null, 'roles', null, 'lovers', null, 'chronicle', null, 'results', null);
  v_server := jsonb_build_object(
    'roles', v_roles, 'lovers', '[]'::jsonb, 'lovers_known', false,
    'potions', jsonb_build_object('life', true, 'death', true),
    'seer', '[]'::jsonb, 'wolf_votes', '{}'::jsonb, 'done', false,
    'victim', null, 'protected', null, 'last_protected', null, 'saved', false, 'poison', null,
    'cur', null, 'nights', '[]'::jsonb);
  return jsonb_build_object('state', v_state, 'server', v_server,
                            'secrets', public._lg_secrets(v_state, v_server));
end $$;

-- -----------------------------------------------------------------------------
-- Actions
--   {"type":"tick"}                       tous : échéance dépassée -> suite (sinon inchangé)
--   {"type":"next"}                       hôte : roles -> nuit 1 ; reveal -> suite
--   {"type":"night_action", ...}          acteur de l'étape de nuit :
--       cupidon    {"targets":[a,b]}
--       voyante    {"target":x}
--       protecteur {"target":x}             (pas le même que la nuit précédente)
--       loups      {"target":x|null}        (vote modifiable, visible des autres loups)
--       sorciere   {"save":bool,"target":x|null}  (ou "potion":"life"|"death"|"none")
--   {"type":"end_debate"}                 hôte : jour -> vote
--   {"type":"day_vote","target":x}        vivant : vote public, modifiable
--   {"type":"close_vote"}                 hôte : dépouille maintenant
--   {"type":"hunter_shot","target":x|null}  chasseur mort
-- -----------------------------------------------------------------------------
create or replace function public.game_loup_garou_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_type   text := p_action->>'type';
  v_me     text := p_actor::text;
  v_phase  text := p_state->>'phase';
  v_step   text := p_state->>'step';
  v_target text := nullif(p_action->>'target', '');
  v_alive  boolean := coalesce((p_state->'alive') ? v_me, false);
  v_player boolean := coalesce((p_state->'players') ? v_me, false);
  v_r      jsonb;
  v_a      text;
  v_b      text;
  v_save   boolean;
  v_wolves text[];
  v_n      integer;
  v_pot    text;
begin
  if v_phase not in ('roles', 'night', 'reveal', 'hunter', 'day', 'vote') then
    raise exception 'wrong_phase';
  end if;

  -- ------------------------------------------------------------------ tick
  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    v_r := case v_phase
      when 'roles'  then public._lg_begin_night(p_state, p_server)
      when 'night'  then public._lg_end_step(p_state, p_server)
      when 'reveal' then public._lg_after_reveal(p_state, p_server)
      when 'hunter' then public._lg_hunter_done(p_state, p_server, null)
      when 'day'    then public._lg_begin_vote(p_state, p_server, p_state->'alive', false)
      when 'vote'   then public._lg_tally(p_state, p_server)
    end;
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  -- ------------------------------------------------------------------ hôte
  if v_type in ('next', 'end_debate', 'close_vote') then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_type = 'next' and v_phase = 'roles' then
      v_r := public._lg_begin_night(p_state, p_server);
    elsif v_type = 'next' and v_phase = 'reveal' then
      v_r := public._lg_after_reveal(p_state, p_server);
    elsif v_type = 'end_debate' and v_phase = 'day' then
      v_r := public._lg_begin_vote(p_state, p_server, p_state->'alive', false);
    elsif v_type = 'close_vote' and v_phase = 'vote' then
      v_r := public._lg_tally(p_state, p_server);
    else
      raise exception 'wrong_phase';
    end if;
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  if v_type not in ('night_action', 'day_vote', 'hunter_shot') then raise exception 'unknown_action'; end if;
  if not v_player then raise exception 'not_a_player'; end if;

  -- ------------------------------------------------------------------ chasseur
  if v_type = 'hunter_shot' then
    if v_phase <> 'hunter' then raise exception 'wrong_phase'; end if;
    if p_state->>'hunter' is distinct from v_me then raise exception 'not_your_turn'; end if;
    if v_target is not null and (v_target = v_me or not ((p_state->'alive') ? v_target)) then
      raise exception 'invalid_target';
    end if;
    v_r := public._lg_hunter_done(p_state, p_server, v_target);
    return public._lg_out(v_r->'state', v_r->'server');
  end if;

  if not v_alive then raise exception 'not_alive'; end if;

  -- ------------------------------------------------------------------ vote du jour
  if v_type = 'day_vote' then
    if v_phase <> 'vote' then raise exception 'wrong_phase'; end if;
    if v_target is null or not ((p_state->'candidates') ? v_target) or not ((p_state->'alive') ? v_target) then
      raise exception 'invalid_target';
    end if;
    if v_target = v_me then raise exception 'cannot_vote_self'; end if;
    p_state := jsonb_set(p_state, array['votes', v_me], to_jsonb(v_target), true);
    select count(*) into v_n from jsonb_object_keys(p_state->'votes') k where (p_state->'alive') ? k;
    if v_n >= jsonb_array_length(p_state->'alive') then
      v_r := public._lg_tally(p_state, p_server);
      return public._lg_out(v_r->'state', v_r->'server');
    end if;
    return public._lg_out(p_state, p_server);
  end if;

  -- ------------------------------------------------------------------ actions de nuit
  if v_phase <> 'night' then raise exception 'wrong_phase'; end if;
  if not (v_me = any(public._lg_actors(p_state, p_server, v_step))) then raise exception 'not_your_turn'; end if;
  if v_step <> 'loups' and coalesce((p_server->>'done')::boolean, false) then raise exception 'already_acted'; end if;

  if v_step = 'cupidon' then
    v_a := p_action->'targets'->>0;
    v_b := p_action->'targets'->>1;
    if jsonb_typeof(p_action->'targets') <> 'array' or jsonb_array_length(p_action->'targets') <> 2
       or v_a is null or v_b is null or v_a = v_b
       or not ((p_state->'alive') ? v_a) or not ((p_state->'alive') ? v_b) then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('lovers', jsonb_build_array(v_a, v_b));
    p_server := public._lg_cur(p_server, 'lovers', jsonb_build_array(v_a, v_b));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'voyante' then
    if v_target is null or v_target = v_me or not ((p_state->'alive') ? v_target) then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('seer', coalesce(p_server->'seer', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('night', (p_state->>'night')::integer, 'target', v_target,
                         'role', p_server->'roles'->>v_target)));
    p_server := public._lg_cur(p_server, 'seer', to_jsonb(v_target));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'protecteur' then
    if v_target is null or not ((p_state->'alive') ? v_target)
       or v_target is not distinct from p_server->>'last_protected' then
      raise exception 'invalid_target';
    end if;
    p_server := p_server || jsonb_build_object('protected', v_target);
    p_server := public._lg_cur(p_server, 'protect', to_jsonb(v_target));
    v_r := public._lg_mark_done(p_state, p_server);

  elsif v_step = 'loups' then
    if v_target is not null and (not ((p_state->'alive') ? v_target) or p_server->'roles'->>v_target = 'loup') then
      raise exception 'invalid_target';
    end if;
    if v_target is null then
      p_server := p_server || jsonb_build_object('wolf_votes', coalesce(p_server->'wolf_votes', '{}'::jsonb) - v_me);
    else
      p_server := p_server || jsonb_build_object('wolf_votes',
        coalesce(p_server->'wolf_votes', '{}'::jsonb) || jsonb_build_object(v_me, v_target));
    end if;
    v_wolves := public._lg_alive_role(p_state, p_server, 'loup');
    if (select count(*) from unnest(v_wolves) w where p_server->'wolf_votes' ? w) = cardinality(v_wolves)
       and (select count(distinct p_server->'wolf_votes'->>w) from unnest(v_wolves) w) = 1 then
      -- Unanimité : l'étape se termine (après le minimum).
      v_r := public._lg_mark_done(p_state, p_server);
    elsif coalesce((p_server->>'done')::boolean, false) then
      -- Un loup change d'avis : l'unanimité est rompue, retour à l'échéance max.
      p_server := p_server || jsonb_build_object('done', false);
      p_state := p_state || jsonb_build_object('deadline', public._lg_iso(greatest(
        (p_state->>'step_started')::timestamptz + make_interval(secs => public._lg_step_max('loups')),
        now() + interval '5 seconds')));
      v_r := public._lg_pair(p_state, p_server);
    else
      v_r := public._lg_pair(p_state, p_server);
    end if;

  elsif v_step = 'sorciere' then
    v_pot := p_action->>'potion';
    v_save := coalesce((p_action->>'save')::boolean, false) or v_pot in ('life', 'both');
    if v_pot = 'none' or v_pot = 'life' then v_target := null; end if;
    if v_save then
      if not coalesce((p_server->'potions'->>'life')::boolean, false) then raise exception 'no_potion'; end if;
      if p_server->>'victim' is null then raise exception 'invalid_target'; end if;
    end if;
    if v_target is not null then
      if not coalesce((p_server->'potions'->>'death')::boolean, false) then raise exception 'no_potion'; end if;
      if v_target = v_me or not ((p_state->'alive') ? v_target) then raise exception 'invalid_target'; end if;
    end if;
    if v_save then
      p_server := p_server || jsonb_build_object('saved', true,
        'potions', p_server->'potions' || '{"life":false}'::jsonb);
      p_server := public._lg_cur(p_server, 'saved', to_jsonb(p_server->>'victim'));
    end if;
    if v_target is not null then
      p_server := p_server || jsonb_build_object('poison', v_target,
        'potions', p_server->'potions' || '{"death":false}'::jsonb);
      p_server := public._lg_cur(p_server, 'poison', to_jsonb(v_target));
    end if;
    v_r := public._lg_mark_done(p_state, p_server);

  else
    raise exception 'wrong_phase';
  end if;

  return public._lg_out(v_r->'state', v_r->'server');
end $$;

revoke all on function public._lg_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._lg_suggest(integer) from public, anon, authenticated;
revoke all on function public._lg_step_min(text) from public, anon, authenticated;
revoke all on function public._lg_step_max(text) from public, anon, authenticated;
revoke all on function public._lg_alive_role(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_steps(jsonb) from public, anon, authenticated;
revoke all on function public._lg_actors(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_pair(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_begin_step(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_mark_done(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_cur(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public._lg_kill(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._lg_camp(jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_winner(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_finish(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_tstats(jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public._lg_begin_night(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_resolve_night(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_end_step(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_begin_vote(jsonb, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._lg_tally(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_hunter_done(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._lg_after_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_secrets(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._lg_out(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_loup_garou_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_loup_garou_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\menteur.sql =====
-- =============================================================================
-- JEU « Menteur » (id menteur) — dés de bluff (famille des « dés menteurs »)
-- Idempotent (create or replace). Dispatché par start_match / game_action.
--
-- Chaque joueur a 5 dés cachés (match_secrets). À chaque manche tout le monde
-- relance (tirage serveur random()). À tour de rôle : monter l'enchère
-- « N dés de valeur V » sur l'ensemble des dés de la table, ou crier « Menteur ! »
-- (ou « Pile ! » si la variante est active). Le perdant de la vérification perd
-- un dé ; à 0 dé on est éliminé ; le dernier joueur avec des dés gagne.
--
-- RÈGLES DES 1 (« Paco ») — les 1 sont JOKERS : ils comptent pour toutes les
-- valeurs, sauf quand l'enchère porte justement sur les 1.
--   * enchère normale -> normale : quantité supérieure, ou même quantité et
--     valeur supérieure ;
--   * normale (q, v) -> Paco : quantité >= ceil(q / 2) ;
--   * Paco (q) -> Paco : quantité > q ;
--   * Paco (q) -> normale : quantité >= 2q + 1 ;
--   * l'enchère d'OUVERTURE d'une manche ne peut pas porter sur les 1 ;
--   * une quantité ne peut jamais dépasser le nombre total de dés en jeu.
--   (Pas de manche « palifico » : variante non retenue.)
--
-- « Menteur ! » (joueur dont c'est le tour, une enchère existe) : on compte les
-- dés de la valeur annoncée + les 1 (sauf enchère Paco). Total >= quantité ->
-- celui qui a crié perd un dé ; sinon l'enchérisseur perd un dé. Le perdant
-- commence la manche suivante (s'il est éliminé : le joueur vivant suivant).
-- « Pile ! » (option, défaut off ; joueur dont c'est le tour) : total exactement
-- égal -> le crieur regagne un dé (plafonné à 5, sinon rien) ; sinon il en perd
-- un. Le crieur commence la manche suivante (ou le vivant suivant s'il est sorti).
--
-- MINUTEUR (deadline + {"type":"tick"}) :
--   * phase bidding : à l'échéance, enchère minimale automatique pour le joueur
--     dont c'est le tour = même valeur, quantité + 1 ; en ouverture : 1 dé de la
--     valeur (hors 1) la plus fréquente dans SES dés (égalité -> la plus haute).
--     Si cette enchère dépasse le nombre de dés en jeu -> « Menteur ! » automatique.
--   * phase reveal : à l'échéance, manche suivante (ou fin de partie si c'était
--     la dernière vérification). L'hôte peut accélérer avec {"type":"next"}.
--
-- server : {"dice": {"<uid>": [1..6, ...]}}  (dés de la manche en cours)
-- secret d'un joueur : {"round": n, "dice": [..]}  ([] une fois éliminé)
-- Contrat complet (state public, actions) : src/games/menteur/types.ts.
-- =============================================================================

create or replace function public._mtr_iso(p_ts timestamptz)
returns text language sql stable
set search_path = public, extensions
as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- p_n dés tirés au sort.
create or replace function public._mtr_roll(p_n integer)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(1 + floor(random() * 6)::integer), '[]'::jsonb)
    from generate_series(1, greatest(p_n, 0));
$$;

-- Joueur vivant suivant p_from dans l'ordre de la table (p_from peut être éliminé).
create or replace function public._mtr_next(p_state jsonb, p_from text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_order text[] := array(select jsonb_array_elements_text(p_state->'order'));
  v_n     integer := cardinality(v_order);
  v_cur   integer := coalesce(array_position(v_order, p_from), 1);
  i       integer;
begin
  for i in 1 .. v_n loop
    v_cur := v_cur % v_n + 1;
    if (p_state->'alive') ? v_order[v_cur] then return v_order[v_cur]; end if;
  end loop;
  return null;
end $$;

-- L'enchère (p_q, p_f) est-elle valide après p_bid (null = ouverture) ?
create or replace function public._mtr_valid(p_q integer, p_f integer, p_bid jsonb, p_total integer)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  cq integer;
  cf integer;
begin
  if p_q is null or p_f is null or p_f < 1 or p_f > 6 or p_q < 1 or p_q > p_total then return false; end if;
  if p_bid is null or jsonb_typeof(p_bid) <> 'object' then
    return p_f <> 1;  -- ouverture : pas sur les Paco
  end if;
  cq := (p_bid->>'qty')::integer;
  cf := (p_bid->>'face')::integer;
  if cf = 1 then
    if p_f = 1 then return p_q > cq; end if;
    return p_q >= 2 * cq + 1;
  end if;
  if p_f = 1 then return p_q >= ceil(cq / 2.0)::integer; end if;
  return p_q > cq or (p_q = cq and p_f > cf);
end $$;

-- Nouvelle manche : tout le monde relance. Renvoie {state, server, secrets}.
create or replace function public._mtr_new_round(p_state jsonb, p_server jsonb, p_starter text, p_grace integer)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_round   integer := coalesce((p_state->>'round')::integer, 0) + 1;
  v_dice    jsonb := '{}'::jsonb;
  v_secrets jsonb := '{}'::jsonb;
  v_total   integer := 0;
  v_d       jsonb;
  p         text;
begin
  for p in select jsonb_array_elements_text(p_state->'players') loop
    if (p_state->'alive') ? p then
      v_d := public._mtr_roll((p_state->'dice_count'->>p)::integer);
      v_dice := v_dice || jsonb_build_object(p, v_d);
      v_total := v_total + jsonb_array_length(v_d);
    else
      v_d := '[]'::jsonb;
    end if;
    v_secrets := v_secrets || jsonb_build_object(p, jsonb_build_object('round', v_round, 'dice', v_d));
  end loop;
  p_server := p_server || jsonb_build_object('dice', v_dice);
  p_state := p_state || jsonb_build_object(
    'phase', 'bidding',
    'round', v_round,
    'starter', p_starter,
    'turn', p_starter,
    'turn_seq', coalesce((p_state->>'turn_seq')::integer, 0) + 1,
    'bid', null,
    'bids', '[]'::jsonb,
    'total_dice', v_total,
    'reveal', null,
    'deadline', public._mtr_iso(now() + make_interval(secs => case
      when coalesce((p_state->'absent'->>p_starter)::boolean, false) then 8   -- absent auto : tour express
      else (p_state->>'turn_seconds')::integer + p_grace end)));
  return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : rejoue history[] (qui perd / gagne un dé).
create or replace function public._mtr_tstats(p_state jsonb, p_pl text, p_winner text)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_dice    jsonb := (select jsonb_object_agg(x, 5) from jsonb_array_elements_text(p_state->'players') x);
  v_alive   integer := v_n;
  v_comeback boolean := false;
  v_lost    boolean := false;
  v_false_liar integer := 0; v_caught integer := 0; v_good_liar integer := 0;
  v_exact integer := 0; v_big integer := 0; v_pile integer := 0; v_pure integer := 0;
  h         jsonb;
begin
  for h in select value from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) loop
    if h->>'kind' = 'liar' then
      if h->>'caller' = p_pl and h->>'loser' = p_pl then v_false_liar := v_false_liar + 1; end if;
      if h->'bid'->>'by' = p_pl and h->>'loser' = p_pl then v_caught := v_caught + 1; end if;
      if h->>'caller' = p_pl and h->>'loser' is not null and h->>'loser' <> p_pl then v_good_liar := v_good_liar + 1; end if;
      if h->'bid'->>'by' = p_pl and (h->>'count')::integer = (h->'bid'->>'qty')::integer then v_exact := v_exact + 1; end if;
      if h->'bid'->>'by' = p_pl and coalesce((h->>'pure')::boolean, false) then v_pure := v_pure + 1; end if;
      if h->'bid'->>'by' = p_pl and (h->'bid'->>'qty')::integer >= 8
         and (h->>'count')::integer >= (h->'bid'->>'qty')::integer then v_big := v_big + 1; end if;
    elsif h->>'kind' = 'pile' and h->>'caller' = p_pl and h->>'loser' is null then
      v_pile := v_pile + 1;
    end if;
    if h->>'loser' is not null then
      v_dice := jsonb_set(v_dice, array[h->>'loser'], to_jsonb((v_dice->>(h->>'loser'))::integer - 1));
      if h->>'loser' = p_pl then v_lost := true; end if;
      if h->>'eliminated' is not null then v_alive := v_alive - 1; end if;
      -- tombé à un seul dé alors qu'il restait 3 joueurs ou plus
      if h->>'loser' = p_pl and (v_dice->>p_pl)::integer = 1 and v_alive >= 3 then v_comeback := true; end if;
    end if;
    if h->>'gainer' is not null then
      v_dice := jsonb_set(v_dice, array[h->>'gainer'], to_jsonb((v_dice->>(h->>'gainer'))::integer + 1));
    end if;
  end loop;
  return jsonb_build_object(
    'first_out', case when p_state->'eliminated'->>0 = p_pl then 1 else 0 end,
    'false_liar', v_false_liar, 'caught', v_caught, 'good_liar', v_good_liar,
    'last_die_win', case when p_winner = p_pl and (p_state->'dice_count'->>p_pl)::integer = 1 then 1 else 0 end,
    'pile_ok', v_pile, 'exact_bids', v_exact, 'pure_bluffs', v_pure, 'big_bid', v_big,
    'comeback', case when p_winner = p_pl and v_comeback then 1 else 0 end,
    'captain', case when p_winner = p_pl and not v_lost and v_n >= 3 then 1 else 0 end);
end $$;

-- Fin de partie : vainqueur = dernier vivant, puis ordre d'élimination inverse.
create or replace function public._mtr_finish(p_state jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_ranked  text[] := array(select jsonb_array_elements_text(p_state->'alive'))
                      || array(select e from jsonb_array_elements_text(p_state->'eliminated') with ordinality as t(e, o)
                                order by o desc);
  v_results jsonb := '[]'::jsonb;
  i         integer;
begin
  for i in 1 .. cardinality(v_ranked) loop
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'profile_id', v_ranked[i],
      'placement', i,
      'points', v_n - i,
      'won', i = 1,
      'stats', public._mtr_tstats(p_state, v_ranked[i], v_ranked[1])));
  end loop;
  return p_state || jsonb_build_object(
    'phase', 'finished',
    'deadline', null,
    'turn', null,
    'winner', v_ranked[1],
    'results', v_results);
end $$;

-- Vérification (« Menteur ! » ou « Pile ! ») -> phase reveal.
create or replace function public._mtr_resolve(p_state jsonb, p_server jsonb, p_caller text, p_kind text, p_auto boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_bid     jsonb := p_state->'bid';
  v_q       integer := (v_bid->>'qty')::integer;
  v_f       integer := (v_bid->>'face')::integer;
  v_by      text := v_bid->>'by';
  v_count   integer;
  v_loser   text := null;
  v_gainer  text := null;
  v_elim    text := null;
  v_next    text;
  v_n       integer;
  v_secs    numeric;
  v_entry   jsonb;
  v_pure    boolean;
begin
  select count(*)::integer into v_count
    from jsonb_each(coalesce(p_server->'dice', '{}'::jsonb)) as t(k, v),
         jsonb_array_elements_text(v) as d(x)
   where x::integer = v_f or (v_f <> 1 and x::integer = 1);

  if p_kind = 'liar' then
    v_loser := case when v_count >= v_q then p_caller else v_by end;
  elsif v_count = v_q then
    if (p_state->'dice_count'->>p_caller)::integer < 5 then v_gainer := p_caller; end if;
  else
    v_loser := p_caller;
  end if;

  -- Coup de bluff : enchère contestée (« Menteur ! »), vraie, alors que l'enchérisseur n'avait aucun dé de
  -- cette valeur ni joker. Calculé ici et stocké dans l'historique (les dés sont révélés de toute façon).
  v_pure := p_kind = 'liar' and v_count >= v_q
            and not exists (select 1 from jsonb_array_elements_text(coalesce(p_server->'dice'->v_by, '[]'::jsonb)) d(x)
                             where x::integer = v_f or (v_f <> 1 and x::integer = 1));

  if v_loser is not null then
    v_n := (p_state->'dice_count'->>v_loser)::integer - 1;
    p_state := jsonb_set(p_state, array['dice_count', v_loser], to_jsonb(v_n));
    if v_n <= 0 then
      v_elim := v_loser;
      p_state := p_state || jsonb_build_object('alive', (p_state->'alive') - v_loser,
                                               'eliminated', (p_state->'eliminated') || to_jsonb(v_loser));
    end if;
  end if;
  if v_gainer is not null then
    p_state := jsonb_set(p_state, array['dice_count', v_gainer],
                         to_jsonb((p_state->'dice_count'->>v_gainer)::integer + 1));
  end if;

  -- Qui commence la manche suivante : le perdant (Menteur) / le crieur (Pile).
  v_next := case when p_kind = 'liar' then v_loser else p_caller end;
  if not ((p_state->'alive') ? v_next) then v_next := public._mtr_next(p_state, v_next); end if;

  -- Durée de la révélation (le front illumine les dés comptés un par un, 0,4 s chacun).
  v_secs := least(20, 7 + 0.4 * v_count);
  v_entry := jsonb_build_object(
    'round', p_state->'round',
    'kind', p_kind,
    'caller', p_caller,
    'auto', p_auto,
    'bid', v_bid,
    'dice', coalesce(p_server->'dice', '{}'::jsonb),
    'count', v_count,
    'exact', v_count = v_q,
    'loser', v_loser,
    'gainer', v_gainer,
    'eliminated', v_elim,
    'next_starter', v_next,
    'final', jsonb_array_length(p_state->'alive') <= 1);

  return p_state || jsonb_build_object(
    'phase', 'reveal',
    'turn', null,
    'reveal', v_entry,
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object('round', p_state->'round', 'kind', p_kind, 'caller', p_caller, 'bid', v_bid,
                         'count', v_count, 'loser', v_loser, 'gainer', v_gainer, 'eliminated', v_elim,
                         'pure', v_pure)),
    'deadline', public._mtr_iso(now() + make_interval(secs => v_secs::double precision)));
end $$;

-- -----------------------------------------------------------------------------
-- Démarrage. Options : {"turn_seconds": 30|45|60 (défaut 45), "pile": bool (défaut false)}
-- -----------------------------------------------------------------------------
create or replace function public.game_menteur_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n      integer := cardinality(p_players);
  v_secs   integer := case when coalesce(p_options->>'turn_seconds', '') in ('30', '45', '60')
                           then (p_options->>'turn_seconds')::integer else 45 end;
  v_pile   boolean := coalesce(p_options->>'pile', 'false') = 'true';
  v_order  text[];
  v_counts jsonb := '{}'::jsonb;
  v_state  jsonb;
  v_r      jsonb;
  p        text;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 9 then raise exception 'too_many_players'; end if;
  v_order := array(select x::text from unnest(p_players) as t(x) order by random());
  foreach p in array v_order loop
    v_counts := v_counts || jsonb_build_object(p, 5);
  end loop;

  v_state := jsonb_build_object(
    'game', 'menteur',
    'phase', 'bidding',
    'players', to_jsonb(p_players),
    'order', to_jsonb(v_order),
    'alive', to_jsonb(v_order),
    'eliminated', '[]'::jsonb,
    'dice_count', v_counts,
    'total_dice', 5 * v_n,
    'round', 0,
    'starter', null,
    'turn', null,
    'turn_seq', 0,
    'turn_seconds', v_secs,
    'pile_enabled', v_pile,
    'bid', null,
    'bids', '[]'::jsonb,
    'reveal', null,
    'history', '[]'::jsonb,
    'deadline', null,
    'winner', null,
    'results', null);
  -- 10 s de grâce au premier tour (le temps que tout le monde arrive et secoue).
  v_r := public._mtr_new_round(v_state, '{}'::jsonb, v_order[1], 10);
  return v_r;
end $$;

-- -----------------------------------------------------------------------------
-- Actions :
--   {"type":"bid","qty":n,"face":1..6}   {"type":"liar"}   {"type":"pile"}
--   {"type":"next"} (hôte, phase reveal)   {"type":"tick"}
-- -----------------------------------------------------------------------------
create or replace function public.game_menteur_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_me      text := p_actor::text;
  v_turn    text := p_state->>'turn';
  v_phase   text := p_state->>'phase';
  v_total   integer := coalesce((p_state->>'total_dice')::integer, 0);
  v_bid     jsonb := p_state->'bid';
  v_q       integer;
  v_f       integer;
  v_auto    boolean := false;
  v_kind    text;
  v_r       jsonb;
  v_secrets jsonb := null;
  v_bids    jsonb;
begin
  if v_phase not in ('bidding', 'reveal') then
    if v_type = 'tick' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    raise exception 'wrong_phase';
  end if;
  if jsonb_typeof(v_bid) <> 'object' then v_bid := null; end if;

  -- ---------------------------------------------------------------- tick
  if v_type = 'tick' then
    if p_state->>'deadline' is null or now() < (p_state->>'deadline')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);  -- trop tôt / déjà traité
    end if;
    if v_phase = 'reveal' then
      v_type := 'advance';
    else
      v_auto := true;
      v_me := v_turn;
      if v_bid is null then
        -- Ouverture : 1 dé de la valeur (hors 1) la plus fréquente dans mes dés.
        select x::integer into v_f
          from jsonb_array_elements_text(coalesce(p_server->'dice'->v_turn, '[]'::jsonb)) as d(x)
         where x::integer <> 1
         group by x order by count(*) desc, x::integer desc limit 1;
        v_q := 1;
        v_f := coalesce(v_f, 6);
        v_type := 'bid';
      else
        v_q := (v_bid->>'qty')::integer + 1;
        v_f := (v_bid->>'face')::integer;
        v_type := case when v_q <= v_total then 'bid' else 'liar' end;
      end if;
    end if;
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then raise exception 'wrong_phase'; end if;
    v_type := 'advance';
  elsif v_type in ('bid', 'liar', 'pile') then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if not ((p_state->'alive') ? v_me) then raise exception 'not_alive'; end if;
    if v_phase <> 'bidding' then raise exception 'wrong_phase'; end if;
    if v_turn is distinct from v_me then raise exception 'not_your_turn'; end if;
    if v_type = 'bid' then
      if jsonb_typeof(p_action->'qty') <> 'number' or jsonb_typeof(p_action->'face') <> 'number' then
        raise exception 'invalid_bid';
      end if;
      v_q := floor((p_action->>'qty')::numeric)::integer;
      v_f := floor((p_action->>'face')::numeric)::integer;
      if v_q::numeric <> (p_action->>'qty')::numeric or v_f::numeric <> (p_action->>'face')::numeric
         or v_f < 1 or v_f > 6 or v_q < 1 or v_q > v_total then
        raise exception 'invalid_bid';
      end if;
      if v_bid is null and v_f = 1 then raise exception 'paco_opening'; end if;
    else
      if v_bid is null then raise exception 'no_bid_yet'; end if;
      if v_type = 'pile' and not coalesce((p_state->>'pile_enabled')::boolean, false) then
        raise exception 'pile_disabled';
      end if;
    end if;
  else
    raise exception 'unknown_action';
  end if;

  -- Absent auto : 2 tours consécutifs joués par tick -> tours express ; une action du joueur le fait revenir.
  if v_auto then
    p_state := p_state || jsonb_build_object('idle', coalesce(p_state->'idle', '{}'::jsonb)
      || jsonb_build_object(v_me, coalesce((p_state->'idle'->>v_me)::integer, 0) + 1));
    if (p_state->'idle'->>v_me)::integer >= 2 and not coalesce((p_state->'absent'->>v_me)::boolean, false) then
      p_state := p_state || jsonb_build_object('absent', coalesce(p_state->'absent', '{}'::jsonb)
        || jsonb_build_object(v_me, true));
    end if;
  elsif v_type in ('bid', 'liar', 'pile') then
    if p_state->'idle' ? v_me then
      p_state := p_state || jsonb_build_object('idle', (p_state->'idle') - v_me);
    end if;
    if coalesce((p_state->'absent'->>v_me)::boolean, false) then
      p_state := p_state || jsonb_build_object('absent', (p_state->'absent') - v_me,
                                               'returned', v_me, 'returned_seq', coalesce((p_state->>'turn_seq')::integer, 0));
    end if;
  end if;

  -- ---------------------------------------------------------------- application
  if v_type = 'bid' then
    if not public._mtr_valid(v_q, v_f, v_bid, v_total) then raise exception 'bid_too_low'; end if;
    v_bids := coalesce(p_state->'bids', '[]'::jsonb);
    select coalesce(jsonb_agg(e order by o), '[]'::jsonb) into v_bids
      from jsonb_array_elements(v_bids) with ordinality as t(e, o)
     where o > jsonb_array_length(v_bids) - 29;
    v_bid := jsonb_build_object('qty', v_q, 'face', v_f, 'by', v_me, 'auto', v_auto);
    p_state := p_state || jsonb_build_object(
      'bid', v_bid,
      'bids', v_bids || jsonb_build_array(v_bid),
      'turn', public._mtr_next(p_state, v_me),
      'turn_seq', coalesce((p_state->>'turn_seq')::integer, 0) + 1,
      'deadline', public._mtr_iso(now() + make_interval(secs => case
        when coalesce((p_state->'absent'->>public._mtr_next(p_state, v_me))::boolean, false) then 8
        else (p_state->>'turn_seconds')::integer end)));

  elsif v_type in ('liar', 'pile') then
    p_state := public._mtr_resolve(p_state, p_server, v_me, v_type, v_auto);

  elsif v_type = 'advance' then
    if coalesce((p_state->'reveal'->>'final')::boolean, false) then
      p_state := public._mtr_finish(p_state);
    else
      v_r := public._mtr_new_round(p_state, p_server, p_state->'reveal'->>'next_starter', 6);
      p_state := v_r->'state';
      p_server := v_r->'server';
      v_secrets := v_r->'secrets';
    end if;
  end if;

  if p_state->>'phase' = 'finished' then
    return jsonb_build_object('state', p_state, 'server', p_server, 'results', p_state->'results');
  end if;
  if v_secrets is not null then
    return jsonb_build_object('state', p_state, 'server', p_server, 'secrets', v_secrets);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

revoke all on function public._mtr_iso(timestamptz) from public, anon, authenticated;
revoke all on function public._mtr_roll(integer) from public, anon, authenticated;
revoke all on function public._mtr_next(jsonb, text) from public, anon, authenticated;
revoke all on function public._mtr_valid(integer, integer, jsonb, integer) from public, anon, authenticated;
revoke all on function public._mtr_new_round(jsonb, jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._mtr_finish(jsonb) from public, anon, authenticated;
revoke all on function public._mtr_tstats(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._mtr_resolve(jsonb, jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public.game_menteur_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_menteur_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\mini-golf.sql =====
-- =============================================================================
-- JEU « mini-golf » (Mini-golf 3D, 20 trous de kermesse + 9 trous « Défi ») — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
-- Conception : docs/superpowers/specs/2026-11-19-mini-golf-design.md.
--
-- Tout le monde joue LE MÊME TROU en même temps, chacun sa balle sur son téléphone
-- (physique 3D côté client, positions diffusées en broadcast `golf:<matchId>`, jamais
-- en base). Le serveur ne reçoit qu'UNE écriture par joueur et par trou :
--   {"type":"hole","hole":h,"strokes":n,"holed":true|false,"stats":{water,mill_hits,bank_shot}}
-- h = index (0-based) du trou dans state.holes. Rentrée : 1 ≤ n ≤ cap (6, ou par + 2) ; non rentrée
-- (cap coups joués) : score cap + 1. Temps minimum (anti-triche minimal) : (n − balles à l'eau) × 1,5 s depuis
-- hole_started_at (fin de l'annonce du trou). Doublon : ignoré sans erreur.
--
-- Parcours (option course) : « kermesse » = trous 1..9 dans l'ordre ; « random » (défaut) = 9 trous tirés au
-- sort parmi les 20 premiers ; « express » = 5 trous tirés au sort parmi les 20 ; « defi » = trous 21..29 dans
-- l'ordre (longs trous, pars 4 à 6 : jamais tirés au sort).
-- Coups max sur un trou : _mg_cap(par) = max(6, par + 2) ; balle non rentrée : _mg_picked(par) = cap + 1
-- (7 sur un par 2 à 4, 8 sur un par 5, 9 sur un par 6). Tirage côté serveur, trié par par croissant
-- (ordre aléatoire entre trous de même par) : on commence par les plus faciles, on finit sur un par 4.
--
-- Phases : playing (trou h, chrono `timer` s, 0 = sans chrono) -> hole_end (6 s, classement
-- provisoire) -> playing (trou h+1) ... ; au dernier trou : finished directement.
-- Trou terminé : tous ont fini, échéance du chrono (absents = 7), ou `next` de l'hôte.
-- =============================================================================

-- Les 29 trous : par de chaque trou (pars[id - 1]), parcours « La Kermesse du village » (1..9), « Défi » (21..29),
-- et pool = les ids 1..pool sont tirés au sort (aléatoire, express).
-- Dupliqué avec src/games/mini-golf/holes.ts (synchro vérifiée par tools/sql-tests/mini-golf.mjs).
create or replace function public._mg_course()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '{"pars":[2,2,3,3,3,3,3,3,4,3,3,3,2,3,4,3,3,3,3,3,4,4,6,4,4,4,4,4,5],"kermesse":[1,2,3,4,5,6,7,8,9],"defi":[21,22,23,24,25,26,27,28,29],"pool":20}'::jsonb $$;

-- Ancienne constante (score 7 partout), remplacée par _mg_picked(par).
drop function if exists public._mg_max_score();

-- Coups max sur un trou de par p_par (dupliqué : maxStrokes() de holes.ts).
create or replace function public._mg_cap(p_par integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select greatest(6, coalesce(p_par, 3) + 2) $$;

-- Score d'un trou non rentré (balle ramassée, chrono écoulé, fin forcée) : coups max + 1 (pickedUp() de holes.ts).
create or replace function public._mg_picked(p_par integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select public._mg_cap(p_par) + 1 $$;

-- Ouvre le trou n° p_idx (index dans state.holes) : 3 s d'annonce puis chrono.
create or replace function public._mg_open_hole(p_state jsonb, p_idx integer)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_timer integer := coalesce((p_state->>'timer')::integer, 0);
  v_start timestamptz := now() + interval '3 seconds';
begin
  return p_state || jsonb_build_object(
    'phase', 'playing',
    'hole', p_idx,
    'round', p_idx + 1,
    'hole_started_at', v_start,
    'deadline', case when v_timer > 0 then to_jsonb(v_start + make_interval(secs => v_timer)) else 'null'::jsonb end,
    'done', '[]'::jsonb);
end $$;

-- Ajoute un compteur de trophée (server.tstats[joueur][clé] += delta).
create or replace function public._mg_bump(p_server jsonb, p_pid text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(coalesce(p_server, '{}'::jsonb), array['tstats', p_pid],
    coalesce(p_server->'tstats'->p_pid, '{}'::jsonb)
      || jsonb_build_object(p_key, coalesce((p_server->'tstats'->p_pid->>p_key)::integer, 0) + p_delta), true)
$$;

-- Inscrit le score p_score du joueur p_pid au trou courant (carte, total, fini).
create or replace function public._mg_record(p_state jsonb, p_pid text, p_score integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_card jsonb := coalesce(p_state->'cards'->p_pid, '[]'::jsonb);
  v_h    integer := (p_state->>'hole')::integer;
begin
  -- La carte d'un joueur a exactement `hole` cases avant l'écriture (trous précédents tous clos).
  while jsonb_array_length(v_card) < v_h loop
    v_card := v_card || to_jsonb(public._mg_picked((p_state->'pars'->>jsonb_array_length(v_card))::integer));
  end loop;
  v_card := (select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
               from jsonb_array_elements(v_card) with ordinality t(e, i) where i <= v_h)
            || to_jsonb(p_score);
  p_state := jsonb_set(p_state, array['cards', p_pid], v_card, true);
  p_state := jsonb_set(p_state, array['totals', p_pid],
                       to_jsonb((select coalesce(sum(x::integer), 0) from jsonb_array_elements_text(v_card) x)), true);
  if not ((p_state->'done') ? p_pid) then
    p_state := jsonb_set(p_state, '{done}', (p_state->'done') || to_jsonb(p_pid));
  end if;
  return p_state;
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : calculées depuis la carte
-- (pars, birdies, aces, under_par, clean_card) + compteurs client bornés (server.tstats).
create or replace function public._mg_tstats(p_state jsonb, p_server jsonb, p_pid text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_card  jsonb := coalesce(p_state->'cards'->p_pid, '[]'::jsonb);
  v_pars  jsonb := p_state->'pars';
  v_n     integer := jsonb_array_length(p_state->'holes');
  v_ts    jsonb := coalesce(p_server->'tstats'->p_pid, '{}'::jsonb);
  i       integer;
  v_sc    integer;
  v_par   integer;
  v_inpar integer := 0;
  v_birds integer := 0;
  v_aces  integer := 0;
  v_tot   integer := 0;
  v_ptot  integer := 0;
  v_clean boolean := true;
  v_full  boolean := jsonb_array_length(v_card) = v_n;
begin
  for i in 0 .. v_n - 1 loop
    v_par := (v_pars->>i)::integer;
    v_ptot := v_ptot + v_par;
    v_sc := (v_card->>i)::integer;
    if v_sc is null then v_clean := false; continue; end if;
    v_tot := v_tot + v_sc;
    if v_sc <= v_par then v_inpar := v_inpar + 1; else v_clean := false; end if;
    if v_sc < v_par then v_birds := v_birds + 1; end if;
    if v_sc = 1 then v_aces := v_aces + 1; end if;
  end loop;
  return jsonb_build_object(
    'total', v_tot,
    'holes', v_n,
    'pars', v_inpar,
    'birdies', v_birds,
    'aces', v_aces,
    'picked_up', coalesce((v_ts->>'picked_up')::integer, 0),
    'water', coalesce((v_ts->>'water')::integer, 0),
    'mill_hits', coalesce((v_ts->>'mill_hits')::integer, 0),
    'bank_shot', least(1, coalesce((v_ts->>'bank_shot')::integer, 0)),
    'under_par', case when v_n = 9 and v_full and v_tot < v_ptot then 1 else 0 end,
    'clean_card', case when v_n = 9 and v_full and v_clean then 1 else 0 end);
end $$;

-- Fin de partie : classement (plus petit total), points = n − rang + 1, gagnant(s) = rang 1.
create or replace function public._mg_finish(p_state jsonb, p_server jsonb, p_forced boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_results jsonb;
  v_winners jsonb;
begin
  with t as (
    select x as pid, coalesce((p_state->'totals'->>x)::integer, 0) as total
      from jsonb_array_elements_text(p_state->'players') x
  ), r as (
    select t.*, rank() over (order by total) as rk from t
  )
  select jsonb_agg(jsonb_build_object(
           'profile_id', pid, 'points', v_n - rk + 1, 'won', rk = 1, 'placement', rk,
           'stats', public._mg_tstats(p_state, p_server, pid))
         order by rk, pid),
         coalesce(jsonb_agg(pid order by pid) filter (where rk = 1), '[]'::jsonb)
    into v_results, v_winners
    from r;
  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null, 'forced', p_forced,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Clôt le trou courant : absents = 7 ; dernier trou -> fin de partie, sinon classement 6 s.
create or replace function public._mg_close_hole(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  pl text;
begin
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    if not ((p_state->'done') ? pl) then
      p_state := public._mg_record(p_state, pl, public._mg_picked((p_state->'pars'->>((p_state->>'hole')::integer))::integer));
    end if;
  end loop;
  if (p_state->>'hole')::integer >= jsonb_array_length(p_state->'holes') - 1 then
    return public._mg_finish(p_state, p_server, false);
  end if;
  p_state := p_state || jsonb_build_object('phase', 'hole_end', 'deadline', now() + interval '6 seconds');
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Options : {"course": "random"|"kermesse"|"express"|"defi", "timer": 60|90|0 secondes par trou (0 = sans chrono)}.
-- Anciennes options (sans course) : {"holes": 9} = kermesse, {"holes": 5} = express ; sinon aléatoire 9 trous.
create or replace function public.game_mini_golf_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_course jsonb := public._mg_course();
  v_mode   text;
  v_count  integer;
  v_timer  integer;
  v_holes  jsonb;
  v_pars   jsonb;
  v_empty  jsonb;
  v_zero   jsonb;
  v_state  jsonb;
begin
  -- 2 joueurs minimum : en solo, la victoire serait automatique (tenue Golfeur « farmable »).
  if coalesce(cardinality(p_players), 0) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;

  v_mode := case when p_options->>'course' in ('random', 'kermesse', 'express', 'defi') then p_options->>'course'
                 when p_options->'course' is null and p_options->>'holes' = '9' then 'kermesse'
                 when p_options->'course' is null and p_options->>'holes' = '5' then 'express'
                 else 'random' end;
  v_timer := case when coalesce(p_options->>'timer', '') ~ '^\d{1,3}$' then (p_options->>'timer')::integer else 90 end;
  if v_timer not in (0, 60, 90) then v_timer := 90; end if;

  if v_mode in ('kermesse', 'defi') then
    v_holes := v_course->v_mode;
  else
    -- Tirage sans remise parmi les ids 1..pool (20), puis tri par par croissant (hasard entre pars égaux).
    v_count := case when v_mode = 'express' then 5 else 9 end;
    select jsonb_agg(d.id order by d.par, random()) into v_holes
      from (select o::integer as id, p::integer as par
              from jsonb_array_elements_text(v_course->'pars') with ordinality t(p, o)
             where o <= (v_course->>'pool')::integer
             order by random() limit v_count) d;
  end if;
  select jsonb_agg(v_course->'pars'->((h::integer) - 1) order by o) into v_pars
    from jsonb_array_elements_text(v_holes) with ordinality t(h, o);
  select jsonb_object_agg(p::text, '[]'::jsonb), jsonb_object_agg(p::text, 0) into v_empty, v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'mini-golf',
    'players', to_jsonb(p_players),
    'course', v_mode,
    'holes', v_holes,
    'pars', v_pars,
    'total_rounds', jsonb_array_length(v_holes),
    'timer', v_timer,
    'cards', v_empty,
    'totals', v_zero,
    'last_hole', null,
    'forced', false,
    'winners', null,
    'results', null);
  v_state := public._mg_open_hole(v_state, 0);

  return jsonb_build_object('state', v_state, 'server', jsonb_build_object('tstats', '{}'::jsonb), 'secrets', '{}'::jsonb);
end $$;

create or replace function public.game_mini_golf_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_hole    integer := (p_state->>'hole')::integer;
  v_n       integer := jsonb_array_length(p_state->'holes');
  v_strokes integer;
  v_cap     integer;
  v_holed   boolean;
  v_score   integer;
  v_water   integer;
  v_mill    integer;
  v_bank    integer;
  v_hits    integer;
  v_st      jsonb;
  v_late    boolean := p_state->>'deadline' is not null and now() >= (p_state->>'deadline')::timestamptz;
  pl        text;
  i         integer;
begin
  -- ---------------------------------------------------------------- hole (fin de trou d'un joueur)
  if v_type = 'hole' then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if v_phase = 'finished' then raise exception 'wrong_phase'; end if;
    if jsonb_typeof(p_action->'hole') is distinct from 'number' or (p_action->>'hole') !~ '^\d{1,2}$' then
      raise exception 'invalid_action';
    end if;
    if (p_action->>'hole')::integer <> v_hole then raise exception 'wrong_hole'; end if;
    -- Doublon (renvoi réseau, ou déjà ramassé par le chrono) : ignoré sans erreur.
    if (p_state->'done') ? v_me then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if jsonb_typeof(p_action->'holed') is distinct from 'boolean' then raise exception 'invalid_action'; end if;
    v_holed := (p_action->>'holed')::boolean;
    if jsonb_typeof(p_action->'strokes') is distinct from 'number' or (p_action->>'strokes') !~ '^\d{1,2}$' then
      raise exception 'invalid_strokes';
    end if;
    v_strokes := (p_action->>'strokes')::integer;
    v_cap := public._mg_cap((p_state->'pars'->>v_hole)::integer);
    if v_strokes < 1 or v_strokes > (case when v_holed then v_cap else v_cap + 1 end) then raise exception 'invalid_strokes'; end if;

    -- Compteurs de trophées déclarés par le client, bornés.
    v_st := case when jsonb_typeof(p_action->'stats') = 'object' then p_action->'stats' else '{}'::jsonb end;
    v_water := case when jsonb_typeof(v_st->'water') = 'number' and (v_st->>'water') ~ '^\d{1,2}$' then (v_st->>'water')::integer else 0 end;
    v_water := least(v_water, v_strokes - case when v_holed then 1 else 0 end);
    v_mill := case when jsonb_typeof(v_st->'mill_hits') = 'number' and (v_st->>'mill_hits') ~ '^\d{1,2}$' then least((v_st->>'mill_hits')::integer, v_strokes) else 0 end;
    v_bank := case when v_holed and jsonb_typeof(v_st->'bank_shot') = 'number' and (v_st->>'bank_shot')::numeric >= 1 then 1 else 0 end;

    -- Chrono dépassé (tolérance réseau 3 s) : le trou se clôt, l'envoi est ignoré (score 7).
    if v_late and now() > (p_state->>'deadline')::timestamptz + interval '3 seconds' then
      return public._mg_close_hole(p_state, p_server);
    end if;
    -- Temps minimum : chaque coup réellement joué prend au moins 1,5 s.
    v_hits := greatest(1, v_strokes - v_water);
    if now() < (p_state->>'hole_started_at')::timestamptz + make_interval(secs => v_hits * 1.5) then
      raise exception 'too_fast';
    end if;

    v_score := case when v_holed then v_strokes else v_cap + 1 end;
    p_state := public._mg_record(p_state, v_me, v_score);
    p_state := p_state || jsonb_build_object('last_hole', jsonb_build_object(
      'id', v_me, 'hole', v_hole, 'strokes', v_score, 'holed', v_holed, 'at', now()));
    if v_water > 0 then p_server := public._mg_bump(p_server, v_me, 'water', v_water); end if;
    if v_mill > 0 then p_server := public._mg_bump(p_server, v_me, 'mill_hits', v_mill); end if;
    if v_bank > 0 then p_server := public._mg_bump(p_server, v_me, 'bank_shot', 1); end if;
    if not v_holed then p_server := public._mg_bump(p_server, v_me, 'picked_up', 1); end if;

    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') then
      return public._mg_close_hole(p_state, p_server);
    end if;
    -- Il ne reste qu'un joueur : le trou se clot 45 s apres (meme en « Sans chrono »),
    -- sans rallonger un chrono deja plus court.
    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') - 1 then
      p_state := p_state || jsonb_build_object('deadline', to_jsonb(
        case when p_state->>'deadline' is not null
             then least((p_state->>'deadline')::timestamptz, now() + interval '45 seconds')
             else now() + interval '45 seconds' end));
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- tick (échéances)
  elsif v_type = 'tick' then
    if v_phase = 'playing' and v_late then
      return public._mg_close_hole(p_state, p_server);
    elsif v_phase = 'hole_end' and v_late then
      return jsonb_build_object('state', public._mg_open_hole(p_state, v_hole + 1), 'server', p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- next (hôte : couper le trou / passer le classement)
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase = 'playing' then
      return public._mg_close_hole(p_state, p_server);
    elsif v_phase = 'hole_end' then
      return jsonb_build_object('state', public._mg_open_hole(p_state, v_hole + 1), 'server', p_server);
    end if;
    raise exception 'wrong_phase';

  -- ---------------------------------------------------------------- end_game (hôte : trous restants = 7)
  elsif v_type = 'end_game' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('playing', 'hole_end') then raise exception 'wrong_phase'; end if;
    if v_phase = 'hole_end' then p_state := public._mg_open_hole(p_state, v_hole + 1); end if;
    loop
      for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
        if not ((p_state->'done') ? pl) then
          p_state := public._mg_record(p_state, pl, public._mg_picked((p_state->'pars'->>((p_state->>'hole')::integer))::integer));
        end if;
      end loop;
      i := (p_state->>'hole')::integer;
      exit when i >= v_n - 1;
      p_state := p_state || jsonb_build_object('hole', i + 1, 'round', i + 2, 'done', '[]'::jsonb);
    end loop;
    return public._mg_finish(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._mg_course() from public, anon, authenticated;
revoke all on function public._mg_cap(integer) from public, anon, authenticated;
revoke all on function public._mg_picked(integer) from public, anon, authenticated;
revoke all on function public._mg_open_hole(jsonb, integer) from public, anon, authenticated;
revoke all on function public._mg_bump(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._mg_record(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._mg_tstats(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._mg_finish(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._mg_close_hole(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_mini_golf_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_mini_golf_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\morpion.sql =====
-- =============================================================================
-- JEU « Morpion » (id morpion) — jeu en DUEL (socle supabase/features/duel.sql ;
-- modèle : games/quatre-a-la-suite.sql). 3 variantes au choix de l'hôte
-- (p_options.board.variant, défaut classic) :
--   classic  : grille 3×3, aligner 3 ; grille pleine = nul.
--   giant    : grille 10×10, aligner 5 OU PLUS ; grille pleine = nul.
--   ultimate : 9 petits morpions 3×3 dans un grand. La case jouée dans un petit
--              morpion désigne le petit morpion où l'adversaire doit jouer ; s'il
--              est gagné ou plein, l'adversaire joue n'importe où. Un petit morpion
--              gagné devient un grand X/O (plus aucun coup dedans) ; gagner =
--              aligner 3 petits morpions ; les petits nuls ne comptent pour
--              personne ; nul quand il n'y a plus aucun coup possible.
-- ❌ (x) = le joueur qui commence la manche (duel.starter, alterné par le socle) ;
-- ⭕ (o) = l'autre.
--
-- Plateau public (state.board) :
--   {"variant": "classic"|"giant"|"ultimate",
--    "size": 3|10|9,                    -- côté de la grille de cases
--    "align": 3|5|3,                    -- alignement gagnant (ultime : 3 petits morpions)
--    "a": "<uid>", "b": "<uid>",        -- duellistes (couleurs du socle)
--    "x": "<uid>", "o": "<uid>",        -- ❌ / ⭕
--    "cells": [null|"x"|"o", …],        -- size² cases. classic/giant : i = ligne*size + colonne ;
--                                       -- ultimate : i = 9*petit + case (petit, case : 0..8, sens de lecture)
--    "count": n,                        -- coups joués
--    "last": {"cell": i, "by": "<uid>"} | null,
--    "lines": [[i, …], …] | null,       -- segments gagnants, chacun ordonné d'un bout à l'autre
--                                       -- (classic/giant : cases ; ultimate : petits morpions 0..8)
--    "boards": [null|"x"|"o"|"draw" ×9] | null,   -- ultimate : état des petits morpions (sinon null)
--    "next": 0..8 | null}               -- ultimate : petit morpion imposé (null = libre)
-- Coup : {"cell": i} (aucune autre clé, sinon invalid_move). Pas de secret, pas de server, pas de préparation.
-- Erreurs : invalid_move (format, hors grille), cell_taken, wrong_board (ultime :
-- hors du petit morpion imposé), board_closed (ultime : petit morpion terminé),
-- invalid_variant (démarrage). Miroir TS : src/games/morpion/logic.ts.
-- =============================================================================

-- Variante normalisée (absente / inconnue -> classic).
create or replace function public._morpion_variant(p_opts jsonb)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when jsonb_typeof(p_opts) = 'object' and p_opts->>'variant' in ('classic', 'giant', 'ultimate')
              then p_opts->>'variant' else 'classic' end;
$$;

-- Contenu de la case (r, c) d'une grille carrée p_n × p_n stockée à plat ; null si vide / hors grille.
create or replace function public._morpion_at(p_grid jsonb, p_n integer, p_r integer, p_c integer)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when p_r between 0 and p_n - 1 and p_c between 0 and p_n - 1 then p_grid->>(p_r * p_n + p_c) end;
$$;

-- Segments de p_sym alignés (>= p_align) passant par la case p_idx d'une grille
-- p_n × p_n, dans l'ordre : ligne, colonne, diagonale \, diagonale /. Chaque
-- segment est ordonné d'un bout à l'autre (sens de lecture). Null s'il n'y en a pas.
create or replace function public._morpion_runs(p_grid jsonb, p_n integer, p_idx integer, p_align integer, p_sym text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_dirs integer[] := array[0,1, 1,0, 1,1, 1,-1];   -- (dr, dc)
  v_r    integer := p_idx / p_n;
  v_c    integer := p_idx % p_n;
  v_out  jsonb := '[]'::jsonb;
  v_seg  jsonb;
  dr     integer;
  dc     integer;
  k      integer;
  i      integer;
begin
  if p_sym is null or public._morpion_at(p_grid, p_n, v_r, v_c) is distinct from p_sym then return null; end if;
  for i in 0 .. 3 loop
    dr := v_dirs[i * 2 + 1];
    dc := v_dirs[i * 2 + 2];
    -- Recule jusqu'au début du segment…
    k := 0;
    while public._morpion_at(p_grid, p_n, v_r - (k + 1) * dr, v_c - (k + 1) * dc) = p_sym loop
      k := k + 1;
    end loop;
    -- … puis avance jusqu'à sa fin.
    v_seg := '[]'::jsonb;
    while public._morpion_at(p_grid, p_n, v_r - k * dr, v_c - k * dc) = p_sym loop
      v_seg := v_seg || to_jsonb((v_r - k * dr) * p_n + (v_c - k * dc));
      k := k - 1;
    end loop;
    if jsonb_array_length(v_seg) >= p_align then
      v_out := v_out || jsonb_build_array(v_seg);
    end if;
  end loop;
  return case when jsonb_array_length(v_out) > 0 then v_out end;
end $$;

-- Les 9 cases du petit morpion p_b (ultime), dans l'ordre de lecture.
create or replace function public._morpion_sub(p_cells jsonb, p_b integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_agg(coalesce(p_cells->(9 * p_b + k), 'null'::jsonb) order by k) from generate_series(0, 8) as k;
$$;

-- Plus aucune case vide (null) ?
create or replace function public._morpion_full(p_grid jsonb)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select not exists (select 1 from jsonb_array_elements(p_grid) as e where jsonb_typeof(e) = 'null');
$$;

-- ---------------------------------------------------------------- hooks du socle

create or replace function public.game_morpion_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_var text := public._morpion_variant(p_ctx->'options');
  v_n   integer := case v_var when 'giant' then 10 when 'ultimate' then 9 else 3 end;
  v_x   text := case when p_ctx->>'starter' = p_b then p_b else p_a end;
begin
  return jsonb_build_object('board', jsonb_build_object(
    'variant', v_var,
    'size', v_n,
    'align', case when v_var = 'giant' then 5 else 3 end,
    'a', p_a, 'b', p_b,
    'x', v_x, 'o', case when v_x = p_a then p_b else p_a end,
    'cells', (select jsonb_agg('null'::jsonb) from generate_series(1, v_n * v_n)),
    'count', 0,
    'last', null,
    'lines', null,
    'boards', case when v_var = 'ultimate' then (select jsonb_agg('null'::jsonb) from generate_series(1, 9)) end,
    'next', null));
end $$;

create or replace function public.game_morpion_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_ult    boolean := p_board->>'variant' = 'ultimate';
  v_n      integer := (p_board->>'size')::integer;
  v_cells  jsonb := p_board->'cells';
  v_boards jsonb := p_board->'boards';
  v_next   integer := (p_board->>'next')::integer;
  v_sym    text;
  v_i      integer;
  v_b      integer;
  v_k      integer;
  v_lines  jsonb := null;
  v_out    text := null;
begin
  v_sym := case p_actor when p_board->>'x' then 'x' when p_board->>'o' then 'o' end;
  if v_sym is null then raise exception 'invalid_move'; end if;
  -- Format : EXACTEMENT {"cell": entier >= 0} dans la grille. Aucune autre clé :
  -- le socle recopie le coup tel quel dans le state public (duel.last_move) ; un
  -- champ parasite le gonflerait sur tous les téléphones.
  if jsonb_typeof(p_move) is distinct from 'object' then raise exception 'invalid_move'; end if;
  if (p_move - 'cell') <> '{}'::jsonb then raise exception 'invalid_move'; end if;
  if jsonb_typeof(p_move->'cell') is distinct from 'number' or coalesce(p_move->>'cell', '') !~ '^\d{1,3}$' then
    raise exception 'invalid_move';
  end if;
  v_i := (p_move->>'cell')::integer;
  if v_i >= v_n * v_n then raise exception 'invalid_move'; end if;

  if v_ult then
    v_b := v_i / 9;
    v_k := v_i % 9;
    if v_next is not null and v_b <> v_next then raise exception 'wrong_board'; end if;
    if jsonb_typeof(v_boards->v_b) is distinct from 'null' then raise exception 'board_closed'; end if;
  end if;
  if jsonb_typeof(v_cells->v_i) is distinct from 'null' then raise exception 'cell_taken'; end if;

  v_cells := jsonb_set(v_cells, array[v_i::text], to_jsonb(v_sym));

  if v_ult then
    -- Petit morpion : gagné (grand X/O) ou plein (nul, à personne) ?
    if public._morpion_runs(public._morpion_sub(v_cells, v_b), 3, v_k, 3, v_sym) is not null then
      v_boards := jsonb_set(v_boards, array[v_b::text], to_jsonb(v_sym));
      v_lines := public._morpion_runs(v_boards, 3, v_b, 3, v_sym);
    elsif public._morpion_full(public._morpion_sub(v_cells, v_b)) then
      v_boards := jsonb_set(v_boards, array[v_b::text], '"draw"'::jsonb);
    end if;
    -- La case jouée désigne le prochain petit morpion (libre s'il est terminé).
    v_next := case when jsonb_typeof(v_boards->v_k) = 'null' then v_k end;
    if v_lines is not null then v_out := 'win';
    elsif public._morpion_full(v_boards) then v_out := 'draw';   -- plus aucun coup possible
    end if;
  else
    v_lines := public._morpion_runs(v_cells, v_n, v_i, (p_board->>'align')::integer, v_sym);
    if v_lines is not null then v_out := 'win';
    elsif public._morpion_full(v_cells) then v_out := 'draw';
    end if;
  end if;

  p_board := p_board || jsonb_build_object(
    'cells', v_cells,
    'count', coalesce((p_board->>'count')::integer, 0) + 1,
    'last', jsonb_build_object('cell', v_i, 'by', p_actor),
    'lines', v_lines,
    'boards', v_boards,
    'next', case when v_ult and v_out is null then v_next end);
  if v_out = 'win' then
    -- 'game' : compteurs de fin de manche pour les trophées (L'ombre : Ultime gagné sans perdre un petit morpion)
    return jsonb_build_object('board', p_board, 'outcome', 'win', 'winner', p_actor,
      'game', jsonb_build_object('clean_ultimate',
        v_ult and not exists (select 1 from jsonb_array_elements_text(v_boards) b where b = case v_sym when 'x' then 'o' else 'x' end)));
  end if;
  return jsonb_build_object('board', p_board, 'outcome', v_out);
end $$;

-- Coup automatique (minuteur) : une case libre au hasard, en respectant la
-- contrainte de l'ultime (petit morpion imposé, sinon un petit morpion non terminé).
create or replace function public.game_morpion_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select jsonb_build_object('cell', i)
    from generate_series(0, (p_board->>'size')::integer * (p_board->>'size')::integer - 1) as i
   where jsonb_typeof(p_board->'cells'->i) = 'null'
     and (p_board->>'variant' is distinct from 'ultimate'
          or (jsonb_typeof(p_board->'boards'->(i / 9)) = 'null'
              and (p_board->>'next' is null or i / 9 = (p_board->>'next')::integer)))
   order by random() limit 1;
$$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

-- Hook de trophées du socle duel (features/duel.sql, _duel_tstats) : stats propres au jeu.
-- La variante est celle de la session (session.board_options.variant).
create or replace function public.game_morpion_trophy_stats(p_state jsonb, p_pl text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  with v as (
    select public._morpion_variant(p_state->'session'->'board_options') as variant,
           coalesce((p_state->'session'->'stats'->p_pl->>'wins')::integer, 0) as wins
  ), g as (select * from public._duel_games(p_state, p_pl))
  select jsonb_build_object(
    'classic_fast_loss', case when v.variant = 'classic' then (select count(*) from g where lost and moves <= 7) else 0 end,
    'giant_wins', case when v.variant = 'giant' then (select count(*) from g where won) else 0 end,
    'win_classic', case when v.variant = 'classic' and v.wins >= 1 then 1 else 0 end,
    'win_giant', case when v.variant = 'giant' and v.wins >= 1 then 1 else 0 end,
    'win_ultimate', case when v.variant = 'ultimate' and v.wins >= 1 then 1 else 0 end,
    'classic_second_win', case when v.variant = 'classic' then (select count(*) from g where won and not i_started) else 0 end,
    'giant_fast_win', case when v.variant = 'giant' then (select count(*) from g where won and moves <= 13) else 0 end,
    'ultimate_duel_wins', case when v.variant = 'ultimate' then v.wins else 0 end,
    'clean_ultimate', case when v.variant = 'ultimate'
        then (select count(*) from public._duel_games_x(p_state, p_pl) x
               where x.won and coalesce((x.g->>'clean_ultimate')::boolean, false)) else 0 end)
  from v
$$;
revoke all on function public.game_morpion_trophy_stats(jsonb, text) from public, anon, authenticated;

create or replace function public.game_morpion_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_var jsonb := p_options->'board'->'variant';
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_var is not null and (jsonb_typeof(v_var) <> 'string' or v_var #>> '{}' not in ('classic', 'giant', 'ultimate')) then
    raise exception 'invalid_variant';
  end if;
  return public._duel_start('morpion', p_players, p_options);
end $$;

create or replace function public.game_morpion_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('morpion', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._morpion_variant(jsonb) from public, anon, authenticated;
revoke all on function public._morpion_at(jsonb, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._morpion_runs(jsonb, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function public._morpion_sub(jsonb, integer) from public, anon, authenticated;
revoke all on function public._morpion_full(jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_morpion_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_morpion_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_morpion_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
