import { mk } from './q'

export const QUOTIDIEN = mk('quotidien', [
  // difficulté 1
  ['Combien y a-t-il de secondes dans une heure ?', 3600, 's', 1],
  ['Combien y a-t-il d’heures dans une semaine ?', 168, 'h', 1],
  ['Combien y a-t-il de minutes dans une journée ?', 1440, 'min', 1],
  ['Combien de cartes compte un jeu classique, jokers non compris ?', 52, 'cartes', 1],
  ['Combien de cartes compte un jeu de belote ?', 32, 'cartes', 1],
  ['En quelle année les pièces et billets en euros ont-ils été mis en circulation ?', 2002, '', 1],
  ['Combien de points compte un permis de conduire français au départ ?', 12, 'points', 1, 'Pour un permis définitif ; 6 points en probatoire.'],
  ['Quelle est la durée légale hebdomadaire du travail en France ?', 35, 'h', 1],
  ['Combien de cases compte une grille de Sudoku classique ?', 81, 'cases', 1],
  ['Combien de pièces différentes existent en euros ?', 8, 'pièces', 1, 'De 1 centime à 2 euros.'],
  ['Quelle est la tension d’une pile standard de type AA ?', 1.5, 'V', 1],
  ['Quelle température est recommandée dans un réfrigérateur ?', 4, '°C', 1, 'Entre 4 et 5 °C selon les recommandations.'],
  // difficulté 2
  ['Combien y a-t-il de minutes dans une semaine ?', 10080, 'min', 2],
  ['Combien de cartes compte un jeu de tarot ?', 78, 'cartes', 2],
  ['Combien de dominos compte un jeu de dominos double-six ?', 28, 'dominos', 2],
  ['Combien de cases compte le plateau du Monopoly ?', 40, 'cases', 2],
  ['Combien de petits cubes composent un Rubik’s Cube 3×3 ?', 27, 'cubes', 2, '26 visibles, plus le noyau central.'],
  ['Quelle est la hauteur d’une feuille A4 ?', 297, 'mm', 2, '210 × 297 mm.'],
  ['Combien de chiffres compte un numéro de carte bancaire standard ?', 16, 'chiffres', 2],
  ['Quel est le taux d’alcool légal maximal pour un conducteur en France (hors permis probatoire) ?', 0.5, 'g/L', 2, 'Dans le sang.'],
  ['À quelle température correspond le thermostat 6 d’un four ?', 180, '°C', 2],
  ['Quel volume contient une cuillère à soupe, en valeur usuelle ?', 15, 'mL', 2],
  ['Combien d’étoiles figurent sur le drapeau de l’Union européenne ?', 12, 'étoiles', 2],
  ['Combien de lettres compte le mot « anticonstitutionnellement » ?', 25, 'lettres', 2],
  // difficulté 3
  ['Combien de jetons compte un jeu de Scrabble français ?', 102, 'jetons', 3, 'Jokers compris.'],
  ['Combien de cartes compte un jeu de Uno ?', 108, 'cartes', 3],
  ['Quelle est la somme de tous les points d’un jeu de dominos double-six ?', 168, 'points', 3],
  ['Quel est le poids d’une pièce de 1 euro ?', 7.5, 'g', 3],
  ['Quelle est la largeur d’une carte bancaire standard ?', 85.6, 'mm', 3, 'Format ID-1 : 85,60 × 53,98 mm.'],
  ['Quel est l’écartement standard des rails de chemin de fer (voie normale) ?', 1435, 'mm', 3],
  ['Combien de députés siègent à l’Assemblée nationale française ?', 577, 'députés', 3, 'Nombre fixé par la loi depuis 1986.'],
])
