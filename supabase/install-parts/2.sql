-- MORCEAU 2 / 6 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

-- ===== features\idees.sql =====
-- =============================================================================
-- BOÎTE À IDÉES — idempotent. Chaque membre de la bande glisse une idée (nouveau jeu, amélioration, bug…)
-- dans la boîte ; seul l'admin peut lire. Table sans policy RLS : accès uniquement via les RPC.
-- Erreurs : guest_forbidden, forbidden, invalid_idea, too_many_ideas, unknown_idea, invalid_status.
-- =============================================================================

create table if not exists public.ideas (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 500),
  anonymous  boolean not null default false,
  status     text not null default 'new' check (status in ('new', 'done')),
  created_at timestamptz not null default now()
);
create index if not exists ideas_created_idx on public.ideas (created_at desc);
create index if not exists ideas_profile_idx on public.ideas (profile_id, created_at desc);
alter table public.ideas enable row level security;

create or replace function public.idea_box_state()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_member();
  v_admin boolean := exists (select 1 from public.profiles where id = v_me and is_admin);
begin
  return jsonb_build_object(
    'total',    (select count(*)::int from public.ideas),
    'mine',     (select count(*)::int from public.ideas where profile_id = v_me),
    'is_admin', v_admin,
    'unread',   case when v_admin then (select count(*)::int from public.ideas where status = 'new') else 0 end
  );
end $$;

create or replace function public.submit_idea(p_body text, p_anonymous boolean default false)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_member();
  v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 500 then raise exception 'invalid_idea'; end if;
  if (select count(*) from public.ideas where profile_id = v_me and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'too_many_ideas';
  end if;
  insert into public.ideas(profile_id, body, anonymous) values (v_me, v_body, coalesce(p_anonymous, false));
  return public.idea_box_state();
end $$;

-- Admin : idées récentes d'abord ; auteur masqué si anonyme (même pour l'admin).
create or replace function public.admin_list_ideas()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'body', i.body, 'status', i.status, 'created_at', i.created_at, 'anonymous', i.anonymous,
      'author_id',       case when i.anonymous then null else p.id end,
      'author_slug',     case when i.anonymous then null else p.slug end,
      'author_nickname', case when i.anonymous then null else p.nickname end
    ) order by i.created_at desc)
    from public.ideas i join public.profiles p on p.id = i.profile_id
  ), '[]'::jsonb);
end $$;

create or replace function public.admin_set_idea_status(p_id uuid, p_status text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  if p_status not in ('new', 'done') then raise exception 'invalid_status'; end if;
  update public.ideas set status = p_status where id = p_id;
  if not found then raise exception 'unknown_idea'; end if;
end $$;

create or replace function public.admin_delete_idea(p_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  perform public._require_admin();
  delete from public.ideas where id = p_id;
  if not found then raise exception 'unknown_idea'; end if;
end $$;

revoke all on function public.idea_box_state() from public, anon;
revoke all on function public.submit_idea(text, boolean) from public, anon;
revoke all on function public.admin_list_ideas() from public, anon;
revoke all on function public.admin_set_idea_status(uuid, text) from public, anon;
revoke all on function public.admin_delete_idea(uuid) from public, anon;
grant execute on function public.idea_box_state() to authenticated;
grant execute on function public.submit_idea(text, boolean) to authenticated;
grant execute on function public.admin_list_ideas() to authenticated;
grant execute on function public.admin_set_idea_status(uuid, text) to authenticated;
grant execute on function public.admin_delete_idea(uuid) to authenticated;


-- ===== features\membres.sql =====
-- =============================================================================
-- NOUVEAUX MEMBRES DE LA BANDE — idempotent, exécuté APRÈS guest.sql (ordre alphabétique : _guest_avatars).
-- L'admin ajoute une vraie personne à la bande (pas un invité : is_guest = false, donc classements,
-- stats, trophées, boutique… comme les 9 autres). Pas encore de chibi : avatar emoji (mêmes ids que
-- les invités, cf. src/data/guests.ts), slug « m-<avatar>-<6 car.> ».
-- Pas de PIN : à sa première connexion (login_profile), le code saisi devient son code.
-- Passer en chibi plus tard : voir docs/ARCHITECTURE.md (renommer le slug + catalogue des persos).
-- Erreurs : forbidden, invalid_first_name, invalid_nickname, invalid_avatar, nickname_taken, unknown_profile.
-- =============================================================================

create or replace function public.admin_create_member(p_first_name text, p_nickname text, p_avatar text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_first text := btrim(regexp_replace(coalesce(p_first_name, ''), '\s+', ' ', 'g'));
  v_nick  text := btrim(regexp_replace(coalesce(p_nickname, ''), '\s+', ' ', 'g'));
  v_av    text := lower(btrim(coalesce(p_avatar, '')));
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_slug  text;
  v_id    uuid;
begin
  perform public._require_admin();
  if char_length(v_first) < 1 or char_length(v_first) > 30 then raise exception 'invalid_first_name'; end if;
  if char_length(v_nick) < 1 or char_length(v_nick) > 20 then raise exception 'invalid_nickname'; end if;
  if not (v_av = any(public._guest_avatars())) then raise exception 'invalid_avatar'; end if;

  perform pg_advisory_xact_lock(hashtext('admin_create_member'));
  if exists (select 1 from public.profiles where not is_guest and lower(nickname) = lower(v_nick)) then
    raise exception 'nickname_taken';
  end if;

  loop
    select 'm-' || v_av || '-' || string_agg(substr(v_alpha, 1 + floor(random() * length(v_alpha))::integer, 1), '')
      into v_slug from generate_series(1, 6);
    exit when not exists (select 1 from public.profiles where slug = v_slug);
  end loop;

  insert into public.profiles(slug, first_name, nickname, expressions, sort_order)
  values (v_slug, v_first, v_nick,
          array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'],
          coalesce((select max(sort_order) from public.profiles where not is_guest), 0) + 1)
  returning id into v_id;
  return public._profile_json(v_id);
end $$;

-- Change l'emoji d'un membre « m-… » (le slug porte l'avatar ; le suffixe aléatoire est conservé).
create or replace function public.admin_update_member_avatar(p_profile uuid, p_avatar text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_av   text := lower(btrim(coalesce(p_avatar, '')));
  v_p    public.profiles%rowtype;
  v_slug text;
begin
  perform public._require_admin();
  if not (v_av = any(public._guest_avatars())) then raise exception 'invalid_avatar'; end if;
  select * into v_p from public.profiles where id = p_profile and slug like 'm-%' and not is_guest;
  if not found then raise exception 'unknown_profile'; end if;
  v_slug := 'm-' || v_av || '-' || split_part(v_p.slug, '-', 3);
  if v_slug <> v_p.slug then
    update public.profiles set slug = v_slug where id = v_p.id;
    update public.login_attempts set slug = v_slug where slug = v_p.slug;
  end if;
  return public._profile_json(v_p.id);
end $$;

revoke all on function public.admin_create_member(text, text, text) from public, anon;
revoke all on function public.admin_update_member_avatar(uuid, text) from public, anon;
grant execute on function public.admin_create_member(text, text, text) to authenticated;
grant execute on function public.admin_update_member_avatar(uuid, text) to authenticated;


-- ===== features\mises.sql =====
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
--    gagnant, ou joueur choisi absent des resultats : rembourse ; SAUF le pari de l'hote qui annule
--    lui-meme la partie (abort / fin de soiree) : perdu.
-- 2. DEFIS ENTRE JOUEURS (coin_challenges) : « je te defie au Morpion, enjeu 50 ». Ami accepte, jeu
--    en duel (jeu qui a un hook game_<id>_board_new), enjeu 0/10/25/50/100 <= solde des deux.
--    48 h pour accepter (sinon expire, rien preleve) ou refuser ; le defiant peut annuler tant que
--    c'est en attente. Accepte : les deux enjeux sont preleves. Le duel se joue dans une soiree
--    commune (play_challenge en trouve / cree une) ; l'hote le lance avec start_challenge (mode
--    duel, 1 manche, eux deux seuls). Fin : le gagnant empoche le pot (2 x enjeu) ; egalite, partie
--    annulee par l'hote non duelliste, ou defi accepte jamais joue sous 7 jours : chacun est rembourse.
--    Annulee par un des duellistes (l'hote) : abandon, l'adversaire empoche le pot.
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
  -- Hôte qui vient d'annuler la partie (abort) ou de finir la soirée : posé par game_action / end_soiree.
  v_by      uuid := nullif(current_setting('app.aborted_by', true), '')::uuid;
begin
  -- Paris
  for w in select * from public.match_wagers where match_id = p_match_id and status = 'open' for update loop
    if not v_winners and w.profile_id = v_by then
      -- L'hôte annule une partie sur laquelle il a parié : pas de remboursement (sinon pari sans risque).
      update public.match_wagers set status = 'lost', payout = 0, settled_at = now()
       where match_id = p_match_id and profile_id = w.profile_id;
    elsif not v_winners or not exists (select 1 from public.match_players where match_id = p_match_id and profile_id = w.pick) then
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
    if not exists (select 1 from public.match_players where match_id = p_match_id)
       and v_by in (c.challenger_id, c.opponent_id) then
      -- Annulée par un des duellistes (hôte) : abandon, l'adversaire empoche le pot.
      v_won := array[case when v_by = c.challenger_id then c.opponent_id else c.challenger_id end];
      perform public._ledger_add(v_won[1], 2 * c.stake, 'challenge_win', 'challenge:' || c.id);
      update public.coin_challenges set status = 'finished', winner_id = v_won[1], settled_at = now() where id = c.id;
    elsif not exists (select 1 from public.match_players where match_id = p_match_id) then
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


-- ===== features\pronos.sql =====
-- =============================================================================
-- PRONOSTICS ENTRE POTES — idempotent, exécuté APRÈS schema.sql (features/*).
-- Avant de lancer un jeu, l'hôte ouvre une « manche de pronostics » (open_pronos) ; chaque joueur
-- de la soirée parie sur le gagnant (set_prono). Au lancement (start_match) le trigger
-- _pronos_attach rattache les paris à la partie. Le résultat n'est JAMAIS stocké : il se calcule
-- à la lecture en joignant match_players.won (aucun jeu ni finish_match n'est touché).
--
-- Règles : un pari par (soirée, joueur), le dernier gagne ; on peut parier sur soi ; égalité ou
-- équipe gagnante = parier sur n'importe quel gagnant est bon ; partie annulée / sans gagnant =
-- pronostics annulés (void) ; une manche non lancée expire au bout de 10 minutes.
--
-- RPC (toutes security definer, grant authenticated) — erreurs entre parenthèses :
--   open_pronos(p_soiree_id, p_game_id, p_player_ids) -> manche        (not_host, soiree_ended,
--       match_in_progress, soiree_not_found, invalid_pronos) ; remet les paris à zéro
--   close_pronos(p_soiree_id)                                          (not_host, soiree_not_found)
--   set_prono(p_soiree_id, p_pick)                                     (not_in_soiree, pronos_closed, invalid_pick)
--   get_pronos(p_soiree_id) -> {round|null, my_pick|null}              (not_in_soiree) ; jamais les paris des autres
--   match_pronos(p_match_id) -> null | {void, picks[{profile_id,pick,ok}]}   (match_not_found, not_in_soiree)
--   soiree_prono_board(p_soiree_id) -> [{profile_id, hits, bets}]      (not_in_soiree)
-- =============================================================================

create table if not exists public.soiree_prono_rounds (
  soiree_id  uuid primary key references public.soirees(id) on delete cascade,
  game_id    text not null,
  player_ids uuid[] not null,
  bets       integer not null default 0,
  opened_at  timestamptz not null default now()
);

create table if not exists public.soiree_pronos (
  id              bigint generated always as identity primary key,
  soiree_id       uuid not null references public.soirees(id) on delete cascade,
  profile_id      uuid not null references public.profiles(id) on delete cascade,
  pick_profile_id uuid not null references public.profiles(id) on delete cascade,
  match_id        uuid references public.matches(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists soiree_pronos_open_idx on public.soiree_pronos(soiree_id, profile_id) where match_id is null;
create unique index if not exists soiree_pronos_match_idx on public.soiree_pronos(match_id, profile_id) where match_id is not null;
create index if not exists soiree_pronos_profile_idx on public.soiree_pronos(profile_id);

alter table public.soiree_prono_rounds enable row level security;
alter table public.soiree_pronos enable row level security;
drop policy if exists soiree_prono_rounds_select on public.soiree_prono_rounds;
create policy soiree_prono_rounds_select on public.soiree_prono_rounds for select to authenticated
  using (public.is_soiree_member(soiree_id));
revoke all on table public.soiree_prono_rounds, public.soiree_pronos from anon, authenticated;
grant select on table public.soiree_prono_rounds to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'soiree_prono_rounds') then
    alter publication supabase_realtime add table public.soiree_prono_rounds;
  end if;
end $$;

-- Paris rattachés à une partie TERMINÉE qui a au moins un gagnant et dont le joueur choisi a joué : ok = il a gagné.
create or replace function public._prono_resolved()
returns table(soiree_id uuid, match_id uuid, profile_id uuid, pick uuid, ok boolean, at timestamptz)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.soiree_id, p.match_id, p.profile_id, p.pick_profile_id,
         exists (select 1 from public.match_players w
                  where w.match_id = p.match_id and w.profile_id = p.pick_profile_id and w.won),
         coalesce(m.finished_at, m.created_at)
    from public.soiree_pronos p
    join public.matches m on m.id = p.match_id
   where m.status = 'finished'
     and exists (select 1 from public.match_players w where w.match_id = m.id and w.won)
     -- un pari sur un joueur qui n'a pas joué la partie est annulé (ni raté, ni compté)
     and exists (select 1 from public.match_players w where w.match_id = m.id and w.profile_id = p.pick_profile_id)
$$;

create or replace function public.open_pronos(p_soiree_id uuid, p_game_id text, p_player_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_s   public.soirees%rowtype;
  v_ids uuid[];
  v_r   public.soiree_prono_rounds%rowtype;
begin
  select * into v_s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if exists (select 1 from public.matches m where m.soiree_id = p_soiree_id and m.status in ('lobby', 'playing')) then
    raise exception 'match_in_progress';
  end if;
  v_ids := array(select distinct x from unnest(coalesce(p_player_ids, '{}')) x);
  if coalesce(p_game_id, '') !~ '^[a-z0-9_-]{1,40}$' or coalesce(array_length(v_ids, 1), 0) < 2
     or exists (select 1 from unnest(v_ids) x
                 where not exists (select 1 from public.soiree_players sp where sp.soiree_id = p_soiree_id and sp.profile_id = x)) then
    raise exception 'invalid_pronos';
  end if;
  delete from public.soiree_pronos where soiree_id = p_soiree_id and match_id is null;
  insert into public.soiree_prono_rounds(soiree_id, game_id, player_ids, bets, opened_at)
  values (p_soiree_id, p_game_id, v_ids, 0, now())
  on conflict (soiree_id) do update
    set game_id = excluded.game_id, player_ids = excluded.player_ids, bets = 0, opened_at = now()
  returning * into v_r;
  return to_jsonb(v_r);
end $$;

create or replace function public.close_pronos(p_soiree_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_h  uuid;
begin
  select host_id into v_h from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_h <> v_me then raise exception 'not_host'; end if;
  delete from public.soiree_pronos where soiree_id = p_soiree_id and match_id is null;
  delete from public.soiree_prono_rounds where soiree_id = p_soiree_id;
end $$;

create or replace function public.set_prono(p_soiree_id uuid, p_pick uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_r  public.soiree_prono_rounds%rowtype;
begin
  if not public.is_soiree_member(p_soiree_id) then raise exception 'not_in_soiree'; end if;
  select * into v_r from public.soiree_prono_rounds where soiree_id = p_soiree_id for update;
  if not found or v_r.opened_at < now() - interval '10 minutes' then raise exception 'pronos_closed'; end if;
  if not (p_pick = any (v_r.player_ids)) then raise exception 'invalid_pick'; end if;
  insert into public.soiree_pronos(soiree_id, profile_id, pick_profile_id)
  values (p_soiree_id, v_me, p_pick)
  on conflict (soiree_id, profile_id) where match_id is null
  do update set pick_profile_id = excluded.pick_profile_id, updated_at = now();
  update public.soiree_prono_rounds
     set bets = (select count(*) from public.soiree_pronos where soiree_id = p_soiree_id and match_id is null)
   where soiree_id = p_soiree_id;
end $$;

create or replace function public.get_pronos(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_r  public.soiree_prono_rounds%rowtype;
begin
  if not public.is_soiree_member(p_soiree_id) then raise exception 'not_in_soiree'; end if;
  select * into v_r from public.soiree_prono_rounds where soiree_id = p_soiree_id;
  if not found or v_r.opened_at < now() - interval '10 minutes' then
    return jsonb_build_object('round', null, 'my_pick', null);
  end if;
  return jsonb_build_object(
    'round', to_jsonb(v_r),
    'my_pick', (select pick_profile_id from public.soiree_pronos
                 where soiree_id = p_soiree_id and profile_id = v_me and match_id is null));
end $$;

-- Résultat d'une partie : void = pas terminée / annulée / sans gagnant (picks vide : rien n'est révélé).
create or replace function public.match_pronos(p_match_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_m    public.matches%rowtype;
  v_void boolean;
begin
  select * into v_m from public.matches where id = p_match_id;
  if not found then raise exception 'match_not_found'; end if;
  if v_m.soiree_id is null or not public.is_soiree_member(v_m.soiree_id) then raise exception 'not_in_soiree'; end if;
  if not exists (select 1 from public.soiree_pronos where match_id = p_match_id) then return null; end if;
  v_void := not (v_m.status = 'finished'
                 and exists (select 1 from public.match_players w where w.match_id = p_match_id and w.won));
  if v_void then return jsonb_build_object('void', true, 'picks', '[]'::jsonb); end if;
  return jsonb_build_object('void', false, 'picks', (
    select coalesce(jsonb_agg(jsonb_build_object('profile_id', r.profile_id, 'pick', r.pick, 'ok', r.ok)
                              order by pr.sort_order), '[]'::jsonb)
      from public._prono_resolved() r join public.profiles pr on pr.id = r.profile_id
     where r.match_id = p_match_id));
end $$;

create or replace function public.soiree_prono_board(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  if not public.is_soiree_member(p_soiree_id) then raise exception 'not_in_soiree'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', b.profile_id, 'hits', b.hits, 'bets', b.bets)
                     order by b.hits desc, b.bets, b.sort_order)
      from (select r.profile_id, count(*) filter (where r.ok)::int as hits, count(*)::int as bets, pr.sort_order
              from public._prono_resolved() r join public.profiles pr on pr.id = r.profile_id
             where r.soiree_id = p_soiree_id
             group by r.profile_id, pr.sort_order) b), '[]'::jsonb);
end $$;

-- Une partie est créée : les paris ouverts de la soirée lui sont rattachés si le jeu est celui de la
-- manche ; sinon ils sont jetés. Dans tous les cas la manche est refermée.
create or replace function public._pronos_attach()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_game text;
begin
  if new.soiree_id is null then return new; end if;
  select game_id into v_game from public.soiree_prono_rounds where soiree_id = new.soiree_id;
  if found and v_game = new.game_id then
    update public.soiree_pronos set match_id = new.id, updated_at = now()
     where soiree_id = new.soiree_id and match_id is null;
  end if;
  delete from public.soiree_pronos where soiree_id = new.soiree_id and match_id is null;
  delete from public.soiree_prono_rounds where soiree_id = new.soiree_id;
  return new;
end $$;
drop trigger if exists matches_pronos_attach on public.matches;
create trigger matches_pronos_attach after insert on public.matches
  for each row execute function public._pronos_attach();

revoke all on function public._prono_resolved() from public, anon, authenticated;
revoke all on function public._pronos_attach() from public, anon, authenticated;
revoke all on function public.open_pronos(uuid, text, uuid[]) from public, anon;
revoke all on function public.close_pronos(uuid) from public, anon;
revoke all on function public.set_prono(uuid, uuid) from public, anon;
revoke all on function public.get_pronos(uuid) from public, anon;
revoke all on function public.match_pronos(uuid) from public, anon;
revoke all on function public.soiree_prono_board(uuid) from public, anon;
grant execute on function public.open_pronos(uuid, text, uuid[]) to authenticated;
grant execute on function public.close_pronos(uuid) to authenticated;
grant execute on function public.set_prono(uuid, uuid) to authenticated;
grant execute on function public.get_pronos(uuid) to authenticated;
grant execute on function public.match_pronos(uuid) to authenticated;
grant execute on function public.soiree_prono_board(uuid) to authenticated;


-- ===== features\push.sql =====
-- =============================================================================
-- NOTIFICATIONS PUSH : rappel du defi du jour a 18 h (Europe/Paris) — idempotent,
-- execute APRES daily.sql (ordre alphabetique de features/).
--
-- Circuit : pg_cron (toutes les heures a :00) -> _push_daily_tick() -> si heure de
-- Paris = 18 : pg_net POST https://<app>/api/daily-reminder (Bearer <secret>) ->
-- fonction Vercel -> push_daily_reminder_targets() (cle service role) -> web-push ->
-- push_report() (purge des abonnements morts 404/410).
--
-- Configuration (UNE FOIS, dans le SQL Editor, avec TES valeurs ; jamais dans le depot) :
--   insert into public.push_config (id, reminder_url, secret)
--   values (true, 'https://TON-APP.vercel.app/api/daily-reminder', 'LE_MEME_SECRET_QUE_PUSH_CRON_SECRET')
--   on conflict (id) do update set reminder_url = excluded.reminder_url, secret = excluded.secret, updated_at = now();
-- Test immediat (ignore l'heure, envoie a tous ceux qui n'ont pas joue aujourd'hui) :
--   select public._push_daily_tick(true);
-- Invitations « X t'invite a sa soiree » : voir supabase/features/push_invites.sql (URL deduite de reminder_url).
-- =============================================================================

create table if not exists public.push_subscriptions (
  id                bigint generated always as identity primary key,
  profile_id        uuid not null references public.profiles(id) on delete cascade,
  endpoint          text not null unique,
  p256dh            text not null,
  auth              text not null,
  user_agent        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  last_ok_at        timestamptz,
  -- Jour (Paris) du dernier rappel envoye : evite les doublons si l'URL est rappelee.
  last_reminded_day date
);
create index if not exists push_subscriptions_profile_idx on public.push_subscriptions(profile_id);
alter table public.push_subscriptions enable row level security;
-- Aucune policy : acces uniquement via les RPC security definer.
revoke all on table public.push_subscriptions from anon, authenticated;

-- Config privee du declencheur (une seule ligne). Lue par _push_daily_tick().
create table if not exists public.push_config (
  id           boolean primary key default true check (id),
  reminder_url text,
  secret       text,
  updated_at   timestamptz not null default now()
);
alter table public.push_config enable row level security;
revoke all on table public.push_config from anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC joueurs
-- ---------------------------------------------------------------------------

-- Enregistre (ou rattache au joueur courant) l'abonnement push de CET appareil.
-- Plusieurs appareils par joueur (10 max : les plus anciens sont oublies).
-- Erreur : invalid_subscription.
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 1024
     or coalesce(char_length(p_p256dh), 0) not between 20 and 200
     or coalesce(char_length(p_auth), 0) not between 8 and 100 then
    raise exception 'invalid_subscription';
  end if;
  insert into public.push_subscriptions as s (profile_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
        updated_at = now(),
        last_reminded_day = case when s.profile_id = excluded.profile_id then s.last_reminded_day end,
        profile_id = excluded.profile_id;
  delete from public.push_subscriptions
   where profile_id = v_me
     and id not in (select id from public.push_subscriptions where profile_id = v_me
                     order by updated_at desc limit 10);
end $$;

-- Desabonne CET appareil (sans erreur s'il n'etait pas enregistre).
create or replace function public.delete_push_subscription(p_endpoint text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and profile_id = v_me;
end $$;

-- ---------------------------------------------------------------------------
-- RPC service role (fonction Vercel api/daily-reminder.ts)
-- ---------------------------------------------------------------------------

-- Abonnements des joueurs SANS tentative aujourd'hui (une tentative commencee mais
-- non terminee ne peut plus etre rejouee : inutile de rappeler) et pas encore rappeles
-- aujourd'hui. p_claim = true : marque last_reminded_day (anti-doublon, atomique).
-- -> [{endpoint, p256dh, auth, profile_id, nickname, streak}]
create or replace function public.push_daily_reminder_targets(p_claim boolean default true)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_day date := public._daily_day();
  v_ids bigint[];
begin
  select coalesce(array_agg(s.id), '{}') into v_ids
    from public.push_subscriptions s
   where s.last_reminded_day is distinct from v_day
     and not exists (select 1 from public.daily_runs r where r.profile_id = s.profile_id and r.day = v_day);
  if p_claim then
    update public.push_subscriptions set last_reminded_day = v_day where id = any(v_ids);
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'profile_id', s.profile_id,
             'nickname', p.nickname, 'streak', public._daily_streak(s.profile_id)))
      from public.push_subscriptions s join public.profiles p on p.id = s.profile_id
     where s.id = any(v_ids)), '[]'::jsonb);
end $$;

-- Abonnements d'un joueur (par slug), pour tester l'envoi sans condition.
create or replace function public.push_test_targets(p_slug text)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'profile_id', s.profile_id,
           'nickname', p.nickname, 'streak', public._daily_streak(s.profile_id))), '[]'::jsonb)
    from public.push_subscriptions s join public.profiles p on p.id = s.profile_id
   where p.slug = lower(btrim(p_slug))
$$;

-- Compte rendu d'envoi : p_ok -> last_ok_at ; p_dead (404/410) -> supprimes.
create or replace function public.push_report(p_ok text[], p_dead text[])
returns void language plpgsql security definer
set search_path = public, extensions
as $$
begin
  update public.push_subscriptions set last_ok_at = now() where endpoint = any(coalesce(p_ok, '{}'));
  delete from public.push_subscriptions where endpoint = any(coalesce(p_dead, '{}'));
end $$;

-- ---------------------------------------------------------------------------
-- Declencheur horaire (pg_cron + pg_net)
-- ---------------------------------------------------------------------------

-- Appele toutes les heures a :00 ; n'agit qu'a 18 h heure de Paris (ete comme hiver).
-- p_force = true : ignore l'heure (test manuel depuis le SQL Editor).
create or replace function public._push_daily_tick(p_force boolean default false)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare c public.push_config%rowtype;
begin
  if not p_force and extract(hour from (now() at time zone 'Europe/Paris')) <> 18 then return; end if;
  select * into c from public.push_config where id;
  if not found or coalesce(c.reminder_url, '') = '' or coalesce(c.secret, '') = '' then
    raise notice 'push_config incomplete : rappel du defi non envoye';
    return;
  end if;
  begin
    perform net.http_post(
      url := c.reminder_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.secret),
      timeout_milliseconds := 60000);
  exception when others then
    raise notice 'pg_net indisponible (%) : rappel du defi non envoye', sqlerrm;
  end;
end $$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.push_daily_reminder_targets(boolean) from public, anon, authenticated;
revoke all on function public.push_test_targets(text) from public, anon, authenticated;
revoke all on function public.push_report(text[], text[]) from public, anon, authenticated;
revoke all on function public._push_daily_tick(boolean) from public, anon, authenticated;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.push_daily_reminder_targets(boolean) to service_role;
grant execute on function public.push_test_targets(text) to service_role;
grant execute on function public.push_report(text[], text[]) to service_role;

-- Jobs « push-daily-reminder » (toutes les heures a :00) et sa purge d'historique.
-- Tolerant : sans pg_net / pg_cron, simple NOTICE (le rappel peut alors etre declenche
-- par n'importe quel planificateur externe appelant l'URL avec le secret).
do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    raise notice 'pg_net indisponible (%) : rappel push a declencher depuis l''exterieur', sqlerrm;
  end;
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron indisponible (%) : rappel push a declencher depuis l''exterieur', sqlerrm;
    return;
  end;
  begin
    perform cron.unschedule(j.jobid) from cron.job j
      where j.jobname in ('push-daily-reminder', 'push-daily-reminder-purge');
    perform cron.schedule('push-daily-reminder', '0 * * * *', 'select public._push_daily_tick()');
    perform cron.schedule('push-daily-reminder-purge', '23 4 * * *',
      $job$delete from cron.job_run_details
            where end_time < now() - interval '7 days'
              and jobid in (select jobid from cron.job where jobname = 'push-daily-reminder')$job$);
  exception when others then
    raise notice 'planification pg_cron impossible (%) : rappel push non planifie', sqlerrm;
  end;
end $$;


-- ===== features\push_invites.sql =====
-- =============================================================================
-- NOTIFICATION « <hote> t'invite a sa soiree ! » — idempotent, execute APRES push.sql
-- (ordre alphabetique de features/).
--
-- Circuit : trigger sur soiree_players (joueur ajoute par l'hote) -> ligne dans
-- push_invites (une seule par joueur et par soiree = anti-spam, meme si l'hote le
-- retire puis le reinvite) -> pg_net POST <invite_url> (Bearer <secret>) -> fonction
-- Vercel api/soiree-invite.ts -> push_invite_claim() (cle service role) -> web-push
-- -> push_report(). Jamais bloquant : toute erreur (pg_net absent...) = simple NOTICE.
--
-- Configuration : RIEN de plus si push_config.reminder_url est deja rempli (l'URL
-- d'invitation en est deduite en remplacant « daily-reminder » par « soiree-invite »).
-- URL personnalisee : update public.push_config set invite_url = 'https://TON-APP.vercel.app/api/soiree-invite';
-- Cote Vercel : redeployer (la route api/soiree-invite.ts utilise les memes variables
-- d'environnement que le rappel du defi). Verifier : select * from public.push_invites;
-- =============================================================================

alter table public.push_config add column if not exists invite_url text;

-- Preferences push par joueur (defaut : on me previent quand on m'invite).
create table if not exists public.push_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  invites    boolean not null default true
);
alter table public.push_prefs enable row level security;
revoke all on table public.push_prefs from anon, authenticated;

-- File d'attente + memoire anti-doublon des invitations.
create table if not exists public.push_invites (
  soiree_id  uuid not null references public.soirees(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  host_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  primary key (soiree_id, profile_id)
);
alter table public.push_invites enable row level security;
revoke all on table public.push_invites from anon, authenticated;

create or replace function public.get_push_prefs()
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  return jsonb_build_object('invites',
    coalesce((select invites from public.push_prefs where profile_id = v_me), true));
end $$;

create or replace function public.set_push_invites(p_enabled boolean)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  insert into public.push_prefs(profile_id, invites) values (v_me, coalesce(p_enabled, true))
  on conflict (profile_id) do update set invites = excluded.invites;
end $$;

-- Trigger : un joueur (autre que l'hote) rejoint une soiree.
create or replace function public._push_invite_trg()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_host   uuid;
  v_status text;
  c        public.push_config%rowtype;
  v_url    text;
  v_rows   integer;
begin
  begin
    select host_id, status into v_host, v_status from public.soirees where id = new.soiree_id;
    if v_host is null or v_host = new.profile_id or v_status = 'ended' then return new; end if;
    -- Rejoindre soi-même (code, lien invité) n'est pas une invitation : pas de notification.
    if new.profile_id = public.current_profile_id() then return new; end if;
    insert into public.push_invites(soiree_id, profile_id, host_id) values (new.soiree_id, new.profile_id, v_host)
      on conflict do nothing;
    get diagnostics v_rows = row_count;
    if v_rows = 0 then return new; end if;
    select * into c from public.push_config where id;
    v_url := coalesce(nullif(c.invite_url, ''), replace(nullif(c.reminder_url, ''), 'daily-reminder', 'soiree-invite'));
    if not found or v_url is null or coalesce(c.secret, '') = '' then
      raise notice 'push_config incomplete : invitation non notifiee';
      return new;
    end if;
    perform net.http_post(
      url := v_url,
      body := '{}'::jsonb,
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || c.secret),
      timeout_milliseconds := 30000);
  exception when others then
    raise notice 'invitation push non envoyee (%)', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists push_invite_trg on public.soiree_players;
create trigger push_invite_trg after insert on public.soiree_players
  for each row execute function public._push_invite_trg();

-- Fonction Vercel : reclame (atomiquement) les invitations en attente et renvoie les
-- appareils a notifier (preference activee, soiree ouverte, invitation de moins de 10 min).
-- -> [{endpoint, p256dh, auth, profile_id, host_nick, soiree_id}]
create or replace function public.push_invite_claim()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare v_rows jsonb;
begin
  delete from public.push_invites where created_at < now() - interval '60 days';
  with claimed as (
    update public.push_invites i set sent_at = now()
     where i.sent_at is null
    returning i.soiree_id, i.profile_id, i.host_id, i.created_at
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'profile_id', c.profile_id,
           'host_nick', h.nickname, 'soiree_id', c.soiree_id)), '[]'::jsonb)
    into v_rows
    from claimed c
    join public.soirees so on so.id = c.soiree_id and so.status <> 'ended'
    join public.profiles h on h.id = c.host_id
    join public.push_subscriptions s on s.profile_id = c.profile_id
   where c.created_at > now() - interval '10 minutes'
     and coalesce((select p.invites from public.push_prefs p where p.profile_id = c.profile_id), true);
  return v_rows;
end $$;

revoke all on function public.get_push_prefs() from public, anon;
revoke all on function public.set_push_invites(boolean) from public, anon;
revoke all on function public._push_invite_trg() from public, anon, authenticated;
revoke all on function public.push_invite_claim() from public, anon, authenticated;
grant execute on function public.get_push_prefs() to authenticated;
grant execute on function public.set_push_invites(boolean) to authenticated;
grant execute on function public.push_invite_claim() to service_role;


-- ===== features\recap.sql =====
-- =============================================================================
-- RÉCAP DE SOIRÉE (lot C, « façon Wrapped ») — idempotent, exécuté en features/*
-- (après chat.sql : soiree_messages ; _soiree_standings de stats.sql est résolu à l'exécution).
--
-- Le chat est PURGÉ quand la soirée passe à 'ended' (trigger soirees_chat_purge).
-- Les stats de chat / stickers sont donc figées dans `soiree_recaps` par un trigger
-- AFTER UPDATE OF status nommé `soirees_a_recap` : les triggers AFTER d'une même table
-- s'exécutent par ordre alphabétique, « soirees_a_recap » passe avant « soirees_chat_purge ».
--
-- jsonb du récap (version 1) :
--   { version, soiree_id, has_chat (bool : stats de chat disponibles),
--     started_at, ended_at, duration_min, games_played, distinct_games, players_count,
--     players:[{profile_id,slug,nickname,equipped_tenue}],
--     games:[{game_id,played}]  (le plus joué d'abord, ex-aequo par id),
--     top_game:{game_id,played}|null,
--     awards:[{id, profile_id, value, extra}] }
--   RPC soiree_recap ajoute à la volée : standings:[...], winner_ids:[...] (cf. stats.sql).
-- Awards (au plus un lauréat par award, ex-aequo départagés par sort_order du profil) :
--   serie    : plus longue série de victoires consécutives (ses propres parties), >= 2
--   deuxieme : parties terminées 2e (non gagnant, >= 3 joueurs), >= 2
--   bluff    : victoires « en tant qu'infiltré » à Undercover (stats.undercover_won_as_undercover)
--              + victoires côté loup à Loup-garou (state.roles[pid] = 'loup' et won), >= 1
--              extra {as_undercover, as_wolf}
--   pasdebol : parties finies à la dernière place (>= 3 joueurs, >= 3 placements différents,
--              pas gagnant), >= 2
--   bavard   : messages texte envoyés, >= 5            (chat requis)
--   sticker  : sticker le plus envoyé de la soirée (>= 2 envois) ; profile_id = qui l'a le plus
--              envoyé, value = ses envois, extra {expression, total, tenue}   (chat requis)
-- La « Star de la soirée » est le 1er du classement (standings), pas stockée ici.
-- =============================================================================

create table if not exists public.soiree_recaps (
  soiree_id  uuid primary key references public.soirees(id) on delete cascade,
  data       jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.soiree_recaps enable row level security;
revoke all on table public.soiree_recaps from anon, authenticated;

create or replace function public._soiree_recap_compute(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  s        public.soirees%rowtype;
  v_chat   boolean;
  v_games  jsonb;
  v_pl     jsonb;
  v_awards jsonb;
  v_end    timestamptz;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then return null; end if;
  v_end := coalesce(s.ended_at, now());
  v_chat := exists (select 1 from public.soiree_messages where soiree_id = p_soiree_id);

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'played', g.n) order by g.n desc, g.game_id), '[]'::jsonb)
    into v_games
    from (select m.game_id, count(*)::int as n
            from public.matches m
           where m.soiree_id = p_soiree_id and m.status = 'finished'
             and exists (select 1 from public.match_players x where x.match_id = m.id)
           group by m.game_id) g;

  select coalesce(jsonb_agg(jsonb_build_object('profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                               'equipped_tenue', p.equipped_tenue) order by p.sort_order), '[]'::jsonb)
    into v_pl
    from public.profiles p
   where p.id in (select profile_id from public.soiree_players where soiree_id = p_soiree_id
                  union select x.profile_id from public.match_players x join public.matches m on m.id = x.match_id
                         where m.soiree_id = p_soiree_id
                  union select profile_id from public.soiree_messages where soiree_id = p_soiree_id);

  with mp as (
    select x.profile_id, x.match_id, m.game_id, m.finished_at, x.won, x.placement, x.stats, m.state,
           count(*) over (partition by x.match_id) as n,
           max(x.placement) over (partition by x.match_id) as maxp,
           (select count(distinct y.placement) from public.match_players y where y.match_id = x.match_id) as np
      from public.match_players x join public.matches m on m.id = x.match_id
     where m.soiree_id = p_soiree_id and m.status = 'finished'
  ), t as (
    select profile_id, won,
           row_number() over (partition by profile_id order by finished_at, match_id) as rn,
           row_number() over (partition by profile_id, won order by finished_at, match_id) as rw
      from mp
  ), streaks as (
    select profile_id, count(*)::int as len from t where won group by profile_id, rn - rw
  ), cand as (
    select 'serie'::text as id, profile_id, max(len) as value, '{}'::jsonb as extra
      from streaks group by profile_id having max(len) >= 2
    union all
    select 'deuxieme', profile_id, count(*)::int, '{}'::jsonb
      from mp where placement = 2 and not won and n >= 3 group by profile_id having count(*) >= 2
    union all
    select 'pasdebol', profile_id, count(*)::int, '{}'::jsonb
      from mp where placement = maxp and placement > 1 and not won and n >= 3 and np >= 3
     group by profile_id having count(*) >= 2
    union all
    select 'bluff', b.profile_id, b.u + b.w, jsonb_build_object('as_undercover', b.u, 'as_wolf', b.w)
      from (select profile_id,
                   coalesce(sum(case when game_id = 'undercover' then coalesce((stats->>'undercover_won_as_undercover')::int, 0) else 0 end), 0)::int as u,
                   count(*) filter (where game_id = 'loup-garou' and won and state->'roles'->>(profile_id::text) = 'loup')::int as w
              from mp group by profile_id) b
     where b.u + b.w >= 1
    union all
    select 'bavard', profile_id, count(*)::int, '{}'::jsonb
      from public.soiree_messages where soiree_id = p_soiree_id and kind = 'text'
     group by profile_id having count(*) >= 5
    union all
    select 'sticker', z.profile_id, z.c, jsonb_build_object('expression', top.body, 'total', top.total,
             'tenue', (select q.tenue from public.soiree_messages q
                        where q.soiree_id = p_soiree_id and q.kind = 'sticker' and q.body = top.body and q.profile_id = z.profile_id
                        order by q.id desc limit 1))
      from (select body, count(*)::int as total from public.soiree_messages
             where soiree_id = p_soiree_id and kind = 'sticker'
             group by body having count(*) >= 2 order by count(*) desc, body limit 1) top
      cross join lateral (select q.profile_id, count(*)::int as c from public.soiree_messages q
                           where q.soiree_id = p_soiree_id and q.kind = 'sticker' and q.body = top.body
                           group by q.profile_id order by count(*) desc, q.profile_id limit 1) z
    union all
    select 'devin', r.profile_id, count(*) filter (where r.ok)::int, jsonb_build_object('bets', count(*)::int)
      from public._prono_resolved() r where r.soiree_id = p_soiree_id
     group by r.profile_id having count(*) filter (where r.ok) >= 1
  ), best as (
    select distinct on (c.id) c.id, c.profile_id, c.value, c.extra
      from cand c join public.profiles p on p.id = c.profile_id
     order by c.id, c.value desc, p.sort_order
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'profile_id', profile_id, 'value', value, 'extra', extra)
                            order by array_position(array['serie','bluff','deuxieme','pasdebol','bavard','sticker','devin'], id)), '[]'::jsonb)
    into v_awards from best;

  return jsonb_build_object(
    'version', 1, 'soiree_id', p_soiree_id, 'has_chat', v_chat,
    'started_at', coalesce(s.started_at, s.created_at), 'ended_at', s.ended_at,
    'duration_min', greatest(0, round(extract(epoch from (v_end - coalesce(s.started_at, s.created_at))) / 60))::int,
    'games_played', (select coalesce(sum((e->>'played')::int), 0) from jsonb_array_elements(v_games) e),
    'distinct_games', jsonb_array_length(v_games),
    'players_count', jsonb_array_length(v_pl),
    'players', v_pl,
    'games', v_games,
    'top_game', v_games->0,
    'awards', v_awards);
end $$;

-- Trigger : fige le récap à la fin de la soirée (avant la purge du chat).
-- Ne doit JAMAIS empêcher la fin de la soirée : toute erreur est avalée.
create or replace function public._soiree_recap_store()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  begin
    insert into public.soiree_recaps(soiree_id, data)
    values (new.id, public._soiree_recap_compute(new.id))
    on conflict (soiree_id) do nothing;
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists soirees_a_recap on public.soirees;
create trigger soirees_a_recap after update of status on public.soirees
  for each row when (new.status = 'ended' and old.status is distinct from 'ended')
  execute function public._soiree_recap_store();

-- Récap d'une soirée TERMINÉE (mêmes règles d'accès que soiree_history_detail).
-- Sans récap stocké (soirée terminée avant ce lot) : calcul à la volée, sans stats de chat (has_chat=false).
-- → jsonb décrit ci-dessus + standings + winner_ids.
-- Erreurs : soiree_not_found, not_in_soiree, soiree_not_ended.
create or replace function public.soiree_recap(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  s    public.soirees%rowtype;
  v_d  jsonb;
  v_st jsonb;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if not (s.host_id = v_me
          or exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = s.id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  if s.status <> 'ended' then raise exception 'soiree_not_ended'; end if;

  select data into v_d from public.soiree_recaps where soiree_id = s.id;
  if v_d is null then v_d := public._soiree_recap_compute(s.id); end if;
  v_st := public._soiree_standings(s.id);
  return v_d || jsonb_build_object(
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

revoke all on function public._soiree_recap_compute(uuid) from public, anon, authenticated;
revoke all on function public._soiree_recap_store() from public, anon, authenticated;
revoke all on function public.soiree_recap(uuid) from public, anon;
grant execute on function public.soiree_recap(uuid) to authenticated;


-- ===== features\reveillon.sql =====
-- =============================================================================
-- MODE RÉVEILLON / SOIRÉE SCÉNARISÉE — idempotent, exécuté APRÈS schema.sql (features/*).
-- Front : src/features/reveillon/ (thèmes + textes des défis dans themes.ts).
--
-- L'hôte lance une soirée scénarisée (thème noel | nouvel-an | surprise, 4/6/8 manches) :
-- l'appli tire un jeu au sort (parmi les ids compatibles envoyés par le front, jamais deux
-- fois le même tant que c'est possible), l'hôte le lance, et à la fin de chaque partie un
-- DÉFI SURPRISE (petit gage IRL) s'affiche chez tout le monde ; l'hôte coche qui l'a relevé
-- (+1 point) puis passe à la manche suivante. Dernière manche : points doublés.
--
-- État : colonne jsonb soirees.scenario (tout le monde suit via le Realtime de soirees) :
--   {v, theme, rounds, round, phase 'draw'|'playing'|'challenge'|'finished',
--    game_id, pool[] (parts de la roue du tirage), draw (compteur de tirages), drawn_at,
--    match_id, challenge {id, winner_id, loser_id, random_id} | null,
--    challenge_ids[], deck[] (défis restants, mélangés),
--    history [{round, game_id, match_id, points {profile_id: pts}, wins [], double, challenge, bravo []}],
--    started_at, finished_at, closed (true = retour au salon normal ; gardé pour le récap)}
-- Barème d'une manche = _soiree_points (stats.sql : 3/2/1…), x2 à la dernière manche ;
-- +1 par défi relevé. Le classement est calculé côté front à partir de history.
-- Fin de partie : trigger matches_reveillon_end (AFTER UPDATE OF status, erreurs avalées :
-- ne bloque jamais la fin d'une partie). Partie annulée -> retour au tirage (même jeu).
--
-- RPC (hôte) : reveillon_start, reveillon_reroll, reveillon_launch, reveillon_next, reveillon_stop.
-- Lecture : reveillon_recap(soiree) (récap de fin, mêmes accès que soiree_recap).
-- Erreurs : not_host, soiree_ended, soiree_not_found, match_in_progress, not_enough_players,
--   reveillon_already_on, reveillon_off, reveillon_wrong_phase, reveillon_invalid, reveillon_no_games.
-- =============================================================================

alter table public.soirees add column if not exists scenario jsonb;

-- Ids propres (jeux / défis), sans doublon.
create or replace function public._rv_ids(p text[])
returns text[] language sql immutable
as $$
  select coalesce(array(select distinct x from unnest(coalesce(p, '{}'::text[])) x
                         where x ~ '^[a-z0-9_-]{1,40}$' order by x), '{}'::text[])
$$;

create or replace function public._rv_shuffle(p text[])
returns text[] language sql volatile
as $$
  select coalesce(array(select x from unnest(coalesce(p, '{}'::text[])) x order by random()), '{}'::text[])
$$;

-- Tire le jeu de la manche parmi p_ids (compatibles avec le nombre de joueurs, filtrés par le
-- front) : d'abord les jeux pas encore joués ; p_reroll exclut aussi le jeu tiré actuel.
-- Plus rien ? on autorise les déjà joués sauf le dernier, puis tout.
create or replace function public._rv_draw(p_sc jsonb, p_ids text[], p_reroll boolean)
returns jsonb language plpgsql volatile
set search_path = public, extensions
as $$
declare
  v_played text[] := array(select e->>'game_id' from jsonb_array_elements(coalesce(p_sc->'history', '[]'::jsonb)) e);
  v_last   text := (p_sc->'history'->-1)->>'game_id';
  v_cur    text := case when p_reroll then p_sc->>'game_id' end;
  v_cand   text[];
begin
  if coalesce(cardinality(p_ids), 0) = 0 then raise exception 'reveillon_no_games'; end if;
  v_cand := array(select x from unnest(p_ids) x where not (x = any(v_played)) and x is distinct from v_cur);
  if cardinality(v_cand) = 0 then
    v_cand := array(select x from unnest(p_ids) x where x is distinct from v_last and x is distinct from v_cur);
  end if;
  if cardinality(v_cand) = 0 then
    v_cand := array(select x from unnest(p_ids) x where x is distinct from v_cur);
  end if;
  if cardinality(v_cand) = 0 then v_cand := p_ids; end if;
  return p_sc || jsonb_build_object(
    'phase', 'draw',
    'game_id', v_cand[1 + floor(random() * cardinality(v_cand))::int],
    'pool', to_jsonb(v_cand),
    'draw', coalesce((p_sc->>'draw')::int, 0) + 1,
    'drawn_at', now(),
    'match_id', null,
    'challenge', null);
end $$;

-- Verrouille la soirée et vérifie l'hôte. Erreurs : soiree_not_found, not_host, soiree_ended.
create or replace function public._rv_lock(p_soiree_id uuid)
returns public.soirees language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_s  public.soirees%rowtype;
begin
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  return v_s;
end $$;

-- Scénario en cours (ni absent, ni refermé) : sinon reveillon_off.
create or replace function public._rv_active(p_sc jsonb)
returns jsonb language plpgsql immutable
as $$
begin
  if p_sc is null or coalesce((p_sc->>'closed')::boolean, false) then raise exception 'reveillon_off'; end if;
  return p_sc;
end $$;

-- Démarre la soirée scénarisée (manche 1 tirée au sort). p_game_ids : jeux compatibles avec le
-- nombre de joueurs (1 à 40) ; p_challenge_ids : défis du thème (1 à 60, textes côté front).
create or replace function public.reveillon_start(p_soiree_id uuid, p_theme text, p_rounds integer,
                                                  p_game_ids text[], p_challenge_ids text[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_s     public.soirees%rowtype := public._rv_lock(p_soiree_id);
  v_games text[] := public._rv_ids(p_game_ids);
  v_ch    text[] := public._rv_ids(p_challenge_ids);
  v_sc    jsonb;
begin
  if v_s.scenario is not null and not coalesce((v_s.scenario->>'closed')::boolean, false)
     and v_s.scenario->>'phase' <> 'finished' then
    raise exception 'reveillon_already_on';
  end if;
  if exists (select 1 from public.matches m where m.soiree_id = p_soiree_id and m.status <> 'finished') then
    raise exception 'match_in_progress';
  end if;
  if p_theme is null or p_theme not in ('noel', 'nouvel-an', 'surprise')
     or p_rounds is null or p_rounds not in (4, 6, 8)
     or cardinality(v_ch) not between 1 and 60 then
    raise exception 'reveillon_invalid';
  end if;
  if cardinality(v_games) not between 1 and 40 then raise exception 'reveillon_no_games'; end if;
  if (select count(*) from public.soiree_players where soiree_id = p_soiree_id) < 2 then
    raise exception 'not_enough_players';
  end if;
  v_sc := public._rv_draw(jsonb_build_object(
    'v', 1, 'theme', p_theme, 'rounds', p_rounds, 'round', 1, 'draw', 0,
    'history', '[]'::jsonb, 'challenge_ids', to_jsonb(v_ch), 'deck', to_jsonb(public._rv_shuffle(v_ch)),
    'started_at', now(), 'finished_at', null, 'closed', false), v_games, false);
  update public.soirees set scenario = v_sc where id = p_soiree_id;
  return v_sc;
end $$;

-- Nouveau tirage pour la manche en cours (phase draw seulement).
create or replace function public.reveillon_reroll(p_soiree_id uuid, p_game_ids text[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_s  public.soirees%rowtype := public._rv_lock(p_soiree_id);
  v_sc jsonb := public._rv_active(v_s.scenario);
begin
  if v_sc->>'phase' <> 'draw' then raise exception 'reveillon_wrong_phase'; end if;
  v_sc := public._rv_draw(v_sc, public._rv_ids(p_game_ids), true);
  update public.soirees set scenario = v_sc where id = p_soiree_id;
  return v_sc;
end $$;

-- Lance le jeu tiré (start_match : mêmes contrôles et mêmes options que le lancement normal).
create or replace function public.reveillon_launch(p_soiree_id uuid, p_options jsonb)
returns uuid language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_s  public.soirees%rowtype := public._rv_lock(p_soiree_id);
  v_sc jsonb := public._rv_active(v_s.scenario);
  v_id uuid;
begin
  if v_sc->>'phase' <> 'draw' then raise exception 'reveillon_wrong_phase'; end if;
  v_id := public.start_match(p_soiree_id, v_sc->>'game_id', coalesce(p_options, '{}'::jsonb));
  update public.soirees
     set scenario = scenario || jsonb_build_object('phase', 'playing', 'match_id', v_id)
   where id = p_soiree_id;
  return v_id;
end $$;

-- Fin d'une partie de la soirée : si c'est la manche en cours, points de la manche + défi surprise.
create or replace function public._rv_on_match_finished()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_sc     jsonb;
  v_n      integer;
  v_double boolean;
  v_pts    jsonb;
  v_wins   jsonb;
  v_winner uuid;
  v_loser  uuid;
  v_rand   uuid;
  v_deck   jsonb;
  v_ch     text;
begin
  begin
    select scenario into v_sc from public.soirees where id = new.soiree_id for update;
    if v_sc is null or coalesce((v_sc->>'closed')::boolean, false) or v_sc->>'phase' <> 'playing'
       or v_sc->>'match_id' is distinct from new.id::text then
      return new;
    end if;
    -- Partie annulée : retour au tirage, même jeu (l'hôte relance ou change de jeu).
    if coalesce((new.state->>'aborted')::boolean, false) then
      update public.soirees set scenario = v_sc || jsonb_build_object('phase', 'draw', 'match_id', null)
       where id = new.soiree_id;
      return new;
    end if;

    v_double := (v_sc->>'round')::int >= (v_sc->>'rounds')::int;
    select count(*)::int into v_n from public.match_players where match_id = new.id;
    select coalesce(jsonb_object_agg(mp.profile_id::text,
                      public._soiree_points(mp.won, mp.placement, v_n) * case when v_double then 2 else 1 end), '{}'::jsonb),
           coalesce(jsonb_agg(mp.profile_id) filter (where mp.won), '[]'::jsonb)
      into v_pts, v_wins
      from public.match_players mp where mp.match_id = new.id;
    select mp.profile_id into v_winner from public.match_players mp
     where mp.match_id = new.id and mp.won order by random() limit 1;
    select mp.profile_id into v_loser from public.match_players mp
     where mp.match_id = new.id and not mp.won order by mp.placement desc nulls last, random() limit 1;
    select sp.profile_id into v_rand from public.soiree_players sp
     where sp.soiree_id = new.soiree_id order by random() limit 1;

    -- Pioche du défi (paquet mélangé ; vide -> on remélange tous les défis du thème).
    v_deck := coalesce(v_sc->'deck', '[]'::jsonb);
    if jsonb_array_length(v_deck) = 0 then
      v_deck := to_jsonb(public._rv_shuffle(array(select jsonb_array_elements_text(coalesce(v_sc->'challenge_ids', '[]'::jsonb)))));
    end if;
    v_ch := v_deck->>0;
    v_deck := v_deck - 0;

    update public.soirees set scenario = v_sc || jsonb_build_object(
        'phase', 'challenge',
        'deck', v_deck,
        'challenge', case when v_ch is null then null else jsonb_build_object(
          'id', v_ch, 'winner_id', v_winner, 'loser_id', v_loser, 'random_id', v_rand) end,
        'history', coalesce(v_sc->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'round', (v_sc->>'round')::int, 'game_id', new.game_id, 'match_id', new.id,
          'points', v_pts, 'wins', v_wins, 'double', v_double, 'challenge', v_ch, 'bravo', '[]'::jsonb)))
     where id = new.soiree_id;
  exception when others then
    null; -- ne jamais empêcher la fin d'une partie
  end;
  return new;
end $$;

drop trigger if exists matches_reveillon_end on public.matches;
create trigger matches_reveillon_end after update of status on public.matches
  for each row when (new.status = 'finished' and old.status is distinct from 'finished')
  execute function public._rv_on_match_finished();

-- Après le défi : p_bravo = joueurs qui l'ont relevé (+1 point chacun), puis manche suivante
-- (nouveau tirage parmi p_game_ids) ou fin du scénario après la dernière manche.
create or replace function public.reveillon_next(p_soiree_id uuid, p_bravo uuid[], p_game_ids text[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_s     public.soirees%rowtype := public._rv_lock(p_soiree_id);
  v_sc    jsonb := public._rv_active(v_s.scenario);
  v_len   integer;
  v_bravo jsonb;
begin
  if v_sc->>'phase' <> 'challenge' then raise exception 'reveillon_wrong_phase'; end if;
  v_len := jsonb_array_length(coalesce(v_sc->'history', '[]'::jsonb));
  if v_len > 0 then
    select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into v_bravo
      from unnest(coalesce(p_bravo, '{}'::uuid[])) x
     where exists (select 1 from public.soiree_players sp where sp.soiree_id = p_soiree_id and sp.profile_id = x);
    v_sc := jsonb_set(v_sc, array['history', (v_len - 1)::text, 'bravo'], v_bravo);
  end if;
  if (v_sc->>'round')::int >= (v_sc->>'rounds')::int then
    v_sc := v_sc || jsonb_build_object('phase', 'finished', 'challenge', null, 'match_id', null, 'finished_at', now());
  else
    v_sc := public._rv_draw(v_sc || jsonb_build_object('round', (v_sc->>'round')::int + 1),
                            public._rv_ids(p_game_ids), false);
  end if;
  update public.soirees set scenario = v_sc where id = p_soiree_id;
  return v_sc;
end $$;

-- Arrête le scénario (pas pendant une partie). Sans manche jouée : effacé. Sinon refermé
-- (closed = true, retour au salon normal) mais gardé pour le récap de fin.
create or replace function public.reveillon_stop(p_soiree_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_s  public.soirees%rowtype := public._rv_lock(p_soiree_id);
  v_sc jsonb := public._rv_active(v_s.scenario);
begin
  if v_sc->>'phase' = 'playing' then raise exception 'match_in_progress'; end if;
  if jsonb_array_length(coalesce(v_sc->'history', '[]'::jsonb)) = 0 then
    update public.soirees set scenario = null where id = p_soiree_id;
  else
    update public.soirees
       set scenario = v_sc || jsonb_build_object('closed', true, 'challenge', null,
                                                 'finished_at', case when v_sc->>'finished_at' is null then to_jsonb(now())
                                                                     else v_sc->'finished_at' end)
     where id = p_soiree_id;
  end if;
end $$;

-- Récap : le scénario d'une soirée (au moins une manche jouée), sans le paquet de défis ; null sinon.
-- Accès : hôte, membre ou ancien joueur de la soirée. Erreurs : soiree_not_found, not_in_soiree.
create or replace function public.reveillon_recap(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  s    public.soirees%rowtype;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if not (s.host_id = v_me
          or exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = s.id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  if s.scenario is null or jsonb_array_length(coalesce(s.scenario->'history', '[]'::jsonb)) = 0 then
    return null;
  end if;
  return s.scenario - 'deck' - 'challenge_ids' - 'pool';
end $$;

revoke all on function public._rv_ids(text[]) from public, anon, authenticated;
revoke all on function public._rv_shuffle(text[]) from public, anon, authenticated;
revoke all on function public._rv_draw(jsonb, text[], boolean) from public, anon, authenticated;
revoke all on function public._rv_lock(uuid) from public, anon, authenticated;
revoke all on function public._rv_active(jsonb) from public, anon, authenticated;
revoke all on function public._rv_on_match_finished() from public, anon, authenticated;
revoke all on function public.reveillon_start(uuid, text, integer, text[], text[]) from public, anon;
revoke all on function public.reveillon_reroll(uuid, text[]) from public, anon;
revoke all on function public.reveillon_launch(uuid, jsonb) from public, anon;
revoke all on function public.reveillon_next(uuid, uuid[], text[]) from public, anon;
revoke all on function public.reveillon_stop(uuid) from public, anon;
revoke all on function public.reveillon_recap(uuid) from public, anon;
grant execute on function public.reveillon_start(uuid, text, integer, text[], text[]) to authenticated;
grant execute on function public.reveillon_reroll(uuid, text[]) to authenticated;
grant execute on function public.reveillon_launch(uuid, jsonb) to authenticated;
grant execute on function public.reveillon_next(uuid, uuid[], text[]) to authenticated;
grant execute on function public.reveillon_stop(uuid) to authenticated;
grant execute on function public.reveillon_recap(uuid) to authenticated;


-- ===== features\saisons.sql =====
-- =============================================================================
-- SAISONS DE BOUTIQUE — idempotent, execute APRES cadeaux.sql et mises.sql (ordre alphabetique de features/).
-- Spec : docs/superpowers/specs/2026-11-22-saisons-boutique-design.md
--
-- 4 saisons calendaires (heure de Paris), lancees le 2026-12-01 (rien avant) :
--   hiver (1 dec -> fin fev) · printemps (1 mars -> 31 mai) · ete (1 juin -> 31 aout) · automne (1 sept -> 30 nov)
--   season_key = '<id>-<annee du jour de debut>' (janvier 2027 = 'hiver-2026'). Calendrier fixe, pas de table.
-- Catalogue (items.season / items.pass_tier, cadeaux.sql) : collection limitee de 9 articles par saison (price non
--   null, achetable pendant la saison via buy_item) + 4 exclusifs du passe (pas de prix, jamais vendus).
-- Passe gratuit de 20 paliers de 40 points : points DERIVES de l'historique de la saison (partie terminee 10,
--   victoire +10, defi du jour termine 15, soiree a >= 2 joueurs 25 une fois par soiree). Recompenses attribuees
--   par season_sync (idempotent, saison en cours + precedente) : pieces (via coin_ledger, raison 'season_pass',
--   ref '<season_key>:<palier>') + exclusifs aux paliers 5/10/15/20 (+ titre et 100 pieces au 20). Deja possede :
--   100 pieces a la place (150 au palier 20 : 100 + 50 pour le titre).
-- Les invites (profiles.is_guest) n'ont ni passe ni pieces : season_sync les ignore.
--
-- RPC : season_sync() -> {season, season_key, starts_at, ends_at, points, tier, new_claims:[{season_key, tier,
--   coins, item_id, compensated}], ended:{season, season_key, tier, coins_total, collection_owned}|null}
-- Fonctions de date : _season_now() (= now(), redefinie par les tests PGlite pour simuler une date).
-- =============================================================================

create table if not exists public.season_pass_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  season_key text not null,
  tier       integer not null check (tier between 1 and 20),
  coins      integer not null default 0,
  item_id    text references public.items(id) on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (profile_id, season_key, tier)
);
alter table public.season_pass_claims enable row level security;
-- Aucune policy : table lue / ecrite uniquement par season_sync (security definer).

-- « Maintenant » (surchargeable en test).
create or replace function public._season_now()
returns timestamptz language sql stable as $$ select now() $$;

-- Bornes d'une edition (season_key) : jour de debut et dernier jour inclus. Vide si cle invalide.
create or replace function public._season_bounds(p_key text)
returns table(season_id text, season_key text, starts_on date, ends_on date)
language sql immutable
as $$
  with k as (
    select split_part(p_key, '-', 1) as id, nullif(split_part(p_key, '-', 2), '')::int as yr
  ), s as (
    select id, yr, make_date(yr, case id when 'hiver' then 12 when 'printemps' then 3 when 'ete' then 6 else 9 end, 1) as d
      from k where id in ('hiver', 'printemps', 'ete', 'automne') and yr is not null
  )
  select id, p_key, d, (d + interval '3 months' - interval '1 day')::date from s
$$;

-- Saison en cours a l'instant p_at (heure de Paris). Aucune ligne avant le lancement (2026-12-01).
create or replace function public._season_at(p_at timestamptz)
returns table(season_id text, season_key text, starts_on date, ends_on date)
language plpgsql stable
as $$
declare
  v_d date := (p_at at time zone 'Europe/Paris')::date;
  v_m int := extract(month from v_d);
  v_y int := extract(year from v_d);
  v_id text;
begin
  if v_d < date '2026-12-01' then return; end if;
  if v_m in (12, 1, 2) then
    v_id := 'hiver';
    if v_m <> 12 then v_y := v_y - 1; end if;
  elsif v_m in (3, 4, 5) then v_id := 'printemps';
  elsif v_m in (6, 7, 8) then v_id := 'ete';
  else v_id := 'automne';
  end if;
  return query select b.season_id, b.season_key, b.starts_on, b.ends_on from public._season_bounds(v_id || '-' || v_y) b;
end $$;

-- Points de passe d'un joueur sur une edition (derives de l'historique, dans la fenetre de la saison).
create or replace function public._season_points(p_profile uuid, p_key text)
returns integer language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  b record;
  v_from timestamptz;
  v_to timestamptz;
  v_pts integer;
begin
  if exists (select 1 from public.profiles where id = p_profile and is_guest) then return 0; end if;
  select * into b from public._season_bounds(p_key);
  if b.starts_on is null then return 0; end if;
  v_from := b.starts_on::timestamp at time zone 'Europe/Paris';
  v_to := (b.ends_on + 1)::timestamp at time zone 'Europe/Paris';
  -- Parties : memes lignes match_players que _coins, datees par la fin de la partie.
  select coalesce(10 * count(*) + 10 * count(*) filter (where mp.won), 0) into v_pts
    from public.match_players mp join public.matches m on m.id = mp.match_id
   where mp.profile_id = p_profile and coalesce(m.finished_at, m.created_at) >= v_from and coalesce(m.finished_at, m.created_at) < v_to;
  -- Defis du jour termines.
  v_pts := v_pts + 15 * (select count(*) from public.daily_runs d
                          where d.profile_id = p_profile and d.finished_at >= v_from and d.finished_at < v_to)::int;
  -- Soirees entre amis : une seule fois par soiree (partie a >= 2 joueurs, dans la fenetre).
  v_pts := v_pts + 25 * (select count(distinct m.soiree_id) from public.match_players mp
                           join public.matches m on m.id = mp.match_id
                          where mp.profile_id = p_profile
                            and coalesce(m.finished_at, m.created_at) >= v_from and coalesce(m.finished_at, m.created_at) < v_to
                            and (select count(*) from public.match_players x where x.match_id = m.id) >= 2)::int;
  return v_pts;
end $$;

create or replace function public._season_tier(p_points integer)
returns integer language sql immutable as $$ select least(20, greatest(0, p_points / 40)) $$;

-- Pieces du palier (grille commune aux 4 saisons ; 0 aux paliers a cosmetique 5/10/15 ; 100 au 20).
create or replace function public._season_tier_coins(p_tier integer)
returns integer language sql immutable
as $$
  select case p_tier
    when 1 then 20 when 2 then 20 when 3 then 20 when 4 then 30
    when 6 then 20 when 7 then 30 when 8 then 30 when 9 then 30
    when 11 then 30 when 12 then 30 when 13 then 40 when 14 then 40
    when 16 then 40 when 17 then 40 when 18 then 50 when 19 then 50
    when 20 then 100 else 0 end
$$;

-- Attribue les paliers atteints et pas encore enregistres d'une edition. Renvoie les nouveaux paliers.
create or replace function public._season_claim(p_profile uuid, p_key text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_new jsonb := '[]'::jsonb;
  v_id text;
  v_tier integer;
  t integer;
  v_item text;
  v_coins integer;
  v_comp boolean;
begin
  select season_id into v_id from public._season_bounds(p_key);
  if v_id is null then return v_new; end if;
  v_tier := public._season_tier(public._season_points(p_profile, p_key));
  for t in 1..v_tier loop
    if exists (select 1 from public.season_pass_claims where profile_id = p_profile and season_key = p_key and tier = t) then continue; end if;
    v_coins := public._season_tier_coins(t);
    v_item := null;
    v_comp := false;
    if t % 5 = 0 then
      select i.id into v_item from public.items i where i.season = v_id and i.pass_tier = t;
      if v_item is not null then
        if not public._grant_item(p_profile, v_item) then
          -- Deja possede : 100 pieces a la place (150 au palier 20 : 100 du palier + 50 pour le titre).
          v_item := null;
          v_comp := true;
          v_coins := v_coins + case when t = 20 then 50 else 100 end;
        end if;
      end if;
    end if;
    insert into public.season_pass_claims(profile_id, season_key, tier, coins, item_id)
    values (p_profile, p_key, t, v_coins, v_item);
    if v_coins > 0 then
      insert into public.coin_ledger(profile_id, delta, reason, ref)
      values (p_profile, v_coins, 'season_pass', p_key || ':' || t) on conflict do nothing;
    end if;
    v_new := v_new || jsonb_build_object('season_key', p_key, 'tier', t, 'coins', v_coins, 'item_id', v_item, 'compensated', v_comp);
  end loop;
  return v_new;
end $$;

-- Synchronise le passe : saison precedente (rattrapage) puis saison en cours. Idempotent.
create or replace function public.season_sync()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_now timestamptz := public._season_now();
  c record;
  p record;
  v_claims jsonb := '[]'::jsonb;
  v_ended jsonb := null;
  v_pts integer;
begin
  perform 1 from public.profiles where id = v_me for update;  -- serialise les synchronisations d'un joueur
  if exists (select 1 from public.profiles where id = v_me and is_guest) then
    return jsonb_build_object('season', null, 'new_claims', '[]'::jsonb, 'ended', null);
  end if;
  select * into c from public._season_at(v_now);
  if c.season_id is null then
    return jsonb_build_object('season', null, 'new_claims', '[]'::jsonb, 'ended', null);
  end if;
  select * into p from public._season_at((c.starts_on - 1)::timestamp at time zone 'Europe/Paris');
  if p.season_id is not null then
    v_claims := public._season_claim(v_me, p.season_key);
    v_pts := public._season_points(v_me, p.season_key);
    if v_pts > 0 then
      v_ended := jsonb_build_object('season', p.season_id, 'season_key', p.season_key,
        'tier', public._season_tier(v_pts),
        'coins_total', (select coalesce(sum(coins), 0) from public.season_pass_claims where profile_id = v_me and season_key = p.season_key),
        'collection_owned', (select count(*) from public.items i
                              where i.season = p.season_id and i.price is not null and i.pass_tier is null
                                and exists (select 1 from public.profile_items pi where pi.profile_id = v_me and pi.item_id = i.id)));
    end if;
  end if;
  v_claims := v_claims || public._season_claim(v_me, c.season_key);
  v_pts := public._season_points(v_me, c.season_key);
  return jsonb_build_object(
    'season', c.season_id,
    'season_key', c.season_key,
    'starts_at', (c.starts_on::timestamp at time zone 'Europe/Paris'),
    'ends_at', ((c.ends_on + 1)::timestamp at time zone 'Europe/Paris'),
    'points', v_pts,
    'tier', public._season_tier(v_pts),
    'new_claims', v_claims,
    'ended', v_ended);
end $$;

revoke all on function public._season_now() from public, anon, authenticated;
revoke all on function public._season_bounds(text) from public, anon, authenticated;
revoke all on function public._season_at(timestamptz) from public, anon, authenticated;
revoke all on function public._season_points(uuid, text) from public, anon, authenticated;
revoke all on function public._season_tier(integer) from public, anon, authenticated;
revoke all on function public._season_tier_coins(integer) from public, anon, authenticated;
revoke all on function public._season_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.season_sync() from public, anon;
grant execute on function public.season_sync() to authenticated;


-- ===== features\soiree-hote.sql =====
-- =============================================================================
-- OUTILS DE L'HÔTE — idempotent, exécuté APRÈS schema.sql (features/*).
--  1. Exclusion d'un joueur (kick_soiree_player) + ré-invitation (invite_to_soiree).
--     Table soiree_bans (schema.sql) : un exclu ne peut pas revenir par le code
--     (join_soiree_by_code -> soiree_banned) tant que l'hôte ne l'a pas ré-invité.
--  2. Roue des jeux (spin_game_wheel) : le tirage est fait CÔTÉ SERVEUR et écrit
--     dans soiree_wheel_spins ; tous les téléphones le reçoivent en Realtime
--     (INSERT) et font tourner la roue sur le même jeu.
-- =============================================================================

-- Exclure un joueur. Erreurs : not_host, soiree_ended, cannot_kick_self,
-- match_in_progress (partie lobby/playing), soiree_not_found, player_not_in_soiree.
create or replace function public.kick_soiree_player(p_soiree_id uuid, p_profile_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_s  public.soirees%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if p_profile_id = v_me then raise exception 'cannot_kick_self'; end if;
  if exists (select 1 from public.matches m
              where m.soiree_id = p_soiree_id and m.status in ('lobby', 'playing')) then
    raise exception 'match_in_progress';
  end if;
  if not exists (select 1 from public.soiree_players
                  where soiree_id = p_soiree_id and profile_id = p_profile_id) then
    raise exception 'player_not_in_soiree';
  end if;
  insert into public.soiree_bans(soiree_id, profile_id) values (p_soiree_id, p_profile_id)
    on conflict do nothing;
  delete from public.soiree_players where soiree_id = p_soiree_id and profile_id = p_profile_id;
end $$;

-- Ré-inviter un joueur (lève l'exclusion et l'ajoute au salon).
-- Erreurs : not_host, soiree_ended, unknown_profile, player_busy (déjà dans 5 soirées).
create or replace function public.invite_to_soiree(p_soiree_id uuid, p_profile_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_s  public.soirees%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('soiree_membership'));
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if not exists (select 1 from public.profiles where id = p_profile_id) then
    raise exception 'unknown_profile';
  end if;
  -- Invité (guest.sql) : seulement dans SA soirée (ré-invitation après exclusion).
  if exists (select 1 from public.profiles where id = p_profile_id and is_guest)
     and (not exists (select 1 from public.soiree_bans where soiree_id = p_soiree_id and profile_id = p_profile_id)
          or public._open_soirees_count(p_profile_id) > 0) then
    raise exception 'guest_forbidden';
  end if;
  delete from public.soiree_bans where soiree_id = p_soiree_id and profile_id = p_profile_id;
  if exists (select 1 from public.soiree_players where soiree_id = p_soiree_id and profile_id = p_profile_id) then
    return;
  end if;
  if public._open_soirees_count(p_profile_id) >= public._soiree_max_open() then
    raise exception 'player_busy' using detail = (select nickname from public.profiles where id = p_profile_id);
  end if;
  insert into public.soiree_players(soiree_id, profile_id) values (p_soiree_id, p_profile_id);
end $$;

revoke all on function public.kick_soiree_player(uuid, uuid) from public, anon;
revoke all on function public.invite_to_soiree(uuid, uuid) from public, anon;
grant execute on function public.kick_soiree_player(uuid, uuid) to authenticated;
grant execute on function public.invite_to_soiree(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ Roue des jeux
create table if not exists public.soiree_wheel_spins (
  id         bigint generated always as identity primary key,
  soiree_id  uuid not null references public.soirees(id) on delete cascade,
  host_id    uuid not null references public.profiles(id) on delete cascade,
  game_ids   text[] not null,      -- les parts de la roue, dans l'ordre d'affichage
  result     text not null,        -- le jeu tiré (∈ game_ids)
  created_at timestamptz not null default now()
);
create index if not exists soiree_wheel_spins_soiree_idx on public.soiree_wheel_spins(soiree_id, id);

alter table public.soiree_wheel_spins enable row level security;
drop policy if exists soiree_wheel_spins_select on public.soiree_wheel_spins;
create policy soiree_wheel_spins_select on public.soiree_wheel_spins for select to authenticated
  using (public.is_soiree_member(soiree_id));
revoke all on table public.soiree_wheel_spins from anon, authenticated;
grant select on table public.soiree_wheel_spins to authenticated;

-- Tire au sort un jeu parmi p_game_ids (2 à 40 ids ; le front filtre selon le nombre de
-- joueurs). Hôte seulement, pas pendant une partie. Renvoie {id, game_ids, result}.
-- Erreurs : not_host, soiree_ended, match_in_progress, invalid_wheel, soiree_not_found.
create or replace function public.spin_game_wheel(p_soiree_id uuid, p_game_ids text[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_s   public.soirees%rowtype;
  v_ids text[];
  v_res text;
  v_id  bigint;
begin
  select * into v_s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if exists (select 1 from public.matches m
              where m.soiree_id = p_soiree_id and m.status in ('lobby', 'playing')) then
    raise exception 'match_in_progress';
  end if;
  v_ids := array(select distinct x from unnest(coalesce(p_game_ids, '{}')) x where x ~ '^[a-z0-9_-]{1,40}$');
  if coalesce(array_length(v_ids, 1), 0) < 2 or array_length(v_ids, 1) > 40 then
    raise exception 'invalid_wheel';
  end if;
  v_res := v_ids[1 + floor(random() * array_length(v_ids, 1))::int];
  insert into public.soiree_wheel_spins(soiree_id, host_id, game_ids, result)
    values (p_soiree_id, v_me, v_ids, v_res) returning id into v_id;
  delete from public.soiree_wheel_spins where soiree_id = p_soiree_id and id < v_id - 4;
  return jsonb_build_object('id', v_id, 'game_ids', to_jsonb(v_ids), 'result', v_res);
end $$;
revoke all on function public.spin_game_wheel(uuid, text[]) from public, anon;
grant execute on function public.spin_game_wheel(uuid, text[]) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'soiree_wheel_spins') then
    alter publication supabase_realtime add table public.soiree_wheel_spins;
  end if;
end $$;


-- ===== features\spectateur.sql =====
-- =============================================================================
-- MODE SPECTATEUR — idempotent, exécuté APRÈS schema.sql (features/*).
-- Un spectateur regarde l'état PUBLIC d'une partie en cours, sans jouer.
--
-- Qui peut lire une partie (matches) :
--   * un membre de la soirée (comme avant) ;
--   * un AMI ACCEPTÉ (friendships.status = 'accepted', dans les deux sens) d'un joueur de la partie
--     (state->'players') ou de l'hôte de la soirée, pour une partie EN COURS ou terminée depuis moins de
--     30 min (écran de résultats) — jamais l'historique ancien — et s'il n'a pas été EXCLU de la soirée
--     (soiree_bans). Pas d'interrupteur de confidentialité : tout ami accepté peut regarder (décision de conception).
-- Rien d'autre n'est ouvert : soirees, soiree_players, soiree_messages, match_secrets (réservés au
-- joueur concerné) et match_server_state (aucun accès client) restent comme avant.
--
-- RPC (security definer, grant authenticated) :
--   can_watch_match(p_match_id) -> boolean
--   friends_playing() -> [{profile_id, match_id, soiree_id, game_id}]
--       un élément par ami accepté qui figure dans state->'players' d'une partie 'playing'
--       (la plus récente s'il est dans plusieurs).
-- Le serveur refuse déjà toute action d'un non-joueur non-hôte (game_action : not_in_match).
-- =============================================================================

create or replace function public.can_watch_match(p_match_id uuid)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.matches m
     where m.id = p_match_id
       and (
         public.is_soiree_member(m.soiree_id)
         or (
           (m.status = 'playing' or m.finished_at > now() - interval '30 minutes')
           and not exists (select 1 from public.soiree_bans b
                            where b.soiree_id = m.soiree_id and b.profile_id = public.current_profile_id())
           and exists (
           select 1 from public.friendships f
            where f.status = 'accepted'
              and (f.requester_id = public.current_profile_id() or f.addressee_id = public.current_profile_id())
              and (case when f.requester_id = public.current_profile_id() then f.addressee_id else f.requester_id end)::text
                  in (select jsonb_array_elements_text(case when jsonb_typeof(m.state->'players') = 'array'
                                                            then m.state->'players' else '[]'::jsonb end)
                      union select s.host_id::text from public.soirees s where s.id = m.soiree_id))))
  )
$$;

-- La lecture de matches s'élargit aux amis (lecture seule, jamais de secrets).
drop policy if exists matches_select on public.matches;
create policy matches_select on public.matches for select to authenticated
  using (public.is_soiree_member(soiree_id) or public.can_watch_match(id));

-- Mes amis acceptés qui sont dans une partie en cours (une ligne par ami, la plus récente).
create or replace function public.friends_playing()
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', x.friend, 'match_id', x.mid, 'soiree_id', x.sid, 'game_id', x.gid)
                     order by x.created_at desc)
      from (
        select distinct on (fr.friend) fr.friend, m.id as mid, m.soiree_id as sid, m.game_id as gid, m.created_at
          from (select case when f.requester_id = v_me then f.addressee_id else f.requester_id end as friend
                  from public.friendships f
                 where f.status = 'accepted' and (f.requester_id = v_me or f.addressee_id = v_me)) fr
          join public.matches m
            on m.status = 'playing'
           and jsonb_typeof(m.state->'players') = 'array'
           and (m.state->'players') ? fr.friend::text
         order by fr.friend, m.created_at desc) x), '[]'::jsonb);
end $$;

revoke all on function public.can_watch_match(uuid) from public, anon;
revoke all on function public.friends_playing() from public, anon;
grant execute on function public.can_watch_match(uuid) to authenticated;
grant execute on function public.friends_playing() to authenticated;


-- ===== features\stats-fun.sql =====
-- =============================================================================
-- STATS FUN — idempotent, après stats.sql. Une seule RPC : fun_stats(p_profile uuid) -> jsonb.
-- Tout est dérivé de matches / match_players / soirees (parties terminées). Heures en Europe/Paris.
-- Seuils : 10 parties au total (sinon enough = false), 5 parties par tranche / jeu / jour / pote.
-- Les PHRASES sont composées côté front (src/features/stats/funStats.ts) à partir de ces chiffres.
-- =============================================================================

-- Mes parties terminées (une ligne par partie) : base commune des calculs.
create or replace function public._fun_rows(p_profile uuid)
returns table (match_id uuid, game_id text, won boolean, n integer, fin timestamptz, soiree_id uuid)
language sql stable security definer
set search_path = public, extensions
as $$
  select x.match_id, x.game_id, x.won, (select count(*)::int from public.match_players y where y.match_id = x.match_id),
         m.finished_at, m.soiree_id
    from public.match_players x join public.matches m on m.id = x.match_id
   where x.profile_id = p_profile and m.status = 'finished' and m.finished_at is not null
$$;
revoke all on function public._fun_rows(uuid) from public, anon, authenticated;

create or replace function public.fun_stats(p_profile uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_total  integer;
  v_wins   integer;
  v_slots  jsonb;
  v_days   jsonb;
  v_games  jsonb;
  v_streak jsonb;
  v_mates  jsonb;
  v_duel   jsonb;
  v_soiree jsonb;
begin
  perform public._require_profile();
  if not exists (select 1 from public.profiles where id = p_profile) then raise exception 'profile_not_found'; end if;

  select count(*), count(*) filter (where won) into v_total, v_wins from public._fun_rows(p_profile);
  if v_total < 10 then
    return jsonb_build_object('enough', false, 'games', v_total, 'needed', 10);
  end if;

  -- tranches horaires : matin 6-12, aprem 12-18, soir 18-23, nuit 23-6
  select coalesce(jsonb_agg(jsonb_build_object('slot', s, 'played', c, 'wins', w) order by s), '[]'::jsonb) into v_slots
    from (select case when h >= 6 and h < 12 then 'matin' when h >= 12 and h < 18 then 'aprem'
                      when h >= 18 and h < 23 then 'soir' else 'nuit' end as s,
                 count(*) as c, count(*) filter (where won) as w
            from (select won, extract(hour from fin at time zone 'Europe/Paris')::int as h from public._fun_rows(p_profile)) t
           group by 1) z;

  select coalesce(jsonb_agg(jsonb_build_object('dow', d, 'played', c, 'wins', w) order by d), '[]'::jsonb) into v_days
    from (select extract(isodow from fin at time zone 'Europe/Paris')::int as d, count(*) as c, count(*) filter (where won) as w
            from public._fun_rows(p_profile) group by 1) z;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', game_id, 'played', c, 'wins', w) order by c desc), '[]'::jsonb) into v_games
    from (select game_id, count(*) as c, count(*) filter (where won) as w from public._fun_rows(p_profile) group by 1) z;

  -- séries (îlots de victoires / défaites consécutives)
  with o as (
    select won, row_number() over (order by fin, match_id) as rn,
           row_number() over (partition by won order by fin, match_id) as rw from public._fun_rows(p_profile)
  ), runs as (select won, count(*) as len from o group by won, rn - rw)
  select jsonb_build_object('win', coalesce(max(len) filter (where won), 0), 'loss', coalesce(max(len) filter (where not won), 0))
    into v_streak from runs;

  -- potes : parties jouées ensemble (même partie) et mes victoires en leur compagnie
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', pr.id, 'slug', pr.slug, 'nickname', pr.nickname,
           'equipped_tenue', pr.equipped_tenue, 'together', t.c, 'wins', t.w) order by t.c desc, pr.sort_order), '[]'::jsonb) into v_mates
    from (select y.profile_id, count(*) as c, count(*) filter (where me.won) as w
            from public._fun_rows(p_profile) me join public.match_players y on y.match_id = me.match_id and y.profile_id <> p_profile
           group by 1) t join public.profiles pr on pr.id = t.profile_id and not pr.is_guest;

  -- duels (parties à 2) : qui me bat le plus / qui je bats le plus
  select coalesce(jsonb_agg(jsonb_build_object('profile_id', pr.id, 'slug', pr.slug, 'nickname', pr.nickname,
           'equipped_tenue', pr.equipped_tenue, 'my_wins', t.w, 'their_wins', t.l) order by pr.sort_order), '[]'::jsonb) into v_duel
    from (select y.profile_id, count(*) filter (where me.won and not y.won) as w, count(*) filter (where y.won and not me.won) as l
            from public._fun_rows(p_profile) me join public.match_players y on y.match_id = me.match_id and y.profile_id <> p_profile
           where me.n = 2 group by 1) t join public.profiles pr on pr.id = t.profile_id and not pr.is_guest;

  -- soirée la plus longue (durée réelle de la soirée) et soirée la plus chargée en parties
  select jsonb_build_object('soiree_id', s.id, 'minutes', greatest(0, round(extract(epoch from (s.ended_at - coalesce(s.started_at, s.created_at))) / 60))::int,
           'games', g.c, 'day', coalesce(s.started_at, s.created_at))
    into v_soiree
    from (select soiree_id, count(*) as c from public._fun_rows(p_profile) group by 1) g
    join public.soirees s on s.id = g.soiree_id
   where s.ended_at is not null
   order by (s.ended_at - coalesce(s.started_at, s.created_at)) desc limit 1;

  return jsonb_build_object('enough', true, 'games', v_total, 'wins', v_wins,
    'slots', v_slots, 'days', v_days, 'per_game', v_games, 'streak', v_streak,
    'mates', v_mates, 'duels', v_duel, 'longest_soiree', v_soiree,
    'soirees', (select count(distinct soiree_id) from public._fun_rows(p_profile)));
end $$;

revoke all on function public.fun_stats(uuid) from public, anon;
grant execute on function public.fun_stats(uuid) to authenticated;


-- ===== features\stats.sql =====
-- =============================================================================
-- STATS (lot B) — idempotent, exécuté APRÈS schema.sql (features/*).
-- Classement de soirée, historique des soirées, profil / statistiques.
-- Tout est DÉRIVÉ de soirees / soiree_players / matches / match_players :
-- aucune table nouvelle, juste des RPC security definer renvoyant du jsonb.
--
-- BARÈME DE SOIRÉE (par partie terminée, par joueur) — _soiree_points :
--   gagnant (won)                              = 3 pts (équipes : toute l'équipe gagnante)
--   perdant d'un duel (partie à 2 joueurs)     = 1 pt  (participation)
--   2e place (placement 2)                     = 2 pts
--   3e place (placement 3)                     = 1 pt
--   non gagnant avec placement 1 (égalité)     = 1 pt
--   autres                                     = 0 pt
-- Classement : points décroissants, puis victoires, puis moins de parties jouées ;
-- ex-aequo = même rang (rang « compétition » : 1, 1, 3).
-- Seules les parties terminées comptent (match_players n'existe qu'à la fin).
-- =============================================================================

create index if not exists matches_soiree_finished_idx on public.matches(soiree_id) where status = 'finished';

create or replace function public._soiree_points(p_won boolean, p_placement integer, p_n integer)
returns integer language sql immutable
as $$
  select case
    when p_won then 3
    when p_n = 2 then 1
    when p_placement = 2 then 2
    when p_placement = 3 then 1
    when p_placement = 1 then 1
    else 0
  end
$$;

-- Classement brut : jsonb [{profile_id, slug, nickname, equipped_tenue, points, wins, games, rank}].
-- Inclut les membres actuels (même à 0 partie) et ceux qui ont joué puis sont partis.
create or replace function public._soiree_standings(p_soiree_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  with mp as (
    select x.profile_id, x.won,
           public._soiree_points(x.won, x.placement, count(*) over (partition by x.match_id)::int) as pts
      from public.match_players x
      join public.matches mt on mt.id = x.match_id
     where mt.soiree_id = p_soiree_id and mt.status = 'finished'
  ), members as (
    select sp.profile_id from public.soiree_players sp where sp.soiree_id = p_soiree_id
    union
    select profile_id from mp
  ), agg as (
    select mb.profile_id,
           coalesce(sum(mp.pts), 0)::int as points,
           count(*) filter (where mp.won)::int as wins,
           count(mp.profile_id)::int as games
      from members mb left join mp on mp.profile_id = mb.profile_id
     group by mb.profile_id
  ), ranked as (
    select a.*, rank() over (order by a.points desc, a.wins desc, a.games asc) as rk
      from agg a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'profile_id', r.profile_id, 'slug', p.slug, 'nickname', p.nickname,
           'equipped_tenue', p.equipped_tenue,
           'points', r.points, 'wins', r.wins, 'games', r.games, 'rank', r.rk)
         order by r.rk, p.sort_order), '[]'::jsonb)
    from ranked r join public.profiles p on p.id = r.profile_id
$$;

-- Classement de la soirée (membres, ou anciens joueurs d'une de ses parties).
-- → {soiree_id, status, games_played, standings:[...], winner_ids:[uuid]}
--   (winner_ids vide tant que personne n'a de point). Erreurs : soiree_not_found, not_in_soiree.
create or replace function public.soiree_standings(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  v_st     jsonb;
  v_status text;
begin
  select status into v_status from public.soirees where id = p_soiree_id;
  if v_status is null then raise exception 'soiree_not_found'; end if;
  if not (public.is_soiree_member(p_soiree_id)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = p_soiree_id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  v_st := public._soiree_standings(p_soiree_id);
  return jsonb_build_object(
    'soiree_id', p_soiree_id, 'status', v_status,
    'games_played', (select count(*) from public.matches where soiree_id = p_soiree_id and status = 'finished'),
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

-- Mes soirées terminées, la plus récente d'abord (50 au plus).
-- → [{id, host:{id,slug,nickname,equipped_tenue}, started_at, ended_at, duration_min, games_played,
--     players:[{profile_id,slug,nickname,equipped_tenue}], winner:{profile_id,slug,nickname,equipped_tenue,points}|null}]
create or replace function public.my_soirees_history()
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'host', (select jsonb_build_object('id', h.id, 'slug', h.slug, 'nickname', h.nickname, 'equipped_tenue', h.equipped_tenue)
                 from public.profiles h where h.id = s.host_id),
      'started_at', coalesce(s.started_at, s.created_at),
      'ended_at', s.ended_at,
      'duration_min', greatest(0, round(extract(epoch from (s.ended_at - coalesce(s.started_at, s.created_at))) / 60))::int,
      'games_played', (select count(*) from public.matches m where m.soiree_id = s.id and m.status = 'finished'),
      'players', (select coalesce(jsonb_agg(e - 'points' - 'wins' - 'games' - 'rank'), '[]'::jsonb)
                    from jsonb_array_elements(st.j) e),
      'winner', (select e - 'wins' - 'games' - 'rank' from jsonb_array_elements(st.j) e
                  where (e->>'rank')::int = 1 and (e->>'points')::int > 0 limit 1)
    ) order by s.sort_end desc), '[]'::jsonb)
    into v_out
    from (
      select so.*, coalesce(so.ended_at, so.created_at) as sort_end
        from public.soirees so
       where so.status = 'ended'
         and (so.host_id = v_me
              or exists (select 1 from public.soiree_players sp where sp.soiree_id = so.id and sp.profile_id = v_me)
              or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                          where m.soiree_id = so.id and x.profile_id = v_me))
       order by coalesce(so.ended_at, so.created_at) desc
       limit 50
    ) s
    cross join lateral (select public._soiree_standings(s.id) as j) st;
  return v_out;
end $$;

-- Détail d'une soirée où j'étais.
-- → {soiree_id, status, host, started_at, ended_at, duration_min,
--    matches:[{id, game_id, finished_at, players:int, winners:[{profile_id,slug,nickname,equipped_tenue}]}] (ordre chronologique),
--    standings:[...], winner_ids:[...]}. Erreurs : soiree_not_found, not_in_soiree.
create or replace function public.soiree_history_detail(p_soiree_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  s    public.soirees%rowtype;
  v_st jsonb;
begin
  select * into s from public.soirees where id = p_soiree_id;
  if not found then raise exception 'soiree_not_found'; end if;
  if not (s.host_id = v_me
          or exists (select 1 from public.soiree_players sp where sp.soiree_id = s.id and sp.profile_id = v_me)
          or exists (select 1 from public.match_players x join public.matches m on m.id = x.match_id
                      where m.soiree_id = s.id and x.profile_id = v_me)) then
    raise exception 'not_in_soiree';
  end if;
  v_st := public._soiree_standings(s.id);
  return jsonb_build_object(
    'soiree_id', s.id, 'status', s.status,
    'host', (select jsonb_build_object('id', h.id, 'slug', h.slug, 'nickname', h.nickname, 'equipped_tenue', h.equipped_tenue)
               from public.profiles h where h.id = s.host_id),
    'started_at', coalesce(s.started_at, s.created_at), 'ended_at', s.ended_at,
    'duration_min', greatest(0, round(extract(epoch from (coalesce(s.ended_at, now()) - coalesce(s.started_at, s.created_at))) / 60))::int,
    'matches', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'game_id', m.game_id, 'finished_at', m.finished_at,
               'players', (select count(*) from public.match_players x where x.match_id = m.id),
               'winners', (select coalesce(jsonb_agg(jsonb_build_object(
                                    'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
                                  order by p.sort_order), '[]'::jsonb)
                             from public.match_players x join public.profiles p on p.id = x.profile_id
                            where x.match_id = m.id and x.won)
             ) order by m.finished_at), '[]'::jsonb)
        from public.matches m where m.soiree_id = s.id and m.status = 'finished'),
    'standings', v_st,
    'winner_ids', coalesce((select jsonb_agg(e->'profile_id') from jsonb_array_elements(v_st) e
                             where (e->>'rank')::int = 1 and (e->>'points')::int > 0), '[]'::jsonb));
end $$;

-- Profil / statistiques d'un joueur (lisible par tout joueur connecté, comme les classements).
-- → {profile:{id,slug,nickname,equipped_tenue,xp,level}, games_played, wins, win_rate (0..100), soirees,
--    favorite_game:{game_id,played}|null, best_game:{game_id,played,wins,win_rate}|null,
--    rival:{profile_id,slug,nickname,equipped_tenue,losses}|null, per_game:[{game_id,played,wins}]}
-- Jeu préféré = le plus joué. Meilleur jeu = meilleur taux de victoire parmi les jeux joués >= 3 fois,
-- sinon celui qui a le plus de victoires (>= 1 victoire exigée). Rival = adversaire qui a gagné le plus
-- de parties où je n'ai pas gagné (minimum 2). Erreur : profile_not_found.
create or replace function public.profile_stats(p_profile_id uuid)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me     uuid := public._require_profile();
  p        public.profiles%rowtype;
  v_pg     jsonb;
  v_played int;
  v_wins   int;
begin
  select * into p from public.profiles where id = p_profile_id;
  if not found then raise exception 'profile_not_found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('game_id', g.game_id, 'played', g.played, 'wins', g.wins)
                            order by g.played desc, g.wins desc, g.game_id), '[]'::jsonb),
         coalesce(sum(g.played), 0)::int, coalesce(sum(g.wins), 0)::int
    into v_pg, v_played, v_wins
    from (select x.game_id, count(*)::int as played, count(*) filter (where x.won)::int as wins
            from public.match_players x join public.matches m on m.id = x.match_id and m.status = 'finished'
           where x.profile_id = p_profile_id
           group by x.game_id) g;

  return jsonb_build_object(
    'profile', jsonb_build_object('id', p.id, 'slug', p.slug, 'nickname', p.nickname,
                                   'equipped_tenue', p.equipped_tenue, 'xp', p.xp, 'level', public.level_for_xp(p.xp)),
    'games_played', v_played,
    'wins', v_wins,
    'win_rate', case when v_played > 0 then round(v_wins * 100.0 / v_played)::int else 0 end,
    'soirees', (select count(*) from (
                  select soiree_id from public.soiree_players where profile_id = p_profile_id
                  union
                  select m.soiree_id from public.match_players x join public.matches m on m.id = x.match_id
                   where x.profile_id = p_profile_id) u),
    'favorite_game', (select jsonb_build_object('game_id', e->>'game_id', 'played', (e->>'played')::int)
                        from jsonb_array_elements(v_pg) e limit 1),
    'best_game', (
      select jsonb_build_object('game_id', e->>'game_id', 'played', (e->>'played')::int, 'wins', (e->>'wins')::int,
                                'win_rate', round((e->>'wins')::numeric * 100 / (e->>'played')::numeric)::int)
        from jsonb_array_elements(v_pg) e
       where (e->>'wins')::int > 0
       order by ((e->>'played')::int >= 3) desc,
                case when (e->>'played')::int >= 3 then (e->>'wins')::numeric / (e->>'played')::numeric else 0 end desc,
                (e->>'wins')::int desc, (e->>'played')::int desc
       limit 1),
    'rival', (
      select jsonb_build_object('profile_id', r.pid, 'slug', pr.slug, 'nickname', pr.nickname,
                                'equipped_tenue', pr.equipped_tenue, 'losses', r.n)
        from (select w.profile_id as pid, count(*)::int as n
                from public.match_players me
                join public.matches m on m.id = me.match_id and m.status = 'finished'
                join public.match_players w on w.match_id = me.match_id and w.won and w.profile_id <> me.profile_id
                join public.profiles gw on gw.id = w.profile_id and not gw.is_guest  -- invites exclus
               where me.profile_id = p_profile_id and not me.won
               group by w.profile_id
              having count(*) >= 2
               order by count(*) desc, w.profile_id limit 1) r
        join public.profiles pr on pr.id = r.pid and not pr.is_guest),
    'per_game', v_pg);
end $$;

revoke all on function public._soiree_points(boolean, integer, integer) from public, anon, authenticated;
revoke all on function public._soiree_standings(uuid) from public, anon, authenticated;
revoke all on function public.soiree_standings(uuid) from public, anon;
revoke all on function public.my_soirees_history() from public, anon;
revoke all on function public.soiree_history_detail(uuid) from public, anon;
revoke all on function public.profile_stats(uuid) from public, anon;
grant execute on function public.soiree_standings(uuid) to authenticated;
grant execute on function public.my_soirees_history() to authenticated;
grant execute on function public.soiree_history_detail(uuid) to authenticated;
grant execute on function public.profile_stats(uuid) to authenticated;


-- ===== features\tenues.sql =====
-- =============================================================================
-- Tenues (skins vestimentaires) — idempotent, exécuté APRÈS schema.sql.
-- Une tenue = une variante du chibi (public/chibis/<slug>/<tenue>/<expr>.webp),
-- débloquée par une condition du catalogue (aujourd'hui : N victoires dans un jeu).
-- =============================================================================

-- ---- Tables -----------------------------------------------------------------

create table if not exists public.tenues (
  id             text primary key,
  label          text not null,
  emoji          text not null,
  game_id        text,                                  -- null = tous jeux confondus
  condition_type text not null default 'game_wins',     -- 'default' | 'game_wins' | 'duel_wins' | 'trophy'
  threshold      integer not null default 10,
  sort_order     integer not null default 100,
  has_art        boolean not null default false         -- informatif ; le front lit tenues-art.generated.ts
);
-- Tenue SECRÈTE (condition_type = 'trophy') : offerte par le trophée `trophy_id` (trigger de trophees.sql),
-- jamais gagnée aux victoires, tous ses stickers sont offerts. Pas de FK : `trophies` est créée après.
alter table public.tenues add column if not exists trophy_id text;

create table if not exists public.tenue_unlocks (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  tenue_id    text not null references public.tenues(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, tenue_id)
);
create index if not exists tenue_unlocks_profile_idx on public.tenue_unlocks(profile_id);

alter table public.profiles add column if not exists equipped_tenue text not null default 'default';

-- ---- Catalogue (has_art jamais écrasé) ----------------------------------------

insert into public.tenues (id, label, emoji, game_id, condition_type, threshold, sort_order) values
  ('default',  'Tenue de soirée', '🎉', null,             'default',   0,  0),
  ('star',     'Star',            '🌟', 'qui-de-nous',    'game_wins', 10, 10),
  ('espion',   'Espion',          '🕵️', 'undercover',     'game_wins', 10, 20),
  ('croupier', 'Croupier',        '🃏', 'pas-de-bol',     'game_wins', 10, 30),
  ('prof',     'Prof',            '🎓', 'cerveau-en-fete','game_wins', 10, 40),
  ('ecolier',  'Écolier',         '🎒', 'petit-bac',      'game_wins', 10, 50),
  ('artiste',  'Artiste',         '🎨', 'dessine-devine', 'game_wins', 10, 60),
  ('loup',       'Loup',          '🐺', 'loup-garou',     'game_wins', 10, 70),
  ('artificier', 'Artificier',    '💣', 'bombe-a-mots',   'game_wins', 10, 80),
  ('pirate',     'Pirate',        '🏴‍☠️', 'menteur',        'game_wins', 10, 90),
  ('bowler',     'Bowler',        '🎳', 'bowling',        'game_wins', 10, 100),
  ('philosophe', 'Philosophe',    '🤔', 'tu-preferes',    'game_wins', 10, 110),
  ('vedette',    'Star de cinéma','🎬', 'qui-suis-je',    'game_wins', 10, 120),
  ('archer',     'Archer',        '🏹', 'le-plus-proche', 'game_wins', 10, 130),
  ('comedien',   'Comédien',      '🎭', 'action-ou-verite','game_wins', 10, 140),
  ('coach',      'Coach',         '📣', 'devine-en-equipe','game_wins', 10, 150),
  ('stratege',   'Stratège',      '🧠', 'quatre-a-la-suite','duel_wins', 10, 160),
  ('ninja',      'Ninja',         '🥷', 'morpion',        'duel_wins', 10, 170),
  ('amiral',     'Amiral',        '⚓', 'bataille-navale','duel_wins', 10, 180),
  ('magnat',     'Magnat',        '🎩', 'tour-des-potes', 'game_wins', 10, 190),
  ('pilote',     'Pilote',        '🏎️', 'dede-kart',      'game_wins', 10, 200),
  ('hacker',     'Hacker',        '💻', 'nom-de-code',    'game_wins', 10, 210),
  ('grandmaitre', 'Grand Maître', '♟️', 'echecs',         'duel_wins', 10, 220),
  ('cowboy',     'Cow-boy',       '🤠', 'kems',           'game_wins', 10, 230),
  ('golfer',     'Golfeur',       '⛳', 'mini-golf',      'game_wins', 10, 240),
  ('host',       'Animateur Télé', '🎤', 'dede-party',    'game_wins', 5,  250)
on conflict (id) do update
  set label          = excluded.label,
      emoji          = excluded.emoji,
      game_id        = excluded.game_id,
      condition_type = excluded.condition_type,
      threshold      = excluded.threshold,
      sort_order     = excluded.sort_order;

-- Tenue secrète « Madame Irma » : planche de 12 stickers « voyante », débloquée par le trophée gen_madame_irma
-- (3 bons pronostics d'affilée). evaluate_tenues l'ignore (condition 'trophy' = jamais remplie aux victoires).
insert into public.tenues (id, label, emoji, game_id, condition_type, threshold, sort_order, trophy_id) values
  ('irma', 'Madame Irma', '🔮', null, 'trophy', 0, 900, 'gen_madame_irma'),
  -- Tenue de Noël secrète « Lutin » : trophée gen_esprit_noel (12 cases du calendrier de l'Avent ouvertes).
  ('lutin', 'Lutin', '🧝', null, 'trophy', 0, 901, 'gen_esprit_noel')
on conflict (id) do update
  set label          = excluded.label,
      emoji          = excluded.emoji,
      game_id        = excluded.game_id,
      condition_type = excluded.condition_type,
      threshold      = excluded.threshold,
      sort_order     = excluded.sort_order,
      trophy_id      = excluded.trophy_id;

-- Tenue équipée invalide -> retour à 'default'
update public.profiles set equipped_tenue = 'default'
 where equipped_tenue not in (select id from public.tenues);

-- ---- Profil : ajoute equipped_tenue -------------------------------------------

create or replace function public._profile_json(p_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'id', p.id, 'slug', p.slug, 'first_name', p.first_name, 'nickname', p.nickname,
    'is_admin', p.is_admin, 'equipped_expression', p.equipped_expression,
    'equipped_tenue', p.equipped_tenue,
    'expressions', to_jsonb(p.expressions), 'xp', p.xp, 'level', public.level_for_xp(p.xp),
    'sort_order', p.sort_order, 'created_at', p.created_at)
  from public.profiles p where p.id = p_id
$$;

-- Changement des colonnes de retour : drop obligatoire.
drop function if exists public.list_profiles_public();
create function public.list_profiles_public()
returns table (id uuid, slug text, first_name text, nickname text,
               equipped_expression text, equipped_tenue text, expressions text[], has_pin boolean)
language sql stable security definer
set search_path = public, extensions
as $$
  select p.id, p.slug, p.first_name, p.nickname, p.equipped_expression, p.equipped_tenue, p.expressions,
         exists (select 1 from public.profile_credentials c where c.profile_id = p.id)
  from public.profiles p
  where not p.is_guest  -- écran de connexion : la bande seulement
  order by p.sort_order, p.slug
$$;
revoke all on function public.list_profiles_public() from public;
grant execute on function public.list_profiles_public() to anon, authenticated;

-- ---- Vues de classement : ajoutent equipped_tenue -----------------------------

drop view if exists public.leaderboard_general;
create view public.leaderboard_general with (security_invoker = true) as
select p.id as profile_id, p.slug, p.first_name, p.nickname, p.equipped_expression, p.equipped_tenue,
       p.xp, public.level_for_xp(p.xp) as level,
       coalesce(s.wins, 0) as wins,
       coalesce(s.games_played, 0) as games_played,
       rank() over (order by coalesce(s.wins, 0) desc) as rank
from public.profiles p
left join public.player_stats s on s.profile_id = p.id
where not p.is_guest;  -- invités hors classements (features/guest.sql)

drop view if exists public.leaderboard_by_game;
create view public.leaderboard_by_game with (security_invoker = true) as
select mp.game_id, p.id as profile_id, p.slug, p.first_name, p.nickname, p.equipped_expression, p.equipped_tenue,
       count(*)::integer as games_played,
       (count(*) filter (where mp.won))::integer as wins,
       coalesce(sum(mp.points), 0)::integer as points_total,
       rank() over (partition by mp.game_id
                    order by count(*) filter (where mp.won) desc, coalesce(sum(mp.points), 0) desc) as rank
from public.match_players mp
join public.profiles p on p.id = mp.profile_id and not p.is_guest
group by mp.game_id, p.id;

revoke all on table public.leaderboard_general, public.leaderboard_by_game from anon, authenticated;
grant select on table public.leaderboard_general, public.leaderboard_by_game to authenticated;

-- ---- RLS ----------------------------------------------------------------------

alter table public.tenues enable row level security;
alter table public.tenue_unlocks enable row level security;

drop policy if exists tenues_select on public.tenues;
create policy tenues_select on public.tenues for select to authenticated using (true);

drop policy if exists tenue_unlocks_select on public.tenue_unlocks;
create policy tenue_unlocks_select on public.tenue_unlocks for select to authenticated using (true);

revoke all on table public.tenues, public.tenue_unlocks from anon, authenticated;
grant select on table public.tenues, public.tenue_unlocks to authenticated;

-- ---- Évaluation ---------------------------------------------------------------

-- Débloque les tenues dont la condition est remplie ; renvoie les ids NOUVELLEMENT débloqués.
-- condition_type : 'game_wins' = au moins `threshold` victoires (match_players.won) dans `game_id` ;
-- 'duel_wins' = au moins `threshold` duels remportés (somme de match_players.stats.duel_wins)
-- (tous jeux si game_id est null) ; 'trophy' = tenue secrète offerte par un trophée (trigger de trophees.sql),
-- jamais débloquée ici (else false). Ajouter un type = ajouter un `when` ci-dessous.
create or replace function public.evaluate_tenues(p_profile_id uuid)
returns text[] language plpgsql security definer
set search_path = public, extensions
as $$
declare
  t      record;
  v_ok   boolean;
  v_new  text[] := '{}';
  v_rows integer;
begin
  for t in
    select * from public.tenues x
     where x.condition_type <> 'default'
       and not exists (select 1 from public.tenue_unlocks u
                        where u.profile_id = p_profile_id and u.tenue_id = x.id)
     order by x.sort_order
  loop
    v_ok := case t.condition_type
      when 'game_wins' then
        (select count(*) from public.match_players mp
          where mp.profile_id = p_profile_id and mp.won
            and (t.game_id is null or mp.game_id = t.game_id)) >= t.threshold
      -- Jeux en duel : chaque DUEL remporté compte (stats.duel_wins de chaque session).
      when 'duel_wins' then
        (select coalesce(sum(case when mp.stats->>'duel_wins' ~ '^\d{1,6}$'
                                  then (mp.stats->>'duel_wins')::integer else 0 end), 0)
           from public.match_players mp
          where mp.profile_id = p_profile_id
            and (t.game_id is null or mp.game_id = t.game_id)) >= t.threshold
      else false
    end;
    if v_ok then
      insert into public.tenue_unlocks(profile_id, tenue_id) values (p_profile_id, t.id)
      on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_new := v_new || t.id; end if;
    end if;
  end loop;
  return v_new;
end $$;

-- Hook de fin de partie (cf. schema.sql) : {profile_id: [tenue_ids]} (non vides seulement).
create or replace function public._after_finish_match(p_match_id uuid, p_profile_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_id  uuid;
  v_new text[];
  v_map jsonb := '{}'::jsonb;
begin
  foreach v_id in array coalesce(p_profile_ids, '{}') loop
    v_new := public.evaluate_tenues(v_id);
    if coalesce(array_length(v_new, 1), 0) > 0 then
      v_map := v_map || jsonb_build_object(v_id::text, to_jsonb(v_new));
    end if;
  end loop;
  return v_map;
end $$;

-- ---- Équiper -------------------------------------------------------------------

create or replace function public.equip_tenue(p_tenue text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
begin
  if not exists (select 1 from public.tenues where id = p_tenue) then
    raise exception 'unknown_tenue';
  end if;
  if p_tenue <> 'default' and not exists (
    select 1 from public.tenue_unlocks where profile_id = v_me and tenue_id = p_tenue
  ) then
    raise exception 'tenue_locked';
  end if;
  -- Trophées : le sticker porté ne vaut que pour la planche d'une tenue précise (cf. trophees.sql,
  -- _tenue_slot_ok) ; en changeant de tenue il repasse sur `joie` (le front peut le rééquiper).
  update public.profiles set equipped_tenue = p_tenue,
         equipped_expression = case
           when p_tenue is distinct from equipped_tenue and (p_tenue <> 'default' or equipped_expression ~ '^extra[0-9]+$')
           then 'joie' else equipped_expression end
   where id = v_me;
  return public._profile_json(v_me);
end $$;

-- ---- Grants --------------------------------------------------------------------

revoke all on function public._profile_json(uuid) from public, anon, authenticated;
revoke all on function public.evaluate_tenues(uuid) from public, anon, authenticated;
revoke all on function public._after_finish_match(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.equip_tenue(text) from public, anon;
grant execute on function public.equip_tenue(text) to authenticated;

-- Rattrapage (idempotent) : victoires déjà acquises avant l'installation des tenues,
-- et expressions de la palette des tenues (pouces, timide, déterminé) pour tous les persos.
select public.evaluate_tenues(id) from public.profiles;
select public.evaluate_unlocks(id) from public.profiles;


-- ===== features\trophees.sql =====
-- =============================================================================
-- Trophées — idempotent, exécuté APRÈS tenues.sql (tables tenues / tenue_unlocks).
-- Conception : docs/TROPHEES.md. Résumé :
--   * Une tenue débloquée n'offre que le sticker n°1 (joie) de sa planche ; les stickers 2..12
--     se gagnent chacun avec le trophée (tenue, slot) correspondant (stickers > 12 : offerts).
--   * Catalogue `trophies` (230 lignes : 220 de tenue + 10 généraux), règle d'évaluation
--     GÉNÉRIQUE en jsonb (cf. _tr_progress), évaluée en fin de partie sur match_players.
--   * La progression compte dès la première partie, même sans la tenue (le sticker devient
--     utilisable quand la tenue est débloquée). Pas de rattrapage rétroactif à l'installation.
--   * `active = false` : trophée au catalogue mais pas encore branché (compteur manquant, phase 2).
--
-- Règle (colonne `rule`) : {"agg": "sum|max|count|streak|all|special", ...}
--   sum    : somme de `stat` sur les parties du jeu            >= threshold
--   max    : maximum de `stat` sur une partie                  >= threshold
--   count  : nombre de parties satisfaisant `and`              >= threshold
--   streak : plus longue série de parties consécutives (par date) satisfaisant `and` >= threshold
--   all    : toutes les sous-règles de `rules` sont satisfaites
--   special: règle nommée (`name`), trophées généraux (cf. _tr_progress ; ex. 'stickers' = player_stats.stickers_sent)
--   `and`  : [{"stat","op" (>= <= = > <),"value"}] filtre par partie (stat absente = 0)
--   `stat` : clé de match_players.stats, ou colonne virtuelle points / placement / won (0|1) ;
--            `last` (1 = dernier) et `nplayers` sont posées par finish_match dans stats.
-- =============================================================================

-- ---- Tables -----------------------------------------------------------------

-- Migration douce (une seule fois, tant que la table n'existe pas) : les stickers de tenue
-- passent à « un trophée par sticker » ; un joueur qui portait une tenue avec un sticker
-- autre que `joie` repasse sur `joie` (il le rééquipera quand il aura le trophée).
do $$
begin
  if to_regclass('public.trophies') is null then
    update public.profiles set equipped_expression = 'joie'
     where equipped_tenue <> 'default' and equipped_expression <> 'joie';
  end if;
end $$;

create table if not exists public.trophies (
  id          text primary key,
  tenue_id    text references public.tenues(id) on delete cascade,   -- null = trophée général
  slot        integer check (slot between 2 and 12),                  -- rang du sticker (null = général)
  name        text not null,
  description text not null,
  game_id     text,                                                   -- null = tous jeux
  rule        jsonb,
  active      boolean not null default false,
  sort_order  integer not null default 0,
  check ((tenue_id is null) = (slot is null))
);
create unique index if not exists trophies_tenue_slot_idx on public.trophies(tenue_id, slot) where tenue_id is not null;
create index if not exists trophies_game_idx on public.trophies(game_id) where active;

create table if not exists public.trophy_unlocks (
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  trophy_id   text not null references public.trophies(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (profile_id, trophy_id)
);
create index if not exists trophy_unlocks_profile_idx on public.trophy_unlocks(profile_id);

alter table public.trophies enable row level security;
alter table public.trophy_unlocks enable row level security;
drop policy if exists trophies_select on public.trophies;
create policy trophies_select on public.trophies for select to authenticated using (true);
drop policy if exists trophy_unlocks_select on public.trophy_unlocks;
create policy trophy_unlocks_select on public.trophy_unlocks for select to authenticated using (true);
revoke all on table public.trophies, public.trophy_unlocks from anon, authenticated;
grant select on table public.trophies, public.trophy_unlocks to authenticated;

-- ---- Évaluation générique ---------------------------------------------------

-- Valeur d'une stat pour une partie : colonnes virtuelles ou clé numérique de stats (absente = 0).
create or replace function public._tr_val(p_mp public.match_players, p_stat text)
returns numeric language sql immutable
set search_path = public, extensions
as $$
  select case p_stat
    when 'points'    then p_mp.points::numeric
    when 'placement' then p_mp.placement::numeric
    when 'won'       then case when p_mp.won then 1 else 0 end
    else case when jsonb_typeof(p_mp.stats->p_stat) = 'number' then (p_mp.stats->>p_stat)::numeric else 0 end
  end
$$;

-- Toutes les conditions `and` sont-elles vraies pour cette partie ?
create or replace function public._tr_ok(p_mp public.match_players, p_and jsonb)
returns boolean language sql immutable
set search_path = public, extensions
as $$
  select coalesce(bool_and(
    case c->>'op'
      when '>=' then public._tr_val(p_mp, c->>'stat') >= (c->>'value')::numeric
      when '<=' then public._tr_val(p_mp, c->>'stat') <= (c->>'value')::numeric
      when '='  then public._tr_val(p_mp, c->>'stat') =  (c->>'value')::numeric
      when '>'  then public._tr_val(p_mp, c->>'stat') >  (c->>'value')::numeric
      when '<'  then public._tr_val(p_mp, c->>'stat') <  (c->>'value')::numeric
      else false
    end), true)
    from jsonb_array_elements(coalesce(p_and, '[]'::jsonb)) c
$$;

-- Objectif chiffré d'une règle (all = nombre de sous-règles).
create or replace function public._tr_target(p_rule jsonb)
returns numeric language sql immutable
set search_path = public, extensions
as $$
  select case when p_rule->>'agg' = 'all' then jsonb_array_length(p_rule->'rules')::numeric
              else coalesce((p_rule->>'threshold')::numeric, 1) end
$$;

-- Progression actuelle d'un joueur pour une règle (comparée à _tr_target).
create or replace function public._tr_progress(p_profile uuid, p_game text, p_rule jsonb)
returns numeric language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_agg  text := p_rule->>'agg';
  v_stat text := p_rule->>'stat';
  v_and  jsonb := p_rule->'and';
  v      numeric := 0;
begin
  if p_rule is null then return 0; end if;
  if v_agg = 'sum' then
    select coalesce(sum(public._tr_val(mp, v_stat)), 0) into v
      from public.match_players mp
     where mp.profile_id = p_profile and mp.game_id = p_game and public._tr_ok(mp, v_and);
  elsif v_agg = 'max' then
    select coalesce(max(public._tr_val(mp, v_stat)), 0) into v
      from public.match_players mp
     where mp.profile_id = p_profile and mp.game_id = p_game and public._tr_ok(mp, v_and);
  elsif v_agg = 'count' then
    select count(*) into v
      from public.match_players mp
     where mp.profile_id = p_profile and mp.game_id = p_game and public._tr_ok(mp, v_and);
  elsif v_agg = 'streak' then
    -- séries de parties consécutives (ordre de fin de partie) satisfaisant `and`
    select coalesce(max(c), 0) into v from (
      select count(*) as c from (
        select t.ok,
               row_number() over (order by t.at, t.mid)
               - row_number() over (partition by t.ok order by t.at, t.mid) as grp
          from (select public._tr_ok(mp, v_and) as ok, coalesce(m.finished_at, m.created_at) as at, mp.match_id as mid
                  from public.match_players mp join public.matches m on m.id = mp.match_id
                 where mp.profile_id = p_profile and mp.game_id = p_game) t
      ) u where u.ok group by u.grp
    ) z;
  elsif v_agg = 'all' then
    select count(*) into v from jsonb_array_elements(p_rule->'rules') r
     where public._tr_progress(p_profile, p_game, r) >= public._tr_target(r);
  elsif v_agg = 'special' then
    case p_rule->>'name'
      when 'distinct_games' then
        select count(distinct game_id) into v from public.match_players where profile_id = p_profile;
      when 'distinct_win_games' then
        select count(distinct game_id) into v from public.match_players where profile_id = p_profile and won;
      when 'soirees' then
        select coalesce(max(soirees_count), 0) into v from public.player_stats where profile_id = p_profile;
      when 'late_soirees' then
        select coalesce(max(late_soirees_count), 0) into v from public.player_stats where profile_id = p_profile;
      when 'games_in_soiree' then
        select coalesce(max(c), 0) into v from (
          select count(*) as c from public.match_players mp join public.matches m on m.id = mp.match_id
           where mp.profile_id = p_profile and m.soiree_id is not null group by m.soiree_id) x;
      when 'hosted' then
        select count(*) into v from public.soirees s
         where s.host_id = p_profile and s.status = 'ended'
           and coalesce(s.end_reason, 'host') not in ('abandoned', 'admin')
           and exists (select 1 from public.matches m where m.soiree_id = s.id and m.status = 'finished');
      when 'biggest_table' then
        select coalesce(max(c), 0) into v from (
          select count(*) as c from public.soiree_players sp
           where sp.soiree_id in (select soiree_id from public.soiree_players where profile_id = p_profile)
           group by sp.soiree_id) x;
      when 'stickers' then
        -- compteur persistant (le chat est purgé en fin de soirée), incrémenté par send_soiree_message
        select coalesce(max(stickers_sent), 0) into v from public.player_stats where profile_id = p_profile;
      when 'tenues' then
        -- tenues gagnées aux victoires : la tenue secrète offerte par un trophée (Madame Irma) ne compte pas
        select count(*) into v from public.tenue_unlocks u join public.tenues x on x.id = u.tenue_id
         where u.profile_id = p_profile and x.condition_type <> 'trophy';
      when 'full_board' then
        select coalesce(max(c), 0) into v from (
          select count(*) as c from public.trophy_unlocks u join public.trophies t on t.id = u.trophy_id
           where u.profile_id = p_profile and t.tenue_id is not null group by t.tenue_id) x;
      when 'advent' then
        select count(*) into v from public.advent_opens where profile_id = p_profile;
      when 'prono_streak' then
        select coalesce(max(len), 0) into v from (
          select count(*) as len from (
            select r.ok,
                   row_number() over (order by r.at, r.match_id)
                   - row_number() over (partition by r.ok order by r.at, r.match_id) as grp
              from public._prono_resolved() r where r.profile_id = p_profile) t
           where t.ok group by t.grp) z;
      else v := 0;
    end case;
  end if;
  return v;
end $$;

-- Débloque les trophées actifs dont la règle est remplie. p_game : ne regarde que les trophées de ce
-- jeu (+ les généraux) ; null = tous. Renvoie les ids NOUVELLEMENT débloqués.
create or replace function public.evaluate_trophies(p_profile_id uuid, p_game text default null)
returns text[] language plpgsql security definer
set search_path = public, extensions
as $$
declare
  t      record;
  v_new  text[] := '{}';
  v_rows integer;
begin
  -- Invités : jamais de trophée (ni tenue de récompense), quelle que soit la voie (pronos, stickers…).
  if exists (select 1 from public.profiles where id = p_profile_id and is_guest) then return v_new; end if;
  for t in
    select x.* from public.trophies x
     where x.active and x.rule is not null
       and (x.game_id is null or p_game is null or x.game_id = p_game)
       and not exists (select 1 from public.trophy_unlocks u where u.profile_id = p_profile_id and u.trophy_id = x.id)
     order by (x.game_id is null), x.sort_order
  loop
    if public._tr_progress(p_profile_id, t.game_id, t.rule) >= public._tr_target(t.rule) then
      insert into public.trophy_unlocks(profile_id, trophy_id) values (p_profile_id, t.id) on conflict do nothing;
      get diagnostics v_rows = row_count;
      if v_rows > 0 then v_new := v_new || t.id; end if;
    end if;
  end loop;
  return v_new;
end $$;

-- Évalue UN seul trophée (hors fin de partie : ex. Pipelette, au moment où un sticker est envoyé).
-- Renvoie true s'il vient d'être débloqué.
create or replace function public.evaluate_trophy(p_profile_id uuid, p_trophy_id text)
returns boolean language plpgsql security definer
set search_path = public, extensions
as $$
declare
  t      record;
  v_rows integer;
begin
  if exists (select 1 from public.profiles where id = p_profile_id and is_guest) then return false; end if;
  select * into t from public.trophies where id = p_trophy_id and active and rule is not null;
  if not found then return false; end if;
  if exists (select 1 from public.trophy_unlocks u where u.profile_id = p_profile_id and u.trophy_id = t.id) then
    return false;
  end if;
  if public._tr_progress(p_profile_id, t.game_id, t.rule) >= public._tr_target(t.rule) then
    insert into public.trophy_unlocks(profile_id, trophy_id) values (p_profile_id, t.id) on conflict do nothing;
    get diagnostics v_rows = row_count;
    return v_rows > 0;
  end if;
  return false;
end $$;

-- Hook de fin de partie (cf. schema.sql) : {profile_id: [trophy_ids]} (non vides seulement).
create or replace function public._after_finish_trophies(p_match_id uuid, p_profile_ids uuid[])
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_game text;
  v_id   uuid;
  v_new  text[];
  v_map  jsonb := '{}'::jsonb;
  v_ids  uuid[];
begin
  select game_id into v_game from public.matches where id = p_match_id;
  -- joueurs de la partie + parieurs de la manche de pronostics (même absents de la partie)
  v_ids := array(select distinct x from unnest(coalesce(p_profile_ids, '{}')
                  || array(select profile_id from public.soiree_pronos where match_id = p_match_id)) x);
  foreach v_id in array v_ids loop
    v_new := public.evaluate_trophies(v_id, v_game);
    if coalesce(array_length(v_new, 1), 0) > 0 then
      v_map := v_map || jsonb_build_object(v_id::text, to_jsonb(v_new));
    end if;
  end loop;
  return v_map;
end $$;

-- Progression du joueur courant : {trophy_id: {value, target}} pour les trophées actifs
-- (p_tenue : seulement ceux de cette tenue ; null = tous). Calculée à la demande.
create or replace function public.my_trophy_progress(p_tenue text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_res jsonb := '{}'::jsonb;
  t     record;
begin
  for t in select x.id, x.game_id, x.rule from public.trophies x
            where x.active and x.rule is not null
              and (p_tenue is null or x.tenue_id = p_tenue)
  loop
    v_res := v_res || jsonb_build_object(t.id, jsonb_build_object(
      'value', public._tr_progress(v_me, t.game_id, t.rule), 'target', public._tr_target(t.rule)));
  end loop;
  return v_res;
end $$;

-- ---- Stickers de tenue : droit d'usage -----------------------------------------

-- Le joueur peut-il utiliser le sticker de rang p_slot de la planche de la tenue p_tenue ?
-- Tenue débloquée ET (slot 1 | slot > 12 (bonus) | tenue secrète (condition 'trophy' : tous ses stickers
-- sont offerts, la tenue étant déjà la récompense) | trophée (tenue, slot) obtenu).
create or replace function public._tenue_slot_ok(p_profile uuid, p_tenue text, p_slot integer)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select p_slot >= 1
     and exists (select 1 from public.tenue_unlocks u where u.profile_id = p_profile and u.tenue_id = p_tenue)
     and (p_slot = 1 or p_slot > 12
          or exists (select 1 from public.tenues x where x.id = p_tenue and x.condition_type = 'trophy')
          or exists (
           select 1 from public.trophies t join public.trophy_unlocks tu on tu.trophy_id = t.id
            where t.tenue_id = p_tenue and t.slot = p_slot and tu.profile_id = p_profile))
$$;

-- ---- Trophée -> tenue secrète ---------------------------------------------------
-- Obtenir un trophée qui est la clé d'une tenue secrète (tenues.trophy_id, ex. gen_madame_irma -> irma)
-- débloque cette tenue. Un trigger couvre tous les chemins d'attribution (fin de partie, evaluate_trophy…).
create or replace function public._trophy_reward_tenue()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  insert into public.tenue_unlocks(profile_id, tenue_id)
  select new.profile_id, x.id from public.tenues x where x.trophy_id = new.trophy_id
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists trophy_unlocks_reward_tenue on public.trophy_unlocks;
create trigger trophy_unlocks_reward_tenue after insert on public.trophy_unlocks
  for each row execute function public._trophy_reward_tenue();

-- Rattrapage (idempotent) : trophées déjà obtenus avant la mise en place de la tenue secrète.
insert into public.tenue_unlocks(profile_id, tenue_id)
select u.profile_id, x.id from public.trophy_unlocks u join public.tenues x on x.trophy_id = u.trophy_id
on conflict do nothing;

-- ---- Catalogue (généré depuis docs/TROPHEES.md) ----------------------------------

insert into public.trophies (id, tenue_id, slot, name, description, game_id, rule, active, sort_order) values
  ('qdn_incompris', 'star', 2, 'L''incompris', 'Voter 5 fois hors de la majorité en une partie', 'qui-de-nous', '{"agg":"max","stat":"off_majority","threshold":5}'::jsonb, true, 1),
  ('qdn_tete_de_turc', 'star', 3, 'Tête de Turc', 'Être désigné par tous les autres joueurs sur une manche', 'qui-de-nous', '{"agg":"sum","stat":"pointed_by_all","threshold":1}'::jsonb, true, 2),
  ('qdn_a_cote_de_la_plaque', 'star', 4, 'À côté de la plaque', 'Finir dernier d''une partie', 'qui-de-nous', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 3),
  ('qdn_bon_public', 'star', 5, 'Bon public', '60 points en cumul', 'qui-de-nous', '{"agg":"sum","stat":"points","threshold":60}'::jsonb, true, 4),
  ('qdn_invisible', 'star', 6, 'L''invisible', 'Finir une partie (8 manches min.) sans recevoir un seul vote', 'qui-de-nous', '{"agg":"count","threshold":1,"and":[{"stat":"designated","op":"=","value":0},{"stat":"rounds","op":">=","value":8}]}'::jsonb, true, 5),
  ('qdn_chouchou', 'star', 7, 'Le chouchou', 'Recevoir 30 votes en cumul', 'qui-de-nous', '{"agg":"sum","stat":"designated","threshold":30}'::jsonb, true, 6),
  ('qdn_flair', 'star', 8, 'Le flair', 'Voter avec la majorité 5 manches d''affilée', 'qui-de-nous', '{"agg":"max","stat":"maj_streak","threshold":5}'::jsonb, true, 7),
  ('qdn_plebiscite', 'star', 9, 'Plébiscite', 'Être le plus désigné sur 5 manches d''une même partie', 'qui-de-nous', '{"agg":"max","stat":"top_rounds","threshold":5}'::jsonb, true, 8),
  ('qdn_star_de_la_soiree', 'star', 10, 'Star de la soirée', 'Être le joueur le plus désigné de la partie, 3 fois (cumul)', 'qui-de-nous', '{"agg":"sum","stat":"top_designated","threshold":3}'::jsonb, true, 9),
  ('qdn_telepathe', 'star', 11, 'Télépathe', '8 points ou plus sur une partie de 10 manches', 'qui-de-nous', '{"agg":"count","threshold":1,"and":[{"stat":"points","op":">=","value":8},{"stat":"rounds","op":">=","value":10}]}'::jsonb, true, 10),
  ('qdn_voix_du_peuple', 'star', 12, 'La voix du peuple', 'Voter avec la majorité à toutes les manches d''une partie (10 manches min.)', 'qui-de-nous', '{"agg":"sum","stat":"perfect","threshold":1}'::jsonb, true, 11),
  ('uc_grille', 'espion', 2, 'Grillé !', 'Être éliminé en premier', 'undercover', '{"agg":"sum","stat":"undercover_first_out","threshold":1}'::jsonb, true, 12),
  ('uc_erreur_judiciaire', 'espion', 3, 'Erreur judiciaire', 'Être éliminé en étant civil, 3 fois (cumul)', 'undercover', '{"agg":"sum","stat":"wrongly_out","threshold":3}'::jsonb, true, 13),
  ('uc_bavure', 'espion', 4, 'La bavure', 'En civil, voter contre un autre civil 5 fois (cumul)', 'undercover', '{"agg":"sum","stat":"civil_vs_civil","threshold":5}'::jsonb, true, 14),
  ('uc_fin_limier', 'espion', 5, 'Fin limier', 'Voter contre un infiltré 5 fois (cumul)', 'undercover', '{"agg":"sum","stat":"infiltre_votes","threshold":5}'::jsonb, true, 15),
  ('uc_planque', 'espion', 6, 'La planque', 'Être encore en vie à la fin de 5 parties (cumul)', 'undercover', '{"agg":"sum","stat":"survived","threshold":5}'::jsonb, true, 16),
  ('uc_bon_citoyen', 'espion', 7, 'Bon citoyen', 'Gagner 5 parties en civil (cumul)', 'undercover', '{"agg":"sum","stat":"won_civil","threshold":5}'::jsonb, true, 17),
  ('uc_taupe', 'espion', 8, 'La taupe', 'Gagner 2 parties en undercover (cumul)', 'undercover', '{"agg":"sum","stat":"undercover_won_as_undercover","threshold":2}'::jsonb, true, 18),
  ('uc_page_blanche', 'espion', 9, 'Page blanche', 'Gagner une partie en Mister White', 'undercover', '{"agg":"sum","stat":"won_mrwhite","threshold":1}'::jsonb, true, 19),
  ('uc_sherlock', 'espion', 10, 'Sherlock', 'En une partie, voter contre un infiltré à chaque vote (2 votes min.)', 'undercover', '{"agg":"sum","stat":"sherlock","threshold":1}'::jsonb, true, 20),
  ('uc_insoupconnable', 'espion', 11, 'Insoupçonnable', 'Gagner en undercover sans recevoir un seul vote de la partie', 'undercover', '{"agg":"sum","stat":"insoupconnable","threshold":1}'::jsonb, true, 21),
  ('uc_agent_double', 'espion', 12, 'Agent double', 'Gagner 5 parties en infiltré, undercover ou Mister White (cumul)', 'undercover', '{"agg":"sum","stat":"won_infiltre","threshold":5}'::jsonb, true, 22),
  ('pdb_pas_de_bol', 'croupier', 2, 'Vraiment pas de bol', 'Finir dernier (le dernier avec des cartes)', 'pas-de-bol', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 23),
  ('pdb_addition_salee', 'croupier', 3, 'L''addition salée', 'Piocher 6 cartes ou plus d''un coup (cumul de +2 / +4)', 'pas-de-bol', '{"agg":"max","stat":"big_draw","threshold":6}'::jsonb, true, 24),
  ('pdb_etourdi', 'croupier', 4, 'L''étourdi', 'Se faire dénoncer pour un « Dernière carte ! » oublié', 'pas-de-bol', '{"agg":"sum","stat":"denounced","threshold":1}'::jsonb, true, 25),
  ('pdb_beau_jeu', 'croupier', 5, 'Beau jeu', 'Poser 5 cartes spéciales en une partie (+2, +4, joker, sens, passe, perso)', 'pas-de-bol', '{"agg":"max","stat":"special_cards","threshold":5}'::jsonb, true, 26),
  ('pdb_main_pleine', 'croupier', 6, 'Les mains pleines', 'Avoir 12 cartes ou plus en main', 'pas-de-bol', '{"agg":"max","stat":"max_hand","threshold":12}'::jsonb, true, 27),
  ('pdb_genereux', 'croupier', 7, 'Trop généreux', 'Faire piocher 20 cartes aux autres (cumul)', 'pas-de-bol', '{"agg":"sum","stat":"inflicted","threshold":20}'::jsonb, true, 28),
  ('pdb_balance', 'croupier', 8, 'La balance', 'Dénoncer 3 oublis de « Dernière carte ! » (cumul)', 'pas-de-bol', '{"agg":"sum","stat":"denounces","threshold":3}'::jsonb, true, 29),
  ('pdb_retour_envoyeur', 'croupier', 9, 'Retour à l''envoyeur', 'Renvoyer un +2 / +4 en cumulant dessus, 5 fois (cumul)', 'pas-de-bol', '{"agg":"sum","stat":"stacks","threshold":5}'::jsonb, true, 30),
  ('pdb_main_propre', 'croupier', 10, 'Main propre', 'Sortir premier en ayant pioché 2 cartes au plus de toute la partie', 'pas-de-bol', '{"agg":"sum","stat":"clean_win","threshold":1}'::jsonb, true, 31),
  ('pdb_remontada', 'croupier', 11, 'Remontada', 'Sortir premier après avoir eu 10 cartes ou plus en main', 'pas-de-bol', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 32),
  ('pdb_main_chaude', 'croupier', 12, 'Main chaude', 'Sortir premier 3 parties de suite', 'pas-de-bol', '{"agg":"streak","threshold":3,"and":[{"stat":"placement","op":"=","value":1}]}'::jsonb, true, 33),
  ('cef_bonnet_d_ane', 'prof', 2, 'Bonnet d''âne', 'Finir dernier d''une partie', 'cerveau-en-fete', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 34),
  ('cef_copie_blanche', 'prof', 3, 'Copie blanche', 'Rater 3 questions de suite', 'cerveau-en-fete', '{"agg":"max","stat":"miss_streak","threshold":3}'::jsonb, true, 35),
  ('cef_a_la_bourre', 'prof', 4, 'À la bourre', 'Trouver la bonne réponse en dernier (3 trouveurs min.), 5 fois (cumul)', 'cerveau-en-fete', '{"agg":"sum","stat":"last_finder","threshold":5}'::jsonb, true, 36),
  ('cef_bon_eleve', 'prof', 5, 'Bon élève', '50 bonnes réponses (cumul)', 'cerveau-en-fete', '{"agg":"sum","stat":"correct","threshold":50}'::jsonb, true, 37),
  ('cef_sur_le_fil', 'prof', 6, 'Sur le fil', 'Trouver dans les 3 dernières secondes, 3 fois (cumul)', 'cerveau-en-fete', '{"agg":"sum","stat":"close_finds","threshold":3}'::jsonb, true, 38),
  ('cef_doigt_leve', 'prof', 7, 'Le doigt levé', 'Être le premier à trouver 20 fois (cumul)', 'cerveau-en-fete', '{"agg":"sum","stat":"firsts","threshold":20}'::jsonb, true, 39),
  ('cef_eclair', 'prof', 8, 'Éclair de génie', 'Trouver une réponse tapée en moins de 3 s', 'cerveau-en-fete', '{"agg":"sum","stat":"fast_typed","threshold":1}'::jsonb, true, 40),
  ('cef_as_du_qcm', 'prof', 9, 'As du QCM', 'Réussir tous les QCM d''une partie (5 QCM min.)', 'cerveau-en-fete', '{"agg":"sum","stat":"qcm_perfect","threshold":1}'::jsonb, true, 41),
  ('cef_serie', 'prof', 10, 'En série', '5 bonnes réponses d''affilée', 'cerveau-en-fete', '{"agg":"max","stat":"best_streak","threshold":5}'::jsonb, true, 42),
  ('cef_tete_de_classe', 'prof', 11, 'Tête de classe', 'Être le premier à trouver sur 5 questions d''une même partie', 'cerveau-en-fete', '{"agg":"max","stat":"firsts","threshold":5}'::jsonb, true, 43),
  ('cef_sans_faute', 'prof', 12, '20 sur 20', 'Trouver toutes les questions d''une partie (10 questions min.)', 'cerveau-en-fete', '{"agg":"sum","stat":"perfect","threshold":1}'::jsonb, true, 44),
  ('pb_recale', 'ecolier', 2, 'Recalé !', 'Se faire refuser 3 réponses par le vote des autres (cumul)', 'petit-bac', '{"agg":"sum","stat":"refused","threshold":3}'::jsonb, true, 45),
  ('pb_page_blanche', 'ecolier', 3, 'Page blanche', 'Marquer 0 point sur une manche', 'petit-bac', '{"agg":"sum","stat":"zero_rounds","threshold":1}'::jsonb, true, 46),
  ('pb_copieur', 'ecolier', 4, 'Le copieur', '10 réponses partagées avec un autre joueur (cumul)', 'petit-bac', '{"agg":"sum","stat":"shared","threshold":10}'::jsonb, true, 47),
  ('pb_original', 'ecolier', 5, 'L''original', '20 réponses uniques (cumul)', 'petit-bac', '{"agg":"sum","stat":"uniques","threshold":20}'::jsonb, true, 48),
  ('pb_panne_seche', 'ecolier', 6, 'Panne sèche', 'Laisser 3 cases vides sur une même manche', 'petit-bac', '{"agg":"max","stat":"max_empty","threshold":3}'::jsonb, true, 49),
  ('pb_grille_pleine', 'ecolier', 7, 'Grille pleine', 'Remplir toutes les cases d''une manche avec des réponses acceptées', 'petit-bac', '{"agg":"sum","stat":"full_grids","threshold":1}'::jsonb, true, 50),
  ('pb_avocat', 'ecolier', 8, 'L''avocat', 'Contester 5 réponses qui finissent refusées (cumul)', 'petit-bac', '{"agg":"sum","stat":"lawyer","threshold":5}'::jsonb, true, 51),
  ('pb_carton_plein', 'ecolier', 9, 'Carton plein', 'Une manche avec uniquement des réponses uniques (2 pts partout)', 'petit-bac', '{"agg":"sum","stat":"perfect_rounds","threshold":1}'::jsonb, true, 52),
  ('pb_meilleure_copie', 'ecolier', 10, 'Meilleure copie', 'Avoir le meilleur score de la manche 10 fois (cumul)', 'petit-bac', '{"agg":"sum","stat":"best_rounds","threshold":10}'::jsonb, true, 53),
  ('pb_regulier', 'ecolier', 11, 'Élève régulier', 'Marquer au moins 8 points à chaque manche d''une partie (3 manches min.)', 'petit-bac', '{"agg":"sum","stat":"regular","threshold":1}'::jsonb, true, 54),
  ('pb_grand_chelem', 'ecolier', 12, 'Major de promo', 'Avoir le meilleur score à toutes les manches d''une partie (4 manches min., ex æquo acceptés)', 'petit-bac', '{"agg":"sum","stat":"grand_slam","threshold":1}'::jsonb, true, 55),
  ('dd_gribouillis', 'artiste', 2, 'Gribouillis', 'Dessiner un mot que personne ne trouve', 'dessine-devine', '{"agg":"sum","stat":"unfound","threshold":1}'::jsonb, true, 56),
  ('dd_dans_le_flou', 'artiste', 3, 'Dans le flou', 'Ne pas trouver 3 dessins de suite', 'dessine-devine', '{"agg":"max","stat":"miss_streak","threshold":3}'::jsonb, true, 57),
  ('dd_presque', 'artiste', 4, 'Presque !', 'Recevoir 5 « Presque ! » (cumul)', 'dessine-devine', '{"agg":"sum","stat":"close_count","threshold":5}'::jsonb, true, 58),
  ('dd_oeil_de_lynx', 'artiste', 5, 'Œil de lynx', 'Trouver 25 mots (cumul)', 'dessine-devine', '{"agg":"sum","stat":"found_count","threshold":25}'::jsonb, true, 59),
  ('dd_in_extremis', 'artiste', 6, 'In extremis', 'Trouver un mot dans les 5 dernières secondes', 'dessine-devine', '{"agg":"sum","stat":"late_finds","threshold":1}'::jsonb, true, 60),
  ('dd_limpide', 'artiste', 7, 'Limpide', 'Tout le monde trouve ton dessin, 3 fois (cumul)', 'dessine-devine', '{"agg":"sum","stat":"perfect_drawings","threshold":3}'::jsonb, true, 61),
  ('dd_premier_servi', 'artiste', 8, 'Premier servi', 'Être le premier à trouver 10 fois (cumul)', 'dessine-devine', '{"agg":"sum","stat":"first_finds","threshold":10}'::jsonb, true, 62),
  ('dd_eclair', 'artiste', 9, 'Coup d''œil', 'Trouver un mot en moins de 10 s', 'dessine-devine', '{"agg":"sum","stat":"fast_finds","threshold":1}'::jsonb, true, 63),
  ('dd_sans_indice', 'artiste', 10, 'Sans indice', 'Trouver avant la première lettre révélée, 5 fois (cumul)', 'dessine-devine', '{"agg":"sum","stat":"no_hint_finds","threshold":5}'::jsonb, true, 64),
  ('dd_defi_releve', 'artiste', 11, 'Défi relevé', 'Faire deviner un mot difficile (niveau 3) à tous les joueurs', 'dessine-devine', '{"agg":"sum","stat":"hard_perfect","threshold":1}'::jsonb, true, 65),
  ('dd_chef_d_oeuvre', 'artiste', 12, 'Chef-d''œuvre', 'En une partie (4 joueurs min.) : tout le monde trouve tous tes dessins et tu trouves tous ceux des autres', 'dessine-devine', '{"agg":"sum","stat":"masterpiece","threshold":1}'::jsonb, true, 66),
  ('lg_petit_dejeuner', 'loup', 2, 'Petit déjeuner', 'Être dévoré dès la première nuit', 'loup-garou', '{"agg":"sum","stat":"first_night_death","threshold":1}'::jsonb, true, 67),
  ('lg_bucher', 'loup', 3, 'Au bûcher !', 'Être éliminé par le vote sans être loup, 3 fois (cumul)', 'loup-garou', '{"agg":"sum","stat":"lynched_innocent","threshold":3}'::jsonb, true, 68),
  ('lg_cimetiere', 'loup', 4, 'Abonné au cimetière', 'Mourir avant la fin dans 5 parties (cumul)', 'loup-garou', '{"agg":"sum","stat":"died","threshold":5}'::jsonb, true, 69),
  ('lg_flair', 'loup', 5, 'Flair de chasseur', 'Voter contre un loup au vote du jour, 5 fois (cumul)', 'loup-garou', '{"agg":"sum","stat":"wolf_votes","threshold":5}'::jsonb, true, 70),
  ('lg_marmotte', 'loup', 6, 'La marmotte', 'Être encore en vie à la fin de 5 parties (cumul)', 'loup-garou', '{"agg":"sum","stat":"survived","threshold":5}'::jsonb, true, 71),
  ('lg_bon_voisin', 'loup', 7, 'Bon voisin', 'Gagner 5 parties dans le camp du village (cumul)', 'loup-garou', '{"agg":"sum","stat":"won_village","threshold":5}'::jsonb, true, 72),
  ('lg_meute', 'loup', 8, 'La meute', 'Gagner 3 parties en loup (cumul)', 'loup-garou', '{"agg":"sum","stat":"won_wolf","threshold":3}'::jsonb, true, 73),
  ('lg_coup_de_maitre', 'loup', 9, 'Coup de maître', 'Réussir un pouvoir 3 fois (cumul) : voyante qui voit un loup, sorcière qui sauve, protecteur qui protège la cible des loups, chasseur qui abat un loup', 'loup-garou', '{"agg":"sum","stat":"powers","threshold":3}'::jsonb, true, 74),
  ('lg_simple_villageois', 'loup', 10, 'Simple villageois', 'Gagner en simple villageois en étant encore en vie', 'loup-garou', '{"agg":"sum","stat":"simple_win","threshold":1}'::jsonb, true, 75),
  ('lg_agneau', 'loup', 11, 'Doux comme un agneau', 'Gagner en loup sans recevoir un seul vote du village de toute la partie', 'loup-garou', '{"agg":"sum","stat":"lamb","threshold":1}'::jsonb, true, 76),
  ('lg_loup_solitaire', 'loup', 12, 'Loup solitaire', 'Gagner en étant le dernier loup en vie (2 loups min. au départ)', 'loup-garou', '{"agg":"sum","stat":"lone_wolf","threshold":1}'::jsonb, true, 77),
  ('bam_boum', 'artificier', 2, 'BOUM !', 'Exploser 10 fois (cumul)', 'bombe-a-mots', '{"agg":"sum","stat":"explosions","threshold":10}'::jsonb, true, 78),
  ('bam_coup_double', 'artificier', 3, 'Coup double', 'Subir 2 explosions de suite', 'bombe-a-mots', '{"agg":"sum","stat":"double_boom","threshold":1}'::jsonb, true, 79),
  ('bam_premier_saute', 'artificier', 4, 'Premier sauté', 'Être éliminé en premier, 3 fois (cumul)', 'bombe-a-mots', '{"agg":"sum","stat":"first_out","threshold":3}'::jsonb, true, 80),
  ('bam_dico', 'artificier', 5, 'Le dico', '100 mots validés (cumul)', 'bombe-a-mots', '{"agg":"sum","stat":"words","threshold":100}'::jsonb, true, 81),
  ('bam_mot_a_rallonge', 'artificier', 6, 'Mot à rallonge', 'Valider un mot de 12 lettres ou plus', 'bombe-a-mots', '{"agg":"max","stat":"longest_word","threshold":12}'::jsonb, true, 82),
  ('bam_abecedaire', 'artificier', 7, 'L''abécédaire', 'Compléter l''alphabet bonus', 'bombe-a-mots', '{"agg":"sum","stat":"alphabets","threshold":1}'::jsonb, true, 83),
  ('bam_patate_chaude', 'artificier', 8, 'Patate chaude', 'Valider un mot en moins de 2 s, 10 fois (cumul)', 'bombe-a-mots', '{"agg":"sum","stat":"fast_words","threshold":10}'::jsonb, true, 84),
  ('bam_sueurs_froides', 'artificier', 9, 'Sueurs froides', 'Valider un mot à moins d''1 s de l''explosion', 'bombe-a-mots', '{"agg":"sum","stat":"close_calls","threshold":1}'::jsonb, true, 85),
  ('bam_survivant', 'artificier', 10, 'Sur un fil', 'Gagner avec une seule vie restante', 'bombe-a-mots', '{"agg":"sum","stat":"last_life_win","threshold":1}'::jsonb, true, 86),
  ('bam_intouchable', 'artificier', 11, 'Intouchable', 'Gagner sans perdre une seule vie (3 joueurs min.)', 'bombe-a-mots', '{"agg":"sum","stat":"untouched","threshold":1}'::jsonb, true, 87),
  ('bam_marathon', 'artificier', 12, 'Moulin à paroles', '20 mots validés en une partie', 'bombe-a-mots', '{"agg":"max","stat":"words","threshold":20}'::jsonb, true, 88),
  ('mtr_a_la_planche', 'pirate', 2, 'À la planche', 'Être le premier éliminé', 'menteur', '{"agg":"sum","stat":"first_out","threshold":1}'::jsonb, true, 89),
  ('mtr_mauvaise_langue', 'pirate', 3, 'Mauvaise langue', 'Crier « Menteur ! » à tort 5 fois (cumul)', 'menteur', '{"agg":"sum","stat":"false_liar","threshold":5}'::jsonb, true, 90),
  ('mtr_pris_la_main_dans_le_sac', 'pirate', 4, 'La main dans le sac', 'Se faire démasquer 5 fois (cumul)', 'menteur', '{"agg":"sum","stat":"caught","threshold":5}'::jsonb, true, 91),
  ('mtr_detecteur', 'pirate', 5, 'Détecteur de mensonges', 'Crier « Menteur ! » à raison 10 fois (cumul)', 'menteur', '{"agg":"sum","stat":"good_liar","threshold":10}'::jsonb, true, 92),
  ('mtr_dernier_de', 'pirate', 6, 'Le dernier dé', 'Gagner la partie avec un seul dé restant', 'menteur', '{"agg":"sum","stat":"last_die_win","threshold":1}'::jsonb, true, 93),
  ('mtr_pile', 'pirate', 7, 'Pile !', 'Réussir un « Pile ! » exact (option activée)', 'menteur', '{"agg":"sum","stat":"pile_ok","threshold":1}'::jsonb, true, 94),
  ('mtr_bluff', 'pirate', 8, 'Coup de bluff', 'Ton enchère est contestée, elle est vraie, et tu n''avais aucun dé de cette valeur ni joker', 'menteur', '{"agg":"sum","stat":"pure_bluffs","threshold":1}'::jsonb, true, 95),
  ('mtr_pile_poil', 'pirate', 9, 'Pile-poil', 'Ton enchère contestée tombe exactement juste, 3 fois (cumul)', 'menteur', '{"agg":"sum","stat":"exact_bids","threshold":3}'::jsonb, true, 96),
  ('mtr_grosse_voix', 'pirate', 10, 'Grosse voix', 'Une enchère de 8 dés ou plus, contestée, qui s''avère vraie', 'menteur', '{"agg":"sum","stat":"big_bid","threshold":1}'::jsonb, true, 97),
  ('mtr_revenant', 'pirate', 11, 'Le revenant', 'Gagner après être tombé à un seul dé alors qu''il restait 3 joueurs ou plus', 'menteur', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 98),
  ('mtr_capitaine', 'pirate', 12, 'Capitaine', 'Gagner sans perdre un seul dé (3 joueurs min.)', 'menteur', '{"agg":"sum","stat":"captain","threshold":1}'::jsonb, true, 99),
  ('bwl_rigole', 'bowler', 2, 'Abonné à la rigole', '3 gouttières (lancer à 0 quille) en une partie', 'bowling', '{"agg":"max","stat":"gutters","threshold":3}'::jsonb, true, 100),
  ('bwl_quille_tetue', 'bowler', 3, 'La quille têtue', 'Finir une frame avec une seule quille debout, 5 fois (cumul)', 'bowling', '{"agg":"sum","stat":"one_left","threshold":5}'::jsonb, true, 101),
  ('bwl_lanterne_rouge', 'bowler', 4, 'Lanterne rouge', 'Finir dernier d''une partie', 'bowling', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 102),
  ('bwl_strikes', 'bowler', 5, 'Ça tombe !', '10 strikes (cumul)', 'bowling', '{"agg":"sum","stat":"strikes","threshold":10}'::jsonb, true, 103),
  ('bwl_spares', 'bowler', 6, 'Le rattrapeur', '10 spares (cumul)', 'bowling', '{"agg":"sum","stat":"spares","threshold":10}'::jsonb, true, 104),
  ('bwl_double', 'bowler', 7, 'Le doublé', '2 strikes d''affilée', 'bowling', '{"agg":"max","stat":"strike_run","threshold":2}'::jsonb, true, 105),
  ('bwl_sauvetage', 'bowler', 8, 'Sauvetage', 'Faire un spare après une gouttière au premier lancer', 'bowling', '{"agg":"sum","stat":"rescues","threshold":1}'::jsonb, true, 106),
  ('bwl_dinde', 'bowler', 9, 'La dinde', '3 strikes d''affilée', 'bowling', '{"agg":"max","stat":"strike_run","threshold":3}'::jsonb, true, 107),
  ('bwl_cent_cinquante', 'bowler', 10, '150 au compteur', '150 points ou plus sur 10 frames', 'bowling', '{"agg":"count","threshold":1,"and":[{"stat":"score","op":">=","value":150},{"stat":"frames","op":">=","value":10}]}'::jsonb, true, 108),
  ('bwl_partie_propre', 'bowler', 11, 'Partie propre', 'Strike ou spare à chaque frame (5 frames min.)', 'bowling', '{"agg":"sum","stat":"clean","threshold":1}'::jsonb, true, 109),
  ('bwl_deux_cents', 'bowler', 12, 'Le club des 200', '200 points ou plus sur 10 frames', 'bowling', '{"agg":"count","threshold":1,"and":[{"stat":"score","op":">=","value":200},{"stat":"frames","op":">=","value":10}]}'::jsonb, true, 110),
  ('tp_a_contre_courant', 'philosophe', 2, 'À contre-courant', 'Perdre 5 paris en une partie', 'tu-preferes', '{"agg":"max","stat":"bets_lost","threshold":5}'::jsonb, true, 111),
  ('tp_seul_au_monde', 'philosophe', 3, 'Seul au monde', 'Être le seul de son avis une fois', 'tu-preferes', '{"agg":"sum","stat":"rebel","threshold":1}'::jsonb, true, 112),
  ('tp_dernier_de_la_classe', 'philosophe', 4, 'Perdu dans ses pensées', 'Finir dernier d''une partie', 'tu-preferes', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 113),
  ('tp_sondeur', 'philosophe', 5, 'Le sondeur', '30 paris justes (cumul)', 'tu-preferes', '{"agg":"sum","stat":"bets_ok","threshold":30}'::jsonb, true, 114),
  ('tp_mouton', 'philosophe', 6, 'Le mouton', 'Choisir comme la majorité 30 fois (cumul)', 'tu-preferes', '{"agg":"sum","stat":"norm","threshold":30}'::jsonb, true, 115),
  ('tp_tous_d_accord', 'philosophe', 7, 'Tous d''accord', 'Une manche à l''unanimité (3 joueurs min.), 3 fois (cumul)', 'tu-preferes', '{"agg":"sum","stat":"unanimous_rounds","threshold":3}'::jsonb, true, 116),
  ('tp_rebelle_lucide', 'philosophe', 8, 'Rebelle lucide', 'Être seul de son avis et gagner son pari sur la même manche', 'tu-preferes', '{"agg":"sum","stat":"rebel_right","threshold":1}'::jsonb, true, 117),
  ('tp_rebelle_en_serie', 'philosophe', 9, 'Rebelle en série', 'Être seul de son avis 3 fois en une partie', 'tu-preferes', '{"agg":"max","stat":"rebel","threshold":3}'::jsonb, true, 118),
  ('tp_devin', 'philosophe', 10, 'Le devin', '8 paris justes en une partie (10 manches min.)', 'tu-preferes', '{"agg":"count","threshold":1,"and":[{"stat":"bets_ok","op":">=","value":8},{"stat":"rounds","op":">=","value":10}]}'::jsonb, true, 119),
  ('tp_anticonformiste', 'philosophe', 11, 'Anticonformiste', 'Gagner une partie en ayant été minoritaire plus d''une manche sur deux', 'tu-preferes', '{"agg":"count","threshold":1,"and":[{"stat":"minority","op":"=","value":1},{"stat":"won","op":"=","value":1}]}'::jsonb, true, 120),
  ('tp_oracle', 'philosophe', 12, 'L''oracle', 'Tous les paris justes sur une partie de 10 manches min.', 'tu-preferes', '{"agg":"sum","stat":"perfect_bets","threshold":1}'::jsonb, true, 121),
  ('qsj_trou_de_memoire', 'vedette', 2, 'Trou de mémoire', 'Finir un tour sans trouver une seule carte', 'qui-suis-je', '{"agg":"sum","stat":"empty_turns","threshold":1}'::jsonb, true, 122),
  ('qsj_je_passe', 'vedette', 3, 'Je passe !', 'Passer 5 cartes dans un même tour', 'qui-suis-je', '{"agg":"max","stat":"max_passed","threshold":5}'::jsonb, true, 123),
  ('qsj_figurant', 'vedette', 4, 'Le figurant', 'Finir dernier d''une partie', 'qui-suis-je', '{"agg":"sum","stat":"last","threshold":1}'::jsonb, true, 124),
  ('qsj_culture', 'vedette', 5, 'Culture générale', '50 cartes trouvées (cumul)', 'qui-suis-je', '{"agg":"sum","stat":"found","threshold":50}'::jsonb, true, 125),
  ('qsj_sans_joker', 'vedette', 6, 'Sans joker', 'Un tour sans passer, avec 3 cartes trouvées ou plus', 'qui-suis-je', '{"agg":"sum","stat":"clean_turns","threshold":1}'::jsonb, true, 126),
  ('qsj_tete_connue', 'vedette', 7, 'Une tête connue', 'Deviner 3 persos de la bande (thème « Les Soirées de Dédé », cumul)', 'qui-suis-je', '{"agg":"sum","stat":"crew_found","threshold":3}'::jsonb, true, 127),
  ('qsj_tac_tac', 'vedette', 8, 'Tac tac tac', '5 cartes trouvées d''affilée sans passer', 'qui-suis-je', '{"agg":"max","stat":"best_run","threshold":5}'::jsonb, true, 128),
  ('qsj_rafale', 'vedette', 9, 'En rafale', '8 cartes trouvées en un seul tour', 'qui-suis-je', '{"agg":"max","stat":"best_turn","threshold":8}'::jsonb, true, 129),
  ('qsj_valeur_sure', 'vedette', 10, 'Valeur sûre', 'Au moins 5 cartes à chacun de ses tours (2 tours min.)', 'qui-suis-je', '{"agg":"sum","stat":"steady","threshold":1}'::jsonb, true, 130),
  ('qsj_cinephile', 'vedette', 11, 'Le cinéphile', 'Trouver 10 cartes difficiles (niveau 3, cumul)', 'qui-suis-je', '{"agg":"sum","stat":"hard_found","threshold":10}'::jsonb, true, 131),
  ('qsj_tapis_rouge', 'vedette', 12, 'Tapis rouge', '12 cartes trouvées en un seul tour', 'qui-suis-je', '{"agg":"max","stat":"best_turn","threshold":12}'::jsonb, true, 132),
  ('lpp_a_cote', 'archer', 2, 'À côté de la cible', 'Être le plus loin de la réponse 5 fois (3 joueurs min., cumul)', 'le-plus-proche', '{"agg":"sum","stat":"farthest","threshold":5}'::jsonb, true, 133),
  ('lpp_hors_cible', 'archer', 3, 'Dans le décor', 'Se tromper d''un facteur 10 ou plus', 'le-plus-proche', '{"agg":"sum","stat":"way_off","threshold":1}'::jsonb, true, 134),
  ('lpp_bredouille', 'archer', 4, 'Bredouille', '3 manches de suite sans marquer', 'le-plus-proche', '{"agg":"max","stat":"scoreless_run","threshold":3}'::jsonb, true, 135),
  ('lpp_dans_le_jaune', 'archer', 5, 'Dans le jaune', 'Être le plus proche 15 fois (cumul)', 'le-plus-proche', '{"agg":"sum","stat":"closest","threshold":15}'::jsonb, true, 136),
  ('lpp_poulidor', 'archer', 6, 'Éternel second', 'Finir 2e d''une manche 10 fois (cumul)', 'le-plus-proche', '{"agg":"sum","stat":"seconds","threshold":10}'::jsonb, true, 137),
  ('lpp_ames_soeurs', 'archer', 7, 'Âmes sœurs', 'Être le plus proche à égalité avec un autre joueur', 'le-plus-proche', '{"agg":"sum","stat":"tied_closest","threshold":1}'::jsonb, true, 138),
  ('lpp_a_un_cheveu', 'archer', 8, 'À un cheveu', 'Être le plus proche à moins de 1 % de la réponse, sans être exact', 'le-plus-proche', '{"agg":"sum","stat":"near_miss","threshold":1}'::jsonb, true, 139),
  ('lpp_dans_le_mille', 'archer', 9, 'Dans le mille', 'Donner une réponse exacte', 'le-plus-proche', '{"agg":"sum","stat":"exacts","threshold":1}'::jsonb, true, 140),
  ('lpp_regulier', 'archer', 10, 'Tir groupé', 'Marquer des points à toutes les manches d''une partie (8 manches min.)', 'le-plus-proche', '{"agg":"sum","stat":"scored_all","threshold":1}'::jsonb, true, 141),
  ('lpp_triple', 'archer', 11, 'Trois flèches', 'Être le plus proche 3 manches d''affilée', 'le-plus-proche', '{"agg":"max","stat":"closest_run","threshold":3}'::jsonb, true, 142),
  ('lpp_robin_des_bois', 'archer', 12, 'Robin des Bois', '2 réponses exactes en une partie', 'le-plus-proche', '{"agg":"max","stat":"exacts","threshold":2}'::jsonb, true, 143),
  ('aov_four', 'comedien', 2, 'Le four', 'Rater un défi (majorité de 👎)', 'action-ou-verite', '{"agg":"sum","stat":"fails","threshold":1}'::jsonb, true, 144),
  ('aov_gage', 'comedien', 3, 'Gage !', 'Recevoir 3 gages (refus, cumul)', 'action-ou-verite', '{"agg":"sum","stat":"refusals","threshold":3}'::jsonb, true, 145),
  ('aov_siffle', 'comedien', 4, 'Sifflé', 'Recevoir 10 👎 (cumul)', 'action-ou-verite', '{"agg":"sum","stat":"thumbs_down","threshold":10}'::jsonb, true, 146),
  ('aov_franc_jeu', 'comedien', 5, 'Franc-jeu', 'Choisir « Vérité » 10 fois (cumul)', 'action-ou-verite', '{"agg":"sum","stat":"verites","threshold":10}'::jsonb, true, 147),
  ('aov_chouchou_de_la_roue', 'comedien', 6, 'Chouchou de la roue', 'Être désigné 5 fois par la roue en une partie', 'action-ou-verite', '{"agg":"max","stat":"turns","threshold":5}'::jsonb, true, 148),
  ('aov_ovation', 'comedien', 7, 'Ovation', 'Réussir un défi à l''unanimité (3 votants min.)', 'action-ou-verite', '{"agg":"sum","stat":"unanimous","threshold":1}'::jsonb, true, 149),
  ('aov_casse_cou', 'comedien', 8, 'Casse-cou', 'Choisir « Action » 15 fois (cumul)', 'action-ou-verite', '{"agg":"sum","stat":"actions","threshold":15}'::jsonb, true, 150),
  ('aov_niveau_3', 'comedien', 9, 'Même pas peur', 'Réussir une carte de niveau 3', 'action-ou-verite', '{"agg":"sum","stat":"hard_success","threshold":1}'::jsonb, true, 151),
  ('aov_applaudi', 'comedien', 10, 'Applaudimètre', 'Recevoir 50 👍 (cumul)', 'action-ou-verite', '{"agg":"sum","stat":"thumbs_up","threshold":50}'::jsonb, true, 152),
  ('aov_jamais_degonfle', 'comedien', 11, 'Jamais dégonflé', '3 parties sans aucun refus (2 tours min. par partie, cumul)', 'action-ou-verite', '{"agg":"count","threshold":3,"and":[{"stat":"refusals","op":"=","value":0},{"stat":"turns","op":">=","value":2}]}'::jsonb, true, 153),
  ('aov_standing_ovation', 'comedien', 12, 'Standing ovation', 'En une partie : 5 tours ou plus, tous réussis', 'action-ou-verite', '{"agg":"sum","stat":"perfect","threshold":1}'::jsonb, true, 154),
  ('dee_sur_le_banc', 'coach', 2, 'Sur le banc', 'Perdre 3 parties avec son équipe (cumul)', 'devine-en-equipe', '{"agg":"count","threshold":3,"and":[{"stat":"won","op":"=","value":0}]}'::jsonb, true, 155),
  ('dee_bredouille', 'coach', 3, 'Bredouille', 'Finir un passage d''orateur sans aucun mot trouvé', 'devine-en-equipe', '{"agg":"sum","stat":"empty_turns","threshold":1}'::jsonb, true, 156),
  ('dee_suivant', 'coach', 4, 'Suivant !', 'Passer 3 mots dans un même passage', 'devine-en-equipe', '{"agg":"max","stat":"max_passed","threshold":3}'::jsonb, true, 157),
  ('dee_orateur', 'coach', 5, 'Belle éloquence', 'Faire deviner 30 mots (cumul)', 'devine-en-equipe', '{"agg":"sum","stat":"found","threshold":30}'::jsonb, true, 158),
  ('dee_mime', 'coach', 6, 'Roi du mime', 'Faire deviner 5 mots en manche Mime (cumul)', 'devine-en-equipe', '{"agg":"sum","stat":"found_r3","threshold":5}'::jsonb, true, 159),
  ('dee_pilier', 'coach', 7, 'Pilier de l''équipe', 'Être le meilleur orateur de son équipe 3 fois (cumul)', 'devine-en-equipe', '{"agg":"sum","stat":"best_in_team","threshold":3}'::jsonb, true, 160),
  ('dee_un_seul_mot', 'coach', 8, 'En un mot', '4 mots trouvés dans un passage de la manche « Un seul mot »', 'devine-en-equipe', '{"agg":"max","stat":"best_r2","threshold":4}'::jsonb, true, 161),
  ('dee_du_rab', 'coach', 9, 'Du rab', 'Vider la pioche et garder du temps pour la manche suivante', 'devine-en-equipe', '{"agg":"sum","stat":"carries","threshold":1}'::jsonb, true, 162),
  ('dee_rafale', 'coach', 10, 'La rafale', '6 mots trouvés en un seul passage', 'devine-en-equipe', '{"agg":"max","stat":"best_turn","threshold":6}'::jsonb, true, 163),
  ('dee_trois_manches', 'coach', 11, 'Carton plein', 'Son équipe gagne les 3 manches d''une partie', 'devine-en-equipe', '{"agg":"sum","stat":"sweep","threshold":1}'::jsonb, true, 164),
  ('dee_mvp', 'coach', 12, 'MVP', 'Gagner en étant le meilleur orateur des deux équipes avec 10 mots ou plus', 'devine-en-equipe', '{"agg":"sum","stat":"mvp","threshold":1}'::jsonb, true, 165),
  ('q4_tete_en_l_air', 'stratege', 2, 'Tête en l''air', 'Perdre une manche en 10 jetons ou moins (au total)', 'quatre-a-la-suite', '{"agg":"sum","stat":"fast_loss","threshold":1}'::jsonb, true, 166),
  ('q4_serie_noire', 'stratege', 3, 'Série noire', 'Perdre 3 duels d''affilée dans une session', 'quatre-a-la-suite', '{"agg":"max","stat":"loss_streak","threshold":3}'::jsonb, true, 167),
  ('q4_grille_pleine', 'stratege', 4, 'Grille pleine', 'Faire match nul (grille pleine)', 'quatre-a-la-suite', '{"agg":"sum","stat":"draws","threshold":1}'::jsonb, true, 168),
  ('q4_parieur', 'stratege', 5, 'Le parieur', 'Gagner 10 paris en spectateur (cumul)', 'quatre-a-la-suite', '{"agg":"sum","stat":"bets_won","threshold":10}'::jsonb, true, 169),
  ('q4_marathon', 'stratege', 6, 'Guerre des nerfs', 'Gagner une manche de 36 jetons ou plus', 'quatre-a-la-suite', '{"agg":"sum","stat":"long_win","threshold":1}'::jsonb, true, 170),
  ('q4_diagonale', 'stratege', 7, 'En diagonale', 'Gagner 3 manches par une diagonale (cumul)', 'quatre-a-la-suite', '{"agg":"sum","stat":"diag_wins","threshold":3}'::jsonb, true, 171),
  ('q4_double_menace', 'stratege', 8, 'Double menace', 'Gagner avec deux alignements à la fois, ou 5 jetons alignés', 'quatre-a-la-suite', '{"agg":"sum","stat":"double_wins","threshold":1}'::jsonb, true, 172),
  ('q4_express', 'stratege', 9, 'Express', 'Gagner une manche en 12 jetons ou moins (au total)', 'quatre-a-la-suite', '{"agg":"sum","stat":"fast_win","threshold":1}'::jsonb, true, 173),
  ('q4_trois_a_la_suite', 'stratege', 10, '3 à la suite', 'Gagner 3 duels d''affilée dans une session', 'quatre-a-la-suite', '{"agg":"max","stat":"win_streak","threshold":3}'::jsonb, true, 174),
  ('q4_champion', 'stratege', 11, 'Champion de la table', 'Finir premier d''une session de 4 joueurs ou plus, 2 fois (cumul)', 'quatre-a-la-suite', '{"agg":"count","threshold":2,"and":[{"stat":"won","op":"=","value":1},{"stat":"nplayers","op":">=","value":4}]}'::jsonb, true, 175),
  ('q4_invaincu', 'stratege', 12, 'Invaincu', 'Une session de 4 duels joués ou plus, sans défaite ni nul', 'quatre-a-la-suite', '{"agg":"count","threshold":1,"and":[{"stat":"played","op":">=","value":4},{"stat":"losses","op":"=","value":0},{"stat":"draws","op":"=","value":0}]}'::jsonb, true, 176),
  ('mor_etourdi', 'ninja', 2, 'L''étourdi', 'Perdre une manche en classique en 7 coups ou moins', 'morpion', '{"agg":"sum","stat":"classic_fast_loss","threshold":1}'::jsonb, true, 177),
  ('mor_serie_noire', 'ninja', 3, 'Série noire', 'Perdre 3 duels d''affilée dans une session', 'morpion', '{"agg":"max","stat":"loss_streak","threshold":3}'::jsonb, true, 178),
  ('mor_match_nul', 'ninja', 4, 'Match nul', '5 nuls (cumul)', 'morpion', '{"agg":"sum","stat":"draws","threshold":5}'::jsonb, true, 179),
  ('mor_parieur', 'ninja', 5, 'Le parieur', 'Gagner 10 paris en spectateur (cumul)', 'morpion', '{"agg":"sum","stat":"bets_won","threshold":10}'::jsonb, true, 180),
  ('mor_geant', 'ninja', 6, 'Vu en grand', 'Gagner 3 manches en Géant (cumul)', 'morpion', '{"agg":"sum","stat":"giant_wins","threshold":3}'::jsonb, true, 181),
  ('mor_touche_a_tout', 'ninja', 7, 'Touche-à-tout', 'Gagner un duel dans chacune des 3 variantes (cumul)', 'morpion', '{"agg":"all","rules":[{"agg":"sum","stat":"win_classic","threshold":1},{"agg":"sum","stat":"win_giant","threshold":1},{"agg":"sum","stat":"win_ultimate","threshold":1}]}'::jsonb, true, 182),
  ('mor_contre_attaque', 'ninja', 8, 'Contre-attaque', 'Gagner une manche en classique en jouant ⭕ (en second)', 'morpion', '{"agg":"sum","stat":"classic_second_win","threshold":1}'::jsonb, true, 183),
  ('mor_eclair', 'ninja', 9, 'L''éclair', 'Gagner une manche en Géant en 13 coups ou moins (au total)', 'morpion', '{"agg":"sum","stat":"giant_fast_win","threshold":1}'::jsonb, true, 184),
  ('mor_ultime', 'ninja', 10, 'Maître de l''Ultime', 'Gagner 3 duels en Ultime (cumul)', 'morpion', '{"agg":"sum","stat":"ultimate_duel_wins","threshold":3}'::jsonb, true, 185),
  ('mor_ombre', 'ninja', 11, 'L''ombre', 'Gagner une manche en Ultime sans perdre un seul petit morpion', 'morpion', '{"agg":"sum","stat":"clean_ultimate","threshold":1}'::jsonb, true, 186),
  ('mor_ninja', 'ninja', 12, 'Insaisissable', 'Gagner 4 duels d''affilée dans une session', 'morpion', '{"agg":"max","stat":"win_streak","threshold":4}'::jsonb, true, 187),
  ('bn_plouf', 'amiral', 2, 'Plouf plouf', '10 tirs à l''eau d''affilée', 'bataille-navale', '{"agg":"max","stat":"miss_streak","threshold":10}'::jsonb, true, 188),
  ('bn_naufrage', 'amiral', 3, 'Naufrage total', 'Perdre une manche sans couler un seul bateau adverse', 'bataille-navale', '{"agg":"sum","stat":"lost_no_sink","threshold":1}'::jsonb, true, 189),
  ('bn_si_pres', 'amiral', 4, 'Si près du but', 'Perdre alors qu''il ne restait qu''un bateau adverse', 'bataille-navale', '{"agg":"sum","stat":"lost_close","threshold":1}'::jsonb, true, 190),
  ('bn_canonnier', 'amiral', 5, 'Le canonnier', '100 tirs touchés (cumul)', 'bataille-navale', '{"agg":"sum","stat":"hits","threshold":100}'::jsonb, true, 191),
  ('bn_guerre_d_usure', 'amiral', 6, 'Guerre d''usure', 'Gagner une manche de 120 tirs ou plus (au total)', 'bataille-navale', '{"agg":"sum","stat":"long_win","threshold":1}'::jsonb, true, 192),
  ('bn_parieur', 'amiral', 7, 'Le parieur', 'Gagner 10 paris en spectateur (cumul)', 'bataille-navale', '{"agg":"sum","stat":"bets_won","threshold":10}'::jsonb, true, 193),
  ('bn_premier_tir', 'amiral', 8, 'Du premier coup', 'Toucher dès son premier tir d''une manche, 3 fois (cumul)', 'bataille-navale', '{"agg":"sum","stat":"first_shot_hits","threshold":3}'::jsonb, true, 194),
  ('bn_rafale', 'amiral', 9, 'En rafale', '5 touchés d''affilée', 'bataille-navale', '{"agg":"max","stat":"best_hit_streak","threshold":5}'::jsonb, true, 195),
  ('bn_precision', 'amiral', 10, 'Tireur d''élite', 'Gagner une manche avec 40 % de tirs touchés ou plus', 'bataille-navale', '{"agg":"sum","stat":"precise_win","threshold":1}'::jsonb, true, 196),
  ('bn_eclair', 'amiral', 11, 'Guerre éclair', 'Gagner une manche en 40 tirs ou moins', 'bataille-navale', '{"agg":"sum","stat":"fast_win","threshold":1}'::jsonb, true, 197),
  ('bn_flotte_intacte', 'amiral', 12, 'Flotte intacte', 'Gagner une manche sans perdre un seul bateau', 'bataille-navale', '{"agg":"sum","stat":"intact_win","threshold":1}'::jsonb, true, 198),
  ('tdp_au_violon', 'magnat', 2, 'Habitué du violon', 'Aller 3 fois au violon en une partie', 'tour-des-potes', '{"agg":"max","stat":"jail","threshold":3}'::jsonb, true, 199),
  ('tdp_faillite', 'magnat', 3, 'Sur la paille', 'Faire faillite', 'tour-des-potes', '{"agg":"sum","stat":"bankrupt","threshold":1}'::jsonb, true, 200),
  ('tdp_pigeon', 'magnat', 4, 'Le pigeon', 'Payer 1 000 de loyers en une partie', 'tour-des-potes', '{"agg":"max","stat":"rent_paid","threshold":1000}'::jsonb, true, 201),
  ('tdp_acheteur', 'magnat', 5, 'Fièvre acheteuse', 'Acheter 30 lieux (cumul)', 'tour-des-potes', '{"agg":"sum","stat":"bought","threshold":30}'::jsonb, true, 202),
  ('tdp_globe_trotteur', 'magnat', 6, 'Globe-trotteur', 'Passer 30 fois par le Départ (cumul)', 'tour-des-potes', '{"agg":"sum","stat":"laps","threshold":30}'::jsonb, true, 203),
  ('tdp_tournee', 'magnat', 7, 'Ma tournée !', 'Ramasser 500 de cagnotte à la Pause apéro (cumul)', 'tour-des-potes', '{"agg":"sum","stat":"pot","threshold":500}'::jsonb, true, 204),
  ('tdp_rentier', 'magnat', 8, 'Le rentier', 'Encaisser 2 000 de loyers en une partie', 'tour-des-potes', '{"agg":"max","stat":"rent_received","threshold":2000}'::jsonb, true, 205),
  ('tdp_pioche', 'magnat', 9, 'Carte sur table', 'Piocher 5 cartes en une partie', 'tour-des-potes', '{"agg":"max","stat":"cards","threshold":5}'::jsonb, true, 206),
  ('tdp_hotelier', 'magnat', 10, 'L''hôtelier', 'Posséder un hôtel à la fin d''une partie', 'tour-des-potes', '{"agg":"sum","stat":"hotel","threshold":1}'::jsonb, true, 207),
  ('tdp_monopole', 'magnat', 11, 'Chasse gardée', 'Posséder 2 quartiers complets à la fin d''une partie', 'tour-des-potes', '{"agg":"sum","stat":"monopoly","threshold":1}'::jsonb, true, 208),
  ('tdp_tycoon', 'magnat', 12, 'Le tycoon', 'Gagner avec une fortune au moins 2 fois supérieure à celle du 2e (3 joueurs min.)', 'tour-des-potes', '{"agg":"sum","stat":"tycoon","threshold":1}'::jsonb, true, 209),
  ('dk_tete_a_queue', 'pilote', 2, 'Tête-à-queue', 'Se faire toucher 5 fois par une boule ou une glue (cumul)', 'dede-kart', '{"agg":"sum","stat":"hits_taken","threshold":5}'::jsonb, true, 210),
  ('dk_lanterne_rouge', 'pilote', 3, 'Lanterne rouge', 'Finir dernier d''une course (4 karts min.)', 'dede-kart', '{"agg":"sum","stat":"last_races","threshold":1}'::jsonb, true, 211),
  ('dk_panne', 'pilote', 4, 'En panne', 'Ne pas franchir la ligne avant la fin d''une course', 'dede-kart', '{"agg":"sum","stat":"dnf","threshold":1}'::jsonb, true, 212),
  ('dk_podium', 'pilote', 5, 'Sur le podium', '10 podiums (4 karts min., cumul)', 'dede-kart', '{"agg":"sum","stat":"podiums","threshold":10}'::jsonb, true, 213),
  ('dk_tireur', 'pilote', 6, 'Fine gâchette', 'Toucher 10 karts avec une boule ou une glue (cumul)', 'dede-kart', '{"agg":"sum","stat":"hits","threshold":10}'::jsonb, true, 214),
  ('dk_touriste', 'pilote', 7, 'Tour du monde', 'Gagner une course sur chacun des 6 circuits (cumul)', 'dede-kart', '{"agg":"all","rules":[{"agg":"sum","stat":"win_track_1","threshold":1},{"agg":"sum","stat":"win_track_2","threshold":1},{"agg":"sum","stat":"win_track_3","threshold":1},{"agg":"sum","stat":"win_track_4","threshold":1},{"agg":"sum","stat":"win_track_5","threshold":1},{"agg":"sum","stat":"win_track_6","threshold":1}]}'::jsonb, true, 215),
  ('dk_coup_bas', 'pilote', 8, 'Coups bas', 'Utiliser au moins une fois le nuage, les confettis et le demi-tour (cumul)', 'dede-kart', '{"agg":"all","rules":[{"agg":"sum","stat":"used_cloud","threshold":1},{"agg":"sum","stat":"used_confetti","threshold":1},{"agg":"sum","stat":"used_reverse","threshold":1}]}'::jsonb, true, 216),
  ('dk_remontada', 'pilote', 9, 'Remontada', 'En coupe, gagner une course après avoir fini hors du podium à la précédente', 'dede-kart', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 217),
  ('dk_sniper', 'pilote', 10, 'Sniper', '5 touches réussies en une coupe', 'dede-kart', '{"agg":"max","stat":"hits","threshold":5}'::jsonb, true, 218),
  ('dk_echappee', 'pilote', 11, 'L''échappée', 'Gagner une course avec 5 s d''avance ou plus sur le 2e', 'dede-kart', '{"agg":"sum","stat":"big_lead","threshold":1}'::jsonb, true, 219),
  ('dk_grand_chelem', 'pilote', 12, 'Grand chelem', 'Gagner les 3 courses d''une coupe (4 karts min.)', 'dede-kart', '{"agg":"sum","stat":"grand_slam","threshold":1}'::jsonb, true, 220),
  ('ndc_kaboum', 'hacker', 2, 'Kaboum !', 'Avoir voté pour la bombe', 'nom-de-code', '{"agg":"sum","stat":"bomb_votes","threshold":1}'::jsonb, true, 2100),
  ('ndc_page_blanche', 'hacker', 3, 'Page blanche', 'En espion, laisser filer le chrono sans donner d''indice', 'nom-de-code', '{"agg":"sum","stat":"idle_clue","threshold":1}'::jsonb, true, 2101),
  ('ndc_taupe', 'hacker', 4, 'Taupe malgré toi', 'Faire dévoiler 3 mots d''une autre équipe (cumul)', 'nom-de-code', '{"agg":"sum","stat":"enemy_reveals","threshold":3}'::jsonb, true, 2102),
  ('ndc_bon_flair', 'hacker', 5, 'Bon flair', 'Être le premier à poser sa tête sur 10 mots de son équipe (cumul)', 'nom-de-code', '{"agg":"sum","stat":"first_good","threshold":10}'::jsonb, true, 2103),
  ('ndc_agent_terrain', 'hacker', 6, 'Agent de terrain', 'Jouer 10 parties (cumul)', 'nom-de-code', '{"agg":"count","threshold":10}'::jsonb, true, 2104),
  ('ndc_coup_double', 'hacker', 7, 'Coup double', 'En espion, faire trouver 3 mots avec un seul indice', 'nom-de-code', '{"agg":"max","stat":"best_clue","threshold":3}'::jsonb, true, 2105),
  ('ndc_maitre_espion', 'hacker', 8, 'Maître espion', 'Gagner 3 manches en espion (cumul)', 'nom-de-code', '{"agg":"sum","stat":"spy_wins","threshold":3}'::jsonb, true, 2106),
  ('ndc_sans_faute', 'hacker', 9, 'Sans faute', 'Gagner une manche sans aucune erreur de son équipe', 'nom-de-code', '{"agg":"sum","stat":"flawless","threshold":1}'::jsonb, true, 2107),
  ('ndc_remontada', 'hacker', 10, 'Remontada', 'Gagner une manche après avoir eu 3 mots de retard ou plus', 'nom-de-code', '{"agg":"sum","stat":"comeback","threshold":1}'::jsonb, true, 2108),
  ('ndc_telepathie', 'hacker', 11, 'Télépathie', 'En espion, faire trouver 4 mots ou plus avec un seul indice', 'nom-de-code', '{"agg":"max","stat":"best_clue","threshold":4}'::jsonb, true, 2109),
  ('ndc_legende', 'hacker', 12, 'Légende du code', 'Gagner 15 parties (cumul)', 'nom-de-code', '{"agg":"sum","stat":"won","threshold":15}'::jsonb, true, 2110),
  ('ech_berger', 'grandmaitre', 2, 'Le coup du berger', 'Se faire mater en 10 coups ou moins', 'echecs', '{"agg":"sum","stat":"fast_mated","threshold":1}'::jsonb, true, 2200),
  ('ech_adieu_ma_dame', 'grandmaitre', 3, 'Adieu ma dame', 'Se faire prendre sa dame 5 fois (cumul)', 'echecs', '{"agg":"sum","stat":"queens_lost","threshold":5}'::jsonb, true, 2201),
  ('ech_pat_zut', 'grandmaitre', 4, 'Pat… zut !', 'Mettre l''adversaire pat alors qu''on avait 5 points de matériel d''avance ou plus', 'echecs', '{"agg":"sum","stat":"stalemate_blunders","threshold":1}'::jsonb, true, 2202),
  ('ech_gourmand', 'grandmaitre', 5, 'Le gourmand', 'Prendre 50 pièces (cumul)', 'echecs', '{"agg":"sum","stat":"captures","threshold":50}'::jsonb, true, 2203),
  ('ech_partie_fleuve', 'grandmaitre', 6, 'Partie fleuve', 'Finir une manche de 40 coups ou plus', 'echecs', '{"agg":"max","stat":"max_moves","threshold":40}'::jsonb, true, 2204),
  ('ech_au_chaud', 'grandmaitre', 7, 'Bien au chaud', 'Roquer 10 fois (cumul)', 'echecs', '{"agg":"sum","stat":"castles","threshold":10}'::jsonb, true, 2205),
  ('ech_en_passant', 'grandmaitre', 8, 'En passant', 'Réussir une prise en passant', 'echecs', '{"agg":"sum","stat":"en_passants","threshold":1}'::jsonb, true, 2206),
  ('ech_nouvelle_reine', 'grandmaitre', 9, 'Nouvelle reine', 'Promouvoir 3 pions (cumul)', 'echecs', '{"agg":"sum","stat":"promotions","threshold":3}'::jsonb, true, 2207),
  ('ech_et_mat', 'grandmaitre', 10, 'Échec et mat !', 'Gagner 5 manches par échec et mat (cumul)', 'echecs', '{"agg":"sum","stat":"mates","threshold":5}'::jsonb, true, 2208),
  ('ech_mat_eclair', 'grandmaitre', 11, 'Mat éclair', 'Mater en 15 coups ou moins', 'echecs', '{"agg":"sum","stat":"fast_mates","threshold":1}'::jsonb, true, 2209),
  ('ech_grand_maitre', 'grandmaitre', 12, 'Grand Maître', 'Gagner 25 duels (cumul)', 'echecs', '{"agg":"sum","stat":"duel_wins","threshold":25}'::jsonb, true, 2210),
  ('kems_faux_kems', 'cowboy', 2, 'Faux Kems !', 'Crier « Kems ! » alors que ton partenaire n''a pas de carré', 'kems', '{"agg":"sum","stat":"false_kems","threshold":1}'::jsonb, true, 2300),
  ('kems_grille', 'cowboy', 3, 'Grillé !', 'Ton équipe subit 3 Contre-Kems réussis (cumul)', 'kems', '{"agg":"sum","stat":"countered","threshold":3}'::jsonb, true, 2301),
  ('kems_parano', 'cowboy', 4, 'Parano', 'Crier « Contre-Kems ! » à tort 3 fois (cumul)', 'kems', '{"agg":"sum","stat":"false_counters","threshold":3}'::jsonb, true, 2302),
  ('kems_collectionneur', 'cowboy', 5, 'Collectionneur', 'Réunir 10 carrés (cumul, un par manche au plus)', 'kems', '{"agg":"sum","stat":"squares","threshold":10}'::jsonb, true, 2303),
  ('kems_pilier_de_saloon', 'cowboy', 6, 'Pilier de saloon', 'Jouer 10 parties (cumul)', 'kems', '{"agg":"count","threshold":10}'::jsonb, true, 2304),
  ('kems_complices', 'cowboy', 7, 'Complices', 'Réussir 10 Kems avec son équipe (cumul)', 'kems', '{"agg":"sum","stat":"team_kems","threshold":10}'::jsonb, true, 2305),
  ('kems_oeil_de_lynx', 'cowboy', 8, 'Œil de lynx', 'Réussir 3 Contre-Kems en étant celui qui crie (cumul)', 'kems', '{"agg":"sum","stat":"counters_ok","threshold":3}'::jsonb, true, 2306),
  ('kems_eclair', 'cowboy', 9, 'Kems éclair', 'Réussir un Kems moins de 20 s après le début de la manche', 'kems', '{"agg":"sum","stat":"fast_kems","threshold":1}'::jsonb, true, 2307),
  ('kems_poker_face', 'cowboy', 10, 'Poker face', 'Gagner une partie sans erreur de son équipe et sans se faire contrer', 'kems', '{"agg":"sum","stat":"clean_win","threshold":1}'::jsonb, true, 2308),
  ('kems_double', 'cowboy', 11, 'Double Kems', 'Réussir un Double Kems (les deux coéquipiers ont un carré)', 'kems', '{"agg":"sum","stat":"double_kems","threshold":1}'::jsonb, true, 2309),
  ('kems_legende', 'cowboy', 12, 'Légende du saloon', 'Gagner 15 parties (cumul)', 'kems', '{"agg":"sum","stat":"won","threshold":15}'::jsonb, true, 2310),
  ('mg_plouf', 'golfer', 2, 'Plouf !', '3 balles à l''eau en une partie', 'mini-golf', '{"agg":"max","stat":"water","threshold":3}'::jsonb, true, 2400),
  ('mg_don_quichotte', 'golfer', 3, 'Don Quichotte', 'Se faire renvoyer la balle par le moulin 5 fois (cumul)', 'mini-golf', '{"agg":"sum","stat":"mill_hits","threshold":5}'::jsonb, true, 2401),
  ('mg_ramassee', 'golfer', 4, 'Balle ramassée', 'Ne pas rentrer la balle en 6 coups sur un trou', 'mini-golf', '{"agg":"sum","stat":"picked_up","threshold":1}'::jsonb, true, 2402),
  ('mg_habitue', 'golfer', 5, 'Habitué du parcours', 'Jouer 10 parties (cumul)', 'mini-golf', '{"agg":"count","threshold":10}'::jsonb, true, 2403),
  ('mg_regulier', 'golfer', 6, 'Régulier', '50 trous finis dans le par ou mieux (cumul)', 'mini-golf', '{"agg":"sum","stat":"pars","threshold":50}'::jsonb, true, 2404),
  ('mg_petit_oiseau', 'golfer', 7, 'Petit oiseau', '10 trous finis en un coup de moins que le par (cumul)', 'mini-golf', '{"agg":"sum","stat":"birdies","threshold":10}'::jsonb, true, 2405),
  ('mg_par_la_bande', 'golfer', 8, 'Par la bande', 'Rentrer la balle après 3 rebonds ou plus dans le même coup', 'mini-golf', '{"agg":"max","stat":"bank_shot","threshold":1}'::jsonb, true, 2406),
  ('mg_trou_en_un', 'golfer', 9, 'Trou en un !', 'Rentrer la balle du premier coup', 'mini-golf', '{"agg":"max","stat":"aces","threshold":1}'::jsonb, true, 2407),
  ('mg_sous_le_par', 'golfer', 10, 'Sous le par', 'Finir un parcours de 9 trous sous le par', 'mini-golf', '{"agg":"max","stat":"under_par","threshold":1}'::jsonb, true, 2408),
  ('mg_sans_bavure', 'golfer', 11, 'Sans bavure', '9 trous sans jamais dépasser le par', 'mini-golf', '{"agg":"max","stat":"clean_card","threshold":1}'::jsonb, true, 2409),
  ('mg_legende', 'golfer', 12, 'Légende du green', 'Gagner 15 parties (cumul)', 'mini-golf', '{"agg":"sum","stat":"won","threshold":15}'::jsonb, true, 2410),
  ('party_coupure_pub', 'host', 2, 'Coupure pub', 'S''arrêter sur 3 Pages de pub en une partie', 'dede-party', '{"agg":"max","stat":"pubs","threshold":3}'::jsonb, true, 2500),
  ('party_fauche', 'host', 3, 'Fauché', 'Tomber à 0 pièce', 'dede-party', '{"agg":"sum","stat":"broke","threshold":1}'::jsonb, true, 2501),
  ('party_ciel_couvert', 'host', 4, 'Ciel couvert', 'Finir une partie sans aucune étoile', 'dede-party', '{"agg":"sum","stat":"no_star","threshold":1}'::jsonb, true, 2502),
  ('party_fidele', 'host', 5, 'Fidèle au poste', 'Jouer 5 parties (cumul)', 'dede-party', '{"agg":"count","threshold":5}'::jsonb, true, 2503),
  ('party_tirelire', 'host', 6, 'Tirelire', 'Gagner 300 pièces (cumul)', 'dede-party', '{"agg":"sum","stat":"coins_earned","threshold":300}'::jsonb, true, 2504),
  ('party_chouchou', 'host', 7, 'Chouchou de Dédé', 'Ouvrir 10 enveloppes surprise (cumul)', 'dede-party', '{"agg":"sum","stat":"envelopes","threshold":10}'::jsonb, true, 2505),
  ('party_pile_dessus', 'host', 8, 'Pile dessus', 'Acheter une étoile en s''arrêtant exactement sur sa case', 'dede-party', '{"agg":"sum","stat":"star_exact","threshold":1}'::jsonb, true, 2506),
  ('party_triple', 'host', 9, 'Le triplé', 'Gagner 3 mini-jeux d''affilée', 'dede-party', '{"agg":"max","stat":"mg_streak","threshold":3}'::jsonb, true, 2507),
  ('party_constellation', 'host', 10, 'Constellation', 'Finir une partie avec 4 étoiles ou plus', 'dede-party', '{"agg":"max","stat":"stars","threshold":4}'::jsonb, true, 2508),
  ('party_carton_plein', 'host', 11, 'Carton plein', 'Gagner la partie en étant aussi Roi des mini-jeux', 'dede-party', '{"agg":"sum","stat":"win_mvp","threshold":1}'::jsonb, true, 2509),
  ('party_star_ecran', 'host', 12, 'Star du petit écran', 'Gagner 10 parties (cumul)', 'dede-party', '{"agg":"sum","stat":"won","threshold":10}'::jsonb, true, 2510),
  ('gen_touche_a_tout', null, null, 'Touche-à-tout', 'Jouer à 10 jeux différents', null, '{"agg":"special","name":"distinct_games","threshold":10}'::jsonb, true, 221),
  ('gen_polyvalent', null, null, 'Polyvalent', 'Gagner dans 5 jeux différents', null, '{"agg":"special","name":"distinct_win_games","threshold":5}'::jsonb, true, 222),
  ('gen_pilier', null, null, 'Pilier de soirée', 'Participer à 20 soirées', null, '{"agg":"special","name":"soirees","threshold":20}'::jsonb, true, 223),
  ('gen_noctambule', null, null, 'Noctambule', 'Finir 3 soirées après 2 h du matin', null, '{"agg":"special","name":"late_soirees","threshold":3}'::jsonb, true, 224),
  ('gen_marathon', null, null, 'Marathonien', 'Jouer 8 parties dans une même soirée', null, '{"agg":"special","name":"games_in_soiree","threshold":8}'::jsonb, true, 225),
  ('gen_hote', null, null, 'Hôte de la maison', 'Organiser 5 soirées menées à leur terme', null, '{"agg":"special","name":"hosted","threshold":5}'::jsonb, true, 226),
  ('gen_grande_tablee', null, null, 'Grande tablée', 'Participer à une soirée de 6 joueurs ou plus', null, '{"agg":"special","name":"biggest_table","threshold":6}'::jsonb, true, 227),
  ('gen_pipelette', null, null, 'Pipelette', 'Envoyer 50 stickers dans le chat', null, '{"agg":"special","name":"stickers","threshold":50}'::jsonb, true, 228),
  ('gen_garde_robe', null, null, 'Garde-robe', 'Débloquer 5 tenues', null, '{"agg":"special","name":"tenues","threshold":5}'::jsonb, true, 229),
  ('gen_collectionneur', null, null, 'Collectionneur', 'Compléter une planche de tenue (les 11 trophées)', null, '{"agg":"special","name":"full_board","threshold":11}'::jsonb, true, 230),
  ('gen_madame_irma', null, null, 'Madame Irma', '3 bons pronostics d''affilée', null, '{"agg":"special","name":"prono_streak","threshold":3}'::jsonb, true, 231),
  ('gen_esprit_noel', null, null, 'Esprit de Noël', 'Ouvrir 12 cases du calendrier de l''Avent', null, '{"agg":"special","name":"advent","threshold":12}'::jsonb, true, 232)
on conflict (id) do update
  set tenue_id = excluded.tenue_id, slot = excluded.slot, name = excluded.name, description = excluded.description,
      game_id = excluded.game_id, rule = excluded.rule, active = excluded.active, sort_order = excluded.sort_order;

-- ---- Grants ----------------------------------------------------------------------

revoke all on function public._tr_val(public.match_players, text) from public, anon, authenticated;
revoke all on function public._tr_ok(public.match_players, jsonb) from public, anon, authenticated;
revoke all on function public._tr_target(jsonb) from public, anon, authenticated;
revoke all on function public.evaluate_trophy(uuid, text) from public, anon, authenticated;
revoke all on function public._tr_progress(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.evaluate_trophies(uuid, text) from public, anon, authenticated;
revoke all on function public._after_finish_trophies(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public._tenue_slot_ok(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._trophy_reward_tenue() from public, anon, authenticated;
revoke all on function public.my_trophy_progress(text) from public, anon;
grant execute on function public.my_trophy_progress(text) to authenticated;


-- ===== features\weekly.sql =====
-- =============================================================================
-- CLASSEMENT DE LA SEMAINE + « VICTORIEUX DE LA SEMAINE » — idempotent, après schema.sql.
-- Aucune table : tout est dérivé de match_players / matches (parties terminées).
--
-- Semaine = lundi 00:00 -> dimanche 23:59:59 (fuseau Europe/Paris), comme daily_week_board.
-- Date d'une victoire = matches.finished_at. Une semaine appartient au lundi qui l'ouvre.
-- Classement : victoires desc, puis points desc, puis moins de parties jouées ; rang « compétition ».
-- Champion d'une semaine TERMINÉE : le(s) joueur(s) ayant le plus de victoires (tous jeux),
-- au moins 1 victoire ; ex-aequo = tous champions. La semaine en cours n'en désigne jamais.
-- =============================================================================

create index if not exists matches_finished_at_idx on public.matches(finished_at) where status = 'finished';

-- Lundi (date Paris) de la semaine en cours.
create or replace function public._week_start_now()
returns date language sql stable
as $$ select date_trunc('week', now() at time zone 'Europe/Paris')::date $$;

-- Champions de chaque semaine terminée (jeux confondus, ex-aequo inclus).
-- Ne renvoie que les champions des semaines terminées : (week_start lundi, profile_id, wins).
create or replace function public._weekly_champions_all()
returns table (week_start date, profile_id uuid, wins integer)
language sql stable security definer
set search_path = public, extensions
as $$
  with w as (
    select date_trunc('week', m.finished_at at time zone 'Europe/Paris')::date as ws,
           x.profile_id, count(*)::int as wins
      from public.match_players x
      join public.matches m on m.id = x.match_id and m.status = 'finished' and m.finished_at is not null
      join public.profiles gp on gp.id = x.profile_id and not gp.is_guest  -- invités exclus (guest.sql)
     where x.won
     group by 1, 2
  ), top as (
    select w.*, max(w.wins) over (partition by w.ws) as best from w
  )
  select t.ws, t.profile_id, t.wins
    from top t
   where t.wins = t.best and t.wins >= 1 and t.ws < public._week_start_now()
$$;

-- Classement de la semaine en cours (général si p_game est null, sinon pour ce jeu).
-- -> {week_start, week_end (dimanche), ends_at (timestamptz, fin de semaine),
--     rows:[{profile_id, slug, nickname, equipped_expression, equipped_tenue, level, wins, games_played, points, rank}],
--     last_week:{week_start, week_end, wins, champions:[{profile_id, slug, nickname, equipped_tenue}]}|null}
-- rows contient tous les joueurs (0 partie incluse), le front filtre.
create or replace function public.leaderboard_week(p_game text default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_start date := public._week_start_now();
  v_from  timestamptz := v_start::timestamp at time zone 'Europe/Paris';
  v_to    timestamptz := (v_start + 7)::timestamp at time zone 'Europe/Paris';
  v_last  date;
begin
  perform public._require_profile();
  select max(c.week_start) into v_last from public._weekly_champions_all() c;
  return jsonb_build_object(
    'week_start', v_start,
    'week_end', v_start + 6,
    'ends_at', v_to,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'profile_id', r.id, 'slug', r.slug, 'nickname', r.nickname,
               'equipped_expression', r.equipped_expression, 'equipped_tenue', r.equipped_tenue,
               'level', public.level_for_xp(r.xp), 'wins', r.wins, 'games_played', r.games,
               'points', r.pts, 'rank', r.rk) order by r.rk, r.sort_order)
        from (
          select a.*, rank() over (order by a.wins desc, a.pts desc, a.games asc) as rk
            from (
              select p.id, p.slug, p.nickname, p.equipped_expression, p.equipped_tenue, p.xp, p.sort_order,
                     count(mp.profile_id) filter (where mp.won)::int as wins,
                     count(mp.profile_id)::int as games,
                     coalesce(sum(mp.points), 0)::int as pts
                from public.profiles p
                left join (
                  select x.profile_id, x.won, x.points
                    from public.match_players x
                    join public.matches m on m.id = x.match_id
                   where m.status = 'finished' and m.finished_at >= v_from and m.finished_at < v_to
                     and (p_game is null or x.game_id = p_game)
                ) mp on mp.profile_id = p.id
               where not p.is_guest  -- invités exclus (guest.sql)
               group by p.id
            ) a
        ) r), '[]'::jsonb),
    'last_week', case when v_last is null then null else (
      select jsonb_build_object(
               'week_start', v_last, 'week_end', v_last + 6, 'wins', max(c.wins),
               'champions', jsonb_agg(jsonb_build_object(
                  'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
                  order by p.sort_order))
        from public._weekly_champions_all() c join public.profiles p on p.id = c.profile_id
       where c.week_start = v_last) end);
end $$;

-- Semaines gagnées (« Victorieux de la semaine »), plus récentes d'abord.
-- p_profile = un joueur -> ses semaines ; null -> toutes les semaines gagnées par tous (hall of fame).
-- -> [{week_start, week_end, wins, profile_id, slug, nickname, equipped_tenue}]
create or replace function public.weekly_champions(p_profile uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  perform public._require_profile();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'week_start', c.week_start, 'week_end', c.week_start + 6, 'wins', c.wins,
             'profile_id', p.id, 'slug', p.slug, 'nickname', p.nickname, 'equipped_tenue', p.equipped_tenue)
             order by c.week_start desc, p.sort_order)
      from public._weekly_champions_all() c
      join public.profiles p on p.id = c.profile_id
     where p_profile is null or c.profile_id = p_profile), '[]'::jsonb);
end $$;

revoke all on function public._week_start_now() from public, anon, authenticated;
revoke all on function public._weekly_champions_all() from public, anon, authenticated;
revoke all on function public.leaderboard_week(text) from public, anon;
revoke all on function public.weekly_champions(uuid) from public, anon;
grant execute on function public.leaderboard_week(text) to authenticated;
grant execute on function public.weekly_champions(uuid) to authenticated;
