-- =============================================================================
-- JEU « Bataille navale » (id bataille-navale) — jeu en DUEL (socle
-- supabase/features/duel.sql) avec PRÉPARATION SIMULTANÉE (hook board_setup).
-- Règles traditionnelles :
--  * grille 10 × 10 : colonnes A–J (x = 0..9), lignes 1–10 (y = 0..9) ;
--  * flotte classique : porte-avions 5, cuirassé 4, croiseur 3, sous-marin 3,
--    torpilleur 2 (17 cases) ;
--  * préparation 60 s, en même temps pour les deux duellistes : une flotte
--    tirée au hasard est proposée d'office (bateaux SANS CONTACT, même en
--    diagonale) ; chacun peut mélanger ou placer à la main (contact AUTORISÉ,
--    chevauchement interdit), puis « Prêt ! ». À l'échéance, la flotte
--    courante est validée (au hasard si elle manque) ;
--  * un tir par tour : « touché » ou « coulé » -> le tireur rejoue ; « à
--    l'eau » -> tour adverse. Toute la flotte adverse coulée = manche gagnée
--    (pas de nul possible). 30 s par tir (socle) ; à l'échéance, tir auto au
--    hasard, en mode « chasse » autour des touchés non coulés.
--
-- Bateau : {"id": "porte-avions"|"cuirasse"|"croiseur"|"sous-marin"|"torpilleur",
--           "x": 0..9, "y": 0..9, "dir": "h"|"v"}
--   (x, y) = première case (gauche / haut) ; h = vers la droite, v = vers le bas.
-- Flotte = tableau des 5 bateaux, chacun une fois (ordre libre en entrée,
-- normalisé dans l'ordre de la composition).
--
-- Plateau PUBLIC (state.board) — jamais aucune case de bateau non coulé :
--   {"size": 10, "a": uid, "b": uid, "duel_no": n, "game_no": n,
--    "ships":  [{"id", "name", "size"}],                 -- composition (ordre d'affichage)
--    "waters": {"<uid>": {"shots": [{"x", "y", "r": "miss|hit|sunk"}],  -- tirs REÇUS par uid, dans l'ordre
--                         "sunk":  [bateau],             -- bateaux de uid coulés (révélés)
--                         "left":  5}},                  -- bateaux de uid encore à flot
--    "stats":  {"<uid>": {"shots", "hits", "streak", "best"}},  -- tirs TIRÉS par uid ; série de touchés
--    "count":  n,                                        -- tirs de la manche
--    "last":   {"by", "x", "y", "r", "ship": id|null} | null,   -- ship renseigné seulement si coulé
--    "reveal": {"<uid>": flotte} | null}                 -- fin de manche : les deux flottes révélées
--   r = "sunk" pour toutes les cases d'un bateau coulé (les tirs « hit » passent à « sunk »).
-- Server (match_server_state, privé) : {"fleets": {"<uid>": flotte}}.
-- Secret de chaque duelliste (match_secrets, upsert à chaque changement) :
--   {"duel_no", "game_no", "me", "fleet": flotte, "received": [tirs reçus = waters[me].shots]}.
-- Coups : préparation {"type":"place","ships":[bateau x5]} | {"type":"shuffle"} ;
--         bataille {"x": 0..9, "y": 0..9} (exactement ces deux clés, sinon invalid_move :
--         le socle recopie le coup dans duel.last_move, public).
-- Erreurs : invalid_fleet, fleet_overlap, setup_incomplete, already_shot, invalid_move.
-- =============================================================================

-- Composition de la flotte (ordre d'affichage et de placement).
create or replace function public._bn_ships()
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select '[{"id": "porte-avions", "name": "Porte-avions", "size": 5},
           {"id": "cuirasse",     "name": "Cuirassé",     "size": 4},
           {"id": "croiseur",     "name": "Croiseur",     "size": 3},
           {"id": "sous-marin",   "name": "Sous-marin",   "size": 3},
           {"id": "torpilleur",   "name": "Torpilleur",   "size": 2}]'::jsonb;
$$;

-- Cases (indices y * 10 + x) d'un bateau ; null si malformé ou hors de la grille.
create or replace function public._bn_cells(p_ship jsonb)
returns integer[] language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_size integer;
  v_x    integer;
  v_y    integer;
begin
  if jsonb_typeof(p_ship) is distinct from 'object' then return null; end if;
  select (e->>'size')::integer into v_size
    from jsonb_array_elements(public._bn_ships()) as e where e->>'id' = p_ship->>'id';
  if v_size is null
     or jsonb_typeof(p_ship->'x') is distinct from 'number' or jsonb_typeof(p_ship->'y') is distinct from 'number'
     or p_ship->>'x' !~ '^[0-9]$' or p_ship->>'y' !~ '^[0-9]$' then
    return null;
  end if;
  v_x := (p_ship->>'x')::integer;
  v_y := (p_ship->>'y')::integer;
  if p_ship->>'dir' = 'h' and v_x + v_size <= 10 then
    return array(select v_y * 10 + v_x + k from generate_series(0, v_size - 1) as k order by k);
  elsif p_ship->>'dir' = 'v' and v_y + v_size <= 10 then
    return array(select (v_y + k) * 10 + v_x from generate_series(0, v_size - 1) as k order by k);
  end if;
  return null;
end $$;

-- Erreur d'une flotte (null si valide) : 5 bateaux, chacun une fois, dans la
-- grille ('invalid_fleet'), sans chevauchement ('fleet_overlap'). Le contact
-- (même en diagonale) est autorisé en placement manuel.
create or replace function public._bn_fleet_error(p_fleet jsonb)
returns text language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_def  jsonb;
  v_ship jsonb;
  v_n    integer;
  v_c    integer[];
  v_all  integer[] := '{}'::integer[];
  v_over boolean := false;
begin
  if jsonb_typeof(p_fleet) is distinct from 'array'
     or jsonb_array_length(p_fleet) <> jsonb_array_length(public._bn_ships()) then
    return 'invalid_fleet';
  end if;
  for v_def in select e from jsonb_array_elements(public._bn_ships()) as e loop
    select count(*)::integer, min(s::text)::jsonb into v_n, v_ship
      from jsonb_array_elements(p_fleet) as s
     where jsonb_typeof(s) = 'object' and s->>'id' = v_def->>'id';
    if v_n <> 1 then return 'invalid_fleet'; end if;
    v_c := public._bn_cells(v_ship);
    if v_c is null then return 'invalid_fleet'; end if;
    if v_all && v_c then v_over := true; end if;
    v_all := v_all || v_c;
  end loop;
  return case when v_over then 'fleet_overlap' end;
end $$;

-- Flotte (supposée valide) normalisée : ordre de la composition, {id, x, y, dir} seuls.
create or replace function public._bn_fleet_norm(p_fleet jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.e->>'id', 'x', (f.s->>'x')::integer,
                                               'y', (f.s->>'y')::integer, 'dir', f.s->>'dir') order by d.o),
                  '[]'::jsonb)
    from jsonb_array_elements(public._bn_ships()) with ordinality as d(e, o)
    cross join lateral (select x.s from jsonb_array_elements(p_fleet) as x(s)
                         where jsonb_typeof(x.s) = 'object' and x.s->>'id' = d.e->>'id' limit 1) as f;
$$;

-- Valide (lève invalid_fleet / fleet_overlap) et normalise une flotte.
create or replace function public._bn_fleet_check(p_fleet jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare v_err text := public._bn_fleet_error(p_fleet);
begin
  if v_err is not null then raise exception '%', v_err; end if;
  return public._bn_fleet_norm(p_fleet);
end $$;

-- Flotte tirée au hasard, bateaux SANS CONTACT (ni bord, ni coin) : du plus
-- grand au plus petit, chaque bateau prend une position libre au hasard parmi
-- toutes les positions possibles (cases du bateau + voisines bloquées ensuite).
create or replace function public._bn_fleet_random()
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_def   jsonb;
  v_size  integer;
  v_block boolean[];
  v_fleet jsonb;
  v_ship  jsonb;
  v_x     integer;
  v_y     integer;
  v_d     text;
  v_ok    boolean;
  v_try   integer;
  c       integer;
  dx      integer;
  dy      integer;
begin
  for v_try in 1 .. 100 loop
    v_block := array_fill(false, array[100]);
    v_fleet := '[]'::jsonb;
    v_ok := true;
    for v_def in select e from jsonb_array_elements(public._bn_ships()) as e loop
      v_size := (v_def->>'size')::integer;
      select g.gx, g.gy, g.gd into v_x, v_y, v_d
        from (select gx, gy, gd
                from generate_series(0, 9) as gx, generate_series(0, 9) as gy, unnest(array['h', 'v']) as gd) as g
       where (case when g.gd = 'h' then g.gx + v_size <= 10 else g.gy + v_size <= 10 end)
         and not exists (
           select 1 from generate_series(0, v_size - 1) as k
            where v_block[(g.gy + case when g.gd = 'v' then k else 0 end) * 10
                          + g.gx + case when g.gd = 'h' then k else 0 end + 1])
       order by random() limit 1;
      if not found then v_ok := false; exit; end if;
      v_ship := jsonb_build_object('id', v_def->>'id', 'x', v_x, 'y', v_y, 'dir', v_d);
      v_fleet := v_fleet || jsonb_build_array(v_ship);
      foreach c in array public._bn_cells(v_ship) loop
        for dx in -1 .. 1 loop
          for dy in -1 .. 1 loop
            if c % 10 + dx between 0 and 9 and c / 10 + dy between 0 and 9 then
              v_block[(c / 10 + dy) * 10 + c % 10 + dx + 1] := true;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
    if v_ok then return v_fleet; end if;
  end loop;
  raise exception 'invalid_board';  -- jamais en pratique (17 cases sur 100)
end $$;

-- Bateau de la flotte occupant la case p_cell (y * 10 + x), ou null.
create or replace function public._bn_ship_at(p_fleet jsonb, p_cell integer)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select s from jsonb_array_elements(case when jsonb_typeof(p_fleet) = 'array' then p_fleet else '[]'::jsonb end) as s
   where p_cell = any(public._bn_cells(s)) limit 1;
$$;

-- Secret d'un duelliste : sa flotte + les tirs reçus (copie de waters[me].shots).
create or replace function public._bn_secret(p_board jsonb, p_me text, p_fleet jsonb)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'duel_no', p_board->'duel_no', 'game_no', p_board->'game_no', 'me', p_me,
    'fleet', p_fleet,
    'received', coalesce(p_board->'waters'->p_me->'shots', '[]'::jsonb));
$$;

-- ---------------------------------------------------------------- hooks du socle

-- Nouvelle manche : flottes tirées au hasard (proposées d'office), préparation 60 s.
create or replace function public.game_bataille_navale_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_fa    jsonb := public._bn_fleet_random();
  v_fb    jsonb := public._bn_fleet_random();
  v_n     integer := jsonb_array_length(public._bn_ships());
  v_board jsonb;
begin
  v_board := jsonb_build_object(
    'size', 10, 'a', p_a, 'b', p_b,
    'duel_no', p_ctx->'duel_no', 'game_no', p_ctx->'game_no',
    'ships', public._bn_ships(),
    'waters', jsonb_build_object(
      p_a, jsonb_build_object('shots', '[]'::jsonb, 'sunk', '[]'::jsonb, 'left', v_n),
      p_b, jsonb_build_object('shots', '[]'::jsonb, 'sunk', '[]'::jsonb, 'left', v_n)),
    'stats', jsonb_build_object(
      p_a, jsonb_build_object('shots', 0, 'hits', 0, 'streak', 0, 'best', 0),
      p_b, jsonb_build_object('shots', 0, 'hits', 0, 'streak', 0, 'best', 0)),
    'count', 0, 'last', null, 'reveal', null);
  return jsonb_build_object(
    'board', v_board,
    'server', jsonb_build_object('fleets', jsonb_build_object(p_a, v_fa, p_b, v_fb)),
    'secrets', jsonb_build_object(p_a, public._bn_secret(v_board, p_a, v_fa),
                                  p_b, public._bn_secret(v_board, p_b, v_fb)),
    'setup_seconds', 60);
end $$;

-- Préparation simultanée. Coups clients : place (flotte complète, validée
-- strictement), shuffle (nouvelle flotte au hasard). Réservés au socle : ready
-- (valider), auto (échéance : la flotte courante est gardée, au hasard si
-- absente), begin (p_actor null : on fige les deux flottes et on renvoie les secrets).
create or replace function public.game_bataille_navale_board_setup(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_type    text := p_move->>'type';
  v_srv     jsonb := case when jsonb_typeof(p_server) = 'object' then p_server else '{}'::jsonb end;
  v_fleets  jsonb;
  v_fleet   jsonb;
  v_secrets jsonb := '{}'::jsonb;
  p         text;
begin
  v_fleets := case when jsonb_typeof(v_srv->'fleets') = 'object' then v_srv->'fleets' else '{}'::jsonb end;

  if v_type = 'begin' then
    if p_actor is not null then raise exception 'invalid_move'; end if;
    foreach p in array array[p_board->>'a', p_board->>'b'] loop
      v_fleet := v_fleets->p;
      if public._bn_fleet_error(v_fleet) is not null then v_fleet := public._bn_fleet_random(); end if;
      v_fleets := v_fleets || jsonb_build_object(p, v_fleet);
      v_secrets := v_secrets || jsonb_build_object(p, public._bn_secret(p_board, p, v_fleet));
    end loop;
    return jsonb_build_object('board', p_board, 'server', v_srv || jsonb_build_object('fleets', v_fleets),
                              'secrets', v_secrets);
  end if;

  if p_actor is null or p_actor not in (p_board->>'a', p_board->>'b') then raise exception 'not_duelist'; end if;
  v_fleet := v_fleets->p_actor;
  if v_type = 'place' then
    v_fleet := public._bn_fleet_check(p_move->'ships');
  elsif v_type = 'shuffle' then
    v_fleet := public._bn_fleet_random();
  elsif v_type = 'ready' then
    if public._bn_fleet_error(v_fleet) is not null then raise exception 'setup_incomplete'; end if;
    return jsonb_build_object('board', p_board);
  elsif v_type = 'auto' then
    if public._bn_fleet_error(v_fleet) is null then
      return jsonb_build_object('board', p_board);          -- flotte courante validée telle quelle
    end if;
    v_fleet := public._bn_fleet_random();
  else
    raise exception 'invalid_move';
  end if;
  return jsonb_build_object(
    'board', p_board,
    'server', v_srv || jsonb_build_object('fleets', v_fleets || jsonb_build_object(p_actor, v_fleet)),
    'secrets', jsonb_build_object(p_actor, public._bn_secret(p_board, p_actor, v_fleet)));
end $$;

-- Un tir {x, y} de p_actor sur la flotte adverse.
create or replace function public.game_bataille_navale_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_a      text := p_board->>'a';
  v_b      text := p_board->>'b';
  v_target text;
  v_x      integer;
  v_y      integer;
  v_cell   integer;
  v_w      jsonb;
  v_shots  jsonb;
  v_fleet  jsonb;
  v_ship   jsonb;
  v_cells  integer[];
  v_hits   integer;
  v_r      text;
  v_left   integer;
  v_st     jsonb;
  v_streak integer;
  v_sec    jsonb;
begin
  if p_actor is null or p_actor not in (v_a, v_b) then raise exception 'not_duelist'; end if;
  if jsonb_typeof(p_move) is distinct from 'object'
     or jsonb_typeof(p_move->'x') is distinct from 'number' or jsonb_typeof(p_move->'y') is distinct from 'number'
     or p_move->>'x' !~ '^[0-9]$' or p_move->>'y' !~ '^[0-9]$' then
    raise exception 'invalid_move';
  end if;
  -- Exactement {x, y} : le socle recopie le coup brut dans le state public
  -- (duel.last_move.move) ; aucune clé en plus ne doit pouvoir y entrer.
  if (select count(*) from jsonb_object_keys(p_move)) <> 2 then
    raise exception 'invalid_move';
  end if;
  v_x := (p_move->>'x')::integer;
  v_y := (p_move->>'y')::integer;
  v_cell := v_y * 10 + v_x;
  v_target := case when p_actor = v_a then v_b else v_a end;
  v_w := coalesce(p_board->'waters'->v_target, '{}'::jsonb);
  v_shots := coalesce(v_w->'shots', '[]'::jsonb);
  if exists (select 1 from jsonb_array_elements(v_shots) as e
              where (e->>'y')::integer * 10 + (e->>'x')::integer = v_cell) then
    raise exception 'already_shot';
  end if;
  v_fleet := p_server->'fleets'->v_target;
  if public._bn_fleet_error(v_fleet) is not null then raise exception 'invalid_board'; end if;

  v_ship := public._bn_ship_at(v_fleet, v_cell);
  if v_ship is null then
    v_r := 'miss';
    v_shots := v_shots || jsonb_build_array(jsonb_build_object('x', v_x, 'y', v_y, 'r', 'miss'));
  else
    v_cells := public._bn_cells(v_ship);
    select count(*)::integer + 1 into v_hits from jsonb_array_elements(v_shots) as e
     where (e->>'y')::integer * 10 + (e->>'x')::integer = any(v_cells);
    v_shots := v_shots || jsonb_build_array(jsonb_build_object('x', v_x, 'y', v_y, 'r', 'hit'));
    if v_hits >= cardinality(v_cells) then
      v_r := 'sunk';
      select jsonb_agg(case when (t.e->>'y')::integer * 10 + (t.e->>'x')::integer = any(v_cells)
                            then t.e || jsonb_build_object('r', 'sunk') else t.e end order by t.o)
        into v_shots from jsonb_array_elements(v_shots) with ordinality as t(e, o);
      v_w := v_w || jsonb_build_object('sunk', coalesce(v_w->'sunk', '[]'::jsonb) || jsonb_build_array(v_ship));
    else
      v_r := 'hit';
    end if;
  end if;
  v_left := jsonb_array_length(v_fleet) - jsonb_array_length(coalesce(v_w->'sunk', '[]'::jsonb));
  v_w := v_w || jsonb_build_object('shots', v_shots, 'left', v_left);

  -- Statistiques du tireur : tirs, touchés, série de touchés en cours / record.
  v_st := coalesce(p_board->'stats'->p_actor, '{}'::jsonb);
  v_streak := case when v_r = 'miss' then 0 else coalesce((v_st->>'streak')::integer, 0) + 1 end;
  v_st := v_st || jsonb_build_object(
    'shots', coalesce((v_st->>'shots')::integer, 0) + 1,
    'hits', coalesce((v_st->>'hits')::integer, 0) + case when v_r = 'miss' then 0 else 1 end,
    'streak', v_streak,
    'best', greatest(coalesce((v_st->>'best')::integer, 0), v_streak));

  p_board := p_board || jsonb_build_object(
    'waters', coalesce(p_board->'waters', '{}'::jsonb) || jsonb_build_object(v_target, v_w),
    'stats', coalesce(p_board->'stats', '{}'::jsonb) || jsonb_build_object(p_actor, v_st),
    'count', coalesce((p_board->>'count')::integer, 0) + 1,
    'last', jsonb_build_object('by', p_actor, 'x', v_x, 'y', v_y, 'r', v_r,
                               'ship', case when v_r = 'sunk' then v_ship->'id' end));
  v_sec := jsonb_build_object(v_target, public._bn_secret(p_board, v_target, v_fleet));

  if v_left <= 0 then
    -- Toute la flotte adverse est coulée : manche gagnée, flottes révélées.
    p_board := p_board || jsonb_build_object('reveal', jsonb_build_object(
      v_a, p_server->'fleets'->v_a, v_b, p_server->'fleets'->v_b));
    return jsonb_build_object('board', p_board, 'secrets', v_sec, 'outcome', 'win', 'winner', p_actor);
  elsif v_r = 'miss' then
    return jsonb_build_object('board', p_board, 'secrets', v_sec, 'outcome', null);   -- à l'eau : tour adverse
  end if;
  return jsonb_build_object('board', p_board, 'secrets', v_sec, 'outcome', null, 'turn', p_actor);  -- touché : rejoue
end $$;

-- Tir automatique (minuteur), d'après les seules informations PUBLIQUES :
-- 1. prolonger un alignement de touchés non coulés ; 2. sinon une case voisine
-- d'un touché non coulé (« chasse ») ; 3. sinon une case non visée au hasard.
create or replace function public.game_bataille_navale_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_target text := case when p_actor = p_board->>'a' then p_board->>'b' else p_board->>'a' end;
  v_shot   boolean[] := array_fill(false, array[100]);
  v_hit    boolean[] := array_fill(false, array[100]);
  v_pick   integer;
  e        jsonb;
  i        integer;
begin
  for e in select s from jsonb_array_elements(coalesce(p_board->'waters'->v_target->'shots', '[]'::jsonb)) as s loop
    i := (e->>'y')::integer * 10 + (e->>'x')::integer;
    v_shot[i + 1] := true;
    if e->>'r' = 'hit' then v_hit[i + 1] := true; end if;
  end loop;

  select n.c into v_pick
    from (select (h / 10 + d.dy) * 10 + h % 10 + d.dx as c
            from generate_series(0, 99) as h, (values (1, 0), (-1, 0), (0, 1), (0, -1)) as d(dx, dy)
           where v_hit[h + 1]
             and h % 10 + d.dx between 0 and 9 and h / 10 + d.dy between 0 and 9
             and h % 10 - d.dx between 0 and 9 and h / 10 - d.dy between 0 and 9
             and v_hit[(h / 10 - d.dy) * 10 + h % 10 - d.dx + 1]) as n
   where not v_shot[n.c + 1]
   order by random() limit 1;

  if v_pick is null then
    select n.c into v_pick
      from (select (h / 10 + d.dy) * 10 + h % 10 + d.dx as c
              from generate_series(0, 99) as h, (values (1, 0), (-1, 0), (0, 1), (0, -1)) as d(dx, dy)
             where v_hit[h + 1]
               and h % 10 + d.dx between 0 and 9 and h / 10 + d.dy between 0 and 9) as n
     where not v_shot[n.c + 1]
     order by random() limit 1;
  end if;

  if v_pick is null then
    select c into v_pick from generate_series(0, 99) as c where not v_shot[c + 1] order by random() limit 1;
  end if;

  if v_pick is null then return null; end if;   -- impossible : la manche serait finie
  return jsonb_build_object('x', v_pick % 10, 'y', v_pick / 10);
end $$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

create or replace function public.game_bataille_navale_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  return public._duel_start('bataille-navale', p_players, p_options);
end $$;

create or replace function public.game_bataille_navale_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('bataille-navale', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._bn_ships() from public, anon, authenticated;
revoke all on function public._bn_cells(jsonb) from public, anon, authenticated;
revoke all on function public._bn_fleet_error(jsonb) from public, anon, authenticated;
revoke all on function public._bn_fleet_norm(jsonb) from public, anon, authenticated;
revoke all on function public._bn_fleet_check(jsonb) from public, anon, authenticated;
revoke all on function public._bn_fleet_random() from public, anon, authenticated;
revoke all on function public._bn_ship_at(jsonb, integer) from public, anon, authenticated;
revoke all on function public._bn_secret(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_board_setup(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_bataille_navale_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
