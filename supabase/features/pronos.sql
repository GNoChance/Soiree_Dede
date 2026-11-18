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

-- Paris rattachés à une partie TERMINÉE qui a au moins un gagnant : ok = le joueur choisi a gagné.
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
