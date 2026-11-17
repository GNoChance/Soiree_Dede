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
    'deadline', public._mtr_iso(now() + make_interval(secs => (p_state->>'turn_seconds')::integer + p_grace)));
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
  if v_phase not in ('bidding', 'reveal') then raise exception 'wrong_phase'; end if;
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
      'deadline', public._mtr_iso(now() + make_interval(secs => (p_state->>'turn_seconds')::integer)));

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
