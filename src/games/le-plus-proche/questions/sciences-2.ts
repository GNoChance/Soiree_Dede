import { mk } from './q'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
export const SCIENCES_2 = mk('sciences', [
  // difficulté 1
  ['Combien vaut la somme des angles d’un triangle ?', 180, '°', 1],
  ['Quel est le numéro atomique de l’hélium ?', 2, '', 1],
  ['Quelle est la valeur du nombre pi, arrondie au centième ?', 3.14, '', 1],
  ['Quelle est la masse d’un mètre cube d’eau ?', 1000, 'kg', 1],
  ['Combien y a-t-il de centimètres carrés dans un mètre carré ?', 10000, 'cm²', 1],
  ['Combien de kilomètres mesure un mile terrestre ?', 1.609, 'km', 1, 'Exactement 1,609344 km.'],
  ['Combien de centimètres mesure un pouce ?', 2.54, 'cm', 1],
  ['Quel est le pH de l’eau pure à 25 °C ?', 7, '', 1, 'Un pH neutre.'],
  ['Combien d’arêtes compte un cube ?', 12, 'arêtes', 1],
  ['Combien de prix Nobel Marie Curie a-t-elle reçus ?', 2, 'prix', 1, 'Physique en 1903 et chimie en 1911.'],
  ['Combien de zéros compte un milliard écrit en chiffres ?', 9, 'zéros', 1],
  ['Combien de bits compte un octet ?', 8, 'bits', 1],
  // difficulté 2
  ['Quel est le numéro atomique du cuivre ?', 29, '', 2],
  ['Combien de grammes pèse une livre anglaise (pound) ?', 453.6, 'g', 2, 'Exactement 453,59237 g.'],
  ['À quelle température l’azote liquide bout-il ?', -196, '°C', 2, 'Environ −196 °C.'],
  ['Combien de diagonales compte un hexagone ?', 9, 'diagonales', 2],
  ['Combien de faces compte un icosaèdre ?', 20, 'faces', 2, 'La forme du dé à 20 faces.'],
  ['Quelle est la valeur de la racine carrée de 2, à trois décimales près ?', 1.414, '', 2],
  ['Quelle est la vitesse du son dans l’eau ?', 1500, 'm/s', 2, 'Environ 1 500 m/s (environ 1 480 m/s dans l’eau douce à 20 °C).'],
  ['En quelle année Graham Bell a-t-il breveté le téléphone ?', 1876, '', 2],
  ['En quelle année Thomas Edison a-t-il mis au point son ampoule électrique à incandescence durable ?', 1879, '', 2, 'D’autres inventeurs avaient déjà réalisé des prototypes avant lui.'],
  ['En quelle année Louis Pasteur a-t-il administré pour la première fois son vaccin contre la rage à un humain ?', 1885, '', 2, 'Au jeune Joseph Meister, en juillet 1885.'],
  ['Combien de grammes de sel contient en moyenne un litre d’eau de mer ?', 35, 'g', 2, 'Environ 35 g par litre en moyenne.'],
  ['À combien de degrés Fahrenheit correspond 0 °C ?', 32, '°F', 2],
  // difficulté 3
  ['Quel est le numéro atomique de l’argent ?', 47, '', 3],
  ['Quelle est la valeur du nombre e (base des logarithmes naturels), à trois décimales près ?', 2.718, '', 3],
  ['Quelle est la demi-vie du carbone 14, utilisé pour dater les fossiles ?', 5730, 'ans', 3, 'Environ 5 730 ans.'],
  ['En quelle année Dmitri Mendeleïev a-t-il présenté son tableau périodique des éléments ?', 1869, '', 3],
  ['En quelle année Henri Becquerel a-t-il découvert la radioactivité ?', 1896, '', 3],
  ['À quelle température le fer fond-il ?', 1538, '°C', 3, 'Environ 1 538 °C.'],
])
