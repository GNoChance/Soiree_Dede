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
  -- Constellation : seuil d'étoiles selon la durée et la table (~10-25 % des joueurs partout, cf. simulation) :
  -- 2-4 joueurs : 3 / 4 / 5 ★ en 6 / 9 / 12 tours ; 5-8 joueurs : 3 / 3 / 4 ★.
  v_rounds integer := coalesce((p_state->>'rounds')::integer, 9);
  v_n      integer := (select count(*)::integer from jsonb_object_keys(coalesce(p_state->'stars', '{}'::jsonb)));
  v_need   integer := case when v_n <= 4 then case when v_rounds <= 6 then 3 when v_rounds <= 9 then 4 else 5 end
                           else case when v_rounds <= 9 then 3 else 4 end end;
begin
  return jsonb_build_object(
    'stars', v_st,
    'constellation', case when v_st >= v_need then 1 else 0 end,
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
  -- Seul avec des bots : entraînement, personne ne va dans finish_match (ni XP, ni stats, ni trophées, ni pièces).
  if jsonb_array_length(p_state->'players') - jsonb_array_length(coalesce(p_state->'bots', '[]'::jsonb)) <= 1 then
    return jsonb_build_object('state', p_state, 'server', p_server, 'results', '[]'::jsonb);
  end if;
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
    -- Seul avec des bots : partie d'entraînement, rien ne compte (cf. _dp_finish).
    'training', cardinality(p_players) = 1,
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
