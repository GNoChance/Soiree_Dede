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
