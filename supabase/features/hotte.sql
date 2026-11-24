-- =============================================================================
-- LA HOTTE DU JOUR (événement « Noël chez Dédé ») — idempotent.
-- Spec : docs/superpowers/specs/2026-11-24-noel-event-design.md (§4).
-- Mini-activité solo de Noël : 5 manches, la même pour toute la bande le jour J (date de Paris),
-- un seul essai, 5 minutes pour finir. Ouverte du 1er décembre au 6 janvier.
-- Types de manches : quiz, memoire (le cadeau disparu), intrus, proche (« combien ? », ±15 %, au
-- moins ±1), chanson (paroles à trous). Les réponses restent côté serveur (_hotte_rounds) ;
-- memoire / intrus sont déductibles des données envoyées (limite assumée, jeu entre amis).
-- Contenu des banques : hotte_banques.sql. Les ❄️ (6 par bonne réponse) sont comptés par noel.sql.
-- Date courante : _season_now() (surchargée par les tests).
-- Erreurs : not_authenticated, not_logged_in, guest_forbidden, hotte_closed, hotte_done,
--   hotte_bad_round, hotte_not_done, hotte_empty.
-- =============================================================================

create table if not exists public.hotte_runs (
  profile_id     uuid not null references public.profiles(id) on delete cascade,
  day            date not null,
  started_at     timestamptz not null,
  answers        jsonb not null default '[]'::jsonb,   -- [{round, answer, ok}]
  score          integer not null default 0,
  last_answer_at timestamptz,
  finished_at    timestamptz,
  primary key (profile_id, day)
);
create index if not exists hotte_runs_day_idx on public.hotte_runs(day) where finished_at is not null;
alter table public.hotte_runs enable row level security;

create table if not exists public.hotte_quiz (
  id          serial primary key,
  prompt      text not null,
  answer      text not null,
  distractors text[] not null
);
create table if not exists public.hotte_songs (
  id          serial primary key,
  line        text not null,   -- contient « ___ » à la place du mot manquant
  answer      text not null,
  distractors text[] not null
);
create table if not exists public.hotte_estimates (
  id     serial primary key,
  prompt text not null,
  answer numeric not null,
  unit   text not null
);
alter table public.hotte_quiz enable row level security;
alter table public.hotte_songs enable row level security;
alter table public.hotte_estimates enable row level security;

-- Date de Paris « maintenant ».
create or replace function public._hotte_day()
returns date language sql stable security definer
set search_path = public, extensions
as $$ select (public._season_now() at time zone 'Europe/Paris')::date $$;

-- 1er décembre de l'édition qui contient ce jour (null hors période).
create or replace function public._hotte_edition_start(p_day date)
returns date language sql immutable
as $$
  select case
    when extract(month from p_day) = 12 then make_date(extract(year from p_day)::int, 12, 1)
    when extract(month from p_day) = 1 and extract(day from p_day) <= 6 then make_date(extract(year from p_day)::int - 1, 12, 1)
  end
$$;

create or replace function public._hotte_open(p_day date)
returns boolean language sql immutable
as $$ select public._hotte_edition_start(p_day) is not null $$;

create or replace function public._hotte_noel_emojis()
returns text[] language sql immutable
as $$ select array['🎄','🎅','🤶','🦌','⛄','❄️','🎁','🔔','🕯️','⭐','🍪','🥛','🧦','🛷','🎀','🍬','🌟','🧣','🧤','🪵','🍫','🎶','👼','🏠'] $$;

create or replace function public._hotte_intrus_emojis()
returns text[] language sql immutable
as $$ select array['🏖️','🌴','🍉','🩴','🕶️','🏄','🌻','🐣','🎃','👻','🍦','⛱️','🦩','🌵','🏝️','🐠'] $$;

-- Types des 5 manches du jour (ordre de jeu) : 1 quiz + 4 tirés (au plus 2 par type).
create or replace function public._hotte_types(p_day date)
returns text[] language sql immutable
as $$
  with seed as (select md5('hotte' || p_day::text) s),
  pool as (
    select t, k from (values ('quiz', 1), ('memoire', 1), ('memoire', 2), ('intrus', 1), ('intrus', 2),
                             ('proche', 1), ('proche', 2), ('chanson', 1), ('chanson', 2)) v(t, k)
  ),
  picked as (
    select t from pool, seed order by md5(seed.s || t || k) limit 4
  ),
  allr as (
    select 'quiz' as t, 0 as i union all select t, row_number() over () from picked
  )
  select array_agg(t order by md5((select s from seed) || 'o' || i || t)) from allr
$$;

-- Normalise un nombre saisi et compare à ±15 % (au moins ±1).
create or replace function public._hotte_proche_ok(p_answer text, p_value numeric)
returns boolean language plpgsql immutable
as $$
declare v numeric;
begin
  begin
    v := replace(btrim(coalesce(p_answer, '')), ',', '.')::numeric;
  exception when others then
    return false;
  end;
  return abs(v - p_value) <= greatest(1, 0.15 * abs(p_value));
end $$;

-- Les 5 manches du jour, AVEC les réponses (interne). Choix dans les banques : élément de rang
-- (c mod n) de la banque triée par md5(id || 'noel'), c = nombre de manches de ce type depuis le
-- 1er décembre de l'édition (cycle sans répétition tant que la banque n'est pas épuisée).
create or replace function public._hotte_rounds(p_day date)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_seed  text := md5('hotte' || p_day::text);
  v_start date := public._hotte_edition_start(p_day);
  v_types text[] := public._hotte_types(p_day);
  v_out   jsonb := '[]'::jsonb;
  v_t     text;
  v_i     integer;
  v_c     integer;
  v_n     integer;
  d       date;
  q       record;
  v_opts  jsonb;
  v_shown text[];
  v_miss  text;
  v_rest  text[];
  v_intr  text;
begin
  for v_i in 1..5 loop
    v_t := v_types[v_i];
    -- c = manches de ce type les jours précédents de l'édition + plus tôt dans la journée.
    v_c := 0;
    if v_start is not null then
      d := v_start;
      while d < p_day loop
        v_c := v_c + (select count(*) from unnest(public._hotte_types(d)) x where x = v_t)::int;
        d := d + 1;
      end loop;
    end if;
    v_c := v_c + (select count(*) from unnest(v_types[1:v_i - 1]) x where x = v_t)::int;

    if v_t = 'quiz' then
      select count(*) into v_n from public.hotte_quiz;
      if v_n = 0 then raise exception 'hotte_empty'; end if;
      select * into q from public.hotte_quiz order by md5(id::text || 'noel') offset (v_c % v_n) limit 1;
      select jsonb_agg(o order by md5(v_seed || v_i || o)) into v_opts from unnest(q.distractors || q.answer) o;
      v_out := v_out || jsonb_build_object('type', 'quiz', 'prompt', q.prompt, 'options', v_opts, 'answer', q.answer);
    elsif v_t = 'chanson' then
      select count(*) into v_n from public.hotte_songs;
      if v_n = 0 then raise exception 'hotte_empty'; end if;
      select * into q from public.hotte_songs order by md5(id::text || 'noel') offset (v_c % v_n) limit 1;
      select jsonb_agg(o order by md5(v_seed || v_i || o)) into v_opts from unnest(q.distractors || q.answer) o;
      v_out := v_out || jsonb_build_object('type', 'chanson', 'line', q.line, 'options', v_opts, 'answer', q.answer);
    elsif v_t = 'proche' then
      select count(*) into v_n from public.hotte_estimates;
      if v_n = 0 then raise exception 'hotte_empty'; end if;
      select * into q from public.hotte_estimates order by md5(id::text || 'noel') offset (v_c % v_n) limit 1;
      v_out := v_out || jsonb_build_object('type', 'proche', 'prompt', q.prompt, 'unit', q.unit,
                                           'answer', trim_scale(q.answer)::text);
    elsif v_t = 'memoire' then
      select array_agg(e order by md5(v_seed || v_i || 'm' || e)) into v_shown
        from (select e from unnest(public._hotte_noel_emojis()) e order by md5(v_seed || v_i || e) limit 6) x;
      v_miss := v_shown[1 + (('x' || substr(md5(v_seed || v_i || 'miss'), 1, 6))::bit(24)::int % 6)];
      select array_agg(e order by md5(v_seed || v_i || 'r' || e)) into v_rest from unnest(v_shown) e where e <> v_miss;
      select jsonb_agg(o order by md5(v_seed || v_i || 'p' || o)) into v_opts
        from (select v_miss as o union all
              select e from (select e from unnest(v_rest) e order by md5(v_seed || v_i || 'd' || e) limit 3) y) x;
      v_out := v_out || jsonb_build_object('type', 'memoire', 'shown', to_jsonb(v_shown), 'remaining', to_jsonb(v_rest),
                                           'options', v_opts, 'answer', v_miss);
    else -- intrus
      select e into v_intr from unnest(public._hotte_intrus_emojis()) e order by md5(v_seed || v_i || 'i' || e) limit 1;
      select jsonb_agg(o order by md5(v_seed || v_i || 'g' || o)) into v_opts
        from (select v_intr as o union all
              select e from (select e from unnest(public._hotte_noel_emojis()) e order by md5(v_seed || v_i || 'n' || e) limit 8) y) x;
      v_out := v_out || jsonb_build_object('type', 'intrus', 'grid', v_opts, 'answer', v_intr);
    end if;
  end loop;
  return v_out;
end $$;

-- Clôt les essais commencés il y a plus de 5 minutes (score = bonnes réponses déjà données).
create or replace function public._hotte_close_expired()
returns void language sql security definer
set search_path = public, extensions
as $$
  update public.hotte_runs set finished_at = started_at + interval '5 minutes'
   where finished_at is null and started_at < public._season_now() - interval '5 minutes'
$$;

create or replace function public._hotte_public(p_run public.hotte_runs)
returns jsonb language sql stable security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
    'day', p_run.day, 'started_at', p_run.started_at, 'deadline', p_run.started_at + interval '5 minutes',
    'rounds', (select jsonb_agg(r - 'answer' order by o) from jsonb_array_elements(public._hotte_rounds(p_run.day)) with ordinality t(r, o)),
    'answers', p_run.answers, 'score', p_run.score, 'finished', p_run.finished_at is not null)
$$;

-- Commence (ou reprend) la Hotte du jour. -> {day, started_at, deadline, rounds, answers, score, finished}
create or replace function public.hotte_start()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_member();
  v_day date := public._hotte_day();
  v_run public.hotte_runs%rowtype;
begin
  perform public._hotte_close_expired();
  -- Essai en cours (même commencé la veille juste avant minuit) : on le reprend.
  select * into v_run from public.hotte_runs where profile_id = v_me and finished_at is null
   order by started_at desc limit 1;
  if found then return public._hotte_public(v_run); end if;
  if not public._hotte_open(v_day) then raise exception 'hotte_closed'; end if;
  if exists (select 1 from public.hotte_runs where profile_id = v_me and day = v_day) then raise exception 'hotte_done'; end if;
  perform public._hotte_rounds(v_day); -- banques vides -> hotte_empty avant de créer l'essai
  insert into public.hotte_runs(profile_id, day, started_at) values (v_me, v_day, public._season_now())
  returning * into v_run;
  return public._hotte_public(v_run);
end $$;

-- Répond à une manche (1-5), une seule fois. -> {ok, correct, score, finished}
create or replace function public.hotte_answer(p_round integer, p_answer text)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_member();
  v_run public.hotte_runs%rowtype;
  v_r   jsonb;
  v_ok  boolean;
  v_n   integer;
begin
  perform public._hotte_close_expired();
  select * into v_run from public.hotte_runs where profile_id = v_me and finished_at is null
   order by started_at desc limit 1 for update;
  if not found then raise exception 'hotte_bad_round'; end if;
  if p_round is null or p_round < 1 or p_round > 5
     or exists (select 1 from jsonb_array_elements(v_run.answers) a where (a->>'round')::int = p_round) then
    raise exception 'hotte_bad_round';
  end if;
  v_r := public._hotte_rounds(v_run.day) -> (p_round - 1);
  v_ok := case when v_r->>'type' = 'proche' then public._hotte_proche_ok(p_answer, (v_r->>'answer')::numeric)
               else btrim(coalesce(p_answer, '')) = v_r->>'answer' end;
  v_n := jsonb_array_length(v_run.answers) + 1;
  update public.hotte_runs
     set answers = answers || jsonb_build_array(jsonb_build_object('round', p_round, 'answer', left(coalesce(p_answer, ''), 60), 'ok', v_ok)),
         score = score + case when v_ok then 1 else 0 end,
         last_answer_at = public._season_now(),
         finished_at = case when v_n >= 5 then public._season_now() end
   where profile_id = v_me and day = v_run.day
  returning * into v_run;
  return jsonb_build_object('ok', v_ok, 'correct', v_r->>'answer', 'score', v_run.score, 'finished', v_run.finished_at is not null);
end $$;

-- Classement du jour de la bande (après avoir fini sa propre Hotte). -> [{profile_id, score, secs}]
create or replace function public.hotte_board()
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_member();
  v_day date := public._hotte_day();
begin
  perform public._hotte_close_expired();
  if not exists (select 1 from public.hotte_runs where profile_id = v_me and day = v_day and finished_at is not null) then
    raise exception 'hotte_not_done';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', h.profile_id, 'score', h.score, 'secs', x.secs)
                     order by h.score desc, x.secs, h.profile_id)
      from public.hotte_runs h join public.profiles p on p.id = h.profile_id
      cross join lateral (select greatest(0, floor(extract(epoch from coalesce(h.last_answer_at, h.finished_at) - h.started_at)))::int as secs) x
     where h.day = v_day and h.finished_at is not null and not p.is_guest), '[]'::jsonb);
end $$;

revoke all on function public._hotte_day() from public, anon, authenticated;
revoke all on function public._hotte_edition_start(date) from public, anon, authenticated;
revoke all on function public._hotte_open(date) from public, anon, authenticated;
revoke all on function public._hotte_noel_emojis() from public, anon, authenticated;
revoke all on function public._hotte_intrus_emojis() from public, anon, authenticated;
revoke all on function public._hotte_types(date) from public, anon, authenticated;
revoke all on function public._hotte_proche_ok(text, numeric) from public, anon, authenticated;
revoke all on function public._hotte_rounds(date) from public, anon, authenticated;
revoke all on function public._hotte_close_expired() from public, anon, authenticated;
revoke all on function public._hotte_public(public.hotte_runs) from public, anon, authenticated;
revoke all on function public.hotte_start() from public, anon;
revoke all on function public.hotte_answer(integer, text) from public, anon;
revoke all on function public.hotte_board() from public, anon;
grant execute on function public.hotte_start() to authenticated;
grant execute on function public.hotte_answer(integer, text) to authenticated;
grant execute on function public.hotte_board() to authenticated;
