import { mk } from './q'

export const SPORT = mk('sport', [
  // difficulté 1
  ['Quelle est la longueur officielle d’un marathon ?', 42.195, 'km', 1],
  ['À quelle distance du but se tire un penalty au football ?', 11, 'm', 1],
  ['Quelle est la longueur d’une piscine olympique ?', 50, 'm', 1],
  ['En quelle année ont eu lieu les premiers Jeux olympiques modernes, à Athènes ?', 1896, '', 1],
  ['En quelle année a eu lieu le premier Tour de France cycliste ?', 1903, '', 1],
  ['En quelle année l’équipe de France a-t-elle gagné sa première Coupe du monde de football ?', 1998, '', 1],
  ['Combien de minutes dure un match de rugby, hors prolongations ?', 80, 'min', 1],
  ['À quelle hauteur du sol se situe un panier de basket ?', 3.05, 'm', 1],
  ['Combien de trous compte un parcours de golf standard ?', 18, 'trous', 1],
  ['Quel est le score maximal avec trois fléchettes ?', 180, 'points', 1],
  ['Quelle est la longueur d’un tour de piste d’athlétisme standard ?', 400, 'm', 1],
  ['Combien de pièces compte chaque joueur au début d’une partie d’échecs ?', 16, 'pièces', 1],
  // difficulté 2
  ['Quelle est la largeur d’un but de football ?', 7.32, 'm', 2],
  ['Quelle est la hauteur d’un but de football ?', 2.44, 'm', 2],
  ['En quelle année a eu lieu la première Coupe du monde de football ?', 1930, '', 2, 'En Uruguay.'],
  ['En quelle année ont eu lieu les premiers Jeux olympiques d’hiver, à Chamonix ?', 1924, '', 2],
  ['Combien de titres à Roland-Garros Rafael Nadal a-t-il remportés en simple ?', 14, 'titres', 2],
  ['Combien de médailles d’or olympiques Michael Phelps a-t-il remportées au cours de sa carrière ?', 23, 'médailles', 2],
  ['Combien de buts Just Fontaine a-t-il marqués lors de la Coupe du monde 1958 ?', 13, 'buts', 2],
  ['Combien de titres NBA Michael Jordan a-t-il remportés avec les Bulls ?', 6, 'titres', 2],
  ['Combien de minutes dure un match de NBA, hors prolongations ?', 48, 'min', 2],
  ['À quelle hauteur se situe la plateforme de plongeon la plus haute aux Jeux olympiques ?', 10, 'm', 2],
  ['Quelle est la longueur d’un terrain de basket aux normes FIBA ?', 28, 'm', 2],
  ['Quelle est la distance à vélo d’un Ironman ?', 180, 'km', 2, 'Environ 180 km (3,8 km de natation et un marathon).'],
  // difficulté 3
  ['Quelle est la longueur d’un court de tennis ?', 23.77, 'm', 3],
  ['Quelle est la hauteur du filet de tennis au centre du court ?', 91.4, 'cm', 3, '1,07 m aux poteaux.'],
  ['Combien de notes parfaites de 10 Nadia Comăneci a-t-elle obtenues aux Jeux de Montréal en 1976 ?', 7, 'notes', 3],
  ['Combien de points Wilt Chamberlain a-t-il marqués lors de son match de 1962 contre les Knicks ?', 100, 'points', 3],
  ['Quel est le score maximal d’un break au snooker ?', 147, 'points', 3, '15 rouges + 15 noires + toutes les couleurs.'],
  ['Quel est le poids du poids masculin en athlétisme ?', 7.26, 'kg', 3],
  ['Quelle est la longueur d’une table de tennis de table ?', 2.74, 'm', 3],
])
