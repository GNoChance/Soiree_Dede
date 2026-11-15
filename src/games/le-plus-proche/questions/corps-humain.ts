import { mk } from './q'

export const CORPS_HUMAIN = mk('corps-humain', [
  // difficulté 1
  ['Combien d’os compte le squelette d’un adulte ?', 206, 'os', 1],
  ['Combien de dents compte une dentition adulte complète, dents de sagesse comprises ?', 32, 'dents', 1],
  ['Combien de chromosomes compte une cellule humaine ordinaire ?', 46, 'chromosomes', 1],
  ['Quelle est la température normale du corps humain, en valeur usuelle ?', 37, '°C', 1, 'Entre 36,5 et 37,5 °C selon les personnes et le moment.'],
  ['Quel volume de sang contient le corps d’un adulte ?', 5, 'L', 1, 'Environ 5 L (4,5 à 5,5 L).'],
  ['Combien de vertèbres cervicales compte le cou humain ?', 7, 'vertèbres', 1],
  ['Combien de côtes compte la cage thoracique d’un adulte (au total) ?', 24, 'côtes', 1, '12 paires.'],
  ['Quelle est la fréquence cardiaque moyenne au repos d’un adulte ?', 70, 'battements/min', 1, 'Valeur normale entre 60 et 100 battements par minute.'],
  ['Combien de paires de chromosomes compte l’être humain ?', 23, 'paires', 1],
  ['Combien de dents de lait compte un enfant ?', 20, 'dents', 1],
  ['Combien de vertèbres compte la colonne vertébrale (sacrum et coccyx comptés en vertèbres soudées) ?', 33, 'vertèbres', 1, '7 cervicales, 12 thoraciques, 5 lombaires, 5 sacrées et 4 coccygiennes.'],
  ['Combien de paires de nerfs crâniens compte l’être humain ?', 12, 'paires', 1],
  // difficulté 2
  ['Combien d’os compte une main humaine (poignet compris) ?', 27, 'os', 2],
  ['Combien d’os compte un pied humain ?', 26, 'os', 2],
  ['Combien d’osselets compte l’oreille d’un être humain (les deux oreilles au total) ?', 6, 'osselets', 2, '3 par oreille : marteau, enclume et étrier.'],
  ['Quel pourcentage du poids d’un adulte est constitué d’eau ?', 60, '%', 2, 'Environ 60 % (50 à 65 % selon l’âge et le sexe).'],
  ['Quelle est la surface approximative de la peau d’un adulte ?', 2, 'm²', 2, 'Environ 1,7 à 2 m².'],
  ['Quel est le poids moyen du cerveau d’un adulte ?', 1.4, 'kg', 2, 'Environ 1,3 à 1,4 kg.'],
  ['Combien de fois le cœur bat-il environ en une journée ?', 100000, 'battements', 2, 'Environ 100 000 battements par jour.'],
  ['Combien de saveurs de base la langue distingue-t-elle ?', 5, 'saveurs', 2, 'Sucré, salé, acide, amer et umami.'],
  ['Combien de fois respire-t-on environ par minute au repos, pour un adulte ?', 15, 'respirations/min', 2, 'Entre 12 et 20.'],
  ['Quel est le poids moyen du cœur d’un adulte ?', 300, 'g', 2, 'Environ 250 à 350 g.'],
  ['Quelle est la durée de vie moyenne d’un globule rouge ?', 120, 'jours', 2],
  ['Combien de vertèbres thoraciques compte la colonne vertébrale ?', 12, 'vertèbres', 2],
  // difficulté 3
  ['Combien d’os forment le crâne humain (crâne et face) ?', 22, 'os', 3],
  ['Combien de paires de nerfs rachidiens compte l’être humain ?', 31, 'paires', 3],
  ['Combien d’os environ compte un nouveau-né ?', 300, 'os', 3, 'Environ 270 à 300 ; beaucoup se soudent en grandissant.'],
  ['Combien de neurones contient en moyenne le cerveau humain ?', 86, 'milliards', 3, 'Estimation de 2009 : environ 86 milliards (et non 100).'],
  ['Quel est le poids moyen du foie d’un adulte ?', 1.5, 'kg', 3, 'Environ 1,4 à 1,6 kg.'],
  ['Quelle est la longueur de l’étrier, le plus petit os du corps humain ?', 3, 'mm', 3, 'Environ 3 mm.'],
  ['Quel pourcentage de l’énergie du corps le cerveau consomme-t-il environ ?', 20, '%', 3, 'Environ 20 % pour environ 2 % de la masse corporelle.'],
])
