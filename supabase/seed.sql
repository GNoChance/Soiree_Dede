-- =============================================================================
-- Soirées de Dédé — seed des 9 profils (idempotent)
-- À exécuter APRÈS schema.sql. Ne touche jamais au PIN, à l'XP ni au pseudo
-- d'un profil existant (on conflict : prénom, expressions et ordre seulement).
-- =============================================================================

insert into public.profiles (slug, first_name, nickname, expressions, sort_order) values
  ('kevin',  'Kevin',    'Keke',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 1),
  ('cycy',   'Cyrielle', 'Cycy',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 2),
  ('dede',   'Delphine', 'Dédé',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 3),
  ('manon',  'Manon',    'Manon',  array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 4),
  ('mika',   'Michael',  'Mika',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 5),
  ('cecile', 'Cécile',   'Cécile', array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 6),
  ('carole', 'Carole',   'Karo',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','pouces','timide','charmee'], 7),
  ('marius', 'Marius',   'Marius', array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','amoureux','cool','gamer'], 8),
  ('nini',   'Nicolas',  'Nini',   array['joie','colere','pleurs','boude','reflexion','dodo','bisou','clin_oeil','surprise','pouces','timide','gamer'], 9)
on conflict (slug) do update
  set first_name  = excluded.first_name,
      expressions = excluded.expressions,
      sort_order  = excluded.sort_order;

-- Admin
update public.profiles set is_admin = (slug = 'kevin') where is_admin is distinct from (slug = 'kevin');

-- Expression équipée invalide (ex. expressions modifiées) -> retour à 'joie'
update public.profiles set equipped_expression = 'joie'
 where not (equipped_expression = any(expressions));

-- Lignes de stats + déblocage par défaut
insert into public.player_stats (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

insert into public.unlocks (profile_id, expression)
select id, 'joie' from public.profiles
on conflict (profile_id, expression) do nothing;
