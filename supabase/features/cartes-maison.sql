-- =============================================================================
-- CARTES MAISON : chacun écrit ses cartes (blagues internes) qui entrent dans les paquets de
-- « Tu préfères » (kind dilemma : {a, b}), « Action ou vérité » (kind action | verite : {text, level 1..3})
-- et « Qui de nous » (kind question : {text}). Lecture : tous les authentifiés (les cartes masquées ne
-- sont vues que par leur auteur et l'admin). Écriture : uniquement via les RPC ci-dessous.
-- Les moteurs de jeu reçoivent les cartes dans p_options (le front les lit ici) avec `by` = id du profil auteur.
-- =============================================================================

create table if not exists public.custom_cards (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles(id) on delete cascade,
  game_id    text not null check (game_id in ('tu-preferes', 'action-ou-verite', 'qui-de-nous')),
  kind       text not null check (kind in ('dilemma', 'action', 'verite', 'question')),
  payload    jsonb not null,
  created_at timestamptz not null default now(),
  hidden     boolean not null default false,
  constraint custom_cards_kind_game check (
    (game_id = 'tu-preferes' and kind = 'dilemma')
    or (game_id = 'action-ou-verite' and kind in ('action', 'verite'))
    or (game_id = 'qui-de-nous' and kind = 'question'))
);
create index if not exists custom_cards_game_idx on public.custom_cards (game_id, created_at desc);
create index if not exists custom_cards_author_idx on public.custom_cards (author_id);
alter table public.custom_cards enable row level security;
drop policy if exists custom_cards_select on public.custom_cards;
create policy custom_cards_select on public.custom_cards for select to authenticated
  using (not hidden or author_id = public.current_profile_id()
         or exists (select 1 from public.profiles p where p.id = public.current_profile_id() and p.is_admin));
-- Aucune policy d'écriture : tout passe par les RPC.

-- Valide et normalise un payload ; lève invalid_card si KO. Renvoie le payload propre.
create or replace function public._custom_card_clean(p_kind text, p_payload jsonb)
returns jsonb language plpgsql immutable
set search_path = public, extensions
as $$
declare
  v_a text; v_b text; v_t text; v_l integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'invalid_custom_card'; end if;
  if p_kind = 'dilemma' then
    v_a := btrim(regexp_replace(coalesce(p_payload->>'a', ''), '\s+', ' ', 'g'));
    v_b := btrim(regexp_replace(coalesce(p_payload->>'b', ''), '\s+', ' ', 'g'));
    if char_length(v_a) < 2 or char_length(v_b) < 2 or char_length(v_a) > 120 or char_length(v_b) > 120 then
      raise exception 'invalid_custom_card';
    end if;
    return jsonb_build_object('a', v_a, 'b', v_b);
  elsif p_kind in ('action', 'verite') then
    v_t := btrim(regexp_replace(coalesce(p_payload->>'text', ''), '\s+', ' ', 'g'));
    if char_length(v_t) < 5 or char_length(v_t) > 300 then raise exception 'invalid_custom_card'; end if;
    begin
      v_l := coalesce(nullif(p_payload->>'level', '')::integer, 1);
    exception when others then raise exception 'invalid_custom_card';
    end;
    if v_l not in (1, 2, 3) then raise exception 'invalid_custom_card'; end if;
    return jsonb_build_object('text', v_t, 'level', v_l);
  elsif p_kind = 'question' then
    v_t := btrim(regexp_replace(coalesce(p_payload->>'text', ''), '\s+', ' ', 'g'));
    if char_length(v_t) < 8 or char_length(v_t) > 200 then raise exception 'invalid_custom_card'; end if;
    return jsonb_build_object('text', v_t);
  end if;
  raise exception 'invalid_custom_card';
end $$;

-- Clé anti-doublon d'une carte (texte en minuscules).
create or replace function public._custom_card_key(p_kind text, p_payload jsonb)
returns text language sql immutable
as $$ select lower(case when p_kind = 'dilemma' then (p_payload->>'a') || '|' || (p_payload->>'b') else p_payload->>'text' end) $$;

create or replace function public.create_custom_card(p_game text, p_kind text, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_clean jsonb;
  v_row public.custom_cards;
begin
  if not ((p_game = 'tu-preferes' and p_kind = 'dilemma')
       or (p_game = 'action-ou-verite' and p_kind in ('action', 'verite'))
       or (p_game = 'qui-de-nous' and p_kind = 'question')) then
    raise exception 'invalid_custom_card';
  end if;
  v_clean := public._custom_card_clean(p_kind, p_payload);
  if (select count(*) from public.custom_cards where author_id = v_me) >= 200 then raise exception 'too_many_cards'; end if;
  if exists (select 1 from public.custom_cards
              where author_id = v_me and game_id = p_game and kind = p_kind
                and public._custom_card_key(kind, payload) = public._custom_card_key(p_kind, v_clean)) then
    raise exception 'duplicate_card';
  end if;
  insert into public.custom_cards(author_id, game_id, kind, payload) values (v_me, p_game, p_kind, v_clean)
    returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.update_custom_card(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_row public.custom_cards;
  v_clean jsonb;
begin
  select * into v_row from public.custom_cards where id = p_id;
  if not found then raise exception 'card_not_found'; end if;
  if v_row.author_id <> v_me then raise exception 'not_card_author'; end if;
  v_clean := public._custom_card_clean(v_row.kind, p_payload);
  if exists (select 1 from public.custom_cards
              where author_id = v_me and game_id = v_row.game_id and kind = v_row.kind and id <> p_id
                and public._custom_card_key(kind, payload) = public._custom_card_key(v_row.kind, v_clean)) then
    raise exception 'duplicate_card';
  end if;
  update public.custom_cards set payload = v_clean where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end $$;

create or replace function public.delete_custom_card(p_id uuid)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := public._require_profile();
  v_author uuid;
begin
  select author_id into v_author from public.custom_cards where id = p_id;
  if not found then raise exception 'card_not_found'; end if;
  if v_author <> v_me and not exists (select 1 from public.profiles where id = v_me and is_admin) then
    raise exception 'not_card_author';
  end if;
  delete from public.custom_cards where id = p_id;
end $$;

-- Admin : masque / ré-affiche une carte (pas de modération automatique).
create or replace function public.hide_custom_card(p_id uuid, p_hidden boolean)
returns void language plpgsql security definer
set search_path = public, extensions
as $$
declare v_me uuid := public._require_profile();
begin
  if not exists (select 1 from public.profiles where id = v_me and is_admin) then raise exception 'not_admin'; end if;
  update public.custom_cards set hidden = coalesce(p_hidden, true) where id = p_id;
  if not found then raise exception 'card_not_found'; end if;
end $$;

revoke all on function public._custom_card_clean(text, jsonb) from public, anon, authenticated;
revoke all on function public._custom_card_key(text, jsonb) from public, anon, authenticated;
revoke all on function public.create_custom_card(text, text, jsonb) from public, anon;
revoke all on function public.update_custom_card(uuid, jsonb) from public, anon;
revoke all on function public.delete_custom_card(uuid) from public, anon;
revoke all on function public.hide_custom_card(uuid, boolean) from public, anon;
grant execute on function public.create_custom_card(text, text, jsonb) to authenticated;
grant execute on function public.update_custom_card(uuid, jsonb) to authenticated;
grant execute on function public.delete_custom_card(uuid) to authenticated;
grant execute on function public.hide_custom_card(uuid, boolean) to authenticated;
grant select on public.custom_cards to authenticated;
