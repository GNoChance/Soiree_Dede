import { mk } from './q'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
export const SPORT_2 = mk('sport', [
  // difficulté 1
  ['Combien de joueurs par équipe sont sur le terrain au volley-ball ?', 6, 'joueurs', 1],
  ['Combien de joueurs par équipe sont sur le terrain au handball, gardien compris ?', 7, 'joueurs', 1],
  ['Combien de minutes dure un match de football, hors arrêts de jeu et prolongations ?', 90, 'min', 1],
  ['Combien de fois l’équipe de France masculine a-t-elle remporté la Coupe du monde de football entre 1930 et 2022 ?', 2, 'fois', 1, 'En 1998 et en 2018.'],
  ['Combien d’étapes compte en général le Tour de France ?', 21, 'étapes', 1],
  ['Combien de tournois du Grand Chelem se disputent chaque année au tennis ?', 4, 'tournois', 1, 'Open d’Australie, Roland-Garros, Wimbledon et US Open.'],
  ['Combien d’anneaux figurent sur le drapeau olympique ?', 5, 'anneaux', 1],
  ['Combien de quilles faut-il renverser pour faire un strike au bowling ?', 10, 'quilles', 1],
  ['Combien de points rapporte un essai au rugby à XV ?', 5, 'points', 1],
  ['Combien de minutes dure un round de boxe professionnelle ?', 3, 'min', 1],
  ['Combien de fois Paris a-t-elle accueilli les Jeux olympiques d’été ?', 3, 'fois', 1, 'En 1900, 1924 et 2024.'],
  ['Combien de points rapporte une victoire en championnat de football ?', 3, 'points', 1],
  // difficulté 2
  ['Quelle est la hauteur du filet de volley-ball pour les hommes ?', 2.43, 'm', 2, '2,24 m pour les femmes.'],
  ['Combien de tours de piste faut-il courir pour un 10 000 m sur piste ?', 25, 'tours', 2],
  ['Quel est le score maximal d’une partie de bowling ?', 300, 'points', 2, '12 strikes d’affilée.'],
  ['Combien de Ballons d’or Lionel Messi a-t-il remportés entre 2009 et 2023 ?', 8, 'Ballons d’or', 2, 'Le record absolu (2009, 2010, 2011, 2012, 2015, 2019, 2021 et 2023).'],
  ['Combien de buts Kylian Mbappé a-t-il marqués en finale de la Coupe du monde 2022 ?', 3, 'buts', 2, 'Un triplé, hors tirs au but.'],
  ['Combien de fois Bernard Hinault a-t-il remporté le Tour de France ?', 5, 'victoires', 2],
  ['Combien de fois Roger Federer a-t-il remporté Wimbledon en simple ?', 8, 'titres', 2],
  ['Combien de médailles d’or la France a-t-elle remportées aux Jeux olympiques de Paris 2024 ?', 16, 'médailles', 2, '64 médailles au total.'],
  ['Combien de médailles d’or olympiques Teddy Riner a-t-il remportées jusqu’aux Jeux de Paris 2024, en individuel et par équipes ?', 5, 'médailles', 2, 'Trois en individuel (2012, 2016, 2024) et deux par équipes (2021, 2024).'],
  ['Combien de titres de champion du monde de Formule 1 Michael Schumacher a-t-il remportés ?', 7, 'titres', 2],
  ['Combien de Coupes du monde de football le Brésil a-t-il remportées entre 1930 et 2022 ?', 5, 'titres', 2, 'Le record (1958, 1962, 1970, 1994 et 2002).'],
  ['En combien de secteurs numérotés est divisée une cible de fléchettes ?', 20, 'secteurs', 2],
  // difficulté 3
  ['À quelle distance du panier se situe la ligne à 3 points en NBA (dans l’axe) ?', 7.24, 'm', 3, '6,75 m selon les règles FIBA.'],
  ['Quel est le diamètre intérieur d’un panier de basket ?', 45, 'cm', 3],
  ['Combien de médailles d’or olympiques Usain Bolt a-t-il conservées ?', 8, 'médailles', 3, 'Il en a gagné 9, mais celle du relais 4 × 100 m de 2008 lui a été retirée.'],
  ['Quelle est la hauteur des haies du 110 m haies masculin ?', 106.7, 'cm', 3],
  ['Combien d’étapes du Tour de France Mark Cavendish a-t-il remportées ?', 35, 'étapes', 3, 'Le record, battu en 2024 devant Eddy Merckx (34).'],
  ['Combien de titres du Grand Chelem en simple Serena Williams a-t-elle remportés ?', 23, 'titres', 3],
])
