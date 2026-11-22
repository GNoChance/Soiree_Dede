import { mk } from './q'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
export const QUOTIDIEN_2 = mk('quotidien', [
  // difficulté 1
  ['Quel est le poids habituel d’une baguette de pain ?', 250, 'g', 1, 'Environ 250 g.'],
  ['Combien de cases compte un échiquier ?', 64, 'cases', 1],
  ['Quel volume contient une canette de soda standard ?', 33, 'cL', 1],
  ['Quel volume contient une bouteille de vin standard ?', 75, 'cL', 1],
  ['Combien de feuilles compte une ramette de papier ?', 500, 'feuilles', 1],
  ['Combien de chiffres compte un numéro de téléphone français ?', 10, 'chiffres', 1],
  ['Quel volume contient une cuillère à café, en valeur usuelle ?', 5, 'mL', 1],
  ['Combien de minutes faut-il cuire un œuf à la coque dans l’eau bouillante ?', 3, 'min', 1, 'Environ 3 minutes.'],
  ['Combien de caractères (lettres et chiffres) compte une plaque d’immatriculation française actuelle ?', 7, 'caractères', 1, 'Format AB-123-CD, en place depuis 2009.'],
  ['Combien de grammes pèse une livre, l’ancienne unité encore utilisée au marché ?', 500, 'g', 1],
  ['Quelle est la vitesse maximale autorisée sur autoroute en France, par temps sec ?', 130, 'km/h', 1],
  ['Combien de chiffres compte le code secret d’une carte bancaire ?', 4, 'chiffres', 1],
  // difficulté 2
  ['Sur un dé classique, combien vaut la somme de deux faces opposées ?', 7, '', 2],
  ['Combien de points compte un dé classique au total, toutes faces additionnées ?', 21, 'points', 2],
  ['Combien de pions possède chaque joueur au début d’une partie de dames (damier 10 × 10) ?', 20, 'pions', 2],
  ['Combien de cartes chaque joueur reçoit-il au début d’une partie de Uno ?', 7, 'cartes', 2],
  ['Combien de points vaut la lettre Z au Scrabble français ?', 10, 'points', 2],
  ['Quel est le diamètre d’un CD ?', 12, 'cm', 2],
  ['Combien de chiffres compte un code-barres standard (EAN-13) ?', 13, 'chiffres', 2],
  ['Combien de lettres chaque joueur a-t-il sur son chevalet au Scrabble ?', 7, 'lettres', 2],
  ['Combien de cases compte une roulette de casino française, zéro compris ?', 37, 'cases', 2, 'De 0 à 36.'],
  ['Parmi combien de numéros choisit-on ses 5 numéros au Loto français ?', 49, 'numéros', 2, 'Plus un numéro chance parmi 10.'],
  ['Combien de cases compte le jeu de l’oie ?', 63, 'cases', 2],
  ['De combien de degrés tourne l’aiguille des minutes en une minute ?', 6, '°', 2, '360° en 60 minutes.'],
  // difficulté 3
  ['Combien de feuilles A4 faut-il pour couvrir une feuille A0 ?', 16, 'feuilles', 3, 'Une feuille A0 mesure 1 m².'],
  ['Quelle est la hauteur d’une porte intérieure standard en France ?', 204, 'cm', 3, 'Format standard : 204 × 83 cm.'],
  ['Combien de chiffres compte un numéro de sécurité sociale français, clé comprise ?', 15, 'chiffres', 3, '13 chiffres et une clé de 2 chiffres.'],
  ['Combien de caractères compte un IBAN français ?', 27, 'caractères', 3, 'Il commence toujours par FR.'],
  ['Combien de cartes compte un jeu de 7 familles classique ?', 42, 'cartes', 3, '7 familles de 6 personnages.'],
  ['Combien de fois les aiguilles des heures et des minutes se superposent-elles en 12 heures ?', 11, 'fois', 3, 'Environ toutes les 65 minutes.'],
])
