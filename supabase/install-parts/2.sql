-- MORCEAU 2 / 6 — -- GÉNÉRÉ par scripts/build-sql.mjs — ne pas éditer. Idempotent. À exécuter dans l'ordre (1, puis 2…) dans Supabase > SQL Editor > Run.

-- ===== features\hotte.sql =====
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
-- (c mod n) de la banque triée par md5(texte || 'noel') (stable si on recolle le SQL : ids serial changent), c = nombre de manches de ce type depuis le
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
      select * into q from public.hotte_quiz order by md5(prompt || 'noel'), id offset (v_c % v_n) limit 1;
      select jsonb_agg(o order by md5(v_seed || v_i || o)) into v_opts from unnest(q.distractors || q.answer) o;
      v_out := v_out || jsonb_build_object('type', 'quiz', 'prompt', q.prompt, 'options', v_opts, 'answer', q.answer);
    elsif v_t = 'chanson' then
      select count(*) into v_n from public.hotte_songs;
      if v_n = 0 then raise exception 'hotte_empty'; end if;
      select * into q from public.hotte_songs order by md5(line || 'noel'), id offset (v_c % v_n) limit 1;
      select jsonb_agg(o order by md5(v_seed || v_i || o)) into v_opts from unnest(q.distractors || q.answer) o;
      v_out := v_out || jsonb_build_object('type', 'chanson', 'line', q.line, 'options', v_opts, 'answer', q.answer);
    elsif v_t = 'proche' then
      select count(*) into v_n from public.hotte_estimates;
      if v_n = 0 then raise exception 'hotte_empty'; end if;
      select * into q from public.hotte_estimates order by md5(prompt || 'noel'), id offset (v_c % v_n) limit 1;
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


-- ===== features\hotte_banques.sql =====
-- =============================================================================
-- CONTENU DE LA HOTTE DU JOUR (événement de Noël) — idempotent : vide puis remplit les 3 banques.
-- Tables : hotte.sql. 40 quiz, 20 chants (domaine public), 20 « combien ».
-- =============================================================================
delete from public.hotte_quiz;
delete from public.hotte_songs;
delete from public.hotte_estimates;

insert into public.hotte_quiz(prompt, answer, distractors) values
  -- Traditions de Noël en France
  ('Parmi les desserts de Noël provençaux, que sont les « quatre mendiants » ?', 'Des fruits secs', array['Des biscuits', 'Des santons', 'Des bougies']),
  ('Que cache-t-on dans la galette des rois ?', 'Une fève', array['Une pièce d’or', 'Une noisette', 'Un grelot']),
  ('À quelle date tombe traditionnellement l’Épiphanie ?', 'Le 6 janvier', array['Le 1er janvier', 'Le 26 décembre', 'Le 2 février']),
  ('Quel jour fête-t-on la Saint-Nicolas ?', 'Le 6 décembre', array['Le 1er décembre', 'Le 24 décembre', 'Le 11 novembre']),
  ('Quelle ville française accueille le plus ancien marché de Noël du pays, né en 1570 ?', 'Strasbourg', array['Colmar', 'Lille', 'Reims']),
  ('Dans une crèche provençale, comment appelle-t-on les petites figurines ?', 'Les santons', array['Les lutins', 'Les fèves', 'Les pantins']),
  ('Selon la tradition, que fait-on sous une branche de gui ?', 'On s’embrasse', array['On chante', 'On se serre la main', 'On fait la sieste']),
  ('De quelle couleur sont les baies du houx ?', 'Rouges', array['Blanches', 'Bleues', 'Violettes']),
  ('En Alsace, comment appelle-t-on les petits biscuits de Noël ?', 'Les bredele', array['Les bretzels', 'Les spätzle', 'Les knacks']),
  ('À l’origine, qu’était la bûche de Noël ?', 'Une vraie bûche dans la cheminée', array['Un pain en forme de sapin', 'Une bougie géante', 'Un fromage de montagne']),
  ('Quel fruit glissait-on autrefois dans les souliers des enfants à Noël ?', 'Une orange', array['Une banane', 'Un ananas', 'Une pastèque']),
  ('Comment appelle-t-on le repas de fête du soir du 24 décembre ?', 'Le réveillon', array['Le brunch', 'Le goûter', 'Le pique-nique']),
  ('Quel sapin de Noël est le plus vendu en France ?', 'Le Nordmann', array['L’épicéa', 'Le mélèze', 'Le pin parasol']),
  ('Avec l’or et l’encens, quel est le troisième cadeau des Rois mages ?', 'La myrrhe', array['La cannelle', 'Le miel', 'La soie']),
  -- Noël dans le monde
  ('Dans quel pays se trouve Rovaniemi, le village officiel du Père Noël ?', 'En Finlande', array['En Norvège', 'En Suède', 'En Islande']),
  ('Comment dit-on « Joyeux Noël » en espagnol ?', 'Feliz Navidad', array['Buon Natale', 'Frohe Weihnachten', 'Merry Christmas']),
  ('En Australie, en quelle saison fête-t-on Noël ?', 'En été', array['En hiver', 'Au printemps', 'En automne']),
  ('Au Japon, quel plat est devenu une tradition populaire de Noël ?', 'Le poulet frit', array['Les sushis', 'La raclette', 'La pizza']),
  ('Quel pays offre chaque année à Londres le grand sapin de Trafalgar Square ?', 'La Norvège', array['La Suède', 'La Finlande', 'Le Canada']),
  ('Dans quel pays le chant « Douce nuit » a-t-il été composé, en 1818 ?', 'En Autriche', array['En Allemagne', 'En Suisse', 'En France']),
  -- Films, contes et musique
  ('Dans « Maman, j’ai raté l’avion ! », dans quelle ville la famille part-elle fêter Noël ?', 'Paris', array['Londres', 'Rome', 'New York']),
  ('De quelle couleur est le Grinch ?', 'Vert', array['Rouge', 'Bleu', 'Violet']),
  ('Comment s’appelle le chien du Grinch ?', 'Max', array['Rex', 'Milou', 'Pluto']),
  ('Dans « La Reine des neiges », comment s’appelle le bonhomme de neige ?', 'Olaf', array['Sven', 'Kristoff', 'Hans']),
  ('Sur quel royaume règne Elsa dans « La Reine des neiges » ?', 'Arendelle', array['Corona', 'Agrabah', 'Atlantica']),
  ('Dans « Le Pôle Express », quel premier cadeau de Noël le garçon choisit-il ?', 'Un grelot du traîneau', array['Un train électrique', 'Un sifflet de contrôleur', 'Un bonnet rouge']),
  ('Dans le film « Elfe », comment s’appelle le héros élevé par les elfes du Père Noël ?', 'Buddy', array['Bernard', 'Dobby', 'Legolas']),
  ('Dans « Le Père Noël est une ordure », quelle association répond au téléphone ?', 'SOS Détresse Amitié', array['SOS Père Noël', 'Allô Réconfort', 'SOS Solitude Joyeuse']),
  ('Qui a composé la musique du ballet « Casse-Noisette » ?', 'Tchaïkovski', array['Mozart', 'Beethoven', 'Vivaldi']),
  ('Qui a écrit « Un chant de Noël », l’histoire de l’avare Scrooge ?', 'Charles Dickens', array['Jules Verne', 'Victor Hugo', 'Mark Twain']),
  -- Le Père Noël et ses rennes
  ('Quel renne du Père Noël est célèbre pour son nez rouge ?', 'Rudolph', array['Comète', 'Tonnerre', 'Cupidon']),
  ('Chez les rennes, qui porte des bois ?', 'Les mâles et les femelles', array['Seulement les mâles', 'Seulement les femelles', 'Seulement les chefs de troupeau']),
  ('Par où le Père Noël entre-t-il dans les maisons ?', 'Par la cheminée', array['Par la fenêtre', 'Par le garage', 'Par la chatière']),
  -- Hiver et neige
  ('Combien de branches possède un flocon de neige ?', 'Six', array['Quatre', 'Cinq', 'Huit']),
  ('Vers quelle date commence l’hiver en France ?', 'Le 21 décembre', array['Le 1er décembre', 'Le 21 novembre', 'Le 1er janvier']),
  ('Lequel de ces animaux ne vit pas au pôle Nord ?', 'Le manchot', array['L’ours polaire', 'Le morse', 'Le renard polaire']),
  -- Gastronomie de fête
  ('Quel gâteau italien de Noël, en forme de dôme, est garni de fruits confits ?', 'Le panettone', array['Le tiramisu', 'La panna cotta', 'Le cannolo']),
  ('Quel dessert de Noël anglais est flambé avant d’être servi ?', 'Le Christmas pudding', array['Le cheesecake', 'Le crumble', 'Le brownie']),
  ('Quel ingrédient sucré est indispensable au pain d’épices ?', 'Le miel', array['Le caramel', 'La confiture', 'Le sirop d’érable']),
  ('Avec quel fruit fabrique-t-on les marrons glacés ?', 'La châtaigne', array['Le marron d’Inde', 'La noix', 'La noisette']);

insert into public.hotte_songs(line, answer, distractors) values
  -- Mon beau sapin (paroles françaises de Laurent Delcasso, 1856)
  ('Mon beau sapin, ___ des forêts', 'roi', array['prince', 'chef', 'géant']),
  ('Mon beau sapin, roi des forêts, que j’aime ta ___ !', 'verdure', array['ramure', 'coiffure', 'figure']),
  ('Mon beau sapin, roi des forêts, tu gardes ta ___', 'parure', array['fourrure', 'toiture', 'ceinture']),
  ('Joli sapin, comme ils sont doux, et tes bonbons et tes ___ !', 'joujoux', array['cadeaux', 'gâteaux', 'bijoux']),
  -- Il est né le divin enfant (traditionnel, XIXe siècle)
  ('Il est né le divin enfant, jouez ___, résonnez musettes !', 'hautbois', array['violons', 'tambours', 'pianos']),
  ('Il est né le divin enfant, jouez hautbois, résonnez ___ !', 'musettes', array['trompettes', 'clochettes', 'guitares']),
  ('Depuis plus de ___ mille ans, nous le promettaient les prophètes', 'quatre', array['deux', 'trois', 'dix']),
  ('Une étable est son logement, un peu de ___ est sa couchette', 'paille', array['laine', 'mousse', 'neige']),
  -- Les anges dans nos campagnes (traditionnel)
  ('Les anges dans nos ___ ont entonné l’hymne des cieux', 'campagnes', array['villages', 'vallées', 'chaumières']),
  ('Et l’écho de nos ___ redit ce chant mélodieux', 'montagnes', array['vallées', 'forêts', 'clochers']),
  ('Les anges dans nos campagnes… Gloria in excelsis ___', 'Deo', array['Domino', 'Maria', 'Noël']),
  -- Minuit, chrétiens (Placide Cappeau, 1843)
  ('Minuit, chrétiens, c’est l’heure ___', 'solennelle', array['éternelle', 'fraternelle', 'officielle']),
  ('Peuple, à ___, attends ta délivrance !', 'genoux', array['table', 'cheval', 'minuit']),
  -- Entre le bœuf et l’âne gris (traditionnel)
  ('Entre le bœuf et l’âne ___, dort, dort, dort le petit fils', 'gris', array['blanc', 'noir', 'roux']),
  ('Mille anges divins, mille ___ volent à l’entour de ce grand Dieu d’amour', 'séraphins', array['chérubins', 'lutins', 'pingouins']),
  ('Entre les roses et les ___, dort, dort, dort le petit fils', 'lys', array['lilas', 'iris', 'tulipes']),
  -- La Marche des rois, D’où viens-tu bergère, Un flambeau Jeannette Isabelle, Guillaume prends ton tambourin (traditionnels)
  ('De bon matin, j’ai rencontré le train de trois grands ___ qui allaient en voyage', 'rois', array['princes', 'ducs', 'chefs']),
  ('D’où viens-tu, ___, d’où viens-tu ?', 'bergère', array['fermière', 'meunière', 'laitière']),
  ('Un flambeau, Jeannette, Isabelle, un flambeau, courons au ___ !', 'berceau', array['château', 'ruisseau', 'village']),
  ('Guillaume, prends ton ___, toi, prends ta flûte, Robin', 'tambourin', array['violon', 'pipeau', 'clairon']);

insert into public.hotte_estimates(prompt, answer, unit) values
  ('Combien de rennes tirent le traîneau du Père Noël (sans compter Rudolph) ?', 8, 'rennes'), -- source : poème « A Visit from St. Nicholas » (1823), qui nomme 8 rennes
  ('Combien de desserts sert-on à Noël dans la tradition provençale ?', 13, 'desserts'), -- source : tradition des treize desserts de Provence
  ('Combien de cases compte un calendrier de l’Avent classique ?', 24, 'cases'), -- source : une case par jour, du 1er au 24 décembre
  ('Combien de jours séparent Noël de l’Épiphanie (la fête des Rois) ?', 12, 'jours'), -- source : du 25 décembre au 6 janvier, les « douze jours de Noël »
  ('En Espagne, combien de grains de raisin avale-t-on à minuit le soir du Nouvel An ?', 12, 'grains de raisin'), -- source : tradition des « doce uvas », un grain par coup de minuit
  ('Dans la chanson anglaise « The Twelve Days of Christmas », combien de cadeaux sont offerts en tout ?', 364, 'cadeaux'), -- source : cumul sur les 12 jours, 1 + 3 + 6 + … + 78 = 364
  ('Quel âge a le petit héros de « Maman, j’ai raté l’avion ! » ?', 8, 'ans'), -- source : film de 1990, le héros a 8 ans
  ('Combien de dimanches compte l’Avent ?', 4, 'dimanches'), -- source : calendrier liturgique, les 4 dimanches avant Noël
  ('À combien de degrés Fahrenheit l’eau gèle-t-elle ?', 32, 'degrés Fahrenheit'), -- source : 0 °C = 32 °F
  ('Record de froid sur Terre : combien de degrés sous zéro a-t-on mesurés en Antarctique ?', 89, 'degrés sous zéro'), -- source : −89,2 °C à la base Vostok le 21 juillet 1983 (record homologué par l’OMM)
  ('Quel angle sépare deux branches voisines d’un flocon de neige ?', 60, 'degrés'), -- source : symétrie hexagonale du cristal de glace, 360 / 6
  ('Sur combien de pays s’étend la Laponie ?', 4, 'pays'), -- source : Norvège, Suède, Finlande et Russie
  ('Du pôle Nord au pôle Sud, combien de kilomètres le Père Noël doit-il parcourir à la surface du globe ?', 20000, 'kilomètres'), -- source : demi-méridien terrestre, environ 20 004 km
  ('Combien de semaines faut-il patienter entre deux Noëls ?', 52, 'semaines'), -- source : 365 jours = 52 semaines et 1 jour
  ('Combien de fois le Père Noël dit-il « Ho ! » dans son célèbre rire ?', 3, 'fois'), -- source : « Ho ! Ho ! Ho ! »
  ('Combien de jours fériés compte une année en France ?', 11, 'jours fériés'), -- source : Code du travail, art. L. 3133-1 (11 fêtes légales, hors Alsace-Moselle)
  ('Combien de jours séparent la Saint-Nicolas de Noël ?', 19, 'jours'), -- source : du 6 au 25 décembre
  ('Combien de lettres faut-il pour écrire « Joyeux Noël » ?', 10, 'lettres'), -- source : 6 lettres + 4 lettres
  ('Quel jour de décembre fête-t-on la Saint-Sylvestre ?', 31, 'décembre'), -- source : calendrier, dernier jour de l’année
  ('Combien de minutes dure la journée de Noël, de minuit à minuit ?', 1440, 'minutes'); -- source : 24 heures × 60 minutes


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
-- Code à 4 chiffres tiré au hasard, renvoyé à l'admin ({..., pin}) qui le lui donne. Pour en
-- choisir un autre : l'admin réinitialise le code (admin_reset_pin) devant la personne.
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
  v_pin   text;
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
  -- Code tiré au hasard et renvoyé à l'admin (une seule fois) : un profil sans code pourrait être
  -- pris par n'importe qui (première connexion = le code saisi devient le code).
  v_pin := lpad(floor(random() * 10000)::integer::text, 4, '0');
  insert into public.profile_credentials(profile_id, pin_hash, updated_at)
  values (v_id, extensions.crypt(v_pin, extensions.gen_salt('bf', 8)), now());
  return public._profile_json(v_id) || jsonb_build_object('pin', v_pin);
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


-- ===== features\musique.sql =====
-- =============================================================================
-- MUSIQUE DE LA SOIRÉE (Spotify Jam) — idempotent. L'hôte (Premium) lance une Jam dans Spotify
-- et colle son lien d'invitation ; tous les joueurs du salon (invités compris) voient un bouton
-- « Ajouter une musique » qui ouvre la Jam, et la télé affiche le QR code. Aucune API Spotify :
-- c'est un simple lien (les règles développeurs de Spotify interdisent son contenu dans un jeu).
-- soirees.music_url : lu par le salon comme les autres colonnes (select *, Realtime UPDATE).
-- Erreurs : not_authenticated, not_logged_in, soiree_not_found, not_host, soiree_ended, invalid_music_link.
-- =============================================================================

alter table public.soirees add column if not exists music_url text;

-- p_url : lien Spotify (ou texte de partage qui en contient un) ; vide / null = retirer la musique.
create or replace function public.set_soiree_music(p_soiree_id uuid, p_url text)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me  uuid := public._require_profile();
  v_s   public.soirees%rowtype;
  v_raw text := btrim(coalesce(p_url, ''));
  v_url text;
begin
  select * into v_s from public.soirees where id = p_soiree_id for update;
  if not found then raise exception 'soiree_not_found'; end if;
  if v_s.host_id <> v_me then raise exception 'not_host'; end if;
  if v_s.status = 'ended' then raise exception 'soiree_ended'; end if;
  if v_raw <> '' then
    v_url := (regexp_match(v_raw, '(https://(open\.spotify\.com|spotify\.link|spotify\.app\.link)/[A-Za-z0-9_\-/?=&%.~+#]+)'))[1];
    if v_url is null or char_length(v_url) > 300 then raise exception 'invalid_music_link'; end if;
  end if;
  update public.soirees set music_url = v_url where id = p_soiree_id;
end $$;

revoke all on function public.set_soiree_music(uuid, text) from public, anon;
grant execute on function public.set_soiree_music(uuid, text) to authenticated;


-- ===== features\noel.sql =====
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


-- ===== features\presence.sql =====
-- =============================================================================
-- PRÉSENCE (« en ligne » / « vu il y a… ») — idempotent. Tant que l'app est à l'écran, le
-- téléphone d'un membre appelle ping_presence() toutes les minutes ; band_presence() renvoie
-- la dernière activité de chaque membre de la bande (page Amis, profil). « En ligne » = vu il y
-- a moins de 2 min (calculé côté front avec l'horloge serveur).
-- Table à part (pas une colonne de profiles) : un ping par minute ne doit pas réveiller les
-- abonnements Realtime aux profils. Pas de policy RLS : accès uniquement via les RPC.
-- Invités : ni ping, ni lecture (_require_member), jamais dans la liste.
-- Erreurs : not_authenticated, not_logged_in, guest_forbidden.
-- =============================================================================

create table if not exists public.presence (
  profile_id   uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
alter table public.presence enable row level security;

create or replace function public.ping_presence()
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_member();
begin
  -- Pas plus d'une écriture toutes les 20 s par personne (plusieurs onglets / retours d'arrière-plan).
  insert into public.presence(profile_id, last_seen_at) values (v_me, now())
  on conflict (profile_id) do update set last_seen_at = excluded.last_seen_at
   where public.presence.last_seen_at < now() - interval '20 seconds';
end $$;

-- -> [{profile_id, last_seen_at}] des membres de la bande déjà vus (les invités jamais).
create or replace function public.band_presence()
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
begin
  perform public._require_member();
  return coalesce((
    select jsonb_agg(jsonb_build_object('profile_id', pr.profile_id, 'last_seen_at', pr.last_seen_at)
                     order by pr.last_seen_at desc)
      from public.presence pr join public.profiles p on p.id = pr.profile_id
     where not p.is_guest), '[]'::jsonb);
end $$;

revoke all on function public.ping_presence() from public, anon;
revoke all on function public.band_presence() from public, anon;
grant execute on function public.ping_presence() to authenticated;
grant execute on function public.band_presence() to authenticated;


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
-- -> [{endpoint, p256dh, auth, profile_id, nickname, streak, noel_streak}]
-- noel_streak : série de l'événement de Noël (noel.sql) pendant une édition, sinon null (texte du rappel adapté).
create or replace function public._push_noel_streak(p_profile uuid)
returns integer language plpgsql stable security definer
set search_path = public, extensions
as $$
declare v_key text;
begin
  -- noel.sql est chargé après push.sql : appel dynamique résolu à l'exécution (plpgsql).
  v_key := public._noel_key_for(public._noel_day());
  if v_key is null then return null; end if;
  return (public._noel_flakes(p_profile, v_key)->'streak'->>'current')::int;
end $$;

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
             'nickname', p.nickname, 'streak', public._daily_streak(s.profile_id),
             'noel_streak', public._push_noel_streak(s.profile_id)))
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
           'nickname', p.nickname, 'streak', public._daily_streak(s.profile_id),
           'noel_streak', public._push_noel_streak(s.profile_id))), '[]'::jsonb)
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
revoke all on function public._push_noel_streak(uuid) from public, anon, authenticated;
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
  -- 'bande' : thème secret « Le Réveillon de la Bande », réservé à un hôte qui a reçu le Gros Lot de Noël.
  if p_theme is null or not (p_theme in ('noel', 'nouvel-an', 'surprise')
                             or (p_theme = 'bande' and public._noel_gros_lot_ok(v_s.host_id)))
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
  -- Invité exclu : une nouvelle session suffirait à revenir → on ferme les invitations (l'ancien QR
  -- ne marche plus ; l'hôte en rouvre un nouveau s'il le veut). Son prénom reste refusé (join_as_guest).
  if exists (select 1 from public.profiles where id = p_profile_id and is_guest) then
    update public.soirees set guest_token = null where id = p_soiree_id;
  end if;
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
