import { mk } from './q'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
export const CORPS_HUMAIN_2 = mk('corps-humain', [
  // difficulté 1
  ['Combien de vertèbres lombaires compte la colonne vertébrale ?', 5, 'vertèbres', 1],
  ['Combien de cavités (oreillettes et ventricules) compte le cœur humain ?', 4, 'cavités', 1, '2 oreillettes et 2 ventricules.'],
  ['Quelle est la taille moyenne d’un bébé à la naissance ?', 50, 'cm', 1, 'Environ 50 cm.'],
  ['Quel est le poids moyen d’un bébé à la naissance ?', 3.3, 'kg', 1, 'Environ 3,3 kg (le plus souvent entre 2,5 et 4 kg).'],
  ['Combien de dents de sagesse peut-on avoir au maximum ?', 4, 'dents', 1],
  ['Combien d’incisives compte une dentition adulte ?', 8, 'incisives', 1],
  ['Combien de bases azotées différentes composent l’ADN ?', 4, 'bases', 1, 'Adénine, thymine, cytosine et guanine.'],
  ['Combien de groupes sanguins compte le système ABO ?', 4, 'groupes', 1, 'A, B, AB et O.'],
  ['Combien de jours dure en moyenne un cycle menstruel ?', 28, 'jours', 1, 'Environ 28 jours, avec de fortes variations d’une personne à l’autre.'],
  ['À partir de quelle température corporelle parle-t-on généralement de fièvre ?', 38, '°C', 1],
  ['De combien les cheveux poussent-ils environ en un mois ?', 1, 'cm', 1, 'Environ 1 cm par mois (0,9 à 1,2 cm selon les personnes).'],
  ['Combien de mois dure une grossesse humaine ?', 9, 'mois', 1],
  // difficulté 2
  ['Combien de muscles compte environ le corps humain ?', 600, 'muscles', 2, 'Plus de 600 selon les décomptes.'],
  ['Combien de lobes compte le poumon droit ?', 3, 'lobes', 2, 'Le poumon gauche n’en compte que 2, pour laisser de la place au cœur.'],
  ['Combien de phalanges compte une main humaine ?', 14, 'phalanges', 2, '3 par doigt et 2 pour le pouce.'],
  ['Combien de fois cligne-t-on des yeux par minute, en moyenne ?', 15, 'clignements/min', 2, 'Environ 15 à 20 fois par minute.'],
  ['Combien de cheveux compte en moyenne une tête humaine ?', 100000, 'cheveux', 2, 'Environ 100 000 à 150 000.'],
  ['Combien de molaires compte une dentition adulte complète, dents de sagesse comprises ?', 12, 'molaires', 2],
  ['Quelle est la longueur moyenne du fémur d’un adulte, l’os le plus long du corps ?', 45, 'cm', 2, 'Environ 45 à 50 cm, soit à peu près un quart de la taille.'],
  ['Combien de litres de sang le cœur pompe-t-il par minute au repos ?', 5, 'L/min', 2, 'Environ 5 L par minute (débit cardiaque).'],
  ['Combien de paires de côtes « flottantes » (non rattachées au sternum) compte la cage thoracique ?', 2, 'paires', 2, 'Les 11e et 12e paires.'],
  ['Quel volume d’urine un adulte produit-il environ par jour ?', 1.5, 'L', 2, 'Environ 1 à 2 L selon ce que l’on boit.'],
  ['Combien de minutes dure en moyenne un cycle de sommeil ?', 90, 'min', 2, 'Environ 90 minutes (de 60 à 120 minutes).'],
  ['Vers quel âge apparaît généralement la première dent de lait d’un bébé ?', 6, 'mois', 2, 'Vers 6 mois en général (de 4 à 10 mois).'],
  // difficulté 3
  ['Quel est le pH normal du sang humain ?', 7.4, '', 3, 'Entre 7,35 et 7,45 : légèrement basique.'],
  ['Quel est le diamètre d’un globe oculaire adulte ?', 24, 'mm', 3, 'Environ 24 mm.'],
  ['Quelle vitesse peut atteindre l’influx nerveux dans les fibres nerveuses les plus rapides ?', 120, 'm/s', 3, 'Jusqu’à environ 120 m/s, soit plus de 400 km/h.'],
  ['Combien de globules rouges contient un millimètre cube de sang, en millions ?', 5, 'millions', 3, 'Environ 4,5 à 5,5 millions par mm³.'],
  ['Combien de cellules compte environ le corps humain, en milliers de milliards ?', 30, 'milliers de milliards', 3, 'Estimations récentes : environ 30 000 à 37 000 milliards de cellules.'],
  ['Combien d’os forment le poignet (le carpe) ?', 8, 'os', 3],
])
