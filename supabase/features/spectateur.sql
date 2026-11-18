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
