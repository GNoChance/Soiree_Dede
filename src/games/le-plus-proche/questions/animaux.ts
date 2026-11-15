import { mk } from './q'

export const ANIMAUX = mk('animaux', [
  // difficulté 1
  ['Combien de pattes a une araignée ?', 8, 'pattes', 1],
  ['Combien de bras a une pieuvre ?', 8, 'bras', 1],
  ['Combien de cœurs possède une pieuvre ?', 3, 'cœurs', 1],
  ['Combien de vertèbres cervicales a une girafe ?', 7, 'vertèbres', 1, 'Autant qu’un être humain.'],
  ['Quelle est la hauteur d’une girafe adulte ?', 5, 'm', 1, 'Environ 4,5 à 5,5 m pour un mâle.'],
  ['Quelle est la vitesse de pointe d’un guépard ?', 110, 'km/h', 1, 'Environ 100 à 120 km/h sur de courtes distances.'],
  ['Combien de mois dure la gestation d’une éléphante ?', 22, 'mois', 1],
  ['Combien de pattes (pinces comprises) a un crabe ?', 10, 'pattes', 1],
  ['Quelle est la vitesse de pointe d’une autruche ?', 70, 'km/h', 1, 'Environ 70 km/h.'],
  ['Quel est le poids moyen d’un œuf de poule ?', 60, 'g', 1, 'Environ 50 à 65 g.'],
  ['Combien d’heures par jour un koala dort-il ?', 20, 'h', 1, 'Entre 18 et 22 heures.'],
  ['Combien d’heures par jour un chat dort-il environ ?', 15, 'h', 1, 'Entre 12 et 16 heures.'],
  // difficulté 2
  ['Combien de dents compte un chien adulte ?', 42, 'dents', 2],
  ['Quel est le poids approximatif d’un éléphant d’Afrique mâle adulte ?', 6, 't', 2, 'Environ 5 à 6 tonnes.'],
  ['Combien de compartiments compte l’estomac d’une vache ?', 4, 'compartiments', 2, 'Rumen, réseau, feuillet et caillette.'],
  ['Combien d’yeux ont la plupart des araignées ?', 8, 'yeux', 2],
  ['Combien de pattes a un cloporte ?', 14, 'pattes', 2],
  ['Combien de jours dure la gestation d’une chienne ?', 63, 'jours', 2, 'Environ 63 jours (58 à 68).'],
  ['Quel est le poids d’un œuf d’autruche ?', 1.5, 'kg', 2, 'Environ 1,4 à 1,6 kg.'],
  ['Combien de dents un requin blanc a-t-il en bouche à un instant donné ?', 300, 'dents', 2, 'Environ 300 dents, réparties en plusieurs rangées.'],
  ['Combien d’yeux possède une abeille (yeux composés et ocelles compris) ?', 5, 'yeux', 2, '2 yeux composés et 3 ocelles.'],
  ['Quelle est la longueur de la langue d’une girafe ?', 45, 'cm', 2, 'Environ 45 à 50 cm.'],
  ['Combien de dents compte un chat adulte ?', 30, 'dents', 2],
  ['Quel est le poids d’un éléphanteau à la naissance ?', 100, 'kg', 2, 'Environ 90 à 120 kg.'],
  // difficulté 3
  ['Combien de battements d’ailes par seconde une abeille domestique réalise-t-elle environ ?', 230, 'battements/s', 3, 'Environ 230 battements par seconde.'],
  ['Combien d’œufs une reine abeille peut-elle pondre au maximum en une journée ?', 2000, 'œufs', 3, 'Jusqu’à environ 2 000 par jour en pleine saison.'],
  ['Quel est le poids d’un bébé kangourou à la naissance ?', 1, 'g', 3, 'Environ 1 g (moins de 1 g pour un kangourou roux).'],
  ['Combien de mois dure la gestation d’une girafe ?', 15, 'mois', 3, 'Environ 15 mois (environ 450 jours).'],
  ['Combien de dents compte un lapin ?', 28, 'dents', 3],
  ['Combien de dents compte une souris ?', 16, 'dents', 3],
  ['Combien de jours dure l’incubation d’un œuf de poule ?', 21, 'jours', 3],
])
