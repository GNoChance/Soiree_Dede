-- =============================================================================
-- JEU « 4 à la suite » (id quatre-a-la-suite) — jeu en DUEL (socle
-- supabase/features/duel.sql). Règles traditionnelles « aligner 4 jetons » :
-- grille de 7 colonnes × 6 lignes, on lâche un jeton dans une colonne, il tombe
-- sur la plus basse case libre. 4 jetons alignés (horizontale, verticale ou
-- diagonale) = manche gagnée ; grille pleine = nul.
--
-- Plateau public (state.board) :
--   {"width":7, "height":6,
--    "cols": [["<uid>", ...] x7],      -- chaque colonne, du BAS vers le haut
--    "a": "<uid>", "b": "<uid>",       -- duellistes (a = couleur 1, b = couleur 2)
--    "count": n,                       -- jetons posés
--    "last": {"col":c, "row":r, "by":"<uid>"} | null,   -- row 0 = en bas
--    "line": [[c, r], ...] | null}     -- jetons gagnants (4 ou plus, plusieurs lignes possibles)
-- Coup : {"col": 0..6}. Pas de secret, pas de server, pas de préparation.
-- =============================================================================

-- Propriétaire de la case (c, r) ou null (hors grille / vide).
create or replace function public._q4s_cell(p_cols jsonb, p_c integer, p_r integer)
returns text language sql immutable
set search_path = public, extensions
as $$
  select case when p_c between 0 and 6 and p_r between 0 and 5 then p_cols->p_c->>p_r end;
$$;

-- Cases alignées (>= 4) passant par (c, r) pour p_who, toutes directions ; null sinon.
create or replace function public._q4s_line(p_cols jsonb, p_c integer, p_r integer, p_who text)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_dirs  integer[] := array[1,0, 0,1, 1,1, 1,-1];
  v_line  jsonb := '[]'::jsonb;
  v_seg   jsonb;
  dc      integer;
  dr      integer;
  k       integer;
  i       integer;
begin
  for i in 0 .. 3 loop
    dc := v_dirs[i * 2 + 1];
    dr := v_dirs[i * 2 + 2];
    v_seg := jsonb_build_array(jsonb_build_array(p_c, p_r));
    k := 1;
    while public._q4s_cell(p_cols, p_c + k * dc, p_r + k * dr) = p_who loop
      v_seg := v_seg || jsonb_build_array(jsonb_build_array(p_c + k * dc, p_r + k * dr));
      k := k + 1;
    end loop;
    k := 1;
    while public._q4s_cell(p_cols, p_c - k * dc, p_r - k * dr) = p_who loop
      v_seg := v_seg || jsonb_build_array(jsonb_build_array(p_c - k * dc, p_r - k * dr));
      k := k + 1;
    end loop;
    if jsonb_array_length(v_seg) >= 4 then
      v_line := v_line || (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(v_seg) e
                            where not (v_line @> jsonb_build_array(e)));
    end if;
  end loop;
  return case when jsonb_array_length(v_line) > 0 then v_line end;
end $$;

-- ---------------------------------------------------------------- hooks du socle

create or replace function public.game_quatre_a_la_suite_board_new(p_ctx jsonb, p_a text, p_b text)
returns jsonb language sql immutable
set search_path = public, extensions
as $$
  select jsonb_build_object('board', jsonb_build_object(
    'width', 7, 'height', 6,
    'cols', '[[],[],[],[],[],[],[]]'::jsonb,
    'a', p_a, 'b', p_b,
    'count', 0, 'last', null, 'line', null));
$$;

create or replace function public.game_quatre_a_la_suite_board_move(p_board jsonb, p_server jsonb, p_actor text, p_move jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_c     integer;
  v_r     integer;
  v_cols  jsonb := p_board->'cols';
  v_line  jsonb;
  v_count integer := coalesce((p_board->>'count')::integer, 0) + 1;
begin
  if jsonb_typeof(p_move->'col') is distinct from 'number' or coalesce(p_move->>'col', '') !~ '^[0-6]$' then
    raise exception 'invalid_move';
  end if;
  v_c := (p_move->>'col')::integer;
  v_r := jsonb_array_length(v_cols->v_c);
  if v_r >= 6 then raise exception 'column_full'; end if;
  v_cols := jsonb_set(v_cols, array[v_c::text], (v_cols->v_c) || to_jsonb(p_actor));
  v_line := public._q4s_line(v_cols, v_c, v_r, p_actor);
  p_board := p_board || jsonb_build_object(
    'cols', v_cols, 'count', v_count,
    'last', jsonb_build_object('col', v_c, 'row', v_r, 'by', p_actor),
    'line', v_line);
  if v_line is not null then
    return jsonb_build_object('board', p_board, 'outcome', 'win', 'winner', p_actor);
  elsif v_count >= 42 then
    return jsonb_build_object('board', p_board, 'outcome', 'draw');
  end if;
  return jsonb_build_object('board', p_board, 'outcome', null);
end $$;

-- Coup automatique (minuteur) : une colonne non pleine au hasard.
create or replace function public.game_quatre_a_la_suite_board_auto(p_board jsonb, p_server jsonb, p_actor text)
returns jsonb language sql volatile
set search_path = public, extensions
as $$
  select jsonb_build_object('col', c)
    from generate_series(0, 6) as c
   where jsonb_array_length(p_board->'cols'->c) < 6
   order by random() limit 1;
$$;

-- ---------------------------------------------------------------- moteur (délégation au socle)

-- Hook de trophées du socle duel (features/duel.sql, _duel_tstats) : stats propres au jeu.
-- « jetons » = coups des deux joueurs au total.
create or replace function public.game_quatre_a_la_suite_trophy_stats(p_state jsonb, p_pl text)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'fast_loss', count(*) filter (where lost and moves <= 10),
    'long_win', count(*) filter (where won and moves >= 36),
    'fast_win', count(*) filter (where won and moves <= 12))
  from public._duel_games(p_state, p_pl)
$$;
revoke all on function public.game_quatre_a_la_suite_trophy_stats(jsonb, text) from public, anon, authenticated;

create or replace function public.game_quatre_a_la_suite_start(p_players uuid[], p_options jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if cardinality(p_players) > 9 then raise exception 'too_many_players'; end if;
  return public._duel_start('quatre-a-la-suite', p_players, p_options);
end $$;

create or replace function public.game_quatre_a_la_suite_action(
  p_state jsonb, p_server jsonb, p_actor uuid, p_is_host boolean, p_action jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._duel_action('quatre-a-la-suite', p_state, p_server, p_actor, p_is_host, p_action);
end $$;

revoke all on function public._q4s_cell(jsonb, integer, integer) from public, anon, authenticated;
revoke all on function public._q4s_line(jsonb, integer, integer, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_new(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_move(jsonb, jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_board_auto(jsonb, jsonb, text) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_start(uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.game_quatre_a_la_suite_action(jsonb, jsonb, uuid, boolean, jsonb) from public, anon, authenticated;
