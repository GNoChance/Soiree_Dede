-- =============================================================================
-- MISES DE PIECES 🪙 — idempotent, execute APRES cadeaux.sql (ordre alphabetique de features/).
--
-- Registre coin_ledger : tout mouvement de pieces qui n'est pas derive de l'historique (parties,
-- defis du jour, trophees, achats). _coins (cadeaux.sql) y ajoute sum(delta). Une ligne par
-- (profil, raison, ref) : les reglements sont idempotents (on conflict do nothing).
--   raisons : wager (- mise), wager_win (+ gain), wager_refund (+ mise) ; ref = 'match:<id>'
--             challenge (- enjeu), challenge_win (+ pot), challenge_refund (+ enjeu) ; ref = 'challenge:<id>'
-- Solde jamais negatif : chaque debit se fait sous verrou du profil (select ... for update, comme
-- buy_item) apres verification du solde.
--
-- 1. PARIS ENTRE POTES (match_wagers) : un membre de la soiree qui NE JOUE PAS la partie (spectateur,
--    hote meneur) mise 10, 25 ou 50 sur un joueur. Ouverts 45 s apres le lancement (jeux en duel :
--    en plus, seulement pendant le 1er duel, tant que son 1er coup n'est pas joue ou pendant ses 15
--    premieres secondes, comme les paris du socle). Modifiables tant qu'ouverts (1 pari par partie).
--    Cote = 1 / chances du joueur a CE jeu, chances = (victoires + 1) / (parties + nb de joueurs de
--    la partie) : un inconnu a 1 chance sur n ; arrondie au 0,5 et plafonnee entre x1,5 et x5 ;
--    figee au moment du pari. Gain = floor(mise x cote) si le joueur choisi gagne (equipe /
--    egalite : il suffit qu'il soit parmi les gagnants), sinon mise perdue. Partie annulee, sans
--    gagnant, ou joueur choisi absent des resultats : rembourse.
-- 2. DEFIS ENTRE JOUEURS (coin_challenges) : « je te defie au Morpion, enjeu 50 ». Ami accepte, jeu
--    en duel (jeu qui a un hook game_<id>_board_new), enjeu 0/10/25/50/100 <= solde des deux.
--    48 h pour accepter (sinon expire, rien preleve) ou refuser ; le defiant peut annuler tant que
--    c'est en attente. Accepte : les deux enjeux sont preleves. Le duel se joue dans une soiree
--    commune (play_challenge en trouve / cree une) ; l'hote le lance avec start_challenge (mode
--    duel, 1 manche, eux deux seuls). Fin : le gagnant empoche le pot (2 x enjeu) ; egalite, partie
--    annulee, ou defi accepte jamais joue sous 7 jours : chacun est rembourse.
-- Reglement automatique : trigger matches_mises_settle (status -> 'finished' : finish_match, abort,
-- fin de soiree, filet 3 h).
--
-- RPC (security definer, grant authenticated) — erreurs entre parentheses :
--   match_wagers(p_match_id) -> etat des paris               (match_not_found, not_in_soiree)
--   place_wager(p_match_id, p_pick, p_stake) -> idem         (wager_closed, wager_invalid_stake,
--       wager_invalid_pick, wager_player_cannot_bet, wager_not_enough_coins, not_in_soiree, match_not_found)
--   challenge_options() -> {coins, friends:[{id, max_stake, open}]}
--   create_challenge(p_other, p_game, p_stake) -> defi       (unknown_profile, challenge_not_friend,
--       challenge_invalid_game, challenge_invalid_stake, challenge_stake_too_high, challenge_already_open)
--   respond_challenge(p_id, p_accept) -> defi                (challenge_not_found, challenge_not_pending,
--       challenge_expired, challenge_not_enough_coins, challenge_opponent_broke)
--   cancel_challenge(p_id) -> defi                           (challenge_not_found, challenge_not_pending)
--   my_challenges() -> {coins, challenges:[...]}
--   play_challenge(p_id) -> {soiree_id}                      (challenge_not_found, challenge_not_accepted,
--       challenge_already_started + erreurs de create_soiree)
--   soiree_challenges(p_soiree_id) -> [defis acceptes jouables dans cette soiree]   (not_in_soiree)
--   start_challenge(p_id, p_soiree_id, p_options) -> match_id (challenge_not_found, challenge_not_accepted,
--       challenge_already_started, challenge_not_in_soiree + erreurs de start_match)
-- =============================================================================

-- ---- Registre ---------------------------------------------------------------------
create table if not exists public.coin_ledger (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  delta      integer not null,
  reason     text not null,
  ref        text not null default '',
  created_at timestamptz not null default now()
);
create unique index if not exists coin_ledger_ref_uq on public.coin_ledger(profile_id, reason, ref);
alter table public.coin_ledger enable row level security;
revoke all on table public.coin_ledger from anon, authenticated;
-- Aucune policy : lecture et ecriture uniquement via les RPC.

-- Mouvement idempotent (meme profil / raison / ref = ignore).
create or replace function public._ledger_add(p_profile uuid, p_delta integer, p_reason text, p_ref text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  if coalesce(p_delta, 0) = 0 then return; end if;
  insert into public.coin_ledger(profile_id, delta, reason, ref)
  values (p_profile, p_delta, p_reason, coalesce(p_ref, ''))
  on conflict (profile_id, reason, ref) do nothing;
end $$;

-- Ids (texte) des joueurs d'une partie (state.players), uuid valides seulement.
create or replace function public._match_player_ids(p_state jsonb)
returns text[] language sql immutable
set search_path = public, extensions
as $$
  select coalesce(array(
    select x from jsonb_array_elements_text(case when jsonb_typeof(p_state->'players') = 'array'
                                                 then p_state->'players' else '[]'::jsonb end) x
     where x ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), '{}')
$$;

-- =============================================================================
-- 1. PARIS ENTRE POTES
-- =============================================================================
create table if not exists public.match_wagers (
  match_id   uuid not null references public.matches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  pick       uuid not null references public.profiles(id) on delete cascade,
  stake      integer not null check (stake in (10, 25, 50)),
  odds       numeric(3, 1) not null,
  status     text not null default 'open' check (status in ('open', 'won', 'lost', 'refunded')),
  payout     integer not null default 0,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  primary key (match_id, profile_id)
);
create index if not exists match_wagers_profile_idx on public.match_wagers(profile_id);
alter table public.match_wagers enable row level security;
revoke all on table public.match_wagers from anon, authenticated;

create or replace function public._wager_window()
returns interval language sql immutable as $$ select interval '45 seconds' $$;

-- Cote d'un joueur a un jeu (partie a p_n joueurs) : 1 / ((victoires + 1) / (parties + n)),
-- arrondie au 0,5, entre 1,5 et 5.
create or replace function public._wager_odds(p_game text, p_pick uuid, p_n integer)
returns numeric language sql stable security definer
set search_path = public, extensions
as $$
  select least(5.0, greatest(1.5, round(2.0 * (s.played + greatest(p_n, 2)) / (s.wins + 1)) / 2.0))::numeric(3, 1)
    from (select count(*)::int as played, count(*) filter (where won)::int as wins
            from public.match_players where profile_id = p_pick and game_id = p_game) s
$$;

-- Paris ouverts sur cette partie ?
create or replace function public._wager_open(p_status text, p_created timestamptz, p_state jsonb)
returns boolean language sql stable
set search_path = public, extensions
as $$
  select p_status = 'playing'
     and now() < p_created + public._wager_window()
     and coalesce(p_state->>'phase', '') <> 'aborted'
     and (jsonb_typeof(p_state->'duel') is distinct from 'object' or (
            coalesce(p_state->'duel'->>'no', '1') = '1'
        and coalesce(p_state->'duel'->>'game_no', '1') in ('0', '1')
        and (coalesce(p_state->'duel'->>'moves', '0') = '0'
             or now() < coalesce(nullif(p_state->'duel'->>'bets_until', '')::timestamptz, '-infinity'::timestamptz))))
$$;

-- Etat des paris d'une partie pour moi.
-- {can_bet, open, closes_at, coins, stakes, odds:{id: x}, backers:{id: n}, total, mine|null}
create or replace function public.match_wagers(p_match_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me      uuid := public._require_profile();
  v_m       public.matches%rowtype;
  v_players text[];
  v_n       integer;
begin
  select * into v_m from public.matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  if not public.is_soiree_member(v_m.soiree_id) then raise exception 'not_in_soiree'; end if;
  v_players := public._match_player_ids(v_m.state);
  v_n := greatest(cardinality(v_players), 2);
  return jsonb_build_object(
    'can_bet', not (v_me::text = any(v_players)) and cardinality(v_players) >= 2,
    'open', public._wager_open(v_m.status, v_m.created_at, v_m.state),
    'closes_at', v_m.created_at + public._wager_window(),
    'coins', public._coins(v_me),
    'stakes', jsonb_build_array(10, 25, 50),
    'odds', coalesce((select jsonb_object_agg(p, public._wager_odds(v_m.game_id, p::uuid, v_n)) from unnest(v_players) p), '{}'::jsonb),
    'backers', coalesce((select jsonb_object_agg(pick::text, n) from (
                  select pick, count(*)::int as n from public.match_wagers where match_id = p_match_id group by pick) b), '{}'::jsonb),
    'total', (select count(*)::int from public.match_wagers where match_id = p_match_id),
    'mine', (select jsonb_build_object('pick', w.pick, 'stake', w.stake, 'odds', w.odds, 'status', w.status,
                                       'payout', w.payout, 'gain', floor(w.stake * w.odds)::int)
               from public.match_wagers w where w.match_id = p_match_id and w.profile_id = v_me));
end $$;

-- Mise (ou change sa mise tant que c'est ouvert : l'ancienne est rendue, la nouvelle prelevee).
create or replace function public.place_wager(p_match_id uuid, p_pick uuid, p_stake integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me      uuid := public._require_profile();
  v_m       public.matches%rowtype;
  v_players text[];
  v_old     integer;
begin
  -- Verrou partage : la partie ne peut pas se terminer (reglement) pendant la mise.
  select * into v_m from public.matches where id = p_match_id for share;
  if not found then raise exception 'match_not_found'; end if;
  if not public.is_soiree_member(v_m.soiree_id) then raise exception 'not_in_soiree'; end if;
  v_players := public._match_player_ids(v_m.state);
  if v_me::text = any(v_players) then raise exception 'wager_player_cannot_bet'; end if;
  if not public._wager_open(v_m.status, v_m.created_at, v_m.state) then raise exception 'wager_closed'; end if;
  if p_stake is null or p_stake not in (10, 25, 50) then raise exception 'wager_invalid_stake'; end if;
  if p_pick is null or not (p_pick::text = any(v_players)) then raise exception 'wager_invalid_pick'; end if;

  perform 1 from public.profiles where id = v_me for update;  -- serialise les debits du joueur
  select stake into v_old from public.match_wagers where match_id = p_match_id and profile_id = v_me;
  if public._coins(v_me) + coalesce(v_old, 0) < p_stake then raise exception 'wager_not_enough_coins'; end if;

  insert into public.match_wagers(match_id, profile_id, pick, stake, odds)
  values (p_match_id, v_me, p_pick, p_stake,
          public._wager_odds(v_m.game_id, p_pick, greatest(cardinality(v_players), 2)))
  on conflict (match_id, profile_id) do update
    set pick = excluded.pick, stake = excluded.stake, odds = excluded.odds, created_at = now();
  insert into public.coin_ledger(profile_id, delta, reason, ref)
  values (v_me, -p_stake, 'wager', 'match:' || p_match_id)
  on conflict (profile_id, reason, ref) do update set delta = excluded.delta, created_at = now();
  return public.match_wagers(p_match_id);
end $$;

-- =============================================================================
-- 2. DEFIS ENTRE JOUEURS
-- =============================================================================
create table if not exists public.coin_challenges (
  id            uuid primary key default gen_random_uuid(),
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id   uuid not null references public.profiles(id) on delete cascade,
  game_id       text not null,
  stake         integer not null check (stake in (0, 10, 25, 50, 100)),
  -- pending -> accepted | declined | cancelled | expired ; accepted -> finished (winner_id, null = egalite) | void
  status        text not null default 'pending'
                check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'finished', 'void')),
  match_id      uuid references public.matches(id) on delete set null,
  winner_id     uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '48 hours',
  accepted_at   timestamptz,
  settled_at    timestamptz,
  check (challenger_id <> opponent_id)
);
create index if not exists coin_challenges_challenger_idx on public.coin_challenges(challenger_id, status);
create index if not exists coin_challenges_opponent_idx on public.coin_challenges(opponent_id, status);
create index if not exists coin_challenges_match_idx on public.coin_challenges(match_id) where match_id is not null;
alter table public.coin_challenges enable row level security;
revoke all on table public.coin_challenges from anon, authenticated;

create or replace function public._challenge_json(p_c public.coin_challenges, p_me uuid)
returns jsonb language sql stable
set search_path = public, extensions
as $$
  select to_jsonb(p_c) || jsonb_build_object(
    'role', case when p_c.challenger_id = p_me then 'sent' else 'received' end,
    'other_id', case when p_c.challenger_id = p_me then p_c.opponent_id else p_c.challenger_id end,
    'match_status', (select m.status from public.matches m where m.id = p_c.match_id))
$$;

-- Rembourse les deux joueurs d'un defi accepte (idempotent).
create or replace function public._challenge_refund(p_c public.coin_challenges)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._ledger_add(p_c.challenger_id, p_c.stake, 'challenge_refund', 'challenge:' || p_c.id);
  perform public._ledger_add(p_c.opponent_id, p_c.stake, 'challenge_refund', 'challenge:' || p_c.id);
end $$;

-- Menage paresseux : defis en attente depasses -> expires ; acceptes jamais lances sous 7 jours -> rembourses.
create or replace function public._challenges_tidy()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  c public.coin_challenges%rowtype;
begin
  update public.coin_challenges set status = 'expired', settled_at = now()
   where status = 'pending' and expires_at <= now();
  for c in select * from public.coin_challenges
            where status = 'accepted' and match_id is null and accepted_at < now() - interval '7 days'
              for update skip locked
  loop
    perform public._challenge_refund(c);
    update public.coin_challenges set status = 'void', settled_at = now() where id = c.id;
  end loop;
end $$;

-- Jeu en duel = jeu qui fournit le hook board_new du socle duel (features/duel.sql).
create or replace function public._challenge_game_ok(p_game text)
returns boolean language sql stable
set search_path = public, extensions
as $$
  select coalesce(p_game, '') ~ '^[a-z0-9-]{1,40}$'
     and to_regprocedure(format('public.%I(jsonb, text, text)', 'game_' || replace(p_game, '-', '_') || '_board_new')) is not null
$$;

create or replace function public._are_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select exists (select 1 from public.friendships f
                  where f.status = 'accepted'
                    and ((f.requester_id = p_a and f.addressee_id = p_b) or (f.requester_id = p_b and f.addressee_id = p_a)))
$$;

-- Defi ouvert (en attente ou accepte, pas encore regle) entre deux joueurs ?
create or replace function public._challenge_open_between(p_a uuid, p_b uuid)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select exists (select 1 from public.coin_challenges c
                  where c.status in ('pending', 'accepted')
                    and ((c.challenger_id = p_a and c.opponent_id = p_b) or (c.challenger_id = p_b and c.opponent_id = p_a)))
$$;

-- Formulaire « Defier un pote » : mon solde, mes amis, l'enjeu max possible avec chacun.
create or replace function public.challenge_options()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_profile();
  v_coins integer;
begin
  perform public._challenges_tidy();
  v_coins := public._coins(v_me);
  return jsonb_build_object(
    'coins', v_coins,
    'friends', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'max_stake', greatest(0, least(v_coins, public._coins(p.id))),
                                          'open', public._challenge_open_between(v_me, p.id))
                       order by p.sort_order)
        from public.profiles p
       where p.id <> v_me and public._are_friends(v_me, p.id)), '[]'::jsonb));
end $$;

create or replace function public.create_challenge(p_other uuid, p_game text, p_stake integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_c  public.coin_challenges%rowtype;
begin
  perform public._challenges_tidy();
  if p_other is null or p_other = v_me or not exists (select 1 from public.profiles where id = p_other) then
    raise exception 'unknown_profile';
  end if;
  if not public._are_friends(v_me, p_other) then raise exception 'challenge_not_friend'; end if;
  if not public._challenge_game_ok(p_game) then raise exception 'challenge_invalid_game'; end if;
  if p_stake is null or p_stake not in (0, 10, 25, 50, 100) then raise exception 'challenge_invalid_stake'; end if;
  -- Verrou des deux profils (ordre fixe) : pas deux defis croises en meme temps.
  perform 1 from public.profiles where id in (v_me, p_other) order by id for update;
  if public._challenge_open_between(v_me, p_other) then raise exception 'challenge_already_open'; end if;
  if p_stake > public._coins(v_me) or p_stake > public._coins(p_other) then raise exception 'challenge_stake_too_high'; end if;
  insert into public.coin_challenges(challenger_id, opponent_id, game_id, stake)
  values (v_me, p_other, p_game, p_stake) returning * into v_c;
  return public._challenge_json(v_c, v_me);
end $$;

create or replace function public.respond_challenge(p_id uuid, p_accept boolean)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_c  public.coin_challenges%rowtype;
begin
  select * into v_c from public.coin_challenges where id = p_id and opponent_id = v_me;
  if not found then raise exception 'challenge_not_found'; end if;
  -- Verrous : profils (ordre fixe) puis defi.
  perform 1 from public.profiles where id in (v_c.challenger_id, v_c.opponent_id) order by id for update;
  select * into v_c from public.coin_challenges where id = p_id for update;
  -- (expire : le statut est mis a jour par _challenges_tidy, l'exception annulerait l'update)
  if v_c.status = 'pending' and v_c.expires_at <= now() then raise exception 'challenge_expired'; end if;
  if v_c.status <> 'pending' then raise exception 'challenge_not_pending'; end if;
  if not coalesce(p_accept, false) then
    update public.coin_challenges set status = 'declined', settled_at = now() where id = p_id returning * into v_c;
    return public._challenge_json(v_c, v_me);
  end if;
  if public._coins(v_me) < v_c.stake then raise exception 'challenge_not_enough_coins'; end if;
  if public._coins(v_c.challenger_id) < v_c.stake then raise exception 'challenge_opponent_broke'; end if;
  perform public._ledger_add(v_c.challenger_id, -v_c.stake, 'challenge', 'challenge:' || v_c.id);
  perform public._ledger_add(v_c.opponent_id, -v_c.stake, 'challenge', 'challenge:' || v_c.id);
  update public.coin_challenges set status = 'accepted', accepted_at = now() where id = p_id returning * into v_c;
  return public._challenge_json(v_c, v_me);
end $$;

create or replace function public.cancel_challenge(p_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_c  public.coin_challenges%rowtype;
begin
  select * into v_c from public.coin_challenges where id = p_id and challenger_id = v_me for update;
  if not found then raise exception 'challenge_not_found'; end if;
  if v_c.status <> 'pending' then raise exception 'challenge_not_pending'; end if;
  update public.coin_challenges set status = 'cancelled', settled_at = now() where id = p_id returning * into v_c;
  return public._challenge_json(v_c, v_me);
end $$;

-- Mes defis : en cours (en attente, acceptes) + 15 derniers regles depuis 30 jours.
create or replace function public.my_challenges()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  perform public._challenges_tidy();
  return jsonb_build_object(
    'coins', public._coins(v_me),
    'challenges', coalesce((
      select jsonb_agg(public._challenge_json(c, v_me) order by c.created_at desc)
        from public.coin_challenges c
       where c.id in (select x.id from public.coin_challenges x
                       where (x.challenger_id = v_me or x.opponent_id = v_me) and x.status in ('pending', 'accepted')
                      union all
                      (select x.id from public.coin_challenges x
                        where (x.challenger_id = v_me or x.opponent_id = v_me) and x.status not in ('pending', 'accepted')
                          and coalesce(x.settled_at, x.created_at) > now() - interval '30 days'
                        order by coalesce(x.settled_at, x.created_at) desc limit 15))), '[]'::jsonb));
end $$;

-- « Jouer maintenant » : une soiree commune ouverte (de preference dont je suis l'hote), sinon une
-- nouvelle soiree a deux (l'autre recoit l'invitation habituelle). Renvoie {soiree_id}.
create or replace function public.play_challenge(p_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_profile();
  v_c     public.coin_challenges%rowtype;
  v_other uuid;
  v_sid   uuid;
begin
  perform public._challenges_tidy();
  select * into v_c from public.coin_challenges where id = p_id and v_me in (challenger_id, opponent_id);
  if not found then raise exception 'challenge_not_found'; end if;
  if v_c.status <> 'accepted' then raise exception 'challenge_not_accepted'; end if;
  if v_c.match_id is not null then raise exception 'challenge_already_started'; end if;
  v_other := case when v_c.challenger_id = v_me then v_c.opponent_id else v_c.challenger_id end;
  select s.id into v_sid from public.soirees s
   where s.status <> 'ended'
     and exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
     and exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_other)
   order by (s.host_id = v_me) desc, s.created_at desc limit 1;
  if v_sid is null then
    v_sid := (public.create_soiree(array[v_other])->>'id')::uuid;
  end if;
  return jsonb_build_object('soiree_id', v_sid);
end $$;

-- Defis acceptes, pas encore lances, dont les deux joueurs sont dans cette soiree (carte de l'hote).
create or replace function public.soiree_challenges(p_soiree_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  if not public.is_soiree_member(p_soiree_id) then raise exception 'not_in_soiree'; end if;
  perform public._challenges_tidy();
  return coalesce((
    select jsonb_agg(public._challenge_json(c, v_me) order by c.accepted_at)
      from public.coin_challenges c
     where c.status = 'accepted' and c.match_id is null
       and exists (select 1 from public.soiree_players sp where sp.soiree_id = p_soiree_id and sp.profile_id = c.challenger_id)
       and exists (select 1 from public.soiree_players sp where sp.soiree_id = p_soiree_id and sp.profile_id = c.opponent_id)), '[]'::jsonb);
end $$;

-- L'hote lance le duel d'un defi : mode duel, 1 manche, les deux joueurs seuls. Renvoie l'id de la partie.
create or replace function public.start_challenge(p_id uuid, p_soiree_id uuid, p_options jsonb)
returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_c    public.coin_challenges%rowtype;
  v_opts jsonb;
  v_mid  uuid;
begin
  perform public._require_profile();
  select * into v_c from public.coin_challenges where id = p_id for update;
  if not found then raise exception 'challenge_not_found'; end if;
  if v_c.status <> 'accepted' then raise exception 'challenge_not_accepted'; end if;
  if v_c.match_id is not null then raise exception 'challenge_already_started'; end if;
  if not exists (select 1 from public.soiree_players sp where sp.soiree_id = p_soiree_id and sp.profile_id = v_c.challenger_id)
     or not exists (select 1 from public.soiree_players sp where sp.soiree_id = p_soiree_id and sp.profile_id = v_c.opponent_id) then
    raise exception 'challenge_not_in_soiree';
  end if;
  v_opts := (case when jsonb_typeof(p_options) = 'object' then p_options else '{}'::jsonb end)
            || jsonb_build_object('mode', 'duel', 'best_of', 1,
                                  'duel_players', jsonb_build_array(v_c.challenger_id, v_c.opponent_id),
                                  'player_ids', jsonb_build_array(v_c.challenger_id, v_c.opponent_id));
  v_mid := public.start_match(p_soiree_id, v_c.game_id, v_opts);  -- not_host, match_in_progress, soiree_ended...
  update public.coin_challenges set match_id = v_mid where id = p_id;
  return v_mid;
end $$;

-- =============================================================================
-- 3. REGLEMENT (partie terminee ou annulee)
-- =============================================================================
create or replace function public._mises_settle(p_match_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_winners boolean := exists (select 1 from public.match_players where match_id = p_match_id and won);
  w         public.match_wagers%rowtype;
  c         public.coin_challenges%rowtype;
  v_won     uuid[];
  v_gain    integer;
begin
  -- Paris
  for w in select * from public.match_wagers where match_id = p_match_id and status = 'open' for update loop
    if not v_winners or not exists (select 1 from public.match_players where match_id = p_match_id and profile_id = w.pick) then
      perform public._ledger_add(w.profile_id, w.stake, 'wager_refund', 'match:' || p_match_id);
      update public.match_wagers set status = 'refunded', payout = w.stake, settled_at = now()
       where match_id = p_match_id and profile_id = w.profile_id;
    elsif exists (select 1 from public.match_players where match_id = p_match_id and profile_id = w.pick and won) then
      v_gain := floor(w.stake * w.odds)::int;
      perform public._ledger_add(w.profile_id, v_gain, 'wager_win', 'match:' || p_match_id);
      update public.match_wagers set status = 'won', payout = v_gain, settled_at = now()
       where match_id = p_match_id and profile_id = w.profile_id;
    else
      update public.match_wagers set status = 'lost', payout = 0, settled_at = now()
       where match_id = p_match_id and profile_id = w.profile_id;
    end if;
  end loop;

  -- Defis
  for c in select * from public.coin_challenges where match_id = p_match_id and status = 'accepted' for update loop
    v_won := array(select profile_id from public.match_players
                    where match_id = p_match_id and won and profile_id in (c.challenger_id, c.opponent_id));
    if not exists (select 1 from public.match_players where match_id = p_match_id) then
      perform public._challenge_refund(c);
      update public.coin_challenges set status = 'void', settled_at = now() where id = c.id;
    elsif cardinality(v_won) = 1 then
      perform public._ledger_add(v_won[1], 2 * c.stake, 'challenge_win', 'challenge:' || c.id);
      update public.coin_challenges set status = 'finished', winner_id = v_won[1], settled_at = now() where id = c.id;
    else
      perform public._challenge_refund(c);
      update public.coin_challenges set status = 'finished', winner_id = null, settled_at = now() where id = c.id;
    end if;
  end loop;
end $$;

create or replace function public._mises_on_finish()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._mises_settle(new.id);
  return new;
end $$;
drop trigger if exists matches_mises_settle on public.matches;
create trigger matches_mises_settle after update of status on public.matches
  for each row when (old.status is distinct from 'finished' and new.status = 'finished')
  execute function public._mises_on_finish();

-- ---- Droits -------------------------------------------------------------------------
revoke all on function public._ledger_add(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public._match_player_ids(jsonb) from public, anon, authenticated;
revoke all on function public._wager_window() from public, anon, authenticated;
revoke all on function public._wager_odds(text, uuid, integer) from public, anon, authenticated;
revoke all on function public._wager_open(text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public._challenge_json(public.coin_challenges, uuid) from public, anon, authenticated;
revoke all on function public._challenge_refund(public.coin_challenges) from public, anon, authenticated;
revoke all on function public._challenges_tidy() from public, anon, authenticated;
revoke all on function public._challenge_game_ok(text) from public, anon, authenticated;
revoke all on function public._are_friends(uuid, uuid) from public, anon, authenticated;
revoke all on function public._challenge_open_between(uuid, uuid) from public, anon, authenticated;
revoke all on function public._mises_settle(uuid) from public, anon, authenticated;
revoke all on function public._mises_on_finish() from public, anon, authenticated;
revoke all on function public.match_wagers(uuid) from public, anon;
revoke all on function public.place_wager(uuid, uuid, integer) from public, anon;
revoke all on function public.challenge_options() from public, anon;
revoke all on function public.create_challenge(uuid, text, integer) from public, anon;
revoke all on function public.respond_challenge(uuid, boolean) from public, anon;
revoke all on function public.cancel_challenge(uuid) from public, anon;
revoke all on function public.my_challenges() from public, anon;
revoke all on function public.play_challenge(uuid) from public, anon;
revoke all on function public.soiree_challenges(uuid) from public, anon;
revoke all on function public.start_challenge(uuid, uuid, jsonb) from public, anon;
grant execute on function public.match_wagers(uuid) to authenticated;
grant execute on function public.place_wager(uuid, uuid, integer) to authenticated;
grant execute on function public.challenge_options() to authenticated;
grant execute on function public.create_challenge(uuid, text, integer) to authenticated;
grant execute on function public.respond_challenge(uuid, boolean) to authenticated;
grant execute on function public.cancel_challenge(uuid) to authenticated;
grant execute on function public.my_challenges() to authenticated;
grant execute on function public.play_challenge(uuid) to authenticated;
grant execute on function public.soiree_challenges(uuid) to authenticated;
grant execute on function public.start_challenge(uuid, uuid, jsonb) to authenticated;
