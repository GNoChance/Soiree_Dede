-- MORCEAU 3 / 5 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

-- ===== games\bombe-a-mots.sql =====
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
           -- fast_words / close_calls : comptés dans server (l'heure d'explosion est secrète)
           'stats', public._bam_tstats(p_state, pid, v_winner) || jsonb_build_object(
             'fast_words', coalesce((p_server->'fast_words'->>pid)::integer, 0),
             'close_calls', coalesce((p_server->'close_calls'->>pid)::integer, 0))) order by o)
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

  -- Trophées : mot validé en moins de 2 s (Patate chaude) / à moins d'1 s de l'explosion (Sueurs froides).
  if p_state->>'turn_started_at' is not null
     and now() - (p_state->>'turn_started_at')::timestamptz < interval '2 seconds' then
    p_server := p_server || jsonb_build_object('fast_words', coalesce(p_server->'fast_words', '{}'::jsonb)
      || jsonb_build_object(v_me, coalesce((p_server->'fast_words'->>v_me)::integer, 0) + 1));
  end if;
  if v_explode is not null and v_explode - now() < interval '1 second' then
    p_server := p_server || jsonb_build_object('close_calls', coalesce(p_server->'close_calls', '{}'::jsonb)
      || jsonb_build_object(v_me, coalesce((p_server->'close_calls'->>v_me)::integer, 0) + 1));
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


-- ===== games\bowling.sql =====
-- =============================================================================
-- JEU « bowling » (Bowling 3D, tout le monde joue en même temps) — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Chaque joueur joue SA partie sur son téléphone (physique 3D côté client),
-- puis envoie le résultat de chaque lancer : {"type":"roll","frame":f,"roll":r,
-- "pins_down_mask":m}. Le masque m (0..1023, bit i = quille n° i+1) liste les
-- quilles tombées PENDANT ce lancer. Le serveur vérifie la cohérence (ordre des
-- lancers, m ⊆ quilles debout, 10 max) et calcule LUI-MÊME le score officiel
-- (même logique que src/games/bowling/scoring.ts).
--
-- Anti-triche : minimal (jeu entre amis). Le serveur ne peut pas vérifier la
-- physique : un client modifié peut envoyer des strikes à volonté. Il garantit
-- seulement une feuille de score légale et un score correctement calculé.
--
-- Phases : playing -> finished (tous ont fini, échéance globale atteinte, ou
-- l'hôte termine : lancers manquants = 0).
-- =============================================================================

-- Nombre de quilles d'un masque (bits 0..9).
create or replace function public._bw_count(p_mask integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select count(*)::integer from generate_series(0, 9) b where (coalesce(p_mask, 0) >> b) & 1 = 1 $$;

-- Frame terminée ? (p_last : dernière frame = règles de la 10e)
create or replace function public._bw_frame_complete(p_frame jsonb, p_last boolean)
returns boolean language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_len integer := coalesce(jsonb_array_length(p_frame), 0);
  c1 integer;
  c2 integer;
begin
  if v_len = 0 then return false; end if;
  c1 := public._bw_count((p_frame->>0)::integer);
  if not p_last then return v_len >= 2 or c1 = 10; end if;
  if v_len < 2 then return false; end if;
  if v_len >= 3 then return true; end if;
  c2 := public._bw_count((p_frame->>1)::integer);
  return c1 + c2 < 10;
end $$;

-- Quilles debout avant le prochain lancer d'une frame non terminée.
create or replace function public._bw_standing(p_frame jsonb, p_last boolean)
returns integer language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_len integer := coalesce(jsonb_array_length(p_frame), 0);
  m1 integer;
  m2 integer;
begin
  if v_len = 0 then return 1023; end if;
  m1 := (p_frame->>0)::integer;
  if not p_last then return 1023 & ~m1; end if;
  if v_len = 1 then
    return case when public._bw_count(m1) = 10 then 1023 else 1023 & ~m1 end;
  end if;
  m2 := (p_frame->>1)::integer;
  if public._bw_count(m1) = 10 then
    return case when public._bw_count(m2) = 10 then 1023 else 1023 & ~m2 end;
  end if;
  return 1023;  -- spare : quilles relevées
end $$;

-- Prochain lancer attendu {frame, roll, standing} (1-based) ou null si fini.
create or replace function public._bw_next(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  f integer;
  v_frame jsonb;
begin
  for f in 0 .. p_n - 1 loop
    v_frame := coalesce(p_sheet->f, '[]'::jsonb);
    if not public._bw_frame_complete(v_frame, f = p_n - 1) then
      return jsonb_build_object('frame', f + 1, 'roll', jsonb_array_length(v_frame) + 1,
                                'standing', public._bw_standing(v_frame, f = p_n - 1));
    end if;
  end loop;
  return null;
end $$;

-- Ajoute le masque p_mask à la frame p_frame (1-based).
create or replace function public._bw_add(p_sheet jsonb, p_frame integer, p_mask integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_sheet jsonb := coalesce(p_sheet, '[]'::jsonb);
begin
  while jsonb_array_length(v_sheet) < p_frame loop
    v_sheet := v_sheet || '[[]]'::jsonb;
  end loop;
  return jsonb_set(v_sheet, array[(p_frame - 1)::text],
                   (v_sheet->(p_frame - 1)) || to_jsonb(p_mask));
end $$;

-- Complète une feuille avec des lancers à 0 (fin forcée).
create or replace function public._bw_fill(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_sheet jsonb := coalesce(p_sheet, '[]'::jsonb);
  v_next jsonb;
begin
  loop
    v_next := public._bw_next(v_sheet, p_n);
    exit when v_next is null;
    v_sheet := public._bw_add(v_sheet, (v_next->>'frame')::integer, 0);
  end loop;
  return v_sheet;
end $$;

-- Score officiel : {total (bonus non joués = 0), cum: [cumul | null par frame]}.
create or replace function public._bw_score(p_sheet jsonb, p_n integer)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_flat    integer[] := '{}';
  v_start   integer[] := '{}';
  v_counts  integer[];
  v_frame   jsonb;
  f         integer;
  i         integer;
  v_len     integer;
  v_score   integer;
  v_partial integer;
  v_running integer := 0;
  v_total   integer := 0;
  v_broken  boolean := false;
  v_cum     jsonb := '[]'::jsonb;
  m         jsonb;
begin
  for f in 0 .. p_n - 1 loop
    v_start := v_start || (cardinality(v_flat) + 1);  -- index 1-based dans v_flat
    for m in select value from jsonb_array_elements(coalesce(p_sheet->f, '[]'::jsonb)) loop
      v_flat := v_flat || public._bw_count((m #>> '{}')::integer);
    end loop;
  end loop;

  for f in 0 .. p_n - 1 loop
    v_frame := coalesce(p_sheet->f, '[]'::jsonb);
    v_len := jsonb_array_length(v_frame);
    i := v_start[f + 1];
    v_counts := v_flat[i : i + v_len - 1];
    v_partial := coalesce((select sum(x) from unnest(v_counts) x), 0);
    v_score := null;
    if f < p_n - 1 then
      if v_len >= 1 and v_counts[1] = 10 then
        v_partial := 10 + coalesce(v_flat[i + 1], 0) + coalesce(v_flat[i + 2], 0);
        if v_flat[i + 1] is not null and v_flat[i + 2] is not null then v_score := v_partial; end if;
      elsif v_len >= 2 and v_counts[1] + v_counts[2] = 10 then
        v_partial := 10 + coalesce(v_flat[i + 2], 0);
        if v_flat[i + 2] is not null then v_score := v_partial; end if;
      elsif v_len >= 2 then
        v_score := v_partial;
      end if;
    elsif public._bw_frame_complete(v_frame, true) then
      v_score := v_partial;
    end if;
    v_total := v_total + v_partial;
    if v_score is null then v_broken := true; end if;
    if not v_broken then
      v_running := v_running + v_score;
      v_cum := v_cum || to_jsonb(v_running);
    else
      v_cum := v_cum || 'null'::jsonb;
    end if;
  end loop;
  return jsonb_build_object('total', v_total, 'cum', v_cum);
end $$;

-- Recalcule scores / cumuls / prochain lancer / joueurs finis.
create or replace function public._bw_refresh(p_state jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_n      integer := (p_state->>'frames')::integer;
  pl       text;
  v_sheet  jsonb;
  v_sc     jsonb;
  v_next   jsonb;
  v_scores jsonb := '{}'::jsonb;
  v_cum    jsonb := '{}'::jsonb;
  v_nexts  jsonb := '{}'::jsonb;
  v_done   jsonb := '[]'::jsonb;
begin
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    v_sheet := coalesce(p_state->'sheets'->pl, '[]'::jsonb);
    v_sc := public._bw_score(v_sheet, v_n);
    v_next := public._bw_next(v_sheet, v_n);
    v_scores := v_scores || jsonb_build_object(pl, v_sc->'total');
    v_cum := v_cum || jsonb_build_object(pl, v_sc->'cum');
    v_nexts := v_nexts || jsonb_build_object(pl, coalesce(v_next, 'null'::jsonb));
    if v_next is null then v_done := v_done || to_jsonb(pl); end if;
  end loop;
  return p_state || jsonb_build_object('scores', v_scores, 'cum', v_cum, 'next', v_nexts, 'done', v_done);
end $$;

-- Stats de fin de partie pour les trophées (features/trophees.sql). p_sheet = feuille COMPLÉTÉE,
-- p_raw = feuille brute (gouttières : seuls les vrais lancers comptent, pas les 0 de remplissage).
create or replace function public._bw_tstats(p_sheet jsonb, p_n integer, p_raw jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  f int; fr jsonb; c1 int; c2 int; c3 int; len int; l boolean;
  v_strikes int := 0; v_spares int := 0; v_one int := 0; v_resc int := 0; v_gut int := 0;
  v_clean boolean := true; v_run int := 0; v_best int := 0; v_ev int[] := '{}'; e int;
begin
  for f in 0 .. p_n - 1 loop
    fr := coalesce(p_sheet->f, '[]'::jsonb);
    len := jsonb_array_length(fr);
    c1 := case when len >= 1 then public._bw_count((fr->>0)::integer) end;
    c2 := case when len >= 2 then public._bw_count((fr->>1)::integer) end;
    c3 := case when len >= 3 then public._bw_count((fr->>2)::integer) end;
    l := f = p_n - 1;
    if c1 is null then v_clean := false; v_ev := v_ev || 0; continue; end if;
    if not l then
      if c1 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1;
      else
        v_ev := v_ev || 0;
        if coalesce(c1 + c2, 0) = 10 then v_spares := v_spares + 1; if c1 = 0 then v_resc := v_resc + 1; end if;
        else v_clean := false; if coalesce(c1 + c2, 0) = 9 then v_one := v_one + 1; end if;
        end if;
      end if;
    else
      if c1 = 10 then
        v_strikes := v_strikes + 1; v_ev := v_ev || 1;
        if c2 = 10 then
          v_strikes := v_strikes + 1; v_ev := v_ev || 1;
          if c3 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1; else v_ev := v_ev || 0; end if;
        else
          v_ev := v_ev || 0;
          if coalesce(c2 + c3, 0) = 10 then v_spares := v_spares + 1; end if;
        end if;
      else
        v_ev := v_ev || 0;
        if coalesce(c1 + c2, 0) = 10 then
          v_spares := v_spares + 1; if c1 = 0 then v_resc := v_resc + 1; end if;
          if c3 = 10 then v_strikes := v_strikes + 1; v_ev := v_ev || 1; else v_ev := v_ev || 0; end if;
        else
          v_clean := false; if coalesce(c1 + c2, 0) = 9 then v_one := v_one + 1; end if;
        end if;
      end if;
    end if;
  end loop;
  foreach e in array v_ev loop
    v_run := case when e = 1 then v_run + 1 else 0 end;
    v_best := greatest(v_best, v_run);
  end loop;
  -- gouttières : lancers réellement joués à 0 quille
  select count(*) into v_gut
    from jsonb_array_elements(coalesce(p_raw, '[]'::jsonb)) fx, jsonb_array_elements(fx) m
   where public._bw_count((m #>> '{}')::integer) = 0;
  return jsonb_build_object('strikes', v_strikes, 'spares', v_spares, 'one_left', v_one, 'rescues', v_resc,
                            'gutters', v_gut, 'strike_run', v_best,
                            'clean', case when v_clean and p_n >= 5 then 1 else 0 end);
end $$;

-- Fin de partie : feuilles complétées par des 0, classement, résultats.
-- points = round(score / 30) (300 -> 10 pts -> 100 XP) ; gagnant(s) = meilleur
-- score (ex-aequo inclus), à condition d'avoir marqué au moins 1 quille.
create or replace function public._bw_finish(p_state jsonb, p_server jsonb, p_forced boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := (p_state->>'frames')::integer;
  v_sheets  jsonb := '{}'::jsonb;
  pl        text;
  v_max     integer;
  v_results jsonb;
  v_winners jsonb;
  v_raw     jsonb := coalesce(p_state->'sheets', '{}'::jsonb);
begin
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    v_sheets := v_sheets || jsonb_build_object(pl, public._bw_fill(p_state->'sheets'->pl, v_n));
  end loop;
  p_state := public._bw_refresh(p_state || jsonb_build_object('sheets', v_sheets));

  select coalesce(max(value::integer), 0) into v_max from jsonb_each_text(p_state->'scores');

  select jsonb_agg(jsonb_build_object(
           'profile_id', t.key,
           'points', round(t.value::integer / 30.0)::integer,
           'won', v_max > 0 and t.value::integer = v_max,
           'placement', t.r,
           'stats', jsonb_build_object('score', t.value::integer, 'frames', v_n)
                    || public._bw_tstats(p_state->'sheets'->t.key, v_n, v_raw->t.key))
         order by t.r, t.key)
    into v_results
    from (select key, value, rank() over (order by value::integer desc) as r
            from jsonb_each_text(p_state->'scores')) t;

  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_winners
    from jsonb_each_text(p_state->'scores') where v_max > 0 and value::integer = v_max;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'forced', p_forced,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Options : {"frames": 3|5|10 (défaut 5), "time_limit": 0|5|10|15|20 minutes (0 = sans limite)}
create or replace function public.game_bowling_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_frames integer;
  v_limit  integer;
  v_empty  jsonb;
  v_state  jsonb;
begin
  -- 2 joueurs minimum : en solo, la victoire serait automatique (tenue Bowler « farmable »).
  if coalesce(cardinality(p_players), 0) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;

  v_frames := case when coalesce(p_options->>'frames', '') ~ '^\d{1,2}$'
                   then (p_options->>'frames')::integer else 5 end;
  if v_frames not in (3, 5, 10) then v_frames := 5; end if;
  v_limit := case when coalesce(p_options->>'time_limit', '') ~ '^\d{1,2}$'
                  then (p_options->>'time_limit')::integer else 0 end;
  if v_limit not in (0, 5, 10, 15, 20) then v_limit := 0; end if;

  select jsonb_object_agg(p::text, '[]'::jsonb) into v_empty from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'bowling',
    'phase', 'playing',
    'players', to_jsonb(p_players),
    'frames', v_frames,
    'time_limit', v_limit,
    'started_at', now(),
    'deadline', case when v_limit > 0 then to_jsonb(now() + make_interval(mins => v_limit)) else 'null'::jsonb end,
    'sheets', v_empty,
    'last_roll', null,
    'forced', false,
    'winners', null,
    'results', null);

  return jsonb_build_object('state', public._bw_refresh(v_state), 'server', '{}'::jsonb, 'secrets', '{}'::jsonb);
end $$;

create or replace function public.game_bowling_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type    text := p_action->>'type';
  v_phase   text := p_state->>'phase';
  v_me      text := p_actor::text;
  v_n       integer := (p_state->>'frames')::integer;
  v_frame   integer;
  v_roll    integer;
  v_mask    integer;
  v_sheet   jsonb;
  v_prev    jsonb;
  v_next    jsonb;
  v_stand   integer;
  v_cnt     integer;
  v_kind    text;
  v_late    boolean := p_state->>'deadline' is not null
                       and now() >= (p_state->>'deadline')::timestamptz;
begin
  -- ---------------------------------------------------------------- roll
  if v_type = 'roll' then
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if jsonb_typeof(p_action->'frame') is distinct from 'number'
       or jsonb_typeof(p_action->'roll') is distinct from 'number'
       or jsonb_typeof(p_action->'pins_down_mask') is distinct from 'number'
       or (p_action->>'frame') !~ '^\d{1,2}$' or (p_action->>'roll') !~ '^\d$' then
      raise exception 'invalid_action';
    end if;
    if (p_action->>'pins_down_mask') !~ '^\d{1,4}$' then raise exception 'invalid_roll'; end if;
    v_frame := (p_action->>'frame')::integer;
    v_roll  := (p_action->>'roll')::integer;
    v_mask  := (p_action->>'pins_down_mask')::integer;
    if v_mask > 1023 then raise exception 'invalid_roll'; end if;

    -- Échéance globale dépassée (tolérance réseau 3 s) : fin de partie, lancer ignoré.
    if v_late and now() > (p_state->>'deadline')::timestamptz + interval '3 seconds' then
      return public._bw_finish(p_state, p_server, true);
    end if;

    v_sheet := coalesce(p_state->'sheets'->v_me, '[]'::jsonb);
    v_prev := v_sheet->(v_frame - 1)->(v_roll - 1);
    if v_frame >= 1 and v_roll >= 1 and v_prev is not null then
      -- Renvoi du même lancer (réseau) : idempotent ; sinon réécriture interdite.
      if (v_prev #>> '{}')::integer = v_mask then
        return jsonb_build_object('state', p_state, 'server', p_server);
      end if;
      raise exception 'wrong_roll';
    end if;
    v_next := public._bw_next(v_sheet, v_n);
    if v_next is null then raise exception 'already_done'; end if;
    if (v_next->>'frame')::integer <> v_frame or (v_next->>'roll')::integer <> v_roll then
      raise exception 'wrong_roll';
    end if;
    v_stand := (v_next->>'standing')::integer;
    if (v_mask & ~v_stand & 1023) <> 0 then raise exception 'invalid_roll'; end if;

    v_cnt := public._bw_count(v_mask);
    v_kind := case when v_cnt = 0 then 'zero'
                   when v_stand = 1023 and v_cnt = 10 then 'strike'
                   when v_stand <> 1023 and v_mask = v_stand then 'spare'
                   else 'normal' end;

    p_state := jsonb_set(p_state, array['sheets', v_me], public._bw_add(v_sheet, v_frame, v_mask), true);
    p_state := public._bw_refresh(p_state) || jsonb_build_object('last_roll', jsonb_build_object(
      'player', v_me, 'frame', v_frame, 'roll', v_roll, 'mask', v_mask, 'pins', v_cnt,
      'kind', v_kind, 'at', now()));

    if jsonb_array_length(p_state->'done') >= jsonb_array_length(p_state->'players') then
      return public._bw_finish(p_state, p_server, false);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_phase = 'playing' and v_late then
      return public._bw_finish(p_state, p_server, true);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- end_game
  elsif v_type = 'end_game' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'playing' then raise exception 'wrong_phase'; end if;
    return public._bw_finish(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._bw_count(integer) from public, anon, authenticated;
revoke all on function public._bw_frame_complete(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_standing(jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_next(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_add(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public._bw_fill(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_score(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bw_refresh(jsonb) from public, anon, authenticated;
revoke all on function public._bw_finish(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._bw_tstats(jsonb, integer, jsonb) from public, anon, authenticated;
revoke all on function public.game_bowling_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_bowling_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\cerveau-en-fete.sql =====
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


-- ===== games\dede-kart.sql =====
-- =============================================================================
-- JEU « dede-kart » (Dédé Kart, course de karts 3D, tout le monde en même temps) — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
--
-- Chaque téléphone simule SON kart (l'hôte simule aussi les bots) et diffuse sa
-- position en broadcast `kart:<matchId>` (jamais en base). Le serveur ne reçoit
-- qu'une action par TOUR BOUCLÉ : {"type":"lap","lap":n} (+ "bot":"botK" envoyé
-- par l'hôte pour ses bots). Il vérifie l'ordre des tours et un temps minimum par
-- tour (anti-triche minimal, jeu entre amis), puis classe et compte les points.
--
-- Phases : racing (go_at = feu vert) -> results (classement de la course, 15 s)
--          -> racing (course suivante) ... -> finished.
-- Course terminée : tous arrivés, 45 s après le 1er arrivé, ou échéance de sécurité.
--
-- 6 circuits (ordre de src/games/dede-kart/tracks.ts) : 0 Salon, 1 Plage, 2 Montagne,
-- 3 Potager, 4 Supermarché, 5 Château. La course n joue le circuit (track0 + n - 1) % 6,
-- track0 = option "track" (0..5) ou tiré au hasard.
-- =============================================================================

-- Temps minimum d'un tour (ms) par circuit : (longueur du tour - gain du raccourci) parcourue
-- à la vitesse d'un turbo permanent, moins 10 % (un très bon tour réel dure 45 à 55 s).
create or replace function public._dk_min_lap_ms(p_track integer)
returns integer language sql immutable
set search_path = public, extensions
as $$ select (array[31000, 34000, 34000, 31000, 33000, 32000])[coalesce(p_track, 0) % 6 + 1] $$;

-- Tous les karts : joueurs puis bots.
create or replace function public._dk_racers(p_state jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select coalesce(p_state->'players', '[]'::jsonb) || coalesce(p_state->'bots', '[]'::jsonb) $$;

-- Lance la course n° p_race (feu vert dans p_delay secondes).
create or replace function public._dk_new_race(p_state jsonb, p_race integer, p_delay integer)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_go timestamptz := now() + make_interval(secs => p_delay);
begin
  return p_state || jsonb_build_object(
    'phase', 'racing',
    'race', p_race,
    'round', p_race,
    'track', (coalesce((p_state->>'track0')::integer, 0) + p_race - 1) % 6,
    'go_at', v_go,
    'deadline', v_go + make_interval(secs => 60 + 75 * (p_state->>'laps')::integer),
    'laps_done', '{}'::jsonb,
    'lap_at', '{}'::jsonb,
    'finish', '{}'::jsonb,
    'arrival', '[]'::jsonb,
    'hazards', '[]'::jsonb,
    'fx', '[]'::jsonb);
end $$;

-- Auteur d'une action : le joueur, ou un bot (champ "bot"). Les bots sont conduits par
-- le premier joueur présent (cf. Play.tsx) : n'importe quel joueur (ou l'hôte) peut agir pour eux.
create or replace function public._dk_actor(p_state jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns text language plpgsql stable
set search_path = public, extensions
as $$
begin
  if p_action ? 'bot' then
    if not (p_is_host or (p_state->'players') ? p_actor::text) then raise exception 'not_a_player'; end if;
    if not ((p_state->'bots') ? (p_action->>'bot')) then raise exception 'invalid_action'; end if;
    return p_action->>'bot';
  end if;
  if not ((p_state->'players') ? p_actor::text) then raise exception 'not_a_player'; end if;
  return p_actor::text;
end $$;

-- Retire boules (> 6 s), pièges posés (glue, beurre, poule : > 30 s) et effets expirés.
create or replace function public._dk_prune(p_state jsonb)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select p_state || jsonb_build_object(
    'hazards', coalesce((select jsonb_agg(h) from jsonb_array_elements(p_state->'hazards') h
                          where (h->>'at')::timestamptz > now() - case when h->>'type' = 'ball'
                                                                       then interval '6 seconds' else interval '30 seconds' end),
                        '[]'::jsonb),
    'fx', coalesce((select jsonb_agg(f) from jsonb_array_elements(p_state->'fx') f
                     where (f->>'until')::timestamptz > now()), '[]'::jsonb))
$$;

-- Coordonnée envoyée par le client : nombre raisonnable, sinon erreur.
create or replace function public._dk_num(p_v jsonb)
returns numeric language plpgsql immutable
set search_path = public, extensions
as $$
begin
  if p_v is null or jsonb_typeof(p_v) <> 'number' or abs(p_v::text::numeric) > 5000 then
    raise exception 'invalid_action';
  end if;
  return round(p_v::text::numeric, 2);
end $$;

-- Stats de fin de coupe pour les trophées (features/trophees.sql), lues dans standings[] et hits.
-- « karts » = joueurs + bots présents dans la course.
create or replace function public._dk_tstats(p_state jsonb, p_pl text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  with s as (
    select e.o, (e.v->>'track')::integer as track, e.v->'places' as pl, jsonb_array_length(e.v->'places') as nk,
           (select x from jsonb_array_elements(e.v->'places') x where x->>'id' = p_pl limit 1) as me
      from jsonb_array_elements(coalesce(p_state->'standings', '[]'::jsonb)) with ordinality as e(v, o)
  ), x as (
    select s.o, s.track, s.nk, s.me, (s.me->>'place')::integer as place, (s.me->>'time')::integer as t,
           (select (y->>'time')::integer from jsonb_array_elements(s.pl) y where (y->>'place')::integer = 2 limit 1) as t2
      from s where s.me is not null
  )
  select jsonb_build_object(
    'last_races', count(*) filter (where nk >= 4 and place = nk),
    'dnf', count(*) filter (where me->>'time' is null),
    'podiums', count(*) filter (where nk >= 4 and place <= 3),
    'hits', coalesce((p_state->'hits'->>p_pl)::integer, 0),
    'hits_taken', coalesce((p_state->'taken'->>p_pl)::integer, 0),
    'used_cloud', coalesce((p_state->'used'->p_pl->>'cloud')::integer, 0),
    'used_confetti', coalesce((p_state->'used'->p_pl->>'confetti')::integer, 0),
    'used_reverse', coalesce((p_state->'used'->p_pl->>'reverse')::integer, 0),
    'win_track_1', count(*) filter (where place = 1 and track = 0),
    'win_track_2', count(*) filter (where place = 1 and track = 1),
    'win_track_3', count(*) filter (where place = 1 and track = 2),
    'win_track_4', count(*) filter (where place = 1 and track = 3),
    'win_track_5', count(*) filter (where place = 1 and track = 4),
    'win_track_6', count(*) filter (where place = 1 and track = 5),
    'comeback', (select count(*) from x a join x b on b.o = a.o - 1 where a.place = 1 and b.place > 3),
    'big_lead', count(*) filter (where place = 1 and t is not null and (t2 is null or t2 - t >= 5000)),
    'grand_slam', case when count(*) >= 3 and count(*) filter (where place = 1) = count(*) and max(nk) >= 4 then 1 else 0 end)
  from x
$$;

-- Fin de la coupe : points finaux = total / nombre de courses (arrondi), classement des joueurs.
create or replace function public._dk_finish(p_state jsonb, p_server jsonb, p_forced boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_runs    integer := greatest(1, jsonb_array_length(coalesce(p_state->'standings', '[]'::jsonb)));
  v_last    jsonb := coalesce(p_state->'standings'->-1->'places', '[]'::jsonb);
  v_results jsonb;
  v_winners jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'profile_id', t.pid,
           'points', round(t.tot::numeric / v_runs)::integer,
           'won', t.rk = 1 and t.tot > 0,
           'placement', t.rk,
           'stats', public._dk_tstats(p_state, t.pid))
         order by t.rk, t.pid)
    into v_results
    from (select x.pid, x.tot,
                 rank() over (order by x.tot desc, x.lastp asc) as rk
            from (select pl as pid,
                         coalesce((p_state->'points'->>pl)::integer, 0) as tot,
                         coalesce((select (e->>'place')::integer from jsonb_array_elements(v_last) e
                                    where e->>'id' = pl), 99) as lastp
                    from jsonb_array_elements_text(p_state->'players') pl) x) t;

  select coalesce(jsonb_agg(r->>'profile_id'), '[]'::jsonb) into v_winners
    from jsonb_array_elements(v_results) r where (r->>'won')::boolean;

  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null, 'forced', p_forced,
                                           'winners', v_winners, 'results', v_results);
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
end $$;

-- Fin d'une course : classement (arrivés au temps, puis tours bouclés), points, suite ou fin.
create or replace function public._dk_end_race(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_pts    integer[] := array[15, 12, 10, 8, 7, 6, 5, 4, 3, 2, 1, 0];
  v_places jsonb;
  v_points jsonb := coalesce(p_state->'points', '{}'::jsonb);
  e        jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', t.rid, 'place', t.rk, 'pts', coalesce(v_pts[t.rk], 0),
                                               'time', t.fin, 'laps', t.done) order by t.rk), '[]'::jsonb)
    into v_places
    from (select r.rid, r.fin, r.done,
                 row_number() over (order by r.fin asc nulls last, r.done desc, r.lat asc nulls last, r.rid) as rk
            from (select x as rid,
                         (p_state->'finish'->>x)::integer as fin,
                         coalesce((p_state->'laps_done'->>x)::integer, 0) as done,
                         (p_state->'lap_at'->>x)::timestamptz as lat
                    from jsonb_array_elements_text(public._dk_racers(p_state)) x) r) t;

  for e in select value from jsonb_array_elements(v_places) loop
    v_points := v_points || jsonb_build_object(e->>'id',
                  coalesce((v_points->>(e->>'id'))::integer, 0) + (e->>'pts')::integer);
  end loop;

  p_state := p_state || jsonb_build_object(
    'points', v_points,
    'standings', coalesce(p_state->'standings', '[]'::jsonb)
                 || jsonb_build_array(jsonb_build_object('race', p_state->'race', 'track', p_state->'track', 'places', v_places)));

  if (p_state->>'race')::integer >= (p_state->>'races')::integer then
    return public._dk_finish(p_state, p_server, false);
  end if;
  p_state := p_state || jsonb_build_object('phase', 'results', 'deadline', now() + interval '15 seconds');
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Options : {"races": 1|3 (défaut 3), "laps": 2|3 (défaut 3), "fill": 0|6|8|12 (bots pour compléter la grille),
--            "track": 0..5 (1er circuit ; absent ou autre valeur = tiré au hasard)}
create or replace function public.game_dede_kart_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n     integer := coalesce(cardinality(p_players), 0);
  v_races integer := case when p_options->>'races' = '1' then 1 else 3 end;
  v_laps  integer := case when p_options->>'laps' = '2' then 2 else 3 end;
  v_fill  integer := case when coalesce(p_options->>'fill', '') ~ '^\d{1,2}$' then (p_options->>'fill')::integer else 0 end;
  v_track integer := case when coalesce(p_options->>'track', '') ~ '^[0-5]$' then (p_options->>'track')::integer
                          else floor(random() * 6)::integer end;
  v_bots  jsonb;
  v_state jsonb;
begin
  if v_n < 2 then raise exception 'not_enough_players'; end if;
  if v_n > 12 then raise exception 'too_many_players'; end if;
  if v_fill not in (0, 6, 8, 12) then v_fill := 0; end if;

  select coalesce(jsonb_agg('bot' || g order by g), '[]'::jsonb) into v_bots
    from generate_series(1, greatest(0, v_fill - v_n)) g;

  v_state := jsonb_build_object(
    'game', 'dede-kart',
    'players', to_jsonb(p_players),
    'bots', v_bots,
    'laps', v_laps,
    'races', v_races,
    'total_rounds', v_races,
    'track0', v_track,
    'points', '{}'::jsonb,
    'standings', '[]'::jsonb,
    'hits', '{}'::jsonb,
    'hz_seq', 0,
    'forced', false,
    'winners', null,
    'results', null);
  -- 8 s : le temps que tous les téléphones chargent la 3D
  return jsonb_build_object('state', public._dk_new_race(v_state, 1, 8), 'server', '{}'::jsonb, 'secrets', '{}'::jsonb);
end $$;

create or replace function public.game_dede_kart_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type  text := p_action->>'type';
  v_phase text := p_state->>'phase';
  v_id    text;
  v_lap   integer;
  v_done  integer;
  v_prev  timestamptz;
  v_item  text;
  v_seq   integer;
  v_target text;
  v_owner text;
  v_late  boolean := p_state->>'deadline' is not null and now() >= (p_state->>'deadline')::timestamptz;
begin
  -- ---------------------------------------------------------------- lap
  if v_type = 'lap' then
    -- tour arrivé après la fin de la course : ignoré sans erreur
    if v_phase <> 'racing' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    if v_late then return public._dk_end_race(p_state, p_server); end if;
    if now() < (p_state->>'go_at')::timestamptz then raise exception 'too_early'; end if;
    v_id := public._dk_actor(p_state, p_actor, p_is_host, p_action);
    if coalesce(p_action->>'lap', '') !~ '^\d{1,2}$' then raise exception 'invalid_action'; end if;
    v_lap := (p_action->>'lap')::integer;
    v_done := coalesce((p_state->'laps_done'->>v_id)::integer, 0);
    -- doublon (réseau) ou déjà arrivé : ignoré
    if v_lap <= v_done or (p_state->'finish') ? v_id then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    if v_lap <> v_done + 1 then
      -- bot repris par un autre téléphone : compteur décalé, ignoré sans erreur
      if p_action ? 'bot' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
      raise exception 'wrong_lap';
    end if;
    v_prev := coalesce((p_state->'lap_at'->>v_id)::timestamptz, (p_state->>'go_at')::timestamptz);
    if now() - v_prev < make_interval(secs => public._dk_min_lap_ms((p_state->>'track')::integer) / 1000.0) then
      raise exception 'too_fast';
    end if;

    p_state := p_state || jsonb_build_object(
      'laps_done', p_state->'laps_done' || jsonb_build_object(v_id, v_lap),
      'lap_at', p_state->'lap_at' || jsonb_build_object(v_id, now()));
    if v_lap >= (p_state->>'laps')::integer then
      p_state := p_state || jsonb_build_object(
        'finish', p_state->'finish' || jsonb_build_object(v_id,
                    floor(extract(epoch from now() - (p_state->>'go_at')::timestamptz) * 1000)::integer),
        'arrival', p_state->'arrival' || to_jsonb(v_id));
      if jsonb_array_length(p_state->'arrival') = 1 then
        p_state := p_state || jsonb_build_object('deadline',
                     least((p_state->>'deadline')::timestamptz, now() + interval '45 seconds'));
      end if;
      if jsonb_array_length(p_state->'arrival') >= jsonb_array_length(public._dk_racers(p_state)) then
        return public._dk_end_race(p_state, p_server);
      end if;
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- use (objet qui touche les autres)
  -- Le tirage se fait sur le téléphone (jeu entre amis) : le serveur pose le piège /
  -- le projectile, ou les effets sur les cibles, pour que tout le monde voie la même chose.
  elsif v_type = 'use' then
    if v_phase <> 'racing' or now() < (p_state->>'go_at')::timestamptz then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    v_id := public._dk_actor(p_state, p_actor, p_is_host, p_action);
    v_item := p_action->>'item';
    if v_item is null or v_item not in ('ball', 'glue', 'butter', 'hen', 'cloud', 'confetti', 'reverse', 'honk') then
      raise exception 'invalid_action';
    end if;
    if (p_state->'finish') ? v_id then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    p_state := public._dk_prune(p_state);
    v_seq := coalesce((p_state->>'hz_seq')::integer, 0);
    if v_item in ('ball', 'glue', 'butter', 'hen') then
      v_seq := v_seq + 1;
      p_state := p_state || jsonb_build_object('hazards', p_state->'hazards' || jsonb_build_array(jsonb_build_object(
        'id', v_seq, 'type', v_item, 'owner', v_id,
        'x', public._dk_num(p_action->'x'), 'z', public._dk_num(p_action->'z'), 'h', public._dk_num(p_action->'h'),
        'at', now())));
    else
      if jsonb_typeof(p_action->'targets') <> 'array' then raise exception 'invalid_action'; end if;
      -- Trophées (Coups bas) : objets nuage / confettis / demi-tour (/ klaxon) utilisés
      p_state := p_state || jsonb_build_object('used', coalesce(p_state->'used', '{}'::jsonb) || jsonb_build_object(v_id,
        coalesce(p_state->'used'->v_id, '{}'::jsonb) || jsonb_build_object(v_item,
          coalesce((p_state->'used'->v_id->>v_item)::integer, 0) + 1)));
      for v_target in
        select distinct t from jsonb_array_elements_text(p_action->'targets') t
         where public._dk_racers(p_state) ? t and t <> v_id limit 11
      loop
        v_seq := v_seq + 1;
        p_state := p_state || jsonb_build_object('fx', p_state->'fx' || jsonb_build_array(jsonb_build_object(
          'id', v_seq, 'type', v_item, 'target', v_target, 'by', v_id, 'until', now() + interval '3 seconds')));
      end loop;
    end if;
    return jsonb_build_object('state', p_state || jsonb_build_object('hz_seq', v_seq), 'server', p_server);

  -- ---------------------------------------------------------------- hit (un kart a percuté une boule / une glue / du beurre / une poule)
  elsif v_type = 'hit' then
    if v_phase <> 'racing' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    v_id := public._dk_actor(p_state, p_actor, p_is_host, p_action);
    if coalesce(p_action->>'hazard', '') !~ '^\d{1,6}$' then raise exception 'invalid_action'; end if;
    select h->>'owner' into v_owner from jsonb_array_elements(p_state->'hazards') h
     where (h->>'id')::integer = (p_action->>'hazard')::integer;
    -- déjà retiré (deux karts dans la même flaque) : ignoré
    if v_owner is null then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    p_state := p_state || jsonb_build_object(
      'hazards', coalesce((select jsonb_agg(h) from jsonb_array_elements(p_state->'hazards') h
                            where (h->>'id')::integer <> (p_action->>'hazard')::integer), '[]'::jsonb));
    -- Trophées (Tête-à-queue) : touches subies par la victime
    p_state := p_state || jsonb_build_object('taken', coalesce(p_state->'taken', '{}'::jsonb)
                 || jsonb_build_object(v_id, coalesce((p_state->'taken'->>v_id)::integer, 0) + 1));
    if v_owner <> v_id then
      p_state := p_state || jsonb_build_object('hits', coalesce(p_state->'hits', '{}'::jsonb)
                   || jsonb_build_object(v_owner, coalesce((p_state->'hits'->>v_owner)::integer, 0) + 1));
    end if;
    return jsonb_build_object('state', public._dk_prune(p_state), 'server', p_server);

  -- ---------------------------------------------------------------- tick
  elsif v_type = 'tick' then
    if v_late and v_phase = 'racing' then return public._dk_end_race(p_state, p_server); end if;
    if v_late and v_phase = 'results' then
      return jsonb_build_object('state', public._dk_new_race(p_state, (p_state->>'race')::integer + 1, 6), 'server', p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- next (hôte, sans attendre)
  elsif v_type = 'next' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase <> 'results' then return jsonb_build_object('state', p_state, 'server', p_server); end if;
    return jsonb_build_object('state', public._dk_new_race(p_state, (p_state->>'race')::integer + 1, 6), 'server', p_server);

  -- ---------------------------------------------------------------- end_game (hôte)
  elsif v_type = 'end_game' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase not in ('racing', 'results') then raise exception 'wrong_phase'; end if;
    return public._dk_finish(p_state, p_server, true);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._dk_min_lap_ms(integer) from public, anon, authenticated;
revoke all on function public._dk_racers(jsonb) from public, anon, authenticated;
revoke all on function public._dk_actor(jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
revoke all on function public._dk_prune(jsonb) from public, anon, authenticated;
revoke all on function public._dk_num(jsonb) from public, anon, authenticated;
revoke all on function public._dk_new_race(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public._dk_finish(jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._dk_tstats(jsonb, text) from public, anon, authenticated;
revoke all on function public._dk_end_race(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_dede_kart_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_dede_kart_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


-- ===== games\dede-party.sql =====
-- =============================================================================
-- JEU « dede-party » (Dédé Party, 5 plateaux) — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
-- Conception : docs/superpowers/specs/2026-11-19-dede-party-design.md (section « Décisions ») et
-- docs/superpowers/specs/2026-11-20-dede-party-plateaux-design.md (les 5 plateaux) et
-- docs/superpowers/specs/2026-11-20-dede-party-grands-plateaux-design.md (tailles S / M / L selon le nombre de
-- joueurs : quartiers, portes « un pion sur deux », transports, haltes, étoiles par zone, départs répartis).
--
-- Party game de plateau sur l'un des 5 plateaux (state.map) : grand (Le Grand Plateau, aiguillages qui
-- basculent), mer (Dédé-sur-Mer, la marée), kermesse (la Tombola), camping (Riton le raton), ski (Dédé 2000,
-- télésièges et verglas). 1 à 3 étoiles en jeu selon le nombre de joueurs (30 pièces, la première de chacun
-- à 15), un mini-jeu à chaque tour. Tout le monde lance ses 2 dés EN MÊME TEMPS ; le serveur résout tout le
-- tour d'un coup (scénario `moves` + épilogue `epi`, que les écrans ne font qu'animer). Aucune décision sur
-- le plateau : toutes les mécaniques sont automatiques.
--
-- Phases (toutes enchaînées par `deadline` + {"type":"tick"} idempotent, l'hôte n'a rien à cliquer) :
--   intro (8 s) -> roll (15 s) -> move (2 + 5 s × joueurs, + 4 s d'épilogue) -> mg_intro (8 s) -> mg_play
--   (selon le mini-jeu) -> mg_result (8 s) -> roll … -> awards (12 s, étoiles bonus) -> finished.
-- Actions : roll {double?} · mg_submit {no, payload} · tick · skip (hôte) · end_game (hôte).
-- `server` (jamais exposé) : questions et réponses, sac de mini-jeux, pioche de cartes, envois
-- des joueurs avant résultat ; `forced_dice` / `forced_cards` / `forced_mg` pour les tests.
-- =============================================================================

-- Constantes d'équilibrage (simulation : tools/sql-tests/dede-party.mjs).
create or replace function public._dp_const()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '{"dice":2,"star_count":[1,2,2,2,2,3,3],"star_price":30,"half_price":15,"start_coins":10,"start_bonus":5,"clap":3,"pub":3,"gains":[10,6,4,2],"roll_s":15,"move_s":5,"intro_s":8,"intro_m":10,"intro_l":12,"mg_intro_s":10,"mg_result_s":8,"awards_s":12,"star_cap":30,"chrono_target":7000,"epi_s":4,"tide_low":2,"tide_high":1,"wash":5,"toll":3,"pot_seed":5,"riton_steal":5}'::jsonb $$;

-- Les plateaux sans paramètre (un seul plateau) disparaissent : tout prend désormais le plateau en paramètre.
drop function if exists public._dp_board();
drop function if exists public._dp_next();
drop function if exists public._dp_prev();

-- Les 5 plateaux, dans l'ordre de leur numéro (stat map_no).
create or replace function public._dp_maps()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '["grand","mer","kermesse","camping","ski"]'::jsonb $$;

-- >>> tracés des plateaux : généré par tools/dede-party/write-sizes.mjs (S : boards/<id>.ts ; M / L : grands-plateaux-sim.mjs), ne pas éditer à la main.
-- Tailles servies par plateau (spec grands plateaux §1.1 et §8).
create or replace function public._dp_sizes()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '{"grand":["s","m"],"mer":["s","m","l"],"kermesse":["s","m"],"camping":["s","m"],"ski":["s","m","l"]}'::jsonb $$;

-- Clé « plateau:taille » d'un tracé : plateau absent ou inconnu → grand (parties lancées avant les 5 plateaux) ;
-- taille absente, inconnue ou que le plateau n'a pas → s (parties lancées avant les grandes tailles).
create or replace function public._dp_key(p_map text, p_size text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select m || ':' || case when coalesce(public._dp_sizes()->m, '[]'::jsonb) ? coalesce(p_size, '') then p_size else 's' end
    from (select case when public._dp_maps() ? coalesce(p_map, '') then p_map else 'grand' end m) x
$$;

-- Type de chaque case (index 0 = Départ) du plateau p_map à la taille p_size. Dupliqué avec CELLS / CELLS_M / CELLS_L
-- de src/games/dede-party/boards/<id>.ts : synchro vérifiée par tools/sql-tests/dede-party.mjs.
create or replace function public._dp_board(p_map text, p_size text default 's')
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select case public._dp_key(p_map, p_size)
  when 'grand:m' then '["start","clap","pub","loge","clap","env","clap","loge","pub","clap","env","loge","clap","clap","pub","clap","env","loge","clap","pub","loge","clap","env","clap","clap","clap","env","loge","clap","pub","loge","clap","env","loge","pub","clap","clap","env","loge","clap","clap","pub","clap","pub","env","pub","clap","clap","clap","loge","clap","env","clap","pub","clap","loge","clap","env","clap","clap","clap","loge","clap","env","clap","pub","clap","loge","clap","env","clap","clap","clap","clap","env","pub","clap","loge","clap","env","pub","clap","env","loge","pub","clap","env","pub","clap","loge","clap","env","pub","clap","env","loge","pub","clap","env","clap"]'
  when 'mer:s' then '["start","clap","pub","loge","clap","env","clap","loge","pub","clap","env","loge","clap","pub","clap","loge","env","clap","pub","loge","clap","pub","env","clap","loge","pub","clap","env","loge","clap","pub","clap","env","loge","pub","clap","clap","clap","env","clap","loge","clap","env","clap","clap"]'
  when 'mer:m' then '["start","clap","pub","loge","clap","env","clap","loge","pub","clap","env","loge","clap","pub","clap","loge","env","clap","pub","loge","clap","pub","env","clap","loge","pub","clap","env","loge","clap","pub","clap","env","loge","pub","clap","clap","clap","env","clap","loge","clap","env","clap","clap","halt","loge","clap","pub","clap","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","env","clap","halt","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap"]'
  when 'mer:l' then '["start","clap","pub","loge","clap","env","clap","loge","pub","clap","env","loge","clap","pub","clap","loge","env","clap","pub","loge","clap","pub","env","clap","loge","pub","clap","env","loge","clap","pub","clap","env","loge","pub","clap","clap","clap","env","clap","loge","clap","env","clap","clap","halt","loge","clap","pub","clap","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","env","clap","halt","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","halt","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","pub","env","loge","clap","halt","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","pub","env","clap","clap","env","loge","clap","clap","clap","halt","loge","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","clap","clap","pub","env","loge","clap","env","clap","pub","loge","clap","clap","loge","clap","clap","clap","clap","env","clap","loge","clap"]'
  when 'kermesse:s' then '["start","clap","loge","clap","pub","env","loge","clap","pub","clap","loge","clap","env","tombola","clap","loge","clap","pub","env","clap","loge","clap","pub","clap","env","loge","clap","pub","clap","env","loge","clap","pub","tombola","clap","env","loge","clap","pub","clap"]'
  when 'kermesse:m' then '["start","clap","loge","clap","pub","env","loge","clap","pub","clap","loge","clap","env","tombola","clap","loge","clap","pub","env","clap","loge","clap","pub","clap","env","loge","clap","pub","clap","env","loge","clap","pub","tombola","clap","env","loge","clap","pub","clap","clap","clap","loge","clap","env","pub","clap","loge","clap","env","clap","pub","clap","clap","loge","tombola","env","pub","clap","loge","clap","env","clap","pub","clap","clap","loge","clap","env","pub","clap","clap","clap","loge","clap","env","pub","clap","loge","clap","env","clap","pub","clap","clap","tombola","clap","env","pub","clap","loge","clap","env","clap","pub","clap","clap","loge","clap","clap"]'
  when 'camping:s' then '["start","clap","pub","loge","clap","env","clap","pub","loge","clap","clap","env","pub","loge","clap","env","clap","pub","loge","clap","clap","env","pub","loge","clap","clap","env","pub","loge","clap","clap","env","pub","loge","clap","clap"]'
  when 'camping:m' then '["start","clap","pub","loge","clap","env","clap","pub","loge","clap","clap","env","pub","loge","clap","env","clap","pub","loge","clap","clap","env","pub","loge","clap","clap","env","pub","loge","clap","clap","env","pub","loge","clap","clap","clap","clap","loge","clap","env","pub","clap","loge","clap","env","clap","clap","clap","clap","loge","clap","env","pub","clap","loge","clap","env","clap","clap","clap","clap","loge","clap","env","pub","clap","clap","clap","loge","clap","env","pub","clap","loge","clap","env","clap","clap","clap","clap","loge","clap","env","pub","clap","loge","clap","env","clap","clap","clap","clap","loge","clap","env","pub","clap","loge","clap"]'
  when 'ski:s' then '["start","clap","clap","lift","loge","pub","lift","env","clap","loge","pub","clap","lift","clap","env","lift","loge","pub","clap","env","clap","lift","loge","pub","clap","env","clap","pub","loge","clap","env","clap","pub","loge","clap","env","ice","clap","pub","loge","clap","env","clap","ice","pub","clap","ice","clap","loge"]'
  when 'ski:m' then '["start","clap","clap","lift","loge","pub","lift","env","clap","loge","pub","clap","lift","clap","env","lift","loge","pub","clap","env","clap","lift","loge","pub","clap","env","clap","pub","loge","clap","env","clap","pub","loge","clap","env","ice","clap","pub","loge","clap","env","clap","ice","pub","clap","ice","clap","loge","halt","clap","loge","clap","env","pub","lift","loge","clap","clap","clap","lift","clap","clap","loge","clap","env","clap","clap","ice","clap","env","clap","pub","clap","clap","loge","clap","halt","clap","loge","clap","env","pub","lift","loge","clap","clap","clap","lift","clap","clap","loge","clap","env","clap","clap","ice","clap","env","clap","pub","clap","clap","loge","clap"]'
  when 'ski:l' then '["start","clap","clap","lift","loge","pub","lift","env","clap","loge","pub","clap","lift","clap","env","lift","loge","pub","clap","env","clap","lift","loge","pub","clap","env","clap","pub","loge","clap","env","clap","pub","loge","clap","env","ice","clap","pub","loge","clap","env","clap","ice","pub","clap","ice","clap","loge","halt","clap","loge","clap","env","pub","lift","loge","clap","clap","clap","lift","clap","clap","loge","clap","env","clap","clap","ice","clap","env","clap","pub","clap","clap","loge","clap","halt","clap","loge","clap","env","pub","lift","loge","clap","clap","clap","lift","clap","clap","loge","clap","env","clap","clap","ice","clap","env","clap","pub","clap","clap","loge","clap","halt","clap","loge","clap","lift","pub","clap","loge","clap","lift","clap","pub","clap","clap","loge","clap","env","clap","clap","loge","lift","env","clap","pub","clap","clap","loge","clap","lift","pub","clap","loge","clap","env","ice","pub","clap","clap","loge","clap","env","pub","clap","loge","ice","env","clap","pub","clap","loge","halt","clap","loge","clap","lift","pub","clap","loge","clap","lift","clap","pub","clap","clap","loge","clap","env","clap","clap","loge","lift","env","clap","pub","clap","clap","loge","clap","lift","pub","clap","loge","clap","env","ice","pub","clap","clap","loge","clap","env","pub","clap","loge","ice","env","clap","pub","clap"]'
  else '["start","clap","pub","loge","clap","env","clap","loge","pub","clap","env","loge","clap","clap","pub","clap","env","loge","clap","pub","loge","clap","env","clap","clap","clap","env","loge","clap","pub","loge","clap","env","loge","pub","clap","clap","env","loge","clap","clap","pub","clap","pub","env","pub","clap"]'
  end::jsonb $$;

-- Case suivante de chaque case. Un tableau [tout droit, détour] = embranchement : l'aiguillage (state.sw, dans
-- l'ordre des embranchements) choisit (et bascule, ou suit la marée). Dupliqué avec NEXT / NEXT_M / NEXT_L.
create or replace function public._dp_next(p_map text, p_size text default 's')
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select case public._dp_key(p_map, p_size)
  when 'grand:m' then '[1,2,3,4,[5,47],6,7,8,9,10,11,12,13,[14,36],15,16,17,18,19,20,21,22,[23,41],24,25,26,27,28,[29,73],30,31,32,33,34,35,0,37,38,39,40,15,42,43,44,45,46,25,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,7,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,32]'
  when 'mer:s' then '[1,2,3,4,5,6,7,8,9,10,11,12,[13,36],14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0,37,38,39,40,41,42,43,44,14]'
  when 'mer:m' then '[1,2,3,4,[5,45],6,7,8,9,[10,73],11,12,[13,36],14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0,37,38,39,40,41,42,43,44,14,46,47,48,49,[50,68],51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,8,69,70,71,72,51,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,11]'
  when 'mer:l' then '[1,2,3,4,[5,45],6,7,8,9,[10,73],11,12,[13,36],14,15,16,17,18,19,20,[21,100],22,23,24,25,26,[27,131],28,29,30,31,[32,167],33,34,35,0,37,38,39,40,41,42,43,44,14,46,47,48,49,[50,68],51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,8,69,70,71,72,51,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,11,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,22,132,133,134,135,136,137,138,139,140,141,142,143,[144,160],145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,28,161,162,163,164,165,166,145,168,169,170,171,172,173,174,175,176,177,178,[179,194],180,181,182,183,184,185,186,187,188,189,190,191,192,193,33,195,196,197,198,199,200,180]'
  when 'kermesse:s' then '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,0]'
  when 'kermesse:m' then '[1,2,3,[4,40],5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,[27,71],28,29,30,31,32,33,34,35,36,37,38,39,0,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,5,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,28]'
  when 'camping:s' then '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0]'
  when 'camping:m' then '[1,2,3,4,5,6,7,[8,36],9,10,11,12,13,14,15,16,[17,67],18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,0,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,9,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,18]'
  when 'ski:s' then '[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,0]'
  when 'ski:m' then '[1,2,3,4,5,6,7,8,9,10,11,[12,49],13,77,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,0,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,14,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,18]'
  when 'ski:l' then '[1,2,3,4,5,6,7,8,9,10,11,[12,49],13,77,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,0,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,[14,105],78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,[18,155],106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,[131,20],132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,0,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,[181,24],182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,154]'
  else '[1,2,3,4,5,6,7,8,9,10,11,12,13,[14,36],15,16,17,18,19,20,21,22,[23,41],24,25,26,27,28,29,30,31,32,33,34,35,0,37,38,39,40,15,42,43,44,45,46,25]'
  end::jsonb $$;

-- Case précédente (carte « recule », ronde de Riton) : à un retour d'embranchement, par la grande boucle ;
-- au ski, 0 → 48 (la Grande Luge à l'envers). Dupliqué avec PREV / PREV_M / PREV_L.
create or replace function public._dp_prev(p_map text, p_size text default 's')
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select case public._dp_key(p_map, p_size)
  when 'grand:m' then '[35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,13,36,37,38,39,22,41,42,43,44,45,4,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,28,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98]'
  when 'mer:s' then '[35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,12,36,37,38,39,40,41,42,43]'
  when 'mer:m' then '[35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,12,36,37,38,39,40,41,42,43,4,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,49,68,69,70,71,9,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98]'
  when 'mer:l' then '[35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,12,36,37,38,39,40,41,42,43,4,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,49,68,69,70,71,9,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,20,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,26,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,143,160,161,162,163,164,165,31,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,178,194,195,196,197,198,199]'
  when 'kermesse:s' then '[39,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38]'
  when 'kermesse:m' then '[39,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,3,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,26,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98]'
  when 'camping:s' then '[35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34]'
  when 'camping:m' then '[35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,7,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,16,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98]'
  when 'ski:s' then '[48,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47]'
  when 'ski:m' then '[48,0,1,2,3,4,5,6,7,8,9,10,11,12,76,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,11,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,13,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103]'
  when 'ski:l' then '[48,0,1,2,3,4,5,6,7,8,9,10,11,12,76,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,11,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,13,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,76,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,104,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202]'
  else '[35,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,13,36,37,38,39,22,41,42,43,44,45]'
  end::jsonb $$;

-- Fiche de la mécanique (miroir de EXTRA / EXTRA_M / EXTRA_L) : numéro, mécanique, mode de chaque embranchement
-- (toggle : bascule à chaque pion ; tide : suit la marée), données propres ; grandes tailles : size, stars (zones
-- d'étoiles), starts (haltes de départ), banks (bancs de marée), pack (ratons), tp (téléporteurs).
create or replace function public._dp_map(p_map text, p_size text default 's')
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select case public._dp_key(p_map, p_size)
  when 'grand:m' then '{"no":1,"mech":"forks","forks":["toggle","toggle","toggle","toggle"],"size":"m","stars":[{"n":0,"loges":[3,7,11,17,20,27,30,33,38]},{"n":1,"loges":[49,55,61,67]},{"n":1,"loges":[77,83,89,95]}]}'
  when 'mer:s' then '{"no":2,"mech":"tide","forks":["tide"],"bank":[36,37,38,39,40,41,42,43,44],"wash_to":14}'
  when 'mer:m' then '{"no":2,"mech":"tide","forks":["toggle","toggle","tide","tide"],"size":"m","stars":[{"n":0,"loges":[3,7,11,15,19,24,28,33,40]},{"n":1,"loges":[46,50,55,58,62,67,70]},{"n":1,"loges":[74,78,83,86,90,95,98]}],"banks":[{"cells":[36,37,38,39,40,41,42,43,44],"wash_to":14,"end":45},{"cells":[68,69,70,71,72],"wash_to":51,"end":73}]}'
  when 'mer:l' then '{"no":2,"mech":"tide","forks":["toggle","toggle","tide","toggle","toggle","toggle","tide","tide","tide"],"size":"l","stars":[{"n":0,"loges":[3,7,11,15,19,24,28,33,40]},{"n":1,"loges":[46,50,55,58,62,67,70]},{"n":1,"loges":[74,78,83,86,90,95,98]},{"n":1,"loges":[101,105,110,113,117,122,125,129]},{"n":1,"loges":[132,136,141,144,148,153,156,163]},{"n":1,"loges":[168,172,177,184,189,192,199]}],"starts":[45,73,100,131,167],"banks":[{"cells":[36,37,38,39,40,41,42,43,44],"wash_to":14,"end":45},{"cells":[68,69,70,71,72],"wash_to":51,"end":73},{"cells":[160,161,162,163,164,165,166],"wash_to":145,"end":167},{"cells":[194,195,196,197,198,199,200],"wash_to":180,"end":201}]}'
  when 'kermesse:s' then '{"no":3,"mech":"tombola","forks":[]}'
  when 'kermesse:m' then '{"no":3,"mech":"tombola","forks":["toggle","toggle"],"size":"m","stars":[{"n":0,"loges":[2,6,10,15,20,25,30,36]},{"n":1,"loges":[42,47,54,59,66]},{"n":1,"loges":[73,78,90,97]}]}'
  when 'camping:s' then '{"no":4,"mech":"riton","forks":[],"riton_start":18}'
  when 'camping:m' then '{"no":4,"mech":"riton","forks":["toggle","toggle"],"riton_start":18,"size":"m","stars":[{"n":0,"loges":[3,8,13,18,23,28,33]},{"n":1,"loges":[38,43,50,55,62]},{"n":1,"loges":[69,74,81,86,93,98]}],"pack":[{"name":"Rita","start":51,"path":[66,65,64,63,62,61,60,59,58,57,56,55,54,53,52,51,50,49,48,47,46,45,44,43,42,41,40,39,38,37,36]},{"name":"Ritou","start":83,"path":[99,98,97,96,95,94,93,92,91,90,89,88,87,86,85,84,83,82,81,80,79,78,77,76,75,74,73,72,71,70,69,68,67]}]}'
  when 'ski:s' then '{"no":5,"mech":"tp","forks":[],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20}}'
  when 'ski:m' then '{"no":5,"mech":"tp","forks":["toggle"],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20,"55":71,"60":66,"68":58,"83":99,"88":94,"96":86},"size":"m","stars":[{"n":0,"loges":[4,9,16,22,28,33,39,48]},{"n":1,"loges":[51,56,63,75]},{"n":1,"loges":[79,84,91,103]}]}'
  when 'ski:l' then '{"no":5,"mech":"tp","forks":["toggle","toggle","toggle","toggle","toggle"],"tp":{"3":37,"6":40,"12":42,"15":45,"21":47,"36":2,"43":13,"46":20,"55":71,"60":66,"68":58,"83":99,"88":94,"96":86,"109":127,"114":122,"125":137,"133":151,"139":123,"149":135,"159":177,"164":172,"175":187,"183":201,"189":173,"199":185},"size":"l","stars":[{"n":0,"loges":[4,9,16,22,28,33,39,48]},{"n":1,"loges":[51,56,63,75]},{"n":1,"loges":[79,84,91,103]},{"n":2,"loges":[107,112,119,124,131,136,143,148,154]},{"n":2,"loges":[157,162,169,174,181,186,193,198]}],"starts":[49,77,105,155]}'
  else '{"no":1,"mech":"forks","forks":["toggle","toggle"]}'
  end::jsonb $$;
-- <<< tracés des plateaux

-- Taille d'une partie (spec grands plateaux §1.1), figée au lancement : l si 7 ou 8 joueurs et que le plateau
-- a une taille l (mer, ski) ; sinon m dès 5 joueurs ; sinon s. p_wanted (option de test `size`) la force si
-- le plateau la possède ; absente, inconnue ou trop grande pour le plateau → la règle.
create or replace function public._dp_size(p_map text, p_players integer, p_wanted text)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case
    when coalesce(public._dp_sizes()->p_map, '[]'::jsonb) ? coalesce(p_wanted, '') then p_wanted
    when p_players >= 7 and coalesce(public._dp_sizes()->p_map, '[]'::jsonb) ? 'l' then 'l'
    when p_players >= 5 and coalesce(public._dp_sizes()->p_map, '[]'::jsonb) ? 'm' then 'm'
    else 's' end
$$;

-- Bancs de marée de la partie (Dédé-sur-Mer) : [{cells, wash_to, end}, …]. Fiches M / L : `banks` ;
-- fiche S : le Banc de sable seul, fabriqué depuis bank / wash_to. Autres plateaux : [].
create or replace function public._dp_banks(p_map text, p_size text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select case
    when jsonb_typeof(f->'banks') = 'array' then f->'banks'
    when jsonb_typeof(f->'bank') = 'array' then jsonb_build_array(jsonb_build_object('cells', f->'bank', 'wash_to', f->'wash_to',
      'end', (select max(x::integer) + 1 from jsonb_array_elements_text(f->'bank') x)))
    else '[]'::jsonb end
    from (select public._dp_map(p_map, p_size) f) x
$$;

-- Cases noyées (marée haute) : toutes les cases de tous les bancs ; sinon [].
create or replace function public._dp_wet(p_state jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select case when coalesce(p_state->>'map', 'grand') = 'mer' and coalesce((p_state->'mech'->>'tide')::integer, 0) = 1
    then coalesce((select jsonb_agg(c) from jsonb_array_elements(public._dp_banks('mer', coalesce(p_state->>'size', 's'))) b,
                         jsonb_array_elements(b->'cells') c), '[]'::jsonb)
    else '[]'::jsonb end
$$;

-- Les 12 cartes « Enveloppe surprise » (effet immédiat, sans choix).
create or replace function public._dp_cards()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '[
  {"id":"plus8","text":"Cachet de star : +8 pièces !"},
  {"id":"minus5","text":"Amende pour retard sur le plateau : −5 pièces."},
  {"id":"fwd3","text":"Coup d’accélérateur : avance de 3 cases !"},
  {"id":"back3","text":"Rembobinage : recule de 3 cases."},
  {"id":"swap_lead","text":"Téléportation : échange ta place avec le joueur le plus loin devant !"},
  {"id":"steal3","text":"Pickpocket : prends 3 pièces au joueur le plus riche."},
  {"id":"charity","text":"Téléthon : tout le monde donne 2 pièces au dernier du classement."},
  {"id":"everyone3","text":"Tournée générale : tout le monde gagne 3 pièces !"},
  {"id":"star_moves","text":"Changement de décor : ça déménage chez les étoiles !"},
  {"id":"reroll","text":"Bis ! Relance un dé et avance."},
  {"id":"half_price","text":"Promo du jour : ta prochaine étoile est à moitié prix !"},
  {"id":"gift_double","text":"Cadeau de Dédé : un Triple dé en plus !"}
]'::jsonb $$;

-- Mini-jeux V1 (ordre de référence du sac).
create or replace function public._dp_kinds()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '["quiz","pif","majorite","buzzer","etoiles","chrono"]'::jsonb $$;

-- Un dé à 6 faces (ou le prochain dé imposé par server.forced_dice, pour les tests).
create or replace function public._dp_die(inout p_server jsonb, out v integer)
language plpgsql
set search_path = public, extensions
as $$
declare
  i integer := coalesce((p_server->>'dice_i')::integer, 0);
begin
  if jsonb_typeof(p_server->'forced_dice') = 'array' and i < jsonb_array_length(p_server->'forced_dice') then
    v := (p_server->'forced_dice'->>i)::integer;
  else
    v := 1 + floor(random() * 6)::integer;
  end if;
  p_server := jsonb_set(p_server, '{dice_i}', to_jsonb(i + 1), true);
end $$;

-- Tire une carte : server.forced_cards (tests) puis la pioche, remélangée quand elle est vide.
create or replace function public._dp_draw(inout p_server jsonb, out card text)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_deck jsonb;
begin
  if jsonb_typeof(p_server->'forced_cards') = 'array' and jsonb_array_length(p_server->'forced_cards') > 0 then
    card := p_server->'forced_cards'->>0;
    p_server := jsonb_set(p_server, '{forced_cards}', (p_server->'forced_cards') - 0);
    return;
  end if;
  v_deck := coalesce(p_server->'deck', '[]'::jsonb);
  if jsonb_array_length(v_deck) = 0 then
    select jsonb_agg(c->'id' order by random()) into v_deck from jsonb_array_elements(public._dp_cards()) c;
  end if;
  card := v_deck->>0;
  p_server := jsonb_set(p_server, '{deck}', v_deck - 0, true);
end $$;

-- Instantané du plateau (affiché pendant l'animation des déplacements).
create or replace function public._dp_snap(p_state jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object('pos', p_state->'pos', 'coins', p_state->'coins', 'stars', p_state->'stars',
                            'star_cells', p_state->'star_cells', 'sw', p_state->'sw', 'dist', p_state->'dist',
                            'mech', coalesce(p_state->'mech', '{}'::jsonb))
$$;

-- stats[joueur][clé] += delta.
create or replace function public._dp_stat(p_state jsonb, p_pid text, p_key text, p_delta integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_set(p_state, array['stats', p_pid, p_key],
                   to_jsonb(coalesce((p_state->'stats'->p_pid->>p_key)::integer, 0) + p_delta), true)
$$;

-- Ajoute des pièces (jamais sous 0). Compteurs : coins_earned (gains), broke (tombé à 0 sur une perte,
-- pas sur un achat d'étoile).
create or replace function public._dp_coins(p_state jsonb, p_pid text, p_delta integer, p_kind text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_old integer := coalesce((p_state->'coins'->>p_pid)::integer, 0);
  v_new integer := greatest(0, v_old + p_delta);
begin
  p_state := jsonb_set(p_state, array['coins', p_pid], to_jsonb(v_new));
  if v_new > v_old then
    p_state := public._dp_stat(p_state, p_pid, 'coins_earned', v_new - v_old);
  end if;
  if v_new = 0 and v_old > 0 and p_kind <> 'star' then
    p_state := jsonb_set(p_state, array['stats', p_pid, 'broke'], '1'::jsonb, true);
  end if;
  return p_state;
end $$;

-- L'étoile de la case p_from déménage dans une autre Loge libre (sans étoile) tirée au sort : du plateau en
-- taille S ; de SA ZONE (fiche `stars` : la base ou un quartier) en grande taille. Dédé-sur-Mer à marée haute :
-- jamais sur une Loge d'un banc (la Loge du Phare, celles des îles sont sous l'eau). Plus de Loge libre :
-- l'étoile reste où elle est.
drop function if exists public._dp_move_star(jsonb);
create or replace function public._dp_move_star(p_state jsonb, p_from integer)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_map  text := coalesce(p_state->>'map', 'grand');
  v_size text := coalesce(p_state->>'size', 's');
  v_wet  jsonb := public._dp_wet(p_state);
  v_zone jsonb;
  v_cell integer;
begin
  select z->'loges' into v_zone from jsonb_array_elements(public._dp_map(v_map, v_size)->'stars') z
   where (z->'loges') @> to_jsonb(p_from) limit 1;
  select (o - 1)::integer into v_cell
    from jsonb_array_elements_text(public._dp_board(v_map, v_size)) with ordinality t(c, o)
   where c = 'loge' and not (p_state->'star_cells') @> to_jsonb((o - 1)::integer)
     and not v_wet @> to_jsonb((o - 1)::integer)
     and (v_zone is null or v_zone @> to_jsonb((o - 1)::integer))
   order by random() limit 1;
  return jsonb_set(p_state, '{star_cells}',
    (select jsonb_agg(case when x::integer = p_from then coalesce(v_cell, p_from) else x::integer end order by o)
       from jsonb_array_elements_text(p_state->'star_cells') with ordinality t(x, o)));
end $$;

-- Achat automatique de l'étoile de la case p_cell (au passage comme à l'arrêt, ou à l'arrivée d'un
-- télésiège / d'une glissade). Renvoie {state, ev} (ev : star, star_poor ou null s'il n'y a pas d'étoile).
create or replace function public._dp_star_check(p_state jsonb, p_pid text, p_cell integer, p_exact boolean)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  c       jsonb := public._dp_const();
  v_price integer;
begin
  if not (p_state->'star_cells') @> to_jsonb(p_cell) then
    return jsonb_build_object('state', p_state, 'ev', null);
  end if;
  v_price := case when coalesce((p_state->'half_price'->>p_pid)::boolean, false)
                  then (c->>'half_price')::integer else (c->>'star_price')::integer end;
  if (p_state->'coins'->>p_pid)::integer < v_price then
    return jsonb_build_object('state', p_state, 'ev', jsonb_build_object('t', 'star_poor', 'need', v_price));
  end if;
  p_state := public._dp_coins(p_state, p_pid, -v_price, 'star');
  p_state := jsonb_set(p_state, array['stars', p_pid], to_jsonb((p_state->'stars'->>p_pid)::integer + 1));
  p_state := jsonb_set(p_state, array['half_price', p_pid], 'false'::jsonb);
  p_state := public._dp_stat(p_state, p_pid, 'stars_bought', 1);
  if p_exact then p_state := public._dp_stat(p_state, p_pid, 'star_exact', 1); end if;
  p_state := public._dp_move_star(p_state, p_cell);
  return jsonb_build_object('state', p_state,
    'ev', jsonb_build_object('t', 'star', 'cost', v_price, 'stars', p_state->'star_cells', 'exact', p_exact));
end $$;

-- Le Camping : p_pid croise un raton : p_who = 0 Riton (mech.sack), p_who ≥ 1 le raton pack[p_who − 1] de la
-- fiche (Rita, Ritou : mech.pack[p_who − 1].sack). Sac plein : il lâche tout (le pion empoche le sac) ; sac vide :
-- il pique 5 pièces (ce que le pion a) ; pion sans pièce : rien. Renvoie {state, ev:{t:'riton', k, d, sack[, who]}}
-- (who seulement pour Rita et Ritou : les évènements de Riton gardent leur forme).
drop function if exists public._dp_riton_hit(jsonb, text);
create or replace function public._dp_riton_hit(p_state jsonb, p_pid text, p_who integer default 0)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_path  text[] := case when p_who > 0 then array['mech', 'pack', (p_who - 1)::text, 'sack'] else array['mech', 'sack'] end;
  v_sack  integer := coalesce((p_state #>> v_path)::integer, 0);
  v_coins integer := coalesce((p_state->'coins'->>p_pid)::integer, 0);
  v_name  text := case when p_who > 0
                       then coalesce(public._dp_map(coalesce(p_state->>'map', 'grand'), coalesce(p_state->>'size', 's'))->'pack'->(p_who - 1)->>'name', 'Riton')
                       else 'Riton' end;
  v_tag   jsonb := case when p_who > 0 then jsonb_build_object('who', p_who) else '{}'::jsonb end;
  v_n     integer;
begin
  if v_sack > 0 then
    p_state := public._dp_coins(p_state, p_pid, v_sack, 'riton');
    v_n := (p_state->'coins'->>p_pid)::integer - v_coins;
    p_state := public._dp_stat(p_state, p_pid, 'loot', v_n);
    if v_n > coalesce((p_state->'stats'->p_pid->'best_card'->>'gain')::integer, 0) then
      p_state := jsonb_set(p_state, array['stats', p_pid, 'best_card'], jsonb_build_object('card', 'riton', 'text', 'Le sac de ' || v_name, 'gain', v_n), true);
    end if;
    p_state := jsonb_set(p_state, v_path, '0'::jsonb, true);
    return jsonb_build_object('state', p_state, 'ev', jsonb_build_object('t', 'riton', 'k', 'drop', 'd', v_n, 'sack', 0) || v_tag);
  elsif v_coins > 0 then
    v_n := least((public._dp_const()->>'riton_steal')::integer, v_coins);
    p_state := public._dp_coins(p_state, p_pid, -v_n, 'riton');
    p_state := jsonb_set(p_state, v_path, to_jsonb(v_n), true);
    p_state := public._dp_stat(p_state, p_pid, 'robbed', 1);
    return jsonb_build_object('state', p_state, 'ev', jsonb_build_object('t', 'riton', 'k', 'steal', 'd', -v_n, 'sack', v_n) || v_tag);
  end if;
  return jsonb_build_object('state', p_state, 'ev', jsonb_build_object('t', 'riton', 'k', 'none', 'd', 0, 'sack', 0) || v_tag);
end $$;

-- Fait marcher le pion de p_pid de p_n cases (p_dir = 1 en avant, -1 en arrière) sur le plateau de la partie.
-- En avant : suit _dp_next(map) ; à un embranchement « toggle », l'aiguillage choisit puis bascule ; à un
-- embranchement « tide » (mer), la voie est 1 − marée, sans bascule (évènement fork sur la première case de
-- la voie prise). En arrière : _dp_prev(map), sans toucher aux aiguillages.
-- Sur chaque case franchie, dans l'ordre : Départ ou Halte (+5, en avant ; Halte : évènement start + halt) →
-- mécanique du plateau (péage de la Tombola en avant et sans s'y arrêter ; croisement de Riton ou d'un raton de
-- la famille, dans les deux sens) → étoile (au passage comme à l'arrêt). Un transport (bac, télécabine, piste,
-- Grande Descente) est une liaison comme une autre : 1 pas. Renvoie {state, steps:[{cell, ev:[...]}]}.
create or replace function public._dp_walk(p_state jsonb, p_pid text, p_n integer, p_dir integer)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  c       jsonb := public._dp_const();
  v_map   text := coalesce(p_state->>'map', 'grand');
  v_size  text := coalesce(p_state->>'size', 's');
  v_board jsonb := public._dp_board(v_map, v_size);
  v_next  jsonb := public._dp_next(v_map, v_size);
  v_prev  jsonb := public._dp_prev(v_map, v_size);
  v_modes jsonb := coalesce(public._dp_map(v_map, v_size)->'forks', '[]'::jsonb);
  v_who   integer;
  v_nx    jsonb;
  v_fork  integer;
  v_way   integer;
  v_pos   integer := (p_state->'pos'->>p_pid)::integer;
  v_steps jsonb := '[]'::jsonb;
  v_ev    jsonb;
  v_r     jsonb;
  v_old   integer;
  v_n     integer;
  k       integer;
begin
  for k in 1 .. greatest(p_n, 0) loop
    v_ev := '[]'::jsonb;
    if p_dir < 0 then
      v_pos := (v_prev->>v_pos)::integer;
    else
      v_nx := v_next->v_pos;
      if jsonb_typeof(v_nx) = 'array' then
        -- Numéro de l'embranchement = rang parmi les cases à deux sorties.
        select count(*)::integer into v_fork
          from jsonb_array_elements(v_next) with ordinality t(x, o)
         where jsonb_typeof(x) = 'array' and (o - 1) < v_pos;
        if v_modes->>v_fork = 'tide' then
          v_way := 1 - coalesce((p_state->'mech'->>'tide')::integer, 0);
          v_ev := v_ev || jsonb_build_object('t', 'fork', 'fork', v_fork, 'way', v_way, 'tide', true);
        else
          v_way := coalesce((p_state->'sw'->>v_fork)::integer, 0);
          p_state := jsonb_set(p_state, array['sw', v_fork::text], to_jsonb(1 - v_way));
          v_ev := v_ev || jsonb_build_object('t', 'fork', 'fork', v_fork, 'way', v_way);
        end if;
        v_pos := (v_nx->>v_way)::integer;
      else
        v_pos := v_nx::text::integer;
      end if;
    end if;
    p_state := jsonb_set(p_state, array['pos', p_pid], to_jsonb(v_pos));
    p_state := jsonb_set(p_state, array['dist', p_pid], to_jsonb(coalesce((p_state->'dist'->>p_pid)::integer, 0) + p_dir));
    if p_dir > 0 and (v_pos = 0 or v_board->>v_pos = 'halt') then
      v_old := (p_state->'coins'->>p_pid)::integer;
      p_state := public._dp_coins(p_state, p_pid, (c->>'start_bonus')::integer, 'start');
      v_ev := v_ev || (jsonb_build_object('t', 'start', 'd', (p_state->'coins'->>p_pid)::integer - v_old)
                       || case when v_pos = 0 then '{}'::jsonb else '{"halt":true}'::jsonb end);
    end if;
    -- La Kermesse : péage de la Tombola (en avant, sans s'y arrêter ; pièces versées dans la cagnotte).
    if v_map = 'kermesse' and p_dir > 0 and k < p_n and v_board->>v_pos = 'tombola' then
      v_n := least((c->>'toll')::integer, coalesce((p_state->'coins'->>p_pid)::integer, 0));
      if v_n > 0 then
        p_state := public._dp_coins(p_state, p_pid, -v_n, 'toll');
        p_state := public._dp_stat(p_state, p_pid, 'toll_paid', v_n);
        p_state := jsonb_set(p_state, '{mech,pot}', to_jsonb(coalesce((p_state->'mech'->>'pot')::integer, 0) + v_n), true);
      end if;
      v_ev := v_ev || jsonb_build_object('t', 'toll', 'd', -v_n, 'pot', (p_state->'mech'->>'pot')::integer);
    end if;
    -- Le Camping : marcher sur la case de Riton (ou d'un raton de la famille) = le croiser (avant comme arrière).
    if v_map = 'camping' then
      if v_pos = (p_state->'mech'->>'riton')::integer then
        v_r := public._dp_riton_hit(p_state, p_pid, 0);
        p_state := v_r->'state';
        v_ev := v_ev || (v_r->'ev');
      end if;
      for v_who in select o::integer from jsonb_array_elements(coalesce(p_state->'mech'->'pack', '[]'::jsonb)) with ordinality t(x, o)
                    where (x->>'c')::integer = v_pos loop
        v_r := public._dp_riton_hit(p_state, p_pid, v_who);
        p_state := v_r->'state';
        v_ev := v_ev || (v_r->'ev');
      end loop;
    end if;
    v_r := public._dp_star_check(p_state, p_pid, v_pos, k = p_n);
    p_state := v_r->'state';
    if jsonb_typeof(v_r->'ev') = 'object' then v_ev := v_ev || (v_r->'ev'); end if;
    v_steps := v_steps || jsonb_build_object('cell', v_pos, 'ev', v_ev);
  end loop;
  return jsonb_build_object('state', p_state, 'steps', v_steps);
end $$;

-- Rang d'un joueur dans l'ordre de passage (départage des cartes).
create or replace function public._dp_order_idx(p_state jsonb, p_pid text)
returns integer language sql immutable
set search_path = public, extensions
as $$
  select coalesce((select (o - 1)::integer from jsonb_array_elements_text(p_state->'order') with ordinality t(x, o) where x = p_pid), 0)
$$;

-- Effet de la case d'arrivée d'un lancer de dé (jamais d'une carte : pas de chaînes).
-- Renvoie {state, server, ev:[...], steps:[...] (déplacements dus à une carte, marqués card ;
-- saut de télésiège / verglas, marqué tp)}.
create or replace function public._dp_land(p_state jsonb, p_server jsonb, p_pid text)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  c        jsonb := public._dp_const();
  v_map    text := coalesce(p_state->>'map', 'grand');
  v_size   text := coalesce(p_state->>'size', 's');
  v_cell   integer := (p_state->'pos'->>p_pid)::integer;
  v_type   text := public._dp_board(v_map, v_size)->>v_cell;
  v_to     integer;
  v_ev     jsonb := '[]'::jsonb;
  v_steps  jsonb := '[]'::jsonb;
  v_card   text;
  v_text   text;
  v_old    integer;
  v_mine   integer;
  v_other  text;
  v_tmp    jsonb;
  v_n      integer;
  v_sum    integer;
  v_gain   integer;
  v_cev    jsonb;
  pl       text;
begin
  if v_type = 'clap' then
    v_old := (p_state->'coins'->>p_pid)::integer;
    p_state := public._dp_coins(p_state, p_pid, (c->>'clap')::integer, 'clap');
    v_ev := v_ev || jsonb_build_object('t', 'clap', 'd', (p_state->'coins'->>p_pid)::integer - v_old);
  elsif v_type = 'pub' then
    v_old := (p_state->'coins'->>p_pid)::integer;
    p_state := public._dp_coins(p_state, p_pid, -(c->>'pub')::integer, 'pub');
    p_state := public._dp_stat(p_state, p_pid, 'pubs', 1);
    v_ev := v_ev || jsonb_build_object('t', 'pub', 'd', (p_state->'coins'->>p_pid)::integer - v_old);
  elsif v_type = 'tombola' then
    -- La Kermesse : pile sur la Tombola, le gros lot (toute la cagnotte), qui repart à la mise de départ.
    v_old := (p_state->'coins'->>p_pid)::integer;
    p_state := public._dp_coins(p_state, p_pid, coalesce((p_state->'mech'->>'pot')::integer, (c->>'pot_seed')::integer), 'jackpot');
    v_gain := (p_state->'coins'->>p_pid)::integer - v_old;
    p_state := public._dp_stat(p_state, p_pid, 'jackpots', 1);
    p_state := jsonb_set(p_state, array['stats', p_pid, 'jackpot_best'],
      to_jsonb(greatest(v_gain, coalesce((p_state->'stats'->p_pid->>'jackpot_best')::integer, 0))), true);
    if v_gain > coalesce((p_state->'stats'->p_pid->'best_card'->>'gain')::integer, 0) then
      p_state := jsonb_set(p_state, array['stats', p_pid, 'best_card'], jsonb_build_object('card', 'jackpot', 'text', 'Gros lot de la Tombola', 'gain', v_gain), true);
    end if;
    p_state := jsonb_set(p_state, '{mech,pot}', c->'pot_seed', true);
    v_ev := v_ev || jsonb_build_object('t', 'jackpot', 'd', v_gain, 'pot', (c->>'pot_seed')::integer);
  elsif v_type in ('lift', 'ice') then
    -- Dédé 2000 : pile sur un télésiège (on monte) ou une plaque de verglas (on glisse). Saut sans case
    -- franchie : pas d'effet de la case d'arrivée, mais l'étoile s'achète si elle y est (pile dessus).
    v_to := (public._dp_map(v_map, v_size)->'tp'->>(v_cell::text))::integer;
    if v_to is not null then
      p_state := jsonb_set(p_state, array['pos', p_pid], to_jsonb(v_to));
      p_state := jsonb_set(p_state, array['dist', p_pid], to_jsonb(coalesce((p_state->'dist'->>p_pid)::integer, 0) + v_to - v_cell));
      p_state := public._dp_stat(p_state, p_pid, case when v_type = 'lift' then 'lifts' else 'slides' end, 1);
      v_cev := jsonb_build_array(jsonb_build_object('t', 'tp', 'k', v_type, 'from', v_cell, 'to', v_to));
      v_tmp := public._dp_star_check(p_state, p_pid, v_to, true);
      p_state := v_tmp->'state';
      if jsonb_typeof(v_tmp->'ev') = 'object' then v_cev := v_cev || (v_tmp->'ev'); end if;
      v_steps := jsonb_build_array(jsonb_build_object('cell', v_to, 'tp', v_type, 'ev', v_cev));
    end if;
  elsif v_type = 'env' then
    select d.p_server, d.card into p_server, v_card from public._dp_draw(p_server) d;
    select x->>'text' into v_text from jsonb_array_elements(public._dp_cards()) x where x->>'id' = v_card;
    p_state := public._dp_stat(p_state, p_pid, 'envelopes', 1);
    v_mine := (p_state->'coins'->>p_pid)::integer;
    v_cev := jsonb_build_object('t', 'card', 'card', v_card, 'text', v_text);

    if v_card = 'plus8' then
      p_state := public._dp_coins(p_state, p_pid, 8, 'card');
    elsif v_card = 'minus5' then
      p_state := public._dp_coins(p_state, p_pid, -5, 'card');
    elsif v_card in ('fwd3', 'back3', 'reroll') then
      if v_card = 'reroll' then
        select d.p_server, d.v into p_server, v_n from public._dp_die(p_server) d;
        v_cev := v_cev || jsonb_build_object('die', v_n);
      else
        v_n := 3;
      end if;
      v_tmp := public._dp_walk(p_state, p_pid, v_n, case when v_card = 'back3' then -1 else 1 end);
      p_state := v_tmp->'state';
      select coalesce(jsonb_agg(s || '{"card":true}'::jsonb order by o), '[]'::jsonb) into v_steps
        from jsonb_array_elements(v_tmp->'steps') with ordinality t(s, o);
    elsif v_card = 'swap_lead' then
      -- Le plus loin devant = le plus grand chemin parcouru (dist), strictement devant moi.
      select x into v_other from jsonb_array_elements_text(p_state->'players') x
       where x <> p_pid and (p_state->'dist'->>x)::integer > (p_state->'dist'->>p_pid)::integer
       order by (p_state->'dist'->>x)::integer desc, public._dp_order_idx(p_state, x) limit 1;
      if v_other is null then
        v_cev := v_cev || '{"none":true}'::jsonb;
      else
        v_tmp := jsonb_build_object('pos', p_state->'pos'->p_pid, 'dist', p_state->'dist'->p_pid);
        p_state := jsonb_set(p_state, array['pos', p_pid], p_state->'pos'->v_other);
        p_state := jsonb_set(p_state, array['dist', p_pid], p_state->'dist'->v_other);
        p_state := jsonb_set(p_state, array['pos', v_other], v_tmp->'pos');
        p_state := jsonb_set(p_state, array['dist', v_other], v_tmp->'dist');
        v_cev := v_cev || jsonb_build_object('with', v_other, 'cell', p_state->'pos'->p_pid);
      end if;
    elsif v_card = 'steal3' then
      select x into v_other from jsonb_array_elements_text(p_state->'players') x
       where x <> p_pid and (p_state->'coins'->>x)::integer > 0
       order by (p_state->'coins'->>x)::integer desc, public._dp_order_idx(p_state, x) limit 1;
      if v_other is null then
        v_cev := v_cev || '{"none":true}'::jsonb;
      else
        v_n := least(3, (p_state->'coins'->>v_other)::integer);
        p_state := public._dp_coins(p_state, v_other, -v_n, 'card');
        p_state := public._dp_coins(p_state, p_pid, v_n, 'card');
        v_cev := v_cev || jsonb_build_object('from', v_other, 'd', v_n);
      end if;
    elsif v_card = 'charity' then
      -- Dernier du classement : le moins d'étoiles, puis le moins de pièces, puis le premier dans l'ordre.
      select x into v_other from jsonb_array_elements_text(p_state->'players') x
       order by (p_state->'stars'->>x)::integer, (p_state->'coins'->>x)::integer, public._dp_order_idx(p_state, x) limit 1;
      v_sum := 0;
      for pl in select x from jsonb_array_elements_text(p_state->'players') x where x <> v_other loop
        v_n := least(2, (p_state->'coins'->>pl)::integer);
        if v_n > 0 then
          p_state := public._dp_coins(p_state, pl, -v_n, 'card');
          v_sum := v_sum + v_n;
        end if;
      end loop;
      p_state := public._dp_coins(p_state, v_other, v_sum, 'card');
      v_cev := v_cev || jsonb_build_object('to', v_other, 'd', v_sum);
    elsif v_card = 'everyone3' then
      for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
        p_state := public._dp_coins(p_state, pl, 3, 'card');
      end loop;
    elsif v_card = 'star_moves' then
      for v_n in select x::integer from jsonb_array_elements_text(p_state->'star_cells') x loop
        p_state := public._dp_move_star(p_state, v_n);
      end loop;
      v_cev := v_cev || jsonb_build_object('stars', p_state->'star_cells');
    elsif v_card = 'half_price' then
      p_state := jsonb_set(p_state, array['half_price', p_pid], 'true'::jsonb);
    elsif v_card = 'gift_double' then
      p_state := jsonb_set(p_state, array['double_left', p_pid], to_jsonb((p_state->'double_left'->>p_pid)::integer + 1));
    end if;

    -- Plus gros gain en une carte (« meilleur moment » du résumé).
    v_gain := (p_state->'coins'->>p_pid)::integer - v_mine;
    v_cev := v_cev || jsonb_build_object('gain', v_gain);
    if v_gain > coalesce((p_state->'stats'->p_pid->'best_card'->>'gain')::integer, 0) then
      p_state := jsonb_set(p_state, array['stats', p_pid, 'best_card'], jsonb_build_object('card', v_card, 'text', v_text, 'gain', v_gain), true);
    end if;
    v_ev := v_ev || v_cev;
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server, 'ev', v_ev, 'steps', v_steps);
end $$;

-- Ouvre la phase de lancer (tour suivant ; l'ordre de passage tourne d'un cran à chaque tour).
create or replace function public._dp_open_roll(p_state jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_round integer := coalesce((p_state->>'round')::integer, 0) + 1;
  v_order jsonb := p_state->'order';
begin
  if v_round > 1 then
    v_order := (v_order - 0) || jsonb_build_array(v_order->0);
  end if;
  return p_state || jsonb_build_object(
    'phase', 'roll',
    'round', v_round,
    'order', v_order,
    'rolls', (select jsonb_object_agg(x, null) from jsonb_array_elements_text(p_state->'players') x),
    'moves', '[]'::jsonb,
    'moves_at', null,
    'before', null,
    'epi', null,
    'deadline', now() + make_interval(secs => (public._dp_const()->>'roll_s')::integer));
end $$;

-- Lance les dés de p_pid : 2 dés, 3 avec le « Triple dé » (p_double ; noms internes double / double_left).
create or replace function public._dp_do_roll(p_state jsonb, p_server jsonb, p_pid text, p_double boolean)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_d1 integer;
  v_dice jsonb := '[]'::jsonb;
  k integer;
begin
  for k in 1 .. (public._dp_const()->>'dice')::integer + case when p_double then 1 else 0 end loop
    select d.p_server, d.v into p_server, v_d1 from public._dp_die(p_server) d;
    v_dice := v_dice || to_jsonb(v_d1);
  end loop;
  if p_double then
    p_state := jsonb_set(p_state, array['double_left', p_pid], to_jsonb((p_state->'double_left'->>p_pid)::integer - 1));
    p_state := public._dp_stat(p_state, p_pid, 'doubles', 1);
  end if;
  p_state := jsonb_set(p_state, array['rolls', p_pid], jsonb_build_object('dice', v_dice, 'double', p_double, 'at', now()));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Épilogue du tour (après le dernier pion) : l'évènement du plateau, publié dans state.epi (null s'il n'y a
-- rien à montrer). Renvoie {state, server}.
--   mer     : la marée (cycle 2 tours basse / 1 tour haute), une seule horloge pour TOUS les bancs (le Banc de
--             sable, + 1 en M, + 3 en L). Quand elle monte, les pions de chaque banc sont emportés (ordre de
--             passage) vers le wash_to de leur banc, −5 pièces ; les étoiles des bancs déménagent (dans leur zone).
--             Chaque embranchement « tide » suit la mer (sw = 1 − tide) ; les bacs (toggle) ne bougent pas.
--             Épilogue seulement les tours où la marée change : {t:'tide', tide, washed:[{id, from, d[, to]}], stars?, after}
--             (to : case d'arrivée, en grande taille seulement — en S c'est toujours wash_to).
--   camping : la ronde de Riton (1 dé, à contresens, après tous les dés du tour), à chaque tour ; chaque pion
--             posé sur une case où il arrive est croisé (ordre des cases, puis ordre de passage) :
--             {t:'riton', die, from, path, hits:[{id, cell, k, d, sack}], after}. Grande taille : puis un dé par
--             raton de la famille (fiche pack, dans l'ordre), chacun avance sur sa ronde fermée (path, cyclique) ;
--             ils trottent EN MÊME TEMPS à l'écran : epi.pack = [{who, die, from, path, hits}, …].
create or replace function public._dp_epilogue(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  c       jsonb := public._dp_const();
  v_map   text := coalesce(p_state->>'map', 'grand');
  v_size  text := coalesce(p_state->>'size', 's');
  v_fiche jsonb := public._dp_map(v_map, v_size);
  v_banks jsonb := public._dp_banks(v_map, v_size);
  v_big   boolean := v_size <> 's';
  v_epi   jsonb := null;
  v_tide  integer;
  v_in    integer;
  v_list  jsonb := '[]'::jsonb;
  v_path  jsonb := '[]'::jsonb;
  v_packs jsonb := '[]'::jsonb;
  v_ring  jsonb;
  v_moved boolean := false;
  v_bank  jsonb;
  v_cell  integer;
  v_from  integer;
  v_die   integer;
  v_old   integer;
  v_idx   integer;
  v_r     jsonb;
  pl      text;
  k       integer;
  w       integer;
begin
  if v_map = 'mer' then
    v_tide := coalesce((p_state->'mech'->>'tide')::integer, 0);
    v_in := coalesce((p_state->'mech'->>'tide_in')::integer, 1) - 1;
    if v_in > 0 then
      p_state := jsonb_set(p_state, '{mech}', jsonb_build_object('tide', v_tide, 'tide_in', v_in));
    else
      v_tide := 1 - v_tide;
      -- Chaque embranchement de marée suit la mer ; les bacs gardent leur position.
      p_state := p_state || jsonb_build_object(
        'mech', jsonb_build_object('tide', v_tide, 'tide_in', (c->>(case when v_tide = 1 then 'tide_high' else 'tide_low' end))::integer),
        'sw', coalesce((select jsonb_agg(case when m = 'tide' then to_jsonb(1 - v_tide) else coalesce(p_state->'sw'->((o - 1)::integer), '0'::jsonb) end order by o)
                          from jsonb_array_elements_text(v_fiche->'forks') with ordinality t(m, o)), '[]'::jsonb));
      if v_tide = 1 then
        -- La mer monte : les bancs se ferment, la vague emporte les traînards.
        for pl in select x from jsonb_array_elements_text(p_state->'order') x loop
          v_cell := (p_state->'pos'->>pl)::integer;
          v_bank := null;
          select b into v_bank from jsonb_array_elements(v_banks) b where (b->'cells') @> to_jsonb(v_cell) limit 1;
          if v_bank is not null then
            v_old := (p_state->'coins'->>pl)::integer;
            p_state := public._dp_coins(p_state, pl, -(c->>'wash')::integer, 'wash');
            p_state := jsonb_set(p_state, array['pos', pl], v_bank->'wash_to');
            p_state := jsonb_set(p_state, array['dist', pl], to_jsonb(coalesce((p_state->'dist'->>pl)::integer, 0) + (v_bank->>'end')::integer - v_cell));
            p_state := public._dp_stat(p_state, pl, 'washed', 1);
            v_list := v_list || (jsonb_build_object('id', pl, 'from', v_cell, 'd', (p_state->'coins'->>pl)::integer - v_old)
                                 || case when v_big then jsonb_build_object('to', v_bank->'wash_to') else '{}'::jsonb end);
          end if;
        end loop;
        for v_cell in select x::integer from jsonb_array_elements_text(p_state->'star_cells') x
                       where public._dp_wet(p_state) @> to_jsonb(x::integer) loop
          p_state := public._dp_move_star(p_state, v_cell);
          v_moved := true;
        end loop;
        v_epi := jsonb_build_object('t', 'tide', 'tide', 1, 'washed', v_list);
        if v_moved then v_epi := v_epi || jsonb_build_object('stars', p_state->'star_cells'); end if;
      else
        -- La mer redescend : les bancs rouvrent.
        v_epi := jsonb_build_object('t', 'tide', 'tide', 0, 'washed', '[]'::jsonb);
      end if;
    end if;
  elsif v_map = 'camping' then
    select d.p_server, d.v into p_server, v_die from public._dp_die(p_server) d;
    v_from := coalesce((p_state->'mech'->>'riton')::integer, (v_fiche->>'riton_start')::integer);
    v_cell := v_from;
    for k in 1 .. v_die loop
      v_cell := (public._dp_prev(v_map, v_size)->>v_cell)::integer;
      v_path := v_path || to_jsonb(v_cell);
      p_state := jsonb_set(p_state, '{mech,riton}', to_jsonb(v_cell), true);
      for pl in select x from jsonb_array_elements_text(p_state->'order') x loop
        if (p_state->'pos'->>pl)::integer = v_cell then
          v_r := public._dp_riton_hit(p_state, pl, 0);
          p_state := v_r->'state';
          v_list := v_list || (((v_r->'ev') - 't') || jsonb_build_object('id', pl, 'cell', v_cell));
        end if;
      end loop;
    end loop;
    v_epi := jsonb_build_object('t', 'riton', 'die', v_die, 'from', v_from, 'path', v_path, 'hits', v_list);
    -- La famille Raton (grande taille) : un dé par raton, chacun sur sa ronde fermée.
    w := 0;
    for v_ring in select x from jsonb_array_elements(coalesce(v_fiche->'pack', '[]'::jsonb)) x loop
      w := w + 1;
      select d.p_server, d.v into p_server, v_die from public._dp_die(p_server) d;
      v_from := coalesce((p_state->'mech'->'pack'->(w - 1)->>'c')::integer, (v_ring->>'start')::integer);
      v_cell := v_from;
      v_path := '[]'::jsonb;
      v_list := '[]'::jsonb;
      v_idx := null;
      select (o - 1)::integer into v_idx from jsonb_array_elements_text(v_ring->'path') with ordinality t(x, o) where x::integer = v_from limit 1;
      v_idx := coalesce(v_idx, 0);
      for k in 1 .. v_die loop
        v_idx := (v_idx + 1) % jsonb_array_length(v_ring->'path');
        v_cell := (v_ring->'path'->>v_idx)::integer;
        v_path := v_path || to_jsonb(v_cell);
        p_state := jsonb_set(p_state, array['mech', 'pack', (w - 1)::text, 'c'], to_jsonb(v_cell), true);
        for pl in select x from jsonb_array_elements_text(p_state->'order') x loop
          if (p_state->'pos'->>pl)::integer = v_cell then
            v_r := public._dp_riton_hit(p_state, pl, w);
            p_state := v_r->'state';
            v_list := v_list || (((v_r->'ev') - 't' - 'who') || jsonb_build_object('id', pl, 'cell', v_cell));
          end if;
        end loop;
      end loop;
      v_packs := v_packs || jsonb_build_object('who', w, 'die', v_die, 'from', v_from, 'path', v_path, 'hits', v_list);
    end loop;
    if jsonb_array_length(v_packs) > 0 then v_epi := v_epi || jsonb_build_object('pack', v_packs); end if;
  end if;
  if v_epi is not null then v_epi := v_epi || jsonb_build_object('after', public._dp_snap(p_state)); end if;
  return jsonb_build_object('state', p_state || jsonb_build_object('epi', v_epi), 'server', p_server);
end $$;

-- Résout tout le tour : chaque pion, dans l'ordre de passage, avance, puis effet de sa case ; puis
-- l'épilogue du plateau. Le scénario (moves) est publié pour l'animation ; chaque entrée porte
-- l'instantané `after` ; l'épilogue (state.epi) le sien.
create or replace function public._dp_resolve(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_moves jsonb := '[]'::jsonb;
  v_n     integer := jsonb_array_length(p_state->'players');
  v_r     jsonb;
  pl      text;
  v_roll  jsonb;
  v_sum   integer;
  v_from  integer;
  v_w     jsonb;
  v_l     jsonb;
  v_steps jsonb;
  v_last  integer;
  v_before jsonb := public._dp_snap(p_state);
begin
  -- Lancers d'office pour les retardataires (dé simple).
  for pl in select x from jsonb_array_elements_text(p_state->'players') x loop
    if jsonb_typeof(p_state->'rolls'->pl) is distinct from 'object' then
      v_r := public._dp_do_roll(p_state, p_server, pl, false);
      p_state := v_r->'state';
      p_server := v_r->'server';
      p_state := jsonb_set(p_state, array['rolls', pl, 'auto'], 'true'::jsonb);
    end if;
  end loop;

  for pl in select x from jsonb_array_elements_text(p_state->'order') x loop
    v_roll := p_state->'rolls'->pl;
    select coalesce(sum(d::integer), 0) into v_sum from jsonb_array_elements_text(v_roll->'dice') d;
    v_from := (p_state->'pos'->>pl)::integer;
    v_w := public._dp_walk(p_state, pl, v_sum, 1);
    p_state := v_w->'state';
    v_steps := v_w->'steps';
    v_l := public._dp_land(p_state, p_server, pl);
    p_state := v_l->'state';
    p_server := v_l->'server';
    v_last := jsonb_array_length(v_steps) - 1;
    if v_last >= 0 then
      v_steps := jsonb_set(v_steps, array[v_last::text, 'ev'], (v_steps->v_last->'ev') || (v_l->'ev'));
    end if;
    v_steps := v_steps || (v_l->'steps');
    v_moves := v_moves || jsonb_build_object(
      'id', pl, 'dice', v_roll->'dice', 'double', v_roll->'double', 'auto', coalesce((v_roll->>'auto')::boolean, false),
      'from', v_from, 'to', p_state->'pos'->pl, 'steps', v_steps, 'after', public._dp_snap(p_state));
  end loop;

  v_r := public._dp_epilogue(p_state, p_server);
  p_state := v_r->'state';
  p_server := v_r->'server';
  p_state := p_state || jsonb_build_object(
    'phase', 'move',
    'moves', v_moves,
    'before', v_before,
    'moves_at', now(),
    'deadline', now() + make_interval(secs => 2 + v_n * (public._dp_const()->>'move_s')::integer
                                       + case when jsonb_typeof(p_state->'epi') = 'object' then (public._dp_const()->>'epi_s')::integer else 0 end));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Tire le prochain mini-jeu « dans un sac » : les mini-jeux disponibles passent tous avant
-- qu'un revienne, jamais deux fois le même d'affilée. server.forced_mg (tests) passe en premier.
create or replace function public._dp_pick_kind(inout p_server jsonb, p_state jsonb, out kind text)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_avail jsonb;
  v_bag   jsonb := coalesce(p_server->'bag', '[]'::jsonb);
  v_last  text := p_server->>'last_kind';
  v_np    integer := jsonb_array_length(p_state->'players');
  v_tmp   jsonb;
begin
  if jsonb_typeof(p_server->'forced_mg') = 'array' and jsonb_array_length(p_server->'forced_mg') > 0 then
    kind := p_server->'forced_mg'->>0;
    p_server := jsonb_set(p_server, '{forced_mg}', (p_server->'forced_mg') - 0);
  else
    -- Disponibles : il faut des questions pour quiz / pif / majorite, et 3 joueurs pour un vote.
    select coalesce(jsonb_agg(k), '[]'::jsonb) into v_avail from jsonb_array_elements_text(public._dp_kinds()) k
     where (k <> 'quiz' or jsonb_array_length(coalesce(p_server->'q'->'quiz', '[]'::jsonb)) >= 3)
       and (k <> 'pif' or jsonb_array_length(coalesce(p_server->'q'->'pif', '[]'::jsonb)) >= 1)
       and (k <> 'majorite' or (jsonb_array_length(coalesce(p_server->'q'->'majorite', '[]'::jsonb)) >= 1 and v_np >= 3));
    select coalesce(jsonb_agg(k), '[]'::jsonb) into v_bag from jsonb_array_elements(v_bag) k where v_avail @> jsonb_build_array(k);
    if jsonb_array_length(v_bag) = 0 then
      select jsonb_agg(k order by random()) into v_bag from jsonb_array_elements(v_avail) k;
      -- Pas deux fois de suite le même : le premier du nouveau sac part au fond.
      if v_bag->>0 = v_last and jsonb_array_length(v_bag) > 1 then
        v_tmp := v_bag->0;
        v_bag := (v_bag - 0) || jsonb_build_array(v_tmp);
      end if;
    end if;
    kind := v_bag->>0;
    p_server := jsonb_set(p_server, '{bag}', v_bag - 0, true);
  end if;
  p_server := jsonb_set(p_server, '{last_kind}', to_jsonb(kind), true);
end $$;

-- Prochaine question d'une banque (tourne en boucle si la banque s'épuise).
create or replace function public._dp_next_q(inout p_server jsonb, p_bank text, out q jsonb)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_list jsonb := coalesce(p_server->'q'->p_bank, '[]'::jsonb);
  i      integer := coalesce((p_server->'qi'->>p_bank)::integer, 0);
begin
  if jsonb_array_length(v_list) = 0 then q := null; return; end if;
  q := v_list->(i % jsonb_array_length(v_list));
  p_server := jsonb_set(p_server, array['qi', p_bank], to_jsonb(i + 1), true);
end $$;

-- Annonce du mini-jeu (8 s) : tirage, données publiques (sans les réponses), secrets dans server.mg.
create or replace function public._dp_open_mg(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_kind   text;
  v_no     integer := coalesce((p_state->>'mg_no')::integer, 0) + 1;
  v_data   jsonb := '{}'::jsonb;
  v_secret jsonb := '{}'::jsonb;
  v_q      jsonb;
  v_ch     jsonb;
  v_qs     jsonb := '[]'::jsonb;
  v_ans    jsonb := '[]'::jsonb;
  i        integer;
begin
  select d.p_server, d.kind into p_server, v_kind from public._dp_pick_kind(p_server, p_state) d;
  if v_kind = 'quiz' then
    for i in 1 .. 3 loop
      select d.p_server, d.q into p_server, v_q from public._dp_next_q(p_server, 'quiz') d;
      select jsonb_agg(x order by random()) into v_ch
        from jsonb_array_elements(jsonb_build_array(v_q->'answer') || (v_q->'distractors')) x;
      v_qs := v_qs || jsonb_build_object('prompt', v_q->'prompt', 'choices', v_ch);
      v_ans := v_ans || to_jsonb((select (o - 1)::integer from jsonb_array_elements(v_ch) with ordinality t(x, o) where x = v_q->'answer' order by o limit 1));
    end loop;
    v_data := jsonb_build_object('questions', v_qs, 'per_q', 8000);
    v_secret := jsonb_build_object('answers', v_ans);
  elsif v_kind = 'pif' then
    select d.p_server, d.q into p_server, v_q from public._dp_next_q(p_server, 'pif') d;
    v_data := jsonb_build_object('prompt', v_q->'prompt', 'unit', coalesce(v_q->'unit', 'null'::jsonb));
    v_secret := jsonb_build_object('answer', v_q->'answer', 'unit', coalesce(v_q->'unit', 'null'::jsonb));
  elsif v_kind = 'majorite' then
    select d.p_server, d.q into p_server, v_q from public._dp_next_q(p_server, 'majorite') d;
    v_data := jsonb_build_object('question', v_q);
  elsif v_kind = 'etoiles' then
    v_data := jsonb_build_object('seed', floor(random() * 1000000)::integer, 'cap', (public._dp_const()->>'star_cap')::integer, 'dur', 15000);
  elsif v_kind = 'chrono' then
    v_data := jsonb_build_object('target', (public._dp_const()->>'chrono_target')::integer, 'hide_after', 3000);
  end if;

  p_server := p_server || jsonb_build_object('mg', jsonb_build_object('no', v_no, 'kind', v_kind, 'secret', v_secret), 'subs', '{}'::jsonb);
  p_state := p_state || jsonb_build_object(
    'phase', 'mg_intro',
    'mg_no', v_no,
    'mg', jsonb_build_object('kind', v_kind, 'no', v_no, 'data', v_data, 'submitted', '[]'::jsonb, 'results', null,
                             'reveal', null, 'started_at', null, 'finale', (p_state->>'round')::integer >= (p_state->>'rounds')::integer),
    'deadline', now() + make_interval(secs => (public._dp_const()->>'mg_intro_s')::integer));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Début du mini-jeu : top départ commun et échéance propre au mini-jeu.
create or replace function public._dp_play_mg(p_state jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_kind text := p_state->'mg'->>'kind';
  v_now  timestamptz := now();
  v_go   timestamptz;
  v_end  timestamptz;
begin
  v_end := v_now + case v_kind
    when 'quiz' then interval '26 seconds'
    when 'pif' then interval '22 seconds'
    when 'majorite' then interval '22 seconds'
    when 'etoiles' then interval '18 seconds'
    when 'chrono' then interval '22 seconds'
    else interval '12 seconds' end;
  p_state := jsonb_set(p_state, '{mg,started_at}', to_jsonb(v_now));
  -- Les bots sont « déjà prêts » (leur envoi est tiré à la clôture, cf. _dp_bot_sub).
  p_state := jsonb_set(p_state, '{mg,submitted}', coalesce(p_state->'bots', '[]'::jsonb));
  if v_kind = 'buzzer' then
    -- L'écran passe au vert à un moment surprise (2,5 à 6,5 s après le départ).
    v_go := v_now + make_interval(secs => 2.5 + random() * 4);
    p_state := jsonb_set(p_state, '{mg,data,go_at}', to_jsonb(v_go));
    v_end := v_go + interval '4 seconds';
  end if;
  return p_state || jsonb_build_object('phase', 'mg_play', 'deadline', v_end);
end $$;

-- Valide et normalise l'envoi d'un joueur (exception invalid_submit). Anti-triche minimal pour les
-- mini-jeux mesurés par le téléphone : valeurs bornées, réaction ≥ 120 ms, score plafonné.
create or replace function public._dp_check_submit(p_state jsonb, p_payload jsonb)
returns jsonb language plpgsql stable
set search_path = public, extensions
as $$
declare
  v_kind text := p_state->'mg'->>'kind';
  v_a    jsonb;
  v_m    jsonb;
  v_out  jsonb;
  v_ms   numeric;
  i      integer;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'invalid_submit'; end if;
  if v_kind = 'quiz' then
    v_a := p_payload->'answers';
    v_m := p_payload->'ms';
    if jsonb_typeof(v_a) is distinct from 'array' or jsonb_array_length(v_a) <> 3
       or jsonb_typeof(v_m) is distinct from 'array' or jsonb_array_length(v_m) <> 3 then
      raise exception 'invalid_submit';
    end if;
    v_out := jsonb_build_object('answers', '[]'::jsonb, 'ms', '[]'::jsonb);
    for i in 0 .. 2 loop
      if jsonb_typeof(v_a->i) = 'null' then
        v_out := jsonb_set(v_out, '{answers}', (v_out->'answers') || 'null'::jsonb);
        v_out := jsonb_set(v_out, '{ms}', (v_out->'ms') || '8000'::jsonb);
      else
        if jsonb_typeof(v_a->i) <> 'number' or (v_a->>i) !~ '^[0-3]$' then raise exception 'invalid_submit'; end if;
        if jsonb_typeof(v_m->i) <> 'number' then raise exception 'invalid_submit'; end if;
        v_ms := (v_m->>i)::numeric;
        if v_ms < 0 or v_ms > 8000 then raise exception 'invalid_submit'; end if;
        v_out := jsonb_set(v_out, '{answers}', (v_out->'answers') || (v_a->i));
        v_out := jsonb_set(v_out, '{ms}', (v_out->'ms') || to_jsonb(round(v_ms)::integer));
      end if;
    end loop;
    return v_out;
  elsif v_kind = 'pif' then
    if jsonb_typeof(p_payload->'value') is distinct from 'number' or abs((p_payload->>'value')::numeric) > 1e15 then
      raise exception 'invalid_submit';
    end if;
    return jsonb_build_object('value', p_payload->'value');
  elsif v_kind = 'majorite' then
    if jsonb_typeof(p_payload->'target') is distinct from 'string' or not ((p_state->'players') ? (p_payload->>'target')) then
      raise exception 'invalid_submit';
    end if;
    return jsonb_build_object('target', p_payload->'target');
  elsif v_kind = 'buzzer' then
    if p_payload->'false_start' = 'true'::jsonb then return '{"false_start":true}'::jsonb; end if;
    if jsonb_typeof(p_payload->'ms') is distinct from 'number' then raise exception 'invalid_submit'; end if;
    v_ms := (p_payload->>'ms')::numeric;
    if v_ms < 0 or v_ms > 5000 then raise exception 'invalid_submit'; end if;
    -- Réaction humainement impossible : comptée comme un faux départ.
    if v_ms < 120 then return '{"false_start":true}'::jsonb; end if;
    if now() < (p_state->'mg'->'data'->>'go_at')::timestamptz - interval '1 second' then raise exception 'invalid_submit'; end if;
    return jsonb_build_object('ms', round(v_ms)::integer);
  elsif v_kind = 'etoiles' then
    if jsonb_typeof(p_payload->'score') is distinct from 'number' or (p_payload->>'score')::numeric < 0 then raise exception 'invalid_submit'; end if;
    return jsonb_build_object('score', least(floor((p_payload->>'score')::numeric)::integer, (p_state->'mg'->'data'->>'cap')::integer));
  elsif v_kind = 'chrono' then
    if jsonb_typeof(p_payload->'ms') is distinct from 'number' then raise exception 'invalid_submit'; end if;
    v_ms := (p_payload->>'ms')::numeric;
    if v_ms < 0 or v_ms > 60000 then raise exception 'invalid_submit'; end if;
    return jsonb_build_object('ms', round(v_ms)::integer);
  end if;
  raise exception 'invalid_submit';
end $$;

-- Fin du mini-jeu : scores -> rangs (ex aequo : même rang, le meilleur) -> pièces (10/6/4/2, ×2 en
-- finale ; pas joué = 0), mini-jeux gagnés et séries, révélation des réponses.
create or replace function public._dp_close_mg(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  c        jsonb := public._dp_const();
  v_kind   text := p_state->'mg'->>'kind';
  v_secret jsonb := coalesce(p_server->'mg'->'secret', '{}'::jsonb);
  v_subs   jsonb := coalesce(p_server->'subs', '{}'::jsonb);
  v_mult   integer := case when coalesce((p_state->'mg'->>'finale')::boolean, false) then 2 else 1 end;
  v_scored jsonb := '{}'::jsonb;
  v_reveal jsonb := '{}'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_top    jsonb;
  v_max    integer;
  v_res    jsonb;
  v_sub    jsonb;
  v_ok     integer;
  v_ms     integer;
  v_r      record;
  v_coins  integer;
  pl       text;
  i        integer;
begin
  -- Envois des bots (tirés maintenant : les réponses secrètes sont connues).
  for pl in select x from jsonb_array_elements_text(coalesce(p_state->'bots', '[]'::jsonb)) x loop
    if not (v_subs ? pl) then
      v_sub := public._dp_bot_sub(p_state, v_secret);
      if v_sub is not null then v_subs := v_subs || jsonb_build_object(pl, v_sub); end if;
    end if;
  end loop;
  -- Clé de tri (petit = meilleur ; null = dernier) et score affiché, par envoi.
  if v_kind = 'majorite' then
    select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) into v_counts
      from (select value->>'target' t, count(*) n from jsonb_each(v_subs) group by 1) z;
    select max(value::integer) into v_max from jsonb_each_text(v_counts);
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into v_top from jsonb_each_text(v_counts) where value::integer = v_max;
    v_reveal := jsonb_build_object('counts', v_counts, 'top', v_top);
  elsif v_kind = 'quiz' then
    v_reveal := jsonb_build_object('answers', v_secret->'answers');
  elsif v_kind = 'pif' then
    v_reveal := jsonb_build_object('answer', v_secret->'answer', 'unit', v_secret->'unit');
  elsif v_kind = 'chrono' then
    v_reveal := jsonb_build_object('target', c->'chrono_target');
  end if;

  for pl, v_sub in select key, value from jsonb_each(v_subs) loop
    if v_kind = 'quiz' then
      v_ok := 0; v_ms := 0;
      for i in 0 .. 2 loop
        if jsonb_typeof(v_sub->'answers'->i) = 'number' and (v_sub->'answers'->>i)::integer = (v_secret->'answers'->>i)::integer then
          v_ok := v_ok + 1;
        end if;
        v_ms := v_ms + (v_sub->'ms'->>i)::integer;
      end loop;
      v_scored := v_scored || jsonb_build_object(pl, jsonb_build_object('k', (3 - v_ok) * 100000 + v_ms, 'score', v_ok, 'ms', v_ms, 'answers', v_sub->'answers'));
    elsif v_kind = 'pif' then
      v_scored := v_scored || jsonb_build_object(pl, jsonb_build_object('k', abs((v_sub->>'value')::numeric - (v_secret->>'answer')::numeric), 'score', v_sub->'value'));
    elsif v_kind = 'majorite' then
      v_scored := v_scored || jsonb_build_object(pl, jsonb_build_object('k', case when v_top ? (v_sub->>'target') then 0 else 1 end, 'score', v_sub->'target'));
    elsif v_kind = 'buzzer' then
      v_scored := v_scored || jsonb_build_object(pl, case when v_sub ? 'false_start'
        then jsonb_build_object('k', null, 'score', null, 'false_start', true)
        else jsonb_build_object('k', (v_sub->>'ms')::integer, 'score', v_sub->'ms') end);
    elsif v_kind = 'etoiles' then
      v_scored := v_scored || jsonb_build_object(pl, jsonb_build_object('k', -(v_sub->>'score')::integer, 'score', v_sub->'score'));
    elsif v_kind = 'chrono' then
      v_scored := v_scored || jsonb_build_object(pl, jsonb_build_object('k', abs((v_sub->>'ms')::integer - (c->>'chrono_target')::integer), 'score', v_sub->'ms'));
    end if;
  end loop;

  v_res := '[]'::jsonb;
  for v_r in
    with s as (
      select key as pid, value as v, (value->>'k')::numeric as k from jsonb_each(v_scored)
    )
    select pid, v, rank() over (order by k asc nulls last) as rk from s order by rk, pid
  loop
    v_coins := ((c->'gains'->>(least(v_r.rk, 4) - 1)::integer)::integer) * v_mult;
    p_state := public._dp_coins(p_state, v_r.pid, v_coins, 'mg');
    if v_r.rk = 1 then
      p_state := public._dp_stat(p_state, v_r.pid, 'mg_wins', 1);
      p_state := public._dp_stat(p_state, v_r.pid, 'mg_streak', 1);
      if (p_state->'stats'->v_r.pid->>'mg_streak')::integer > coalesce((p_state->'stats'->v_r.pid->>'mg_streak_max')::integer, 0) then
        p_state := jsonb_set(p_state, array['stats', v_r.pid, 'mg_streak_max'], p_state->'stats'->v_r.pid->'mg_streak');
      end if;
    else
      p_state := jsonb_set(p_state, array['stats', v_r.pid, 'mg_streak'], '0'::jsonb);
    end if;
    v_res := v_res || (jsonb_build_object('id', v_r.pid, 'rank', v_r.rk, 'coins', v_coins, 'played', true) || (v_r.v - 'k'));
  end loop;
  -- Pas joué : 0 pièce, la série s'arrête.
  for pl in select x from jsonb_array_elements_text(p_state->'players') x where not (v_subs ? x) order by x loop
    p_state := jsonb_set(p_state, array['stats', pl, 'mg_streak'], '0'::jsonb);
    v_res := v_res || jsonb_build_object('id', pl, 'rank', null, 'coins', 0, 'played', false, 'score', null);
  end loop;

  p_state := jsonb_set(p_state, '{mg,results}', v_res);
  p_state := jsonb_set(p_state, '{mg,reveal}', v_reveal);
  p_state := p_state || jsonb_build_object('phase', 'mg_result',
    'deadline', now() + make_interval(secs => (c->>'mg_result_s')::integer));
  p_server := p_server || '{"subs":{}}'::jsonb;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Cérémonie : étoiles bonus (Roi des mini-jeux, Prix de la poisse ; ex aequo : chacun la reçoit),
-- puis classement final (étoiles, puis pièces).
create or replace function public._dp_awards(p_state jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_king   jsonb;
  v_poisse jsonb;
  v_kmax   integer;
  v_pmax   integer;
  v_rank   jsonb;
  pl       text;
begin
  select max(coalesce((p_state->'stats'->x->>'mg_wins')::integer, 0)), max(coalesce((p_state->'stats'->x->>'pubs')::integer, 0))
    into v_kmax, v_pmax from jsonb_array_elements_text(p_state->'players') x;
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_king from jsonb_array_elements_text(p_state->'players') x
   where v_kmax > 0 and coalesce((p_state->'stats'->x->>'mg_wins')::integer, 0) = v_kmax;
  select coalesce(jsonb_agg(x order by x), '[]'::jsonb) into v_poisse from jsonb_array_elements_text(p_state->'players') x
   where v_pmax > 0 and coalesce((p_state->'stats'->x->>'pubs')::integer, 0) = v_pmax;
  for pl in select jsonb_array_elements_text(v_king || v_poisse) loop
    p_state := jsonb_set(p_state, array['stars', pl], to_jsonb((p_state->'stars'->>pl)::integer + 1));
  end loop;
  for pl in select jsonb_array_elements_text(v_king) loop
    p_state := jsonb_set(p_state, array['stats', pl, 'king'], '1'::jsonb, true);
  end loop;

  select jsonb_agg(jsonb_build_object('id', x, 'stars', st, 'coins', co, 'rank', rk) order by rk, x) into v_rank
    from (select x, (p_state->'stars'->>x)::integer st, (p_state->'coins'->>x)::integer co,
                 rank() over (order by (p_state->'stars'->>x)::integer desc, (p_state->'coins'->>x)::integer desc) rk
            from jsonb_array_elements_text(p_state->'players') x) z;

  return p_state || jsonb_build_object(
    'phase', 'awards',
    'awards', jsonb_build_array(
      jsonb_build_object('kind', 'king', 'ids', v_king, 'value', v_kmax),
      jsonb_build_object('kind', 'poisse', 'ids', v_poisse, 'value', v_pmax)),
    'ranking', v_rank,
    'winners', (select coalesce(jsonb_agg(e->'id' order by e->>'id'), '[]'::jsonb) from jsonb_array_elements(v_rank) e where (e->>'rank')::integer = 1),
    'deadline', now() + make_interval(secs => (public._dp_const()->>'awards_s')::integer));
end $$;

-- Compteurs de fin de partie pour les trophées (features/trophees.sql).
create or replace function public._dp_tstats(p_state jsonb, p_pid text, p_won boolean)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  s     jsonb := coalesce(p_state->'stats'->p_pid, '{}'::jsonb);
  v_st  integer := coalesce((p_state->'stars'->>p_pid)::integer, 0);
  v_king boolean := coalesce((s->>'king')::integer, 0) = 1;
begin
  return jsonb_build_object(
    'stars', v_st,
    'coins', coalesce((p_state->'coins'->>p_pid)::integer, 0),
    'rounds', coalesce((p_state->>'round')::integer, 0),
    'pubs', coalesce((s->>'pubs')::integer, 0),
    'broke', coalesce((s->>'broke')::integer, 0),
    'no_star', case when v_st = 0 then 1 else 0 end,
    'coins_earned', coalesce((s->>'coins_earned')::integer, 0),
    'envelopes', coalesce((s->>'envelopes')::integer, 0),
    'star_exact', coalesce((s->>'star_exact')::integer, 0),
    'mg_wins', coalesce((s->>'mg_wins')::integer, 0),
    'mg_streak', coalesce((s->>'mg_streak_max')::integer, 0),
    'win_mvp', case when p_won and v_king then 1 else 0 end,
    -- Compteurs des plateaux (enregistrés pour de futurs trophées ; 0 si le plateau ne s'en sert pas).
    'washed', coalesce((s->>'washed')::integer, 0),
    'toll_paid', coalesce((s->>'toll_paid')::integer, 0),
    'jackpots', coalesce((s->>'jackpots')::integer, 0),
    'jackpot_best', coalesce((s->>'jackpot_best')::integer, 0),
    'robbed', coalesce((s->>'robbed')::integer, 0),
    'loot', coalesce((s->>'loot')::integer, 0),
    'lifts', coalesce((s->>'lifts')::integer, 0),
    'slides', coalesce((s->>'slides')::integer, 0),
    'map_no', coalesce((public._dp_map(coalesce(p_state->>'map', 'grand'))->>'no')::integer, 1),
    -- Taille du plateau (1 = s, 2 = m, 3 = l) : pour un futur trophée « plateau géant ».
    'size_no', case coalesce(p_state->>'size', 's') when 'l' then 3 when 'm' then 2 else 1 end);
end $$;

-- Fin de partie : placement = rang (étoiles puis pièces), points = n − rang + 1, won = rang 1.
create or replace function public._dp_finish(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_n       integer := jsonb_array_length(p_state->'players');
  v_results jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'profile_id', e->>'id', 'points', v_n - (e->>'rank')::integer + 1, 'won', (e->>'rank')::integer = 1,
           'placement', (e->>'rank')::integer,
           'stats', public._dp_tstats(p_state, e->>'id', (e->>'rank')::integer = 1))
         order by (e->>'rank')::integer, e->>'id')
    into v_results
    from jsonb_array_elements(p_state->'ranking') e;
  p_state := p_state || jsonb_build_object('phase', 'finished', 'deadline', null, 'results', v_results);
  -- Les bots ne sont pas des profils : hors de finish_match (XP, stats, trophées), leur rang compte quand même.
  return jsonb_build_object('state', p_state, 'server', p_server, 'results',
    (select coalesce(jsonb_agg(r order by o), '[]'::jsonb) from jsonb_array_elements(v_results) with ordinality t(r, o)
      where not (coalesce(p_state->'bots', '[]'::jsonb) ? (r->>'profile_id'))));
end $$;

-- Bots : ils lancent dès l'ouverture du lancer (Triple dé gardé pour la finale). Renvoie {state, server}.
create or replace function public._dp_bots_roll(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_r jsonb;
  b   text;
begin
  for b in select x from jsonb_array_elements_text(coalesce(p_state->'bots', '[]'::jsonb)) x loop
    if jsonb_typeof(p_state->'rolls'->b) is distinct from 'object' then
      v_r := public._dp_do_roll(p_state, p_server, b,
        (p_state->>'round')::integer >= (p_state->>'rounds')::integer and coalesce((p_state->'double_left'->>b)::integer, 0) > 0);
      p_state := v_r->'state';
      p_server := v_r->'server';
    end if;
  end loop;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Envoi d'un bot pour le mini-jeu en cours (déjà normalisé, comme _dp_check_submit) : un joueur moyen,
-- battable mais pas ridicule.
create or replace function public._dp_bot_sub(p_state jsonb, p_secret jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_kind text := p_state->'mg'->>'kind';
  v_ans  numeric;
  v_a    jsonb := '[]'::jsonb;
  v_m    jsonb := '[]'::jsonb;
  v_ok   integer;
  i      integer;
begin
  if v_kind = 'quiz' then
    for i in 0 .. 2 loop
      v_ok := (p_secret->'answers'->>i)::integer;
      v_a := v_a || to_jsonb(case when random() < 0.55 then v_ok else (v_ok + 1 + floor(random() * 3)::integer) % 4 end);
      v_m := v_m || to_jsonb(1500 + floor(random() * 5000)::integer);
    end loop;
    return jsonb_build_object('answers', v_a, 'ms', v_m);
  elsif v_kind = 'pif' then
    v_ans := (p_secret->>'answer')::numeric;
    v_ans := v_ans * (1 + (random() - 0.5) * 0.8);
    return jsonb_build_object('value', case when abs(v_ans) >= 10 then round(v_ans) else round(v_ans, 1) end);
  elsif v_kind = 'majorite' then
    return jsonb_build_object('target', p_state->'players'->floor(random() * jsonb_array_length(p_state->'players'))::integer);
  elsif v_kind = 'buzzer' then
    if random() < 0.1 then return '{"false_start":true}'::jsonb; end if;
    return jsonb_build_object('ms', 260 + floor(random() * 400)::integer);
  elsif v_kind = 'etoiles' then
    return jsonb_build_object('score', least(6 + floor(random() * 17)::integer, (p_state->'mg'->'data'->>'cap')::integer));
  elsif v_kind = 'chrono' then
    return jsonb_build_object('ms', (public._dp_const()->>'chrono_target')::integer + floor((random() - 0.5) * 1600)::integer);
  end if;
  return null;
end $$;

-- Passe à la phase suivante (échéance atteinte, ou `skip` de l'hôte).
create or replace function public._dp_advance(p_state jsonb, p_server jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_phase text := p_state->>'phase';
begin
  if v_phase = 'intro' then
    return public._dp_bots_roll(public._dp_open_roll(p_state), p_server);
  elsif v_phase = 'roll' then
    return public._dp_resolve(p_state, p_server);
  elsif v_phase = 'move' then
    return public._dp_open_mg(p_state, p_server);
  elsif v_phase = 'mg_intro' then
    return jsonb_build_object('state', public._dp_play_mg(p_state), 'server', p_server);
  elsif v_phase = 'mg_play' then
    return public._dp_close_mg(p_state, p_server);
  elsif v_phase = 'mg_result' then
    if (p_state->>'round')::integer >= (p_state->>'rounds')::integer then
      return jsonb_build_object('state', public._dp_awards(p_state), 'server', p_server);
    end if;
    return public._dp_bots_roll(public._dp_open_roll(p_state), p_server);
  elsif v_phase = 'awards' then
    return public._dp_finish(p_state, p_server);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Options : {"rounds": 6|9|12 (défaut 9), "map": "grand"|"mer"|"kermesse"|"camping"|"ski" (absent ou
--            inconnu : tirage parmi les 5 ; le front résout « Au hasard » lui-même),
--            "quiz": [{prompt, answer, distractors[3]}], "pif": [{prompt, answer, unit?}],
--            "majorite": ["Qui de nous… ?"]} (questions tirées par le front).
create or replace function public.game_dede_party_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  c        jsonb := public._dp_const();
  v_rounds integer;
  v_map    text;
  v_mech   jsonb := '{}'::jsonb;
  v_sw     jsonb := '[]'::jsonb;
  v_wet    jsonb := '[]'::jsonb;
  v_quiz   jsonb;
  v_pif    jsonb;
  v_maj    jsonb;
  v_order  jsonb;
  v_state  jsonb;
  v_zero   jsonb;
  v_star   jsonb;
  v_size   text;
  v_fiche  jsonb;
  v_bots   jsonb;
  v_ids    jsonb;
  v_nb     integer;
  v_n      integer;
  v_pos    jsonb;
  v_spots  jsonb;
  v_zone   jsonb;
begin
  if coalesce(cardinality(p_players), 0) < 1 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 8 then raise exception 'too_many_players'; end if;
  -- Bots (option bots, 0 à 8 − joueurs) : des participants comme les autres, ids 'bot1'…, joués par le serveur
  -- (dés lancés à l'ouverture du lancer, envoi de mini-jeu tiré à la clôture), jamais dans les résultats.
  -- Seul devant son écran : au moins 1 bot.
  v_nb := case when coalesce(p_options->>'bots', '') ~ '^\d$' then (p_options->>'bots')::integer else 0 end;
  v_nb := least(greatest(v_nb, 2 - cardinality(p_players)), 8 - cardinality(p_players));
  select coalesce(jsonb_agg('bot' || g order by g), '[]'::jsonb) into v_bots from generate_series(1, v_nb) g;
  v_ids := (select jsonb_agg(p::text order by o) from unnest(p_players) with ordinality t(p, o)) || v_bots;
  v_n := jsonb_array_length(v_ids);

  v_rounds := case when coalesce(p_options->>'rounds', '') ~ '^\d{1,2}$' then (p_options->>'rounds')::integer else 9 end;
  if v_rounds not in (6, 9, 12) then v_rounds := 9; end if;

  -- Plateau : celui demandé, sinon tiré au sort parmi les 5. État initial de sa mécanique.
  v_map := case when jsonb_typeof(p_options->'map') = 'string' and public._dp_maps() ? (p_options->>'map')
                then p_options->>'map' else public._dp_maps()->>floor(random() * 5)::integer end;
  -- Taille (spec grands plateaux §1.1) : selon le nombre de joueurs, figée pour toute la partie ; p_options.size
  -- (tests, page de démo) la force si le plateau la possède.
  v_size := public._dp_size(v_map, v_n, case when jsonb_typeof(p_options->'size') = 'string' then p_options->>'size' end);
  v_fiche := public._dp_map(v_map, v_size);
  if v_map = 'mer' then
    -- Phase de la marée tirée parmi 3 (sinon tout le monde se fait rincer au même tour à chaque partie).
    v_mech := (array['{"tide":0,"tide_in":2}', '{"tide":0,"tide_in":1}', '{"tide":1,"tide_in":1}'])[1 + floor(random() * 3)::integer]::jsonb;
    if (v_mech->>'tide')::integer = 1 then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_wet
        from jsonb_array_elements(public._dp_banks(v_map, v_size)) b, jsonb_array_elements(b->'cells') x;
    end if;
  elsif v_map = 'kermesse' then
    v_mech := jsonb_build_object('pot', (c->>'pot_seed')::integer);
  elsif v_map = 'camping' then
    v_mech := jsonb_build_object('riton', (v_fiche->>'riton_start')::integer, 'sack', 0);
    -- La famille Raton (grande taille) : Rita, Ritou, chacun sa case et son sac.
    if jsonb_typeof(v_fiche->'pack') = 'array' then
      v_mech := v_mech || jsonb_build_object('pack', (select jsonb_agg(jsonb_build_object('c', (x->>'start')::integer, 'sack', 0) order by o)
                                                        from jsonb_array_elements(v_fiche->'pack') with ordinality t(x, o)));
    end if;
  end if;
  -- Un aiguillage par embranchement : toggle → 0 ou 1 au hasard ; tide → 1 − marée (la voie du banc est ouverte à marée basse).
  select coalesce(jsonb_agg(case when m = 'tide' then 1 - coalesce((v_mech->>'tide')::integer, 0) else floor(random() * 2)::integer end order by o), '[]'::jsonb)
    into v_sw from jsonb_array_elements_text(coalesce(v_fiche->'forks', '[]'::jsonb)) with ordinality t(m, o);

  -- Questions : on ne garde que les entrées bien formées.
  select coalesce(jsonb_agg(jsonb_build_object('prompt', q->'prompt', 'answer', q->'answer',
                                               'distractors', jsonb_path_query_array(q->'distractors', '$[0 to 2]'))), '[]'::jsonb)
    into v_quiz
    from jsonb_array_elements(case when jsonb_typeof(p_options->'quiz') = 'array' then p_options->'quiz' else '[]'::jsonb end) q
   where jsonb_typeof(q->'prompt') = 'string' and jsonb_typeof(q->'answer') = 'string'
     and jsonb_typeof(q->'distractors') = 'array' and jsonb_array_length(q->'distractors') >= 3;
  select coalesce(jsonb_agg(jsonb_build_object('prompt', q->'prompt', 'answer', q->'answer',
                                               'unit', case when jsonb_typeof(q->'unit') = 'string' then q->'unit' else 'null'::jsonb end)), '[]'::jsonb)
    into v_pif
    from jsonb_array_elements(case when jsonb_typeof(p_options->'pif') = 'array' then p_options->'pif' else '[]'::jsonb end) q
   where jsonb_typeof(q->'prompt') = 'string' and jsonb_typeof(q->'answer') = 'number';
  select coalesce(jsonb_agg(q), '[]'::jsonb) into v_maj
    from jsonb_array_elements(case when jsonb_typeof(p_options->'majorite') = 'array' then p_options->'majorite' else '[]'::jsonb end) q
   where jsonb_typeof(q) = 'string';

  select jsonb_agg(p::text order by random()) into v_order from jsonb_array_elements_text(v_ids) p;
  if jsonb_typeof(v_fiche->'stars') = 'array' then
    -- Grande taille : des étoiles par zone (la base : 2 ou 3 selon le nombre de joueurs ; chaque quartier : n).
    v_star := '[]'::jsonb;
    for v_zone in select x from jsonb_array_elements(v_fiche->'stars') x loop
      v_star := v_star || coalesce((select jsonb_agg(i order by i)
        from (select l::integer i from jsonb_array_elements_text(v_zone->'loges') l
               where not v_wet @> to_jsonb(l::integer) order by random()
               limit case when (v_zone->>'n')::integer = 0 then greatest(2, (c->'star_count'->>(v_n - 2))::integer)
                          else (v_zone->>'n')::integer end) z), '[]'::jsonb);
    end loop;
  else
    -- 1 à 3 étoiles en jeu selon le nombre de joueurs, chacune sur sa Loge du plateau (jamais sous l'eau).
    select jsonb_agg(i order by i) into v_star
      from (select (o - 1)::integer i from jsonb_array_elements_text(public._dp_board(v_map, v_size)) with ordinality t(x, o)
             where x = 'loge' and not v_wet @> to_jsonb((o - 1)::integer) order by random()
             limit (c->'star_count'->>(v_n - 2))::integer) z;
  end if;
  select jsonb_object_agg(p::text, 0) into v_zero from jsonb_array_elements_text(v_ids) p;
  -- Départs : tout le monde au Départ ; en taille L, par deux sur ceil(n / 2) haltes tirées au sort (le joueur de
  -- rang k dans l'ordre de passage part de la halte k mod nb), sans bonus de halte au placement.
  v_pos := v_zero;
  if jsonb_typeof(v_fiche->'starts') = 'array' then
    select jsonb_agg(x) into v_spots
      from (select x from jsonb_array_elements(v_fiche->'starts') x order by random() limit ceil(v_n / 2.0)::integer) z;
    select jsonb_object_agg(x, v_spots->(((o - 1)::integer) % jsonb_array_length(v_spots))) into v_pos
      from jsonb_array_elements_text(v_order) with ordinality t(x, o);
  end if;

  v_state := jsonb_build_object(
    'game', 'dede-party',
    'phase', 'intro',
    'players', v_ids,
    'bots', v_bots,
    'round', 0,
    'rounds', v_rounds,
    'total_rounds', v_rounds,
    'order', v_order,
    'pos', v_pos,
    'dist', v_zero,
    'coins', (select jsonb_object_agg(p::text, (c->>'start_coins')::integer) from jsonb_array_elements_text(v_ids) p),
    'stars', v_zero,
    'star_cells', v_star,
    'map', v_map,
    -- Taille du plateau (s, m, l), figée au lancement (absente : partie lancée avant les grandes tailles = s).
    'size', v_size,
    'mech', v_mech,
    -- Un aiguillage par embranchement du plateau (mer : tenu par la marée, 1 − tide).
    'sw', v_sw,
    'epi', null,
    -- Promo de bienvenue : la première étoile de chacun est à moitié prix.
    'half_price', (select jsonb_object_agg(p::text, true) from jsonb_array_elements_text(v_ids) p),
    'double_left', (select jsonb_object_agg(p::text, 1) from jsonb_array_elements_text(v_ids) p),
    'rolls', (select jsonb_object_agg(p::text, null) from jsonb_array_elements_text(v_ids) p),
    'moves', '[]'::jsonb,
    'moves_at', null,
    'before', null,
    'mg_no', 0,
    'mg', null,
    'awards', null,
    'ranking', null,
    'winners', null,
    'results', null,
    'forced', false,
    'stats', (select jsonb_object_agg(p::text, '{"pubs":0,"broke":0,"coins_earned":0,"envelopes":0,"star_exact":0,"stars_bought":0,"mg_wins":0,"mg_streak":0,"mg_streak_max":0,"doubles":0,"washed":0,"toll_paid":0,"jackpots":0,"jackpot_best":0,"robbed":0,"loot":0,"lifts":0,"slides":0}'::jsonb) from jsonb_array_elements_text(v_ids) p),
    -- Générique : 8 s (S), 10 s (M : on survole les quartiers), 12 s (L : et on dépose les pions sur leurs haltes).
    'deadline', now() + make_interval(secs => (c->>(case v_size when 'l' then 'intro_l' when 'm' then 'intro_m' else 'intro_s' end))::integer));

  return jsonb_build_object(
    'state', v_state,
    'server', jsonb_build_object('q', jsonb_build_object('quiz', v_quiz, 'pif', v_pif, 'majorite', v_maj),
                                 'qi', '{}'::jsonb, 'bag', '[]'::jsonb, 'deck', '[]'::jsonb, 'dice_i', 0, 'subs', '{}'::jsonb, 'mg', null),
    'secrets', '{}'::jsonb);
end $$;

create or replace function public.game_dede_party_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_type   text := p_action->>'type';
  v_phase  text := p_state->>'phase';
  v_me     text := p_actor::text;
  v_late   boolean := p_state->>'deadline' is not null and now() >= (p_state->>'deadline')::timestamptz;
  v_double boolean;
  v_r      jsonb;
  v_sub    jsonb;
begin
  -- ---------------------------------------------------------------- roll (lancer de dé)
  if v_type = 'roll' then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if v_phase <> 'roll' then raise exception 'wrong_phase'; end if;
    if jsonb_typeof(p_state->'rolls'->v_me) = 'object' then raise exception 'already_rolled'; end if;
    v_double := coalesce(p_action->'double' = 'true'::jsonb, false);
    if v_double and coalesce((p_state->'double_left'->>v_me)::integer, 0) < 1 then raise exception 'no_double_left'; end if;
    v_r := public._dp_do_roll(p_state, p_server, v_me, v_double);
    p_state := v_r->'state';
    p_server := v_r->'server';
    -- Tout le monde a lancé, ou l'échéance est passée : le tour se résout.
    if v_late or not exists (select 1 from jsonb_array_elements_text(p_state->'players') x
                              where jsonb_typeof(p_state->'rolls'->x) is distinct from 'object') then
      return public._dp_resolve(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- mg_submit (un envoi par mini-jeu)
  elsif v_type = 'mg_submit' then
    if not ((p_state->'players') ? v_me) then raise exception 'not_a_player'; end if;
    if jsonb_typeof(p_action->'no') is distinct from 'number' then raise exception 'invalid_submit'; end if;
    -- Autre mini-jeu, mini-jeu pas encore commencé ou déjà clos, doublon : ignoré sans erreur.
    if (p_action->>'no')::numeric <> coalesce((p_state->'mg'->>'no')::numeric, -1)
       or v_phase <> 'mg_play' or (p_state->'mg'->'submitted') ? v_me then
      return jsonb_build_object('state', p_state, 'server', p_server);
    end if;
    -- Envoi après l'échéance + 3 s de tolérance réseau : le mini-jeu se clôt sans lui.
    if v_late and now() > (p_state->>'deadline')::timestamptz + interval '3 seconds' then
      return public._dp_close_mg(p_state, p_server);
    end if;
    v_sub := public._dp_check_submit(p_state, p_action->'payload');
    p_server := jsonb_set(p_server, array['subs', v_me], v_sub, true);
    p_state := jsonb_set(p_state, '{mg,submitted}', (p_state->'mg'->'submitted') || to_jsonb(v_me));
    if jsonb_array_length(p_state->'mg'->'submitted') >= jsonb_array_length(p_state->'players') then
      return public._dp_close_mg(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- tick (échéances)
  elsif v_type = 'tick' then
    if v_late and v_phase <> 'finished' then
      return public._dp_advance(p_state, p_server);
    end if;
    return jsonb_build_object('state', p_state, 'server', p_server);

  -- ---------------------------------------------------------------- skip (hôte : passer la phase)
  elsif v_type = 'skip' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase = 'finished' then raise exception 'wrong_phase'; end if;
    return public._dp_advance(p_state, p_server);

  -- ---------------------------------------------------------------- end_game (hôte : cérémonie tout de suite)
  elsif v_type = 'end_game' then
    if not p_is_host then raise exception 'not_host'; end if;
    if v_phase = 'finished' then raise exception 'wrong_phase'; end if;
    if v_phase = 'awards' then return public._dp_finish(p_state, p_server); end if;
    p_state := jsonb_set(p_state, '{forced}', 'true'::jsonb);
    return jsonb_build_object('state', public._dp_awards(p_state), 'server', p_server || '{"subs":{}}'::jsonb);

  else
    raise exception 'unknown_action';
  end if;
end $$;

revoke all on function public._dp_const() from public, anon, authenticated;
revoke all on function public._dp_maps() from public, anon, authenticated;
revoke all on function public._dp_sizes() from public, anon, authenticated;
revoke all on function public._dp_key(text, text) from public, anon, authenticated;
revoke all on function public._dp_size(text, integer, text) from public, anon, authenticated;
revoke all on function public._dp_banks(text, text) from public, anon, authenticated;
revoke all on function public._dp_wet(jsonb) from public, anon, authenticated;
revoke all on function public._dp_board(text, text) from public, anon, authenticated;
revoke all on function public._dp_next(text, text) from public, anon, authenticated;
revoke all on function public._dp_prev(text, text) from public, anon, authenticated;
revoke all on function public._dp_map(text, text) from public, anon, authenticated;
revoke all on function public._dp_star_check(jsonb, text, integer, boolean) from public, anon, authenticated;
revoke all on function public._dp_riton_hit(jsonb, text, integer) from public, anon, authenticated;
revoke all on function public._dp_epilogue(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_cards() from public, anon, authenticated;
revoke all on function public._dp_kinds() from public, anon, authenticated;
revoke all on function public._dp_die(jsonb) from public, anon, authenticated;
revoke all on function public._dp_draw(jsonb) from public, anon, authenticated;
revoke all on function public._dp_snap(jsonb) from public, anon, authenticated;
revoke all on function public._dp_stat(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._dp_coins(jsonb, text, integer, text) from public, anon, authenticated;
revoke all on function public._dp_move_star(jsonb, integer) from public, anon, authenticated;
revoke all on function public._dp_walk(jsonb, text, integer, integer) from public, anon, authenticated;
revoke all on function public._dp_order_idx(jsonb, text) from public, anon, authenticated;
revoke all on function public._dp_land(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public._dp_open_roll(jsonb) from public, anon, authenticated;
revoke all on function public._dp_do_roll(jsonb, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public._dp_resolve(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_pick_kind(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_next_q(jsonb, text) from public, anon, authenticated;
revoke all on function public._dp_open_mg(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_play_mg(jsonb) from public, anon, authenticated;
revoke all on function public._dp_check_submit(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_close_mg(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_awards(jsonb) from public, anon, authenticated;
revoke all on function public._dp_tstats(jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public._dp_finish(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_bots_roll(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_bot_sub(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._dp_advance(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_dede_party_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_dede_party_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;


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
    'hint', case when v_word is null then null else to_jsonb(v_word->>'word') end,
    'last_turn', jsonb_build_object(
      'turn', p_state->'turn', 'drawer', p_state->'drawer',
      'word', v_word->>'word', 'found', p_state->'found',
      'points', p_state->'turn_points', 'skipped', p_skipped),
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
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select p_state || jsonb_build_object(
    'phase', 'ready',
    'turn_no', coalesce((p_state->>'turn_no')::integer, 0) + 1,
    'budget', p_budget,
    'carried', p_carried,
    'deadline', null,
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
