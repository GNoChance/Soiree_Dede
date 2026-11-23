-- =============================================================================
-- JEU « cerveau-en-fete » : quiz de culture générale multi-écrans
-- =============================================================================
-- Idempotent (create or replace). Contrat : src/games/cerveau-en-fete/types.ts.
--
-- p_options : {"duration": 20, "questions": [{id, theme, difficulty, prompt, image?,
--              answer, aliases?, distractors?, mode: "typed"|"mcq"}]}
-- Le serveur garde les réponses dans match_server_state ; le state public ne contient
-- jamais la réponse avant la phase "reveal".
--
-- Phases : question -> reveal -> question ... -> finished.
-- Échéances : state.deadline (fin du temps de réponse, puis fin de la révélation
-- automatique, CEF_REVEAL_SECONDS = 8 s). N'importe quel joueur envoie {"type":"tick"}.
-- Toute action portant un "round" différent de la manche courante est ignorée
-- sans erreur (state inchangé) : clics en retard, ticks concurrents.

-- Normalisation tolérante : casse, accents, ligatures, ponctuation/espaces,
-- article en tête (le, la, les, l', un, une, des).
create or replace function public._cef_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select replace(
    regexp_replace(
      btrim(regexp_replace(
        lower(translate(
          replace(replace(replace(replace(left(coalesce(p, ''), 120), 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
          'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
          'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY')),
        '[^a-z0-9]+', ' ', 'g')),
      '^(les|le|la|l|une|un|des) ', ''),
    ' ', '')
$$;

-- Distance de Levenshtein (implémentation maison : pas besoin de fuzzystrmatch).
create or replace function public._cef_lev(a text, b text)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  la   integer := char_length(a);
  lb   integer := char_length(b);
  prev integer[];
  cur  integer[];
  i    integer;
  j    integer;
begin
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;
  prev := array(select generate_series(0, lb));
  for i in 1..la loop
    cur := array[i];
    for j in 1..lb loop
      cur := cur || least(prev[j + 1] + 1, cur[j] + 1,
                          prev[j] + case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end);
    end loop;
    prev := cur;
  end loop;
  return prev[lb + 1];
end $$;

-- La proposition correspond-elle à l'une des formes acceptées (déjà normalisées) ?
-- Fautes de frappe : distance <= 1 jusqu'à 6 caractères, <= 2 au-delà ;
-- exact obligatoire si la réponse contient un chiffre (dates !) ou fait <= 3 caractères.
create or replace function public._cef_match(p_guess text, p_accept jsonb)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_g   text := public._cef_norm(p_guess);
  v_a   text;
  v_tol integer;
begin
  if v_g = '' then return false; end if;
  for v_a in select value from jsonb_array_elements_text(coalesce(p_accept, '[]'::jsonb)) loop
    if v_g = v_a then return true; end if;
    if v_a ~ '[0-9]' or char_length(v_a) <= 3 then continue; end if;
    v_tol := case when char_length(v_a) <= 6 then 1 else 2 end;
    if abs(char_length(v_g) - char_length(v_a)) <= v_tol and public._cef_lev(v_g, v_a) <= v_tol then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- Ouvre la question d'index p_idx (0-based).
create or replace function public._cef_open(p_state jsonb, p_server jsonb, p_idx integer)
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
    'question', v_q - 'answer' - 'accept' - 'correct',
    'found', '[]'::jsonb, 'passed', '[]'::jsonb, 'missed', '[]'::jsonb);
  p_server := p_server || jsonb_build_object('picks', '{}'::jsonb, 'tries', '{}'::jsonb);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_cerveau_en_fete_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_in      jsonb := p_options->'questions';
  v_dur     integer;
  v_qs      jsonb := '[]'::jsonb;
  e         jsonb;
  v_mode    text;
  v_acc     jsonb;
  v_dis     jsonb;
  v_choices jsonb;
  v_correct integer;
  v_img     jsonb;
  v_zero    jsonb;
  v_st      jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if v_in is null or jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) = 0 then
    raise exception 'missing_questions';
  end if;
  begin
    v_dur := coalesce(nullif(p_options->>'duration', '')::integer, 20);
  exception when others then v_dur := 20;
  end;
  v_dur := least(greatest(v_dur, 5), 120);

  for e in select value from jsonb_array_elements(v_in) with ordinality t(value, o) order by o limit 50 loop
    if jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'prompt') <> 'string' or jsonb_typeof(e->'answer') <> 'string'
       or char_length(btrim(e->>'prompt')) = 0 or char_length(e->>'prompt') > 500
       or char_length(btrim(e->>'answer')) = 0 or char_length(e->>'answer') > 120 then
      raise exception 'invalid_questions';
    end if;

    -- 3 premiers distracteurs valides, distincts de la réponse.
    select coalesce(jsonb_agg(d order by o), '[]'::jsonb) into v_dis
      from (select d, o from jsonb_array_elements_text(
                     case when jsonb_typeof(e->'distractors') = 'array' then e->'distractors' else '[]'::jsonb end)
                     with ordinality t(d, o)
             where char_length(btrim(d)) between 1 and 120 and d <> e->>'answer'
             order by o limit 3) z;

    -- Formes acceptées (normalisées) : réponse + alias.
    select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_acc
      from (select public._cef_norm(e->>'answer') as x
            union
            select public._cef_norm(a) from jsonb_array_elements_text(
                     case when jsonb_typeof(e->'aliases') = 'array' then e->'aliases' else '[]'::jsonb end) a) t
     where x <> '';

    v_mode := case when e->>'mode' = 'mcq' then 'mcq' else 'typed' end;
    if v_mode = 'mcq' and jsonb_array_length(v_dis) < 3 then v_mode := 'typed'; end if;
    if v_mode = 'typed' and jsonb_array_length(v_acc) = 0 then
      if jsonb_array_length(v_dis) >= 3 then v_mode := 'mcq'; else raise exception 'invalid_questions'; end if;
    end if;

    v_choices := null;
    v_correct := null;
    if v_mode = 'mcq' then
      select jsonb_agg(c order by random()) into v_choices
        from (select e->>'answer' as c union all select value from jsonb_array_elements_text(v_dis)) y;
      select (o - 1)::integer into v_correct
        from jsonb_array_elements_text(v_choices) with ordinality t(c, o) where c = e->>'answer' limit 1;
    end if;

    v_img := null;
    if jsonb_typeof(e->'image') = 'object' and coalesce(e->'image'->>'url', '') ~ '^https://' then
      v_img := jsonb_build_object('url', left(e->'image'->>'url', 500),
                                  'credit', left(coalesce(e->'image'->>'credit', ''), 200),
                                  'license', left(coalesce(e->'image'->>'license', ''), 60));
    end if;

    v_qs := v_qs || jsonb_build_array(jsonb_build_object(
      'id', left(coalesce(e->>'id', ''), 40),
      'theme', left(coalesce(e->>'theme', ''), 40),
      'difficulty', case when e->>'difficulty' in ('1', '2', '3') then (e->>'difficulty')::integer end,
      'prompt', e->>'prompt',
      'image', v_img,
      'mode', v_mode,
      'choices', v_choices,
      'answer', e->>'answer',
      'accept', v_acc,
      'correct', v_correct));
  end loop;

  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_st := public._cef_open(
    jsonb_build_object(
      'game', 'cerveau-en-fete',
      'round', 1,
      'total_rounds', jsonb_array_length(v_qs),
      'duration', v_dur,
      'reveal_seconds', 8,
      'players', to_jsonb(p_players),
      'scores', v_zero,
      'last_reveal', null,
      'history', '[]'::jsonb,
      'winners', null,
      'results', null),
    jsonb_build_object('questions', v_qs),
    0);
  return v_st || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

-- Passe en révélation : réponse publiée, points ajoutés aux scores.
create or replace function public._cef_reveal(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_round  integer := (p_state->>'round')::integer;
  v_q      jsonb := p_server->'questions'->(v_round - 1);
  v_points jsonb;
begin
  select coalesce(jsonb_object_agg(f->>'profile_id', (f->>'points')::integer), '{}'::jsonb) into v_points
    from jsonb_array_elements(p_state->'found') f;

  p_state := p_state || jsonb_build_object(
    'phase', 'reveal',
    'deadline', to_jsonb(now() + make_interval(secs => coalesce((p_state->>'reveal_seconds')::integer, 8))),
    'scores', (select jsonb_object_agg(key, value::integer + coalesce((v_points->>key)::integer, 0))
                 from jsonb_each_text(p_state->'scores')),
    'last_reveal', jsonb_build_object(
      'round', v_round,
      'question', p_state->'question',
      'answer', v_q->'answer',
      'mode', v_q->'mode',
      'choices', v_q->'choices',
      'correct', v_q->'correct',
      'found', p_state->'found',
      'passed', p_state->'passed',
      'missed', p_state->'missed',
      'picks', coalesce(p_server->'picks', '{}'::jsonb),
      'tries', coalesce(p_server->'tries', '{}'::jsonb),
      'points', v_points),
    'history', coalesce(p_state->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'round', v_round,
      'id', v_q->'id',
      'theme', v_q->'theme',
      'prompt', v_q->'prompt',
      'answer', v_q->'answer',
      'mode', v_q->'mode',
      'found', p_state->'found')));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql) : tout se lit dans history[].found.
create or replace function public._cef_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with q as (
    select e.o, e.v->>'mode' as mode,
           (select f from jsonb_array_elements(e.v->'found') f where f->>'profile_id' = p_pl limit 1) as me,
           jsonb_array_length(e.v->'found') as nfound
      from jsonb_array_elements(coalesce(p_state->'history', '[]'::jsonb)) with ordinality as e(v, o)
  ), r as (
    select q.*, (q.me is not null) as ok from q
  ), g as (
    select r.*, r.o - row_number() over (partition by r.ok order by r.o) as grp from r
  )
  select jsonb_build_object(
    'correct', (select count(*) from g where ok),
    'firsts', (select count(*) from g where ok and (me->>'rank')::integer = 1),
    'last_finder', (select count(*) from g where ok and nfound >= 3 and (me->>'rank')::integer = nfound),
    'close_finds', (select count(*) from g where ok
                      and (me->>'ms')::integer >= (p_state->>'duration')::integer * 1000 - 3000),
    'fast_typed', (select count(*) from g where ok and mode = 'typed' and (me->>'ms')::integer < 3000),
    'best_streak', coalesce((select max(c) from (select count(*) as c from g where ok group by grp) x), 0),
    'miss_streak', coalesce((select max(c) from (select count(*) as c from g where not ok group by grp) x), 0),
    'qcm_perfect', case when (select count(*) from g where mode = 'mcq') >= 5
                         and not exists (select 1 from g where mode = 'mcq' and not ok) then 1 else 0 end,
    'perfect', case when (select count(*) from g) >= 10 and not exists (select 1 from g where not ok) then 1 else 0 end)
$$;

create or replace function public._cef_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
begin
  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  -- points (XP = points x 10) : score du quiz / 100 arrondi, pour rester à l'échelle des autres jeux.
  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', round(t.value::integer / 100.0)::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', public._cef_tstats(p_state, t.key))
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

-- Révélation si tous les joueurs ont trouvé, passé ou raté (QCM).
create or replace function public._cef_check_done(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if not exists (
    select 1 from jsonb_array_elements_text(p_state->'players') pl
     where not (p_state->'passed' ? pl) and not (p_state->'missed' ? pl)
       and not exists (select 1 from jsonb_array_elements(p_state->'found') f where f->>'profile_id' = pl))
  then
    return public._cef_reveal(p_state, p_server);
  end if;
  -- Accélérateur : dès que la majorité a trouvé ou passé, il ne reste que 8 s (jamais allongé).
  if (select count(*) from jsonb_array_elements_text(p_state->'players') pl
       where p_state->'passed' ? pl
          or exists (select 1 from jsonb_array_elements(p_state->'found') f where f->>'profile_id' = pl))
     * 2 > jsonb_array_length(p_state->'players')
     and (p_state->>'deadline')::timestamptz > now() + interval '8 seconds' then
    p_state := p_state || jsonb_build_object('deadline', to_jsonb(now() + interval '8 seconds'));
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

create or replace function public.game_cerveau_en_fete_action(
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
  v_q        jsonb;
  v_same     jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_ok       boolean;
  v_idx      integer;
  v_frac     numeric;
  v_rank     integer;
  v_pts      integer;
  v_ms       integer;
begin
  if v_type not in ('answer', 'choose', 'pass', 'skip', 'next', 'tick') then
    raise exception 'unknown_action';
  end if;
  -- Action d'une manche passée (ou partie finie) : ignorée sans erreur.
  if v_phase not in ('question', 'reveal') then return v_same; end if;
  if p_action ? 'round' and (p_action->>'round') is distinct from (p_state->>'round') then
    return v_same;
  end if;

  if v_type = 'tick' then
    if v_deadline is null or now() < v_deadline then return v_same; end if;
    if v_phase = 'question' then return public._cef_reveal(p_state, p_server); end if;
    if v_round >= v_total then return public._cef_finish(p_state, p_server); end if;
    return public._cef_open(p_state, p_server, v_round);

  elsif v_type = 'skip' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'question' then return v_same; end if;
    return public._cef_reveal(p_state, p_server);

  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'reveal' then return v_same; end if;
    if v_round >= v_total then return public._cef_finish(p_state, p_server); end if;
    return public._cef_open(p_state, p_server, v_round);
  end if;

  -- answer / choose / pass : joueurs uniquement, pendant la question.
  if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
  if v_phase <> 'question' then return v_same; end if;
  if now() >= v_deadline then return public._cef_reveal(p_state, p_server); end if;
  if (p_state->'passed' ? v_me) or (p_state->'missed' ? v_me)
     or exists (select 1 from jsonb_array_elements(p_state->'found') f where f->>'profile_id' = v_me) then
    return v_same;   -- déjà fini pour cette question
  end if;

  if v_type = 'pass' then
    p_state := jsonb_set(p_state, '{passed}', (p_state->'passed') || to_jsonb(v_me));
    return public._cef_check_done(p_state, p_server);
  end if;

  v_q := p_server->'questions'->(v_round - 1);
  if v_type = 'answer' then
    if v_q->>'mode' <> 'typed' then raise exception 'wrong_mode'; end if;
    if char_length(btrim(coalesce(p_action->>'text', ''))) = 0 then return v_same; end if;
    p_server := jsonb_set(p_server, array['tries', v_me],
                          to_jsonb(coalesce((p_server->'tries'->>v_me)::integer, 0) + 1), true);
    v_ok := public._cef_match(p_action->>'text', v_q->'accept');
    if not v_ok then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
  else -- choose
    if v_q->>'mode' <> 'mcq' then raise exception 'wrong_mode'; end if;
    begin
      v_idx := (p_action->>'index')::integer;
    exception when others then raise exception 'invalid_choice';
    end;
    if v_idx is null or v_idx < 0 or v_idx >= jsonb_array_length(v_q->'choices') then
      raise exception 'invalid_choice';
    end if;
    p_server := jsonb_set(p_server, array['picks', v_me], to_jsonb(v_idx), true);
    v_ok := v_idx = (v_q->>'correct')::integer;
    if not v_ok then
      p_state := jsonb_set(p_state, '{missed}', (p_state->'missed') || to_jsonb(v_me));
      return public._cef_check_done(p_state, p_server);
    end if;
  end if;

  -- Bonne réponse : base + bonus vitesse (proportionnel au temps restant) + premier.
  v_frac := greatest(0, least(1, extract(epoch from (v_deadline - now())) / (p_state->>'duration')::numeric));
  v_rank := jsonb_array_length(p_state->'found') + 1;
  v_pts := case when v_q->>'mode' = 'typed' then 100 + round(100 * v_frac) else 60 + round(60 * v_frac) end
           + case when v_rank = 1 then 20 else 0 end;
  v_ms := greatest(0, round(extract(epoch from (now() - (p_state->>'started_at')::timestamptz)) * 1000));
  p_state := jsonb_set(p_state, '{found}', (p_state->'found') || jsonb_build_array(jsonb_build_object(
    'profile_id', v_me, 'rank', v_rank, 'ms', v_ms, 'points', v_pts)));
  return public._cef_check_done(p_state, p_server);
end $$;

revoke all on function public._cef_norm(text) from public, anon, authenticated;
revoke all on function public._cef_lev(text, text) from public, anon, authenticated;
revoke all on function public._cef_match(text, jsonb) from public, anon, authenticated;
revoke all on function public._cef_open(jsonb, jsonb, integer) from public, anon, authenticated;
revoke all on function public._cef_reveal(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._cef_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._cef_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public._cef_check_done(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_cerveau_en_fete_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_cerveau_en_fete_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
