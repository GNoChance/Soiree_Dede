-- =============================================================================
-- JEU « Bombe à mots » (id bombe-a-mots) : syllabe imposée + bombe qui tourne
-- Idempotent (create or replace). Dispatché par start_match / game_action.
-- Contrat complet (state public, actions, options) : src/games/bombe-a-mots/types.ts.
--
-- p_options : {"lives": 3, "start_level": 1,
--              "syllables": [{"s":"ou","level":1}, ...]}   -- tirées par l'hôte (front),
--              triées par difficulté croissante, mélangées à niveau égal (10..400 entrées).
--
-- MÈCHE GLOBALE (variante retenue) : une mèche de 5 à 12 s (tirée au hasard par le
-- serveur, JAMAIS publiée : server.explode_at) brûle en continu pendant que la bombe
-- passe de joueur en joueur ; elle n'est retirée qu'après une explosion. Pour éviter
-- une explosion « injuste » juste après une passe, le joueur qui reçoit la bombe a
-- toujours au moins BAM_GRACE_MS (1,5 s) devant lui (explode_at repoussé si besoin).
-- Après une explosion (et au lancement) : pause de BAM_PAUSE_S (3 s, state.resume_at),
-- puis nouvelle mèche à partir de resume_at (state.fuse_started_at).
--
-- Échéance cachée => le front ne sait pas quand envoyer le tick. Il « sonde » :
-- {"type":"tick","quiet":true} à partir de fuse_started_at + 5 s ; si la bombe n'a pas
-- encore explosé, le serveur LÈVE 'bomb_not_ready' (transaction annulée : aucune
-- écriture, aucun évènement Realtime, aucun seq consommé). {"type":"tick"} sans quiet
-- respecte la convention commune (state renvoyé inchangé, sans erreur).
--
-- Dictionnaire : vérifié CÔTÉ CLIENT uniquement (~300 000 formes, impossible à charger
-- dans une fonction SQL à chaque coup). Le serveur vérifie tout le reste.
-- =============================================================================

-- Normalisation d'un mot joué : minuscules, sans accents ni ligatures. Le tiret est
-- conservé (mots composés). Le résultat doit ensuite matcher ^[a-z]+(-[a-z]+)*$.
create or replace function public._bam_norm(p text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select lower(translate(
    replace(replace(replace(replace(btrim(left(coalesce(p, ''), 60)), 'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'))
$$;

-- Nouvelle mèche aléatoire (5 000 à 12 000 ms) à partir de p_from.
create or replace function public._bam_fuse(p_from timestamptz)
returns timestamptz language sql volatile
set search_path = public, extensions
as $$ select p_from + make_interval(secs => (5000 + floor(random() * 7001)) / 1000.0) $$;

-- Joueur vivant suivant p_from dans l'ordre de table (p_from peut être éliminé).
create or replace function public._bam_next(p_state jsonb, p_from text)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_order text[] := array(select jsonb_array_elements_text(p_state->'players'));
  v_n     integer := cardinality(v_order);
  v_i     integer := coalesce(array_position(v_order, p_from), 0);
  k       integer;
  v_c     text;
begin
  for k in 1 .. v_n loop
    v_c := v_order[((v_i - 1 + k) % v_n) + 1];
    if (p_state->'alive') ? v_c then return v_c; end if;
  end loop;
  return null;
end $$;

-- Tire la syllabe suivante (niveau visé = start_level + mots validés / level_every, plafonné à 5).
-- Préfère une syllabe inutilisée du niveau visé (dans l'ordre fourni), sinon le niveau le
-- plus proche (plus facile d'abord) ; liste épuisée => on recycle (sauf la syllabe courante).
create or replace function public._bam_pick(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_target integer := least(5, (p_state->>'start_level')::integer
                              + (p_state->>'words_count')::integer / greatest(1, (p_state->>'level_every')::integer));
  v_cur    text := p_state->>'syllable';
  v_used   jsonb := coalesce(p_server->'used', '[]'::jsonb);
  v_idx    integer;
  v_s      text;
  v_lvl    integer;
begin
  for k in 1 .. 2 loop
    select (o - 1)::integer, e->>'s', (e->>'level')::integer into v_idx, v_s, v_lvl
      from jsonb_array_elements(p_server->'syllables') with ordinality t(e, o)
     where not (v_used @> to_jsonb((o - 1)::integer))
       and (v_cur is null or e->>'s' <> v_cur)
     order by abs((e->>'level')::integer - v_target), (e->>'level')::integer, o
     limit 1;
    exit when v_idx is not null;
    v_used := '[]'::jsonb;  -- tout a servi : on recycle
  end loop;
  if v_idx is null then  -- liste d'une seule syllabe (impossible via start) : on garde la courante
    v_s := v_cur; v_lvl := coalesce((p_state->>'level')::integer, 1);
  else
    v_used := v_used || to_jsonb(v_idx);
  end if;
  p_state := p_state || jsonb_build_object('syllable', v_s, 'level', v_lvl, 'target_level', v_target);
  p_server := p_server || jsonb_build_object('used', v_used);
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql), lues dans explosions / words / bonuses.
create or replace function public._bam_tstats(p_state jsonb, p_pl text, p_winner text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with ev as (   -- événements de MES tours, dans l'ordre : x = explosion, w = mot validé
    select (x->>'n')::integer as n, 'x' as k from jsonb_array_elements(coalesce(p_state->'explosions', '[]'::jsonb)) x where x->>'p' = p_pl
    union all
    select (w->>'n')::integer, 'w' from jsonb_array_elements(coalesce(p_state->'words', '[]'::jsonb)) w where w->>'p' = p_pl
  ), r as (
    select n, k, row_number() over (order by n) - row_number() over (partition by k order by n) as grp from ev
  ), me as (
    select (select count(*) from ev where k = 'x') as booms
  )
  select jsonb_build_object(
    'explosions', (select booms from me),
    'double_boom', (select count(*) from (select count(*) as c from r where k = 'x' group by grp) z where c >= 2),
    'first_out', case when p_state->'eliminated'->>0 = p_pl then 1 else 0 end,
    'words', coalesce((p_state->'word_counts'->>p_pl)::integer, 0),
    'longest_word', coalesce((select max(char_length(replace(w->>'w', '-', '')))
                                from jsonb_array_elements(coalesce(p_state->'words', '[]'::jsonb)) w where w->>'p' = p_pl), 0),
    'alphabets', (select count(*) from jsonb_array_elements(coalesce(p_state->'bonuses', '[]'::jsonb)) b where b->>'p' = p_pl),
    'last_life_win', case when p_winner = p_pl and (p_state->'lives'->>p_pl)::integer = 1 then 1 else 0 end,
    'untouched', case when p_winner = p_pl and (select booms from me) = 0
                       and jsonb_array_length(p_state->'players') >= 3 then 1 else 0 end)
$$;

-- Fin de partie : survivant 1er, puis ordre d'élimination inverse.
-- points = mots validés (plafonnés à 25 => XP max 250 + 50 de victoire).
create or replace function public._bam_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_winner  text := p_state->'alive'->>0;
  v_ranked  jsonb;
  v_results jsonb;
begin
  -- Ordre de classement : vivant(s) puis éliminés du dernier au premier.
  select jsonb_agg(x order by r) into v_ranked from (
    select value as x, 0 as r from jsonb_array_elements_text(p_state->'alive')
    union all
    select value, (100000 - o)::integer from jsonb_array_elements_text(p_state->'eliminated') with ordinality t(value, o)
  ) z;

  select jsonb_agg(jsonb_build_object(
           'profile_id', pid,
           'points', least(25, coalesce((p_state->'word_counts'->>pid)::integer, 0)),
           'won', pid = v_winner,
           'placement', o::integer,
           'stats', public._bam_tstats(p_state, pid, v_winner)) order by o)
    into v_results
    from jsonb_array_elements_text(v_ranked) with ordinality t(pid, o);

  p_state := p_state || jsonb_build_object('phase', 'finished', 'winner', v_winner, 'turn', null,
                                           'resume_at', null, 'results', v_results,
                                           'ranking', v_ranked);
  return jsonb_build_object('state', p_state, 'server', p_server - 'explode_at', 'results', v_results);
end $$;

-- Démarre une nouvelle mèche après une pause de 3 s (lancement / après explosion).
create or replace function public._bam_rearm(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_resume timestamptz := now() + interval '3 seconds';
begin
  p_state := p_state || jsonb_build_object('resume_at', to_jsonb(v_resume), 'fuse_started_at', to_jsonb(v_resume));
  p_server := p_server || jsonb_build_object('explode_at', to_jsonb(public._bam_fuse(v_resume)));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- BOUM : le joueur actif perd une vie (éliminé à 0), la bombe passe au suivant.
create or replace function public._bam_explode(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_victim text := p_state->>'turn';
  v_lives  integer := greatest(0, coalesce((p_state->'lives'->>v_victim)::integer, 1) - 1);
  v_out    boolean := v_lives = 0;
  v_n      integer := (p_state->>'turn_n')::integer + 1;
  v_r      jsonb;
begin
  p_state := jsonb_set(p_state, array['lives', v_victim], to_jsonb(v_lives));
  if v_out then
    p_state := p_state || jsonb_build_object(
      'alive', (p_state->'alive') - v_victim,
      'eliminated', coalesce(p_state->'eliminated', '[]'::jsonb) || to_jsonb(v_victim));
  end if;
  p_state := p_state || jsonb_build_object(
    'explosions', coalesce(p_state->'explosions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'p', v_victim, 's', p_state->>'syllable', 'n', p_state->'turn_n', 'eliminated', v_out)),
    'last_event', jsonb_build_object('kind', 'explosion', 'n', p_state->'turn_n', 'p', v_victim,
                                     's', p_state->>'syllable', 'lives', v_lives, 'eliminated', v_out,
                                     'at', to_jsonb(now())));

  if jsonb_array_length(p_state->'alive') <= 1 then
    return public._bam_finish(p_state, p_server);
  end if;

  p_state := p_state || jsonb_build_object('turn', public._bam_next(p_state, v_victim), 'turn_n', v_n,
                                           'turn_started_at', to_jsonb(now() + interval '3 seconds'));
  v_r := public._bam_pick(p_state, p_server);
  return public._bam_rearm(v_r->'state', v_r->'server');
end $$;

create or replace function public.game_bombe_a_mots_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_in     jsonb := p_options->'syllables';
  v_syl    jsonb;
  v_lives  integer;
  v_level  integer;
  v_order  jsonb;
  v_st     jsonb;
  v_r      jsonb;
begin
  if cardinality(p_players) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  if v_in is null or jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) < 10
     or jsonb_array_length(v_in) > 400 then
    raise exception 'invalid_syllables';
  end if;
  if exists (select 1 from jsonb_array_elements(v_in) e
              where jsonb_typeof(e) <> 'object' or coalesce(e->>'s', '') !~ '^[a-z]{2,3}$'
                 or coalesce(e->>'level', '') !~ '^[1-5]$') then
    raise exception 'invalid_syllables';
  end if;
  select jsonb_agg(jsonb_build_object('s', e->>'s', 'level', (e->>'level')::integer) order by o)
    into v_syl from jsonb_array_elements(v_in) with ordinality t(e, o);

  begin
    v_lives := coalesce(nullif(p_options->>'lives', '')::integer, 3);
    v_level := coalesce(nullif(p_options->>'start_level', '')::integer, 1);
  exception when others then
    v_lives := 3; v_level := 1;
  end;
  v_lives := least(greatest(v_lives, 1), 5);
  v_level := least(greatest(v_level, 1), 5);

  -- Ordre de table aléatoire.
  select jsonb_agg(p::text order by random()) into v_order from unnest(p_players) p;

  v_st := jsonb_build_object(
    'game', 'bombe-a-mots',
    'phase', 'playing',
    'players', v_order,
    'alive', v_order,
    'eliminated', '[]'::jsonb,
    'turn', v_order->>0,
    'turn_n', 1,
    'turn_started_at', to_jsonb(now() + interval '3 seconds'),
    'syllable', null,
    'level', v_level,
    'target_level', v_level,
    'start_level', v_level,
    'level_every', 8,
    'max_lives', v_lives,
    'lives', (select jsonb_object_agg(value, v_lives) from jsonb_array_elements_text(v_order)),
    'letters', (select jsonb_object_agg(value, '') from jsonb_array_elements_text(v_order)),
    'bonus_alphabet', 'abcdefghijlmnopqrstuv',
    'word_counts', (select jsonb_object_agg(value, 0) from jsonb_array_elements_text(v_order)),
    'words_count', 0,
    'words', '[]'::jsonb,
    'explosions', '[]'::jsonb,
    'bonuses', '[]'::jsonb,
    'last_event', null,
    'min_fuse_ms', 5000,
    'max_fuse_ms', 12000,
    'grace_ms', 1500,
    'winner', null,
    'results', null);
  v_r := public._bam_pick(v_st, jsonb_build_object('syllables', v_syl, 'used', '[]'::jsonb));
  v_r := public._bam_rearm(v_r->'state', v_r->'server');
  return v_r || jsonb_build_object('secrets', '{}'::jsonb);
end $$;

create or replace function public.game_bombe_a_mots_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_me      text := p_actor::text;
  v_same    jsonb := jsonb_build_object('state', p_state, 'server', p_server);
  v_explode timestamptz := (p_server->>'explode_at')::timestamptz;
  v_resume  timestamptz := (p_state->>'resume_at')::timestamptz;
  v_syl     text := p_state->>'syllable';
  v_w       text;
  v_letters text;
  v_alpha   text := p_state->>'bonus_alphabet';
  v_lives   integer;
  v_bonus   boolean := false;
  v_full    boolean := false;
  v_next    text;
  v_n       integer := (p_state->>'turn_n')::integer;
  v_r       jsonb;
begin
  if v_type not in ('word', 'tick') then raise exception 'unknown_action'; end if;

  if v_type = 'tick' then
    -- Tick d'un tour passé ou partie finie : ignoré.
    if p_state->>'phase' <> 'playing'
       or (p_action ? 'n' and (p_action->>'n') is distinct from (p_state->>'turn_n')) then
      if coalesce((p_action->>'quiet')::boolean, false) then raise exception 'bomb_not_ready'; end if;
      return v_same;
    end if;
    if v_explode is null or now() < v_explode then
      if coalesce((p_action->>'quiet')::boolean, false) then raise exception 'bomb_not_ready'; end if;
      return v_same;
    end if;
    return public._bam_explode(p_state, p_server);
  end if;

  -- word
  if p_state->>'phase' <> 'playing' then raise exception 'wrong_phase'; end if;
  if not (p_state->'players' ? v_me) then raise exception 'not_a_player'; end if;
  if not (p_state->'alive' ? v_me) then raise exception 'not_alive'; end if;
  if p_state->>'turn' <> v_me then raise exception 'not_your_turn'; end if;
  if p_action ? 'n' and (p_action->>'n') is distinct from (p_state->>'turn_n') then
    raise exception 'too_late';
  end if;
  if v_resume is not null and now() < v_resume then raise exception 'bomb_paused'; end if;
  -- Trop tard : la bombe a explosé avant le mot (même si personne n'a encore « tické »).
  if v_explode is not null and now() >= v_explode then
    return public._bam_explode(p_state, p_server);
  end if;

  v_w := public._bam_norm(p_action->>'word');
  if v_w !~ '^[a-z]+(-[a-z]+)*$' or char_length(v_w) > 40 then raise exception 'invalid_word'; end if;
  if strpos(v_w, v_syl) = 0 then raise exception 'word_missing_syllable'; end if;
  if char_length(replace(v_w, '-', '')) <= char_length(v_syl) then raise exception 'word_too_short'; end if;
  if exists (select 1 from jsonb_array_elements(p_state->'words') x where x->>'w' = v_w) then
    raise exception 'word_already_played';
  end if;

  -- Alphabet bonus : lettres (hors k w x y z) déjà utilisées dans les mots validés du joueur.
  select string_agg(c, '' order by c) into v_letters
    from (select distinct c from regexp_split_to_table(coalesce(p_state->'letters'->>v_me, '') || v_w, '') c
           where strpos(v_alpha, c) > 0) z;
  v_letters := coalesce(v_letters, '');
  v_lives := (p_state->'lives'->>v_me)::integer;
  if char_length(v_letters) >= char_length(v_alpha) then
    v_full := true;
    v_letters := '';
    if v_lives < (p_state->>'max_lives')::integer then
      v_lives := v_lives + 1;
      v_bonus := true;
    end if;
    p_state := p_state || jsonb_build_object('bonuses', coalesce(p_state->'bonuses', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('p', v_me, 'n', v_n, 'life', v_bonus)));
  end if;

  v_next := public._bam_next(p_state, v_me);
  p_state := jsonb_set(p_state, array['letters', v_me], to_jsonb(v_letters));
  p_state := jsonb_set(p_state, array['lives', v_me], to_jsonb(v_lives));
  p_state := jsonb_set(p_state, array['word_counts', v_me],
                       to_jsonb(coalesce((p_state->'word_counts'->>v_me)::integer, 0) + 1));
  p_state := p_state || jsonb_build_object(
    'words', (p_state->'words') || jsonb_build_array(jsonb_build_object('p', v_me, 'w', v_w, 's', v_syl, 'n', v_n)),
    'words_count', (p_state->>'words_count')::integer + 1,
    'last_event', jsonb_build_object('kind', 'word', 'n', v_n, 'p', v_me, 'w', v_w, 's', v_syl,
                                     'to', v_next, 'alphabet_full', v_full, 'bonus_life', v_bonus,
                                     'at', to_jsonb(now())),
    'turn', v_next,
    'turn_n', v_n + 1,
    'turn_started_at', to_jsonb(now()));

  -- Mèche globale : elle continue ; délai minimal de grâce pour le receveur.
  if v_explode < now() + make_interval(secs => coalesce((p_state->>'grace_ms')::integer, 1500) / 1000.0) then
    p_server := p_server || jsonb_build_object('explode_at',
      to_jsonb(now() + make_interval(secs => coalesce((p_state->>'grace_ms')::integer, 1500) / 1000.0)));
  end if;

  v_r := public._bam_pick(p_state, p_server);
  return v_r;
end $$;

revoke all on function public._bam_norm(text) from public, anon, authenticated;
revoke all on function public._bam_fuse(timestamptz) from public, anon, authenticated;
revoke all on function public._bam_next(jsonb, text) from public, anon, authenticated;
revoke all on function public._bam_pick(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._bam_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._bam_tstats(jsonb, text, text) from public, anon, authenticated;
revoke all on function public._bam_rearm(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._bam_explode(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_bombe_a_mots_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_bombe_a_mots_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
