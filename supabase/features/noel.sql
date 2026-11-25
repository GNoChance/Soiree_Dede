-- =============================================================================
-- ÉVÉNEMENT DE NOËL « Noël chez Dédé » — idempotent, chargé APRÈS hotte.sql (ordre alphabétique).
-- Spec : docs/superpowers/specs/2026-11-24-noel-event-design.md
-- Édition 'noel-<année>' : du 1er décembre au 6 janvier suivant (dates de Paris).
-- Flocons ❄️ DÉRIVÉS de l'historique (rien à saisir, recalculables) :
--   3 missions du jour (30 chacune, tirage identique pour toute la bande), bonus soirée (30),
--   Hotte du jour (6 par bonne réponse), séries de 3/7/14/21 jours (+30/+70/+140/+210, une fois).
-- Date courante : _season_now() (surchargée par les tests).
-- =============================================================================

-- Date de Paris « maintenant ».
create or replace function public._noel_day()
returns date language sql stable security definer
set search_path = public, extensions
as $$ select (public._season_now() at time zone 'Europe/Paris')::date $$;

-- Édition qui contient ce jour ('noel-2026' du 2026-12-01 au 2027-01-06), sinon null.
create or replace function public._noel_key_for(p_day date)
returns text language sql immutable
as $$
  select case
    when extract(month from p_day) = 12 then 'noel-' || extract(year from p_day)::int
    when extract(month from p_day) = 1 and extract(day from p_day) <= 6 then 'noel-' || (extract(year from p_day)::int - 1)
  end
$$;

create or replace function public._noel_bounds(p_key text, out starts_on date, out ends_on date)
language plpgsql immutable
as $$
declare y integer;
begin
  if p_key is null or p_key !~ '^noel-[0-9]{4}$' then return; end if;
  y := substring(p_key from 6)::int;
  starts_on := make_date(y, 12, 1);
  ends_on := make_date(y + 1, 1, 6);
end $$;

-- Candidats d'un slot, du plus au moins prioritaire : chaque id est répété selon son poids et
-- trié par md5 ; on garde sa 1re occurrence (un poids plus fort sort plus souvent en tête).
create or replace function public._noel_order(p_key text, p_day date, p_slot integer, p_ids text[], p_w integer[])
returns text[] language sql immutable
as $$
  select array_agg(id order by h, id) from (
    select u.id, min(md5(p_key || p_day::text || p_slot::text || u.id || k::text)) h
      from unnest(p_ids, p_w) u(id, w), generate_series(1, u.w) k
     group by u.id) x
$$;

-- Mission « surprise » (slot 3) de chaque jour de l'édition, dans l'ordre des jours. Contraintes :
-- s_advent jusqu'au 24 décembre ; s_challenge et s_shop au plus 1 par semaine ISO, s_card au plus 2 ;
-- jamais la même que la veille.
create or replace function public._noel_surprises(p_key text)
returns text[] language plpgsql stable
as $$
declare
  b      record;
  d      date;
  v_out  text[] := '{}';
  v_days date[] := '{}';
  v_prev text;
  v_pick text;
  c      text;
  v_wk   integer;
begin
  select * into b from public._noel_bounds(p_key);
  if b.starts_on is null then return v_out; end if;
  d := b.starts_on;
  while d <= b.ends_on loop
    v_pick := null;
    foreach c in array public._noel_order(p_key, d, 3,
        array['s_advent', 's_combo', 's_d550', 's_card', 's_challenge', 's_shop'], array[4, 2, 1, 1, 1, 1]) loop
      continue when c = v_prev;
      continue when c = 's_advent' and not (extract(month from d) = 12 and extract(day from d) <= 24);
      select count(*) into v_wk from unnest(v_out, v_days) u(m, dd)
       where u.m = c and date_trunc('week', u.dd) = date_trunc('week', d);
      continue when c in ('s_challenge', 's_shop') and v_wk >= 1;
      continue when c = 's_card' and v_wk >= 2;
      v_pick := c;
      exit;
    end loop;
    v_pick := coalesce(v_pick, case when v_prev = 's_combo' then 's_d550' else 's_combo' end);
    v_out := v_out || v_pick;
    v_days := v_days || d;
    v_prev := v_pick;
    d := d + 1;
  end loop;
  return v_out;
end $$;

-- Slots 1 (Défi) et 2 (Hotte) d'un jour.
create or replace function public._noel_slot12(p_key text, p_day date)
returns text[] language sql immutable
as $$
  select array[
    (public._noel_order(p_key, p_day, 1, array['d_finish', 'd_400', 'd_beat', 'd_morning'], array[2, 2, 1, 1]))[1],
    (public._noel_order(p_key, p_day, 2, array['h_play', 'h_3', 'h_4', 'h_fast'], array[1, 3, 2, 1]))[1]]
$$;

-- Les 3 missions du jour (identiques pour toute la bande). Hors édition : tableau vide.
create or replace function public._noel_missions(p_key text, p_day date)
returns text[] language plpgsql stable
as $$
declare b record;
begin
  select * into b from public._noel_bounds(p_key);
  if b.starts_on is null or p_day < b.starts_on or p_day > b.ends_on then return '{}'; end if;
  return public._noel_slot12(p_key, p_day) || (public._noel_surprises(p_key))[p_day - b.starts_on + 1];
end $$;

-- Mission réussie par ce joueur ce jour-là (date de Paris) ? Sources figées une fois écrites.
create or replace function public._noel_mission_done(p_profile uuid, p_mission text, p_day date)
returns boolean language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  d public.daily_runs%rowtype;
  h public.hotte_runs%rowtype;
begin
  if p_mission like 'd\_%' escape '\' or p_mission in ('s_d550', 's_combo') then
    select * into d from public.daily_runs where profile_id = p_profile and day = p_day and finished_at is not null;
  end if;
  if p_mission like 'h\_%' escape '\' or p_mission = 's_combo' then
    select * into h from public.hotte_runs where profile_id = p_profile and day = p_day and finished_at is not null;
  end if;
  return case p_mission
    when 'd_finish' then d.profile_id is not null
    when 'd_400' then d.profile_id is not null and d.score >= 400
    when 's_d550' then d.profile_id is not null and d.score >= 550
    when 'd_beat' then d.profile_id is not null and d.score > coalesce(
      (select y.score from public.daily_runs y where y.profile_id = p_profile and y.day = p_day - 1 and y.finished_at is not null), -1)
    when 'd_morning' then d.profile_id is not null and (d.finished_at at time zone 'Europe/Paris')::time < time '12:00'
    when 'h_play' then h.profile_id is not null
    when 'h_3' then h.profile_id is not null and h.score >= 3
    when 'h_4' then h.profile_id is not null and h.score >= 4
    when 'h_fast' then h.profile_id is not null and jsonb_array_length(h.answers) = 5
                       and h.last_answer_at - h.started_at < interval '60 seconds'
    when 's_combo' then d.profile_id is not null and h.profile_id is not null
    when 's_advent' then exists (select 1 from public.advent_opens a where a.profile_id = p_profile and a.day = p_day)
    when 's_card' then exists (select 1 from public.custom_cards c where c.author_id = p_profile
                                  and (c.created_at at time zone 'Europe/Paris')::date = p_day)
    when 's_challenge' then exists (select 1 from public.coin_challenges c where c.challenger_id = p_profile
                                       and (c.created_at at time zone 'Europe/Paris')::date = p_day)
    when 's_shop' then exists (select 1 from public.item_purchases i where i.profile_id = p_profile
                                  and (i.bought_at at time zone 'Europe/Paris')::date = p_day)
    else false
  end;
end $$;

-- Bonus soirée : une partie terminée ce jour-là (date de Paris) avec au moins 2 joueurs.
create or replace function public._noel_soiree_bonus(p_profile uuid, p_day date)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.match_players mp join public.matches m on m.id = mp.match_id
     where mp.profile_id = p_profile and m.status = 'finished' and m.finished_at is not null
       and (m.finished_at at time zone 'Europe/Paris')::date = p_day
       and (select count(*) from public.match_players x where x.match_id = m.id) >= 2)
$$;

-- Flocons d'un joueur sur une édition (jours jusqu'à aujourd'hui ou la fin de l'édition).
-- -> {total, by_day:{"AAAA-MM-JJ": n}, streak:{current, best}, streak_bonus}
create or replace function public._noel_flakes(p_profile uuid, p_key text)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  b        record;
  v_today  date := public._noel_day();
  v_last   date;
  v_sur    text[];
  d        date;
  m        text;
  v_n      integer;
  v_bonus  boolean;
  v_day    integer;
  v_by     jsonb := '{}'::jsonb;
  v_sum    integer := 0;
  v_run    integer := 0;
  v_prev   integer := 0;
  v_best   integer := 0;
  v_cur    integer := 0;
  v_sb     integer := 0;
  v_isday  boolean := false;
  v_soir   date[];
  v_act    date[];
  v_hot    jsonb;
begin
  select * into b from public._noel_bounds(p_key);
  if b.starts_on is null or exists (select 1 from public.profiles where id = p_profile and is_guest) then
    return jsonb_build_object('total', 0, 'by_day', v_by, 'streak', jsonb_build_object('current', 0, 'best', 0), 'streak_bonus', 0);
  end if;
  v_last := least(v_today, b.ends_on);
  v_sur := public._noel_surprises(p_key);
  -- Préchargements (une requête chacun au lieu d'une par jour) : jours à bonus soirée, scores de Hotte,
  -- jours où le joueur a fait quelque chose qui peut valider une mission (les autres jours valent 0).
  select coalesce(array_agg(distinct (m.finished_at at time zone 'Europe/Paris')::date), '{}') into v_soir
    from public.match_players mp join public.matches m on m.id = mp.match_id
   where mp.profile_id = p_profile and m.status = 'finished' and m.finished_at is not null
     and (m.finished_at at time zone 'Europe/Paris')::date between b.starts_on and v_last
     and (select count(*) from public.match_players x where x.match_id = m.id) >= 2;
  select coalesce(jsonb_object_agg(h.day::text, h.score), '{}'::jsonb) into v_hot
    from public.hotte_runs h where h.profile_id = p_profile and h.finished_at is not null and h.day between b.starts_on and v_last;
  select coalesce(array_agg(distinct x.d), '{}') into v_act from (
    select day d from public.daily_runs where profile_id = p_profile and finished_at is not null and day between b.starts_on and v_last
    union select day from public.hotte_runs where profile_id = p_profile and finished_at is not null and day between b.starts_on and v_last
    union select day from public.advent_opens where profile_id = p_profile and day between b.starts_on and v_last
    union select (created_at at time zone 'Europe/Paris')::date from public.custom_cards where author_id = p_profile
    union select (created_at at time zone 'Europe/Paris')::date from public.coin_challenges where challenger_id = p_profile
    union select (bought_at at time zone 'Europe/Paris')::date from public.item_purchases where profile_id = p_profile) x
   where x.d between b.starts_on and v_last;
  d := b.starts_on;
  while d <= v_last loop
    v_n := 0;
    if d = any(v_act) then
      foreach m in array (public._noel_slot12(p_key, d) || v_sur[d - b.starts_on + 1]) loop
        if public._noel_mission_done(p_profile, m, d) then v_n := v_n + 1; end if;
      end loop;
    end if;
    v_bonus := d = any(v_soir);
    v_day := 30 * v_n + case when v_bonus then 30 else 0 end + 6 * coalesce((v_hot->>d::text)::int, 0);
    if v_day > 0 then v_by := v_by || jsonb_build_object(d::text, v_day); end if;
    v_sum := v_sum + v_day;
    v_isday := v_n > 0 or v_bonus;
    v_prev := v_run;
    v_run := case when v_isday then v_run + 1 else 0 end;
    v_best := greatest(v_best, v_run);
    d := d + 1;
  end loop;
  -- Série en cours : le jour d'aujourd'hui pas encore joué ne la casse pas.
  v_cur := case when v_isday then v_run when v_last = v_today then v_prev else 0 end;
  v_sb := case when v_best >= 3 then 30 else 0 end + case when v_best >= 7 then 70 else 0 end
        + case when v_best >= 14 then 140 else 0 end + case when v_best >= 21 then 210 else 0 end;
  return jsonb_build_object('total', v_sum + v_sb, 'by_day', v_by,
                            'streak', jsonb_build_object('current', v_cur, 'best', v_best), 'streak_bonus', v_sb);
end $$;

-- =============================================================================
-- PASS DE NOËL (30 paliers de 150 ❄️) ET GRANDE HOTTE DE LA BANDE (5 paliers collectifs)
-- Récompenses attribuées par _noel_claim (idempotent) ; un palier dont la récompense n'est pas
-- encore livrée (effets du lot 2, tenues du lot 3) n'est PAS inscrit : la synchro le rattrapera.
-- Tenues attendues (lot 3) : 'pere_noel' (palier 30 du pass), 'pyjama_noel' (palier 5 collectif).
-- =============================================================================

create table if not exists public.noel_claims (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event_key  text not null,
  kind       text not null check (kind in ('pass', 'band')),
  tier       integer not null,
  coins      integer not null default 0,
  item_id    text references public.items(id) on delete set null,
  claimed_at timestamptz not null default now(),
  primary key (profile_id, event_key, kind, tier)
);
alter table public.noel_claims enable row level security;

-- Récompense d'un palier du pass -> {coins, item_id, ready}
create or replace function public._noel_pass_reward(p_tier integer)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_coins integer := case p_tier
    when 1 then 30 when 2 then 30 when 4 then 40 when 5 then 40 when 7 then 50 when 8 then 50
    when 11 then 60 when 13 then 60 when 14 then 70 when 16 then 70 when 17 then 80 when 19 then 80
    when 21 then 90 when 23 then 90 when 24 then 100 when 26 then 100 when 28 then 100 when 29 then 100
    when 30 then 200 else 0 end;
  v_item text := case p_tier
    when 3 then 't_lutin_chef' when 6 then 'cb_papier_cadeau' when 9 then 'd_sucre_orge' when 10 then 'fx_neige'
    when 12 then 'k_noel_traineau' when 15 then 'gb_boule_noel' when 18 then 'fx_traineau' when 20 then 'bb_buche'
    when 22 then 'm_guirlande' when 25 then 'fx_sapins' when 27 then 'f_noel_houx' when 30 then 't_acharne_noel' end;
  v_ready boolean;
begin
  v_ready := p_tier between 1 and 30
    and (v_item is null or exists (select 1 from public.items where id = v_item))
    and (p_tier <> 30 or exists (select 1 from public.tenues where id = 'pere_noel'));
  return jsonb_build_object('coins', v_coins, 'item_id', v_item, 'ready', v_ready);
end $$;

create or replace function public._noel_band_tier(p_total integer)
returns integer language sql immutable
as $$
  select case when p_total >= 38000 then 5 when p_total >= 30000 then 4 when p_total >= 22000 then 3
              when p_total >= 14000 then 2 when p_total >= 6000 then 1 else 0 end
$$;

-- Récompense d'un palier collectif -> {coins, item_id, ready}. Palier 5 (Gros Lot) : 500 pièces + trophée
-- « Esprit d'équipe <année> » (cf. _noel_claim) + thème secret du Réveillon + plaque de l'album ; la tenue
-- Pyjama de Noël est débloquée par ce trophée dès que son art existe (tenues.sql), sans attendre ici.
create or replace function public._noel_band_reward(p_tier integer)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_coins integer := case p_tier when 1 then 100 when 4 then 250 when 5 then 500 else 0 end;
  v_item text := case p_tier when 2 then 'fx_salon_neige' when 3 then 'f_noel_aurore' when 4 then 't_bande_noel' end;
begin
  return jsonb_build_object('coins', v_coins, 'item_id', v_item,
    'ready', p_tier between 1 and 5
             and (v_item is null or exists (select 1 from public.items where id = v_item)));
end $$;

-- Ancienne version (remplacée par _noel_all_flakes / _noel_band_override).
drop function if exists public._noel_band_total(text);

-- ❄️ de chaque membre de la bande, calculés UNE fois : {profile_id: total} (membres à 0 omis).
create or replace function public._noel_all_flakes(p_key text)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(x.id, x.f) filter (where x.f > 0), '{}'::jsonb)
    from (select p.id, (public._noel_flakes(p.id, p_key)->>'total')::int f
            from public.profiles p where not p.is_guest) x
$$;

-- Total imposé de la Grande Hotte (null = vraie somme). Crochet pour les tests (remplacé par eux).
create or replace function public._noel_band_override(p_key text)
returns integer language sql stable
as $$ select null::integer $$;

-- -> {total, tier, contributors:[{profile_id, flakes}] (> 0, du plus grand au plus petit)}
create or replace function public._noel_band(p_key text, p_all jsonb)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_total integer := coalesce(public._noel_band_override(p_key),
                              (select coalesce(sum(v::int), 0)::int from jsonb_each_text(p_all) e(k, v)));
begin
  return jsonb_build_object('total', v_total, 'tier', public._noel_band_tier(v_total),
    'contributors', coalesce((
      select jsonb_agg(jsonb_build_object('profile_id', e.k, 'flakes', e.v::int) order by e.v::int desc, e.k)
        from jsonb_each_text(p_all) e(k, v)), '[]'::jsonb));
end $$;
drop function if exists public._noel_band(text);

-- Version autonome (recalcule tout) : pour les appels isolés et les tests.
create or replace function public._noel_claim(p_profile uuid, p_key text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
begin
  return public._noel_claim(p_profile, p_key,
    (public._noel_flakes(p_profile, p_key)->>'total')::int,
    (public._noel_band(p_key, public._noel_all_flakes(p_key))->>'total')::int);
end $$;

-- Attribue les paliers atteints et prêts (pass + Grande Hotte si ≥ 400 ❄️ apportés), à partir des
-- totaux déjà calculés par l'appelant (mes ❄️, total de la bande).
-- -> [{kind, tier, coins, item_id, compensated}] des NOUVELLES récompenses.
create or replace function public._noel_claim(p_profile uuid, p_key text, p_me integer, p_band integer)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_new   jsonb := '[]'::jsonb;
  v_flk   integer := coalesce(p_me, 0);
  v_kind  text;
  v_top   integer;
  t       integer;
  v_rw    jsonb;
  v_coins integer;
  v_item  text;
  v_comp  boolean;
begin
  if exists (select 1 from public.profiles where id = p_profile and is_guest) then return v_new; end if;
  foreach v_kind in array array['pass', 'band'] loop
    if v_kind = 'pass' then
      v_top := least(30, v_flk / 150);
    elsif v_flk >= 400 then
      v_top := public._noel_band_tier(coalesce(p_band, 0));
    else
      v_top := 0;
    end if;
    for t in 1..v_top loop
      continue when exists (select 1 from public.noel_claims c where c.profile_id = p_profile and c.event_key = p_key
                                                                 and c.kind = v_kind and c.tier = t);
      v_rw := case when v_kind = 'pass' then public._noel_pass_reward(t) else public._noel_band_reward(t) end;
      continue when not (v_rw->>'ready')::boolean;
      v_coins := (v_rw->>'coins')::int;
      v_item := v_rw->>'item_id';
      v_comp := false;
      if v_item is not null and not public._grant_item(p_profile, v_item) then
        v_item := null;
        v_comp := true;
        v_coins := v_coins + 100;
      end if;
      insert into public.noel_claims(profile_id, event_key, kind, tier, coins, item_id)
      values (p_profile, p_key, v_kind, t, v_coins, v_item) on conflict do nothing;
      continue when not found;
      perform public._ledger_add(p_profile, v_coins, 'event_' || v_kind, p_key || ':' || t);
      -- Gros Lot : trophée daté de l'édition (absent du catalogue = rien).
      if v_kind = 'band' and t = 5 then
        perform public.evaluate_trophy(p_profile, 'gen_esprit_equipe_' || split_part(p_key, '-', 2));
      end if;
      v_new := v_new || jsonb_build_object('kind', v_kind, 'tier', t, 'coins', v_coins, 'item_id', v_item, 'compensated', v_comp);
    end loop;
  end loop;
  return v_new;
end $$;

-- État de l'événement pour le joueur (synchro des récompenses incluse).
-- phase : before (novembre) | live (1er déc → 6 janv) | over (7 → 13 janv) | off.
create or replace function public.noel_state()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_member();
  v_day   date := public._noel_day();
  v_key   text := public._noel_key_for(v_day);
  v_phase text;
  b       record;
  v_flk   jsonb;
  v_tot   integer;
  v_tier  integer;
  v_band  jsonb;
  v_ms    jsonb := '[]'::jsonb;
  v_new   jsonb := '[]'::jsonb;
  h       public.hotte_runs%rowtype;
  m       text;
begin
  if v_key is not null then
    v_phase := 'live';
  elsif extract(month from v_day) = 1 and extract(day from v_day) between 7 and 13 then
    v_phase := 'over';
    v_key := 'noel-' || (extract(year from v_day)::int - 1);
  elsif extract(month from v_day) = 11 then
    v_phase := 'before';
    v_key := 'noel-' || extract(year from v_day)::int;
  else
    v_phase := 'off';
  end if;
  select * into b from public._noel_bounds(v_key);

  if v_phase in ('live', 'over') then
    -- Une Hotte qui vient d'expirer compte tout de suite (avant le calcul des ❄️).
    perform public._hotte_close_expired();
    -- Chaque membre n'est calculé qu'une fois : mes ❄️ détaillés + le total de chacun.
    v_flk := public._noel_flakes(v_me, v_key);
    v_band := public._noel_band(v_key, public._noel_all_flakes(v_key));
    v_new := public._noel_claim(v_me, v_key, (v_flk->>'total')::int, (v_band->>'total')::int);
  else
    v_flk := jsonb_build_object('total', 0, 'streak', jsonb_build_object('current', 0, 'best', 0));
    v_band := jsonb_build_object('total', 0, 'tier', 0, 'contributors', '[]'::jsonb);
  end if;
  v_tot := (v_flk->>'total')::int;
  v_tier := least(30, v_tot / 150);

  if v_phase = 'live' then
    foreach m in array public._noel_missions(v_key, v_day) loop
      v_ms := v_ms || jsonb_build_object('id', m, 'done', public._noel_mission_done(v_me, m, v_day));
    end loop;
    select * into h from public.hotte_runs where profile_id = v_me and day = v_day;
  end if;

  return jsonb_build_object(
    'phase', v_phase, 'key', v_key, 'day', v_day, 'starts_on', b.starts_on, 'ends_on', b.ends_on,
    'missions', v_ms,
    'soiree_bonus', v_phase = 'live' and public._noel_soiree_bonus(v_me, v_day),
    'hotte', jsonb_build_object(
      'status', case when h.profile_id is null then 'todo' when h.finished_at is null then 'running' else 'done' end,
      'score', coalesce(h.score, 0), 'flakes', 6 * coalesce(h.score, 0)),
    'flakes', v_tot, 'tier', v_tier, 'next_at', case when v_tier < 30 then (v_tier + 1) * 150 end,
    'streak', v_flk->'streak',
    'band', v_band || jsonb_build_object('me', v_tot, 'eligible', v_tot >= 400),
    'new_claims', v_new);
end $$;

-- A-t-il reçu le Gros Lot d'une édition (palier 5 de la Grande Hotte) ? Thème secret du Réveillon.
create or replace function public._noel_gros_lot_ok(p_profile uuid)
returns boolean language sql stable security definer
set search_path = public, extensions
as $$
  select exists (select 1 from public.noel_claims where profile_id = p_profile and kind = 'band' and tier = 5)
$$;

-- Gros Lot de la dernière édition (album, Réveillon) -> {key, year, reached, mine, total, contributors}.
-- Dernière édition = celle de décembre de cette année (en décembre) ou de l'an dernier (janvier → novembre).
create or replace function public.noel_gros_lot()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_member();
  v_day  date := public._noel_day();
  v_year integer := extract(year from v_day)::int - case when extract(month from v_day) = 12 then 0 else 1 end;
  v_key  text := 'noel-' || v_year;
  v_band jsonb := public._noel_band(v_key, public._noel_all_flakes(v_key));
begin
  return jsonb_build_object('key', v_key, 'year', v_year,
    'reached', (v_band->>'tier')::int >= 5,
    'mine', exists (select 1 from public.noel_claims where profile_id = v_me and event_key = v_key and kind = 'band' and tier = 5),
    'total', (v_band->>'total')::int, 'contributors', v_band->'contributors');
end $$;

-- Aperçu admin (LECTURE SEULE, rien n'est écrit) : l'état de l'événement comme au jour p_day
-- (missions de ce jour, Hotte « à faire », aucune récompense) + les 5 manches de la Hotte de ce jour
-- AVEC les réponses (le front corrige en local). -> {state, rounds}
create or replace function public.noel_preview(p_day date)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me   uuid := public._require_admin();
  v_key  text := public._noel_key_for(p_day);
  b      record;
  v_flk  jsonb;
  v_band jsonb;
  v_tot  integer;
  v_tier integer;
  v_ms   jsonb := '[]'::jsonb;
  m      text;
begin
  if v_key is null then raise exception 'noel_preview_day'; end if;
  select * into b from public._noel_bounds(v_key);
  v_flk := public._noel_flakes(v_me, v_key);
  v_band := public._noel_band(v_key, public._noel_all_flakes(v_key));
  v_tot := (v_flk->>'total')::int;
  v_tier := least(30, v_tot / 150);
  foreach m in array public._noel_missions(v_key, p_day) loop
    v_ms := v_ms || jsonb_build_object('id', m, 'done', public._noel_mission_done(v_me, m, p_day));
  end loop;
  return jsonb_build_object(
    'state', jsonb_build_object(
      'phase', 'live', 'key', v_key, 'day', p_day, 'starts_on', b.starts_on, 'ends_on', b.ends_on,
      'missions', v_ms, 'soiree_bonus', public._noel_soiree_bonus(v_me, p_day),
      'hotte', jsonb_build_object('status', 'todo', 'score', 0, 'flakes', 0),
      'flakes', v_tot, 'tier', v_tier, 'next_at', case when v_tier < 30 then (v_tier + 1) * 150 end,
      'streak', v_flk->'streak',
      'band', v_band || jsonb_build_object('me', v_tot, 'eligible', v_tot >= 400),
      'new_claims', '[]'::jsonb),
    'rounds', public._hotte_rounds(p_day));
end $$;

revoke all on function public._noel_day() from public, anon, authenticated;
revoke all on function public._noel_key_for(date) from public, anon, authenticated;
revoke all on function public._noel_bounds(text) from public, anon, authenticated;
revoke all on function public._noel_order(text, date, integer, text[], integer[]) from public, anon, authenticated;
revoke all on function public._noel_surprises(text) from public, anon, authenticated;
revoke all on function public._noel_slot12(text, date) from public, anon, authenticated;
revoke all on function public._noel_missions(text, date) from public, anon, authenticated;
revoke all on function public._noel_mission_done(uuid, text, date) from public, anon, authenticated;
revoke all on function public._noel_soiree_bonus(uuid, date) from public, anon, authenticated;
revoke all on function public._noel_flakes(uuid, text) from public, anon, authenticated;
revoke all on function public._noel_pass_reward(integer) from public, anon, authenticated;
revoke all on function public._noel_band_tier(integer) from public, anon, authenticated;
revoke all on function public._noel_band_reward(integer) from public, anon, authenticated;
revoke all on function public._noel_all_flakes(text) from public, anon, authenticated;
revoke all on function public._noel_band_override(text) from public, anon, authenticated;
revoke all on function public._noel_band(text, jsonb) from public, anon, authenticated;
revoke all on function public._noel_claim(uuid, text) from public, anon, authenticated;
revoke all on function public._noel_claim(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.noel_state() from public, anon;
grant execute on function public.noel_state() to authenticated;
revoke all on function public.noel_preview(date) from public, anon;
grant execute on function public.noel_preview(date) to authenticated;
revoke all on function public._noel_gros_lot_ok(uuid) from public, anon, authenticated;
revoke all on function public.noel_gros_lot() from public, anon;
grant execute on function public.noel_gros_lot() to authenticated;
