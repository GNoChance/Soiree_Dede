-- =============================================================================
-- JEU « dede-party » (Dédé Party, « Le Grand Plateau de Dédé ») — idempotent.
-- Dépend de schema.sql (game_action, start_match, finish_match).
-- Conception : docs/superpowers/specs/2026-11-19-dede-party-design.md (section « Décisions »).
--
-- Party game de plateau : boucle de 24 cases, étoiles à 20 pièces, un mini-jeu à chaque tour.
-- Tout le monde lance son dé EN MÊME TEMPS ; le serveur résout tout le tour d'un coup
-- (scénario `moves`, que les écrans ne font qu'animer). Aucune décision sur le plateau.
--
-- Phases (toutes enchaînées par `deadline` + {"type":"tick"} idempotent, l'hôte n'a rien à cliquer) :
--   intro (5 s) -> roll (15 s) -> move (2 + 5 s × joueurs) -> mg_intro (8 s) -> mg_play (selon le
--   mini-jeu) -> mg_result (8 s) -> roll … -> awards (12 s, étoiles bonus) -> finished.
-- Actions : roll {double?} · mg_submit {no, payload} · tick · skip (hôte) · end_game (hôte).
-- `server` (jamais exposé) : questions et réponses, sac de mini-jeux, pioche de cartes, envois
-- des joueurs avant résultat ; `forced_dice` / `forced_cards` / `forced_mg` pour les tests.
-- =============================================================================

-- Constantes d'équilibrage (simulation : tools/sql-tests/dede-party.mjs).
create or replace function public._dp_const()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '{"cells":24,"star_price":20,"half_price":10,"start_coins":10,"start_bonus":5,"clap":3,"pub":3,"gains":[10,6,4,2],"roll_s":15,"move_s":5,"intro_s":5,"mg_intro_s":8,"mg_result_s":8,"awards_s":12,"star_cap":30,"chrono_target":7000}'::jsonb $$;

-- Plateau « Le Grand Plateau de Dédé » : type de chaque case (index 0 = Départ).
-- Dupliqué avec src/games/dede-party/board.ts (synchro vérifiée par tools/sql-tests/dede-party.mjs).
create or replace function public._dp_board()
returns jsonb language sql immutable
set search_path = public, extensions
as $$ select '["start","clap","loge","pub","clap","env","loge","clap","clap","pub","loge","env","clap","loge","clap","pub","env","clap","loge","clap","pub","env","loge","clap"]'::jsonb $$;

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
  {"id":"star_moves","text":"Changement de décor : l’étoile déménage !"},
  {"id":"reroll","text":"Bis ! Relance un dé et avance."},
  {"id":"half_price","text":"Promo du jour : ta prochaine étoile est à moitié prix !"},
  {"id":"gift_double","text":"Cadeau de Dédé : un Double dé en plus !"}
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
                            'star_cell', p_state->'star_cell', 'dist', p_state->'dist')
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

-- L'étoile déménage dans une autre Loge, tirée au sort.
create or replace function public._dp_move_star(p_state jsonb)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_cur  integer := (p_state->>'star_cell')::integer;
  v_cell integer;
begin
  select (o - 1)::integer into v_cell
    from jsonb_array_elements_text(public._dp_board()) with ordinality t(c, o)
   where c = 'loge' and (o - 1) <> v_cur
   order by random() limit 1;
  return jsonb_set(p_state, '{star_cell}', to_jsonb(v_cell));
end $$;

-- Fait marcher le pion de p_pid de p_n cases (p_dir = 1 en avant, -1 en arrière).
-- Applique le passage par Départ (+5, en avant seulement) et l'achat automatique de l'étoile
-- (au passage comme à l'arrêt). Renvoie {state, steps:[{cell, ev:[...]}]}.
create or replace function public._dp_walk(p_state jsonb, p_pid text, p_n integer, p_dir integer)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  c       jsonb := public._dp_const();
  v_cells integer := (c->>'cells')::integer;
  v_pos   integer := (p_state->'pos'->>p_pid)::integer;
  v_steps jsonb := '[]'::jsonb;
  v_ev    jsonb;
  v_price integer;
  v_old   integer;
  k       integer;
begin
  for k in 1 .. greatest(p_n, 0) loop
    v_pos := ((v_pos + p_dir) % v_cells + v_cells) % v_cells;
    p_state := jsonb_set(p_state, array['pos', p_pid], to_jsonb(v_pos));
    p_state := jsonb_set(p_state, array['dist', p_pid], to_jsonb(coalesce((p_state->'dist'->>p_pid)::integer, 0) + p_dir));
    v_ev := '[]'::jsonb;
    if p_dir > 0 and v_pos = 0 then
      v_old := (p_state->'coins'->>p_pid)::integer;
      p_state := public._dp_coins(p_state, p_pid, (c->>'start_bonus')::integer, 'start');
      v_ev := v_ev || jsonb_build_object('t', 'start', 'd', (p_state->'coins'->>p_pid)::integer - v_old);
    end if;
    if v_pos = (p_state->>'star_cell')::integer then
      v_price := case when coalesce((p_state->'half_price'->>p_pid)::boolean, false)
                      then (c->>'half_price')::integer else (c->>'star_price')::integer end;
      if (p_state->'coins'->>p_pid)::integer >= v_price then
        p_state := public._dp_coins(p_state, p_pid, -v_price, 'star');
        p_state := jsonb_set(p_state, array['stars', p_pid], to_jsonb((p_state->'stars'->>p_pid)::integer + 1));
        p_state := jsonb_set(p_state, array['half_price', p_pid], 'false'::jsonb);
        p_state := public._dp_stat(p_state, p_pid, 'stars_bought', 1);
        if k = p_n then p_state := public._dp_stat(p_state, p_pid, 'star_exact', 1); end if;
        p_state := public._dp_move_star(p_state);
        v_ev := v_ev || jsonb_build_object('t', 'star', 'cost', v_price, 'to', p_state->'star_cell', 'exact', k = p_n);
      else
        v_ev := v_ev || jsonb_build_object('t', 'star_poor', 'need', v_price);
      end if;
    end if;
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
-- Renvoie {state, server, ev:[...], steps:[...] (déplacements dus à une carte, marqués card)}.
create or replace function public._dp_land(p_state jsonb, p_server jsonb, p_pid text)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  c        jsonb := public._dp_const();
  v_cell   integer := (p_state->'pos'->>p_pid)::integer;
  v_type   text := public._dp_board()->>v_cell;
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
      p_state := public._dp_move_star(p_state);
      v_cev := v_cev || jsonb_build_object('to', p_state->'star_cell');
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
    'deadline', now() + make_interval(secs => (public._dp_const()->>'roll_s')::integer));
end $$;

-- Lance le dé (ou les deux dés) de p_pid.
create or replace function public._dp_do_roll(p_state jsonb, p_server jsonb, p_pid text, p_double boolean)
returns jsonb language plpgsql
set search_path = public, extensions
as $$
declare
  v_d1 integer;
  v_d2 integer;
  v_dice jsonb;
begin
  select d.p_server, d.v into p_server, v_d1 from public._dp_die(p_server) d;
  v_dice := jsonb_build_array(v_d1);
  if p_double then
    select d.p_server, d.v into p_server, v_d2 from public._dp_die(p_server) d;
    v_dice := v_dice || to_jsonb(v_d2);
    p_state := jsonb_set(p_state, array['double_left', p_pid], to_jsonb((p_state->'double_left'->>p_pid)::integer - 1));
    p_state := public._dp_stat(p_state, p_pid, 'doubles', 1);
  end if;
  p_state := jsonb_set(p_state, array['rolls', p_pid], jsonb_build_object('dice', v_dice, 'double', p_double, 'at', now()));
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Résout tout le tour : chaque pion, dans l'ordre de passage, avance, puis effet de sa case.
-- Le scénario (moves) est publié pour l'animation ; chaque entrée porte l'instantané `after`.
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

  p_state := p_state || jsonb_build_object(
    'phase', 'move',
    'moves', v_moves,
    'before', v_before,
    'moves_at', now(),
    'deadline', now() + make_interval(secs => 2 + v_n * (public._dp_const()->>'move_s')::integer));
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
    'win_mvp', case when p_won and v_king then 1 else 0 end);
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
  return jsonb_build_object('state', p_state, 'server', p_server, 'results', v_results);
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
    return jsonb_build_object('state', public._dp_open_roll(p_state), 'server', p_server);
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
    return jsonb_build_object('state', public._dp_open_roll(p_state), 'server', p_server);
  elsif v_phase = 'awards' then
    return public._dp_finish(p_state, p_server);
  end if;
  return jsonb_build_object('state', p_state, 'server', p_server);
end $$;

-- Options : {"rounds": 6|9|12 (défaut 9), "quiz": [{prompt, answer, distractors[3]}],
--            "pif": [{prompt, answer, unit?}], "majorite": ["Qui de nous… ?"]} (tirées par le front).
create or replace function public.game_dede_party_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  c        jsonb := public._dp_const();
  v_rounds integer;
  v_quiz   jsonb;
  v_pif    jsonb;
  v_maj    jsonb;
  v_order  jsonb;
  v_state  jsonb;
  v_zero   jsonb;
  v_star   integer;
begin
  if coalesce(cardinality(p_players), 0) < 2 then raise exception 'not_enough_players'; end if;
  if cardinality(p_players) > 8 then raise exception 'too_many_players'; end if;

  v_rounds := case when coalesce(p_options->>'rounds', '') ~ '^\d{1,2}$' then (p_options->>'rounds')::integer else 9 end;
  if v_rounds not in (6, 9, 12) then v_rounds := 9; end if;

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

  select jsonb_agg(p::text order by random()) into v_order from unnest(p_players) p;
  select (o - 1)::integer into v_star from jsonb_array_elements_text(public._dp_board()) with ordinality t(x, o)
   where x = 'loge' order by random() limit 1;
  select jsonb_object_agg(p::text, 0) into v_zero from unnest(p_players) p;

  v_state := jsonb_build_object(
    'game', 'dede-party',
    'phase', 'intro',
    'players', to_jsonb(p_players),
    'round', 0,
    'rounds', v_rounds,
    'total_rounds', v_rounds,
    'order', v_order,
    'pos', v_zero,
    'dist', v_zero,
    'coins', (select jsonb_object_agg(p::text, (c->>'start_coins')::integer) from unnest(p_players) p),
    'stars', v_zero,
    'star_cell', v_star,
    'half_price', (select jsonb_object_agg(p::text, false) from unnest(p_players) p),
    'double_left', (select jsonb_object_agg(p::text, 1) from unnest(p_players) p),
    'rolls', (select jsonb_object_agg(p::text, null) from unnest(p_players) p),
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
    'stats', (select jsonb_object_agg(p::text, '{"pubs":0,"broke":0,"coins_earned":0,"envelopes":0,"star_exact":0,"stars_bought":0,"mg_wins":0,"mg_streak":0,"mg_streak_max":0,"doubles":0}'::jsonb) from unnest(p_players) p),
    'deadline', now() + make_interval(secs => (c->>'intro_s')::integer));

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
revoke all on function public._dp_board() from public, anon, authenticated;
revoke all on function public._dp_cards() from public, anon, authenticated;
revoke all on function public._dp_kinds() from public, anon, authenticated;
revoke all on function public._dp_die(jsonb) from public, anon, authenticated;
revoke all on function public._dp_draw(jsonb) from public, anon, authenticated;
revoke all on function public._dp_snap(jsonb) from public, anon, authenticated;
revoke all on function public._dp_stat(jsonb, text, text, integer) from public, anon, authenticated;
revoke all on function public._dp_coins(jsonb, text, integer, text) from public, anon, authenticated;
revoke all on function public._dp_move_star(jsonb) from public, anon, authenticated;
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
revoke all on function public._dp_advance(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.game_dede_party_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_dede_party_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
