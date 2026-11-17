-- =============================================================================
-- CHAT DE SOIRÉE — idempotent, exécuté APRÈS schema.sql (features/*).
-- Un fil de discussion par soirée (salon + pendant les jeux) : textes courts et
-- stickers chibi. Conservé le temps de la soirée, purgé quand elle se termine.
--   kind = 'text'    : body = message (1..200 caractères)
--   kind = 'sticker' : body = id d'expression (joie, colere, extra1…) ; tenue =
--                      tenue portée par l'auteur AU MOMENT de l'envoi (le sticker
--                      garde son look même si l'auteur se change ensuite).
-- Lecture : membres de la soirée (RLS + Realtime). Écriture : RPC uniquement.
-- =============================================================================

create table if not exists public.soiree_messages (
  id         bigint generated always as identity primary key,
  soiree_id  uuid not null references public.soirees(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('text', 'sticker')),
  body       text not null,
  tenue      text not null default 'default',
  created_at timestamptz not null default now()
);
create index if not exists soiree_messages_soiree_idx on public.soiree_messages(soiree_id, id);

alter table public.soiree_messages enable row level security;
drop policy if exists soiree_messages_select on public.soiree_messages;
create policy soiree_messages_select on public.soiree_messages for select to authenticated
  using (public.is_soiree_member(soiree_id));

revoke all on table public.soiree_messages from anon, authenticated;
grant select on table public.soiree_messages to authenticated;

-- Envoi d'un message. Erreurs : not_in_soiree, soiree_ended, invalid_message, chat_too_fast,
-- expression_locked (sticker de tenue sans le trophée du slot).
-- p_slot : rang du sticker dans la planche de la tenue portée (cf. equip_expression) ; envoyé par le
-- front seulement pour un sticker de tenue. Vérifié par _tenue_slot_ok (features/trophees.sql).
drop function if exists public.send_soiree_message(uuid, text, text);
create or replace function public.send_soiree_message(p_soiree_id uuid, p_kind text, p_body text, p_slot integer default null)
returns bigint language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := public._require_profile();
  v_body  text;
  v_tenue text;
  v_id    bigint;
begin
  if not exists (select 1 from public.soiree_players where soiree_id = p_soiree_id and profile_id = v_me)
     and not exists (select 1 from public.soirees where id = p_soiree_id and host_id = v_me) then
    raise exception 'not_in_soiree';
  end if;
  if not exists (select 1 from public.soirees where id = p_soiree_id and status <> 'ended') then
    raise exception 'soiree_ended';
  end if;

  if p_kind = 'text' then
    v_body := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
    if char_length(v_body) < 1 or char_length(v_body) > 200 then raise exception 'invalid_message'; end if;
  elsif p_kind = 'sticker' then
    v_body := coalesce(p_body, '');
    if v_body !~ '^[a-z0-9_]{1,24}$' then raise exception 'invalid_message'; end if;
  else
    raise exception 'invalid_message';
  end if;

  -- anti-spam : 6 messages au plus par tranche de 10 s
  if (select count(*) from public.soiree_messages
       where soiree_id = p_soiree_id and profile_id = v_me
         and created_at > now() - interval '10 seconds') >= 6 then
    raise exception 'chat_too_fast';
  end if;

  select equipped_tenue into v_tenue from public.profiles where id = v_me;
  if p_kind = 'sticker' and p_slot is not null and coalesce(v_tenue, 'default') <> 'default'
     and not public._tenue_slot_ok(v_me, v_tenue, p_slot) then
    raise exception 'expression_locked';
  end if;
  insert into public.soiree_messages(soiree_id, profile_id, kind, body, tenue)
  values (p_soiree_id, v_me, p_kind, v_body, coalesce(v_tenue, 'default'))
  returning id into v_id;

  -- on ne garde que les 200 derniers messages de la soirée
  delete from public.soiree_messages m
   where m.soiree_id = p_soiree_id
     and m.id < (select x.id from public.soiree_messages x
                  where x.soiree_id = p_soiree_id order by x.id desc offset 199 limit 1);
  return v_id;
end $$;

revoke all on function public.send_soiree_message(uuid, text, text, integer) from public, anon;
grant execute on function public.send_soiree_message(uuid, text, text, integer) to authenticated;

-- Fin de soirée : la discussion est effacée.
create or replace function public._chat_purge()
returns trigger language plpgsql security definer
set search_path = public, extensions
as $$
begin
  delete from public.soiree_messages where soiree_id = new.id;
  return new;
end $$;
revoke all on function public._chat_purge() from public, anon, authenticated;

drop trigger if exists soirees_chat_purge on public.soirees;
create trigger soirees_chat_purge after update of status on public.soirees
  for each row when (new.status = 'ended' and old.status is distinct from 'ended')
  execute function public._chat_purge();

-- Rattrapage : discussions de soirées déjà terminées.
delete from public.soiree_messages m
 using public.soirees s where s.id = m.soiree_id and s.status = 'ended';

-- Realtime (idempotent)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'soiree_messages') then
    alter publication supabase_realtime add table public.soiree_messages;
  end if;
end $$;
