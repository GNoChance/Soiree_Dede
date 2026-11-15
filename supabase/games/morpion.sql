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
    return jsonb_build_object('board', p_board, 'outcome', 'win', 'winner', p_actor);
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
