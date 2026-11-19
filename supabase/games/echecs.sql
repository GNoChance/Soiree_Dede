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
