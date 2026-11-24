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
