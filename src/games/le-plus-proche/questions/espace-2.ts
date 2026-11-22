import { mk } from './q'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
export const ESPACE_2 = mk('espace', [
  // difficulté 1
  ['Combien de lunes possède la planète Mars ?', 2, 'lunes', 1, 'Phobos et Déimos.'],
  ['Combien d’astronautes composaient l’équipage d’Apollo 11 ?', 3, 'astronautes', 1, 'Neil Armstrong, Buzz Aldrin et Michael Collins.'],
  ['Combien de signes compte le zodiaque ?', 12, 'signes', 1],
  ['Combien de jours la Terre met-elle pour faire le tour du Soleil ?', 365.25, 'jours', 1, 'Environ 365 jours et 6 heures, d’où les années bissextiles.'],
  ['Combien de planètes rocheuses (telluriques) compte le système solaire ?', 4, 'planètes', 1, 'Mercure, Vénus, la Terre et Mars.'],
  ['En quelle année Valentina Terechkova est-elle devenue la première femme dans l’espace ?', 1963, '', 1],
  ['En quelle année Thomas Pesquet est-il parti pour la première fois dans l’espace ?', 2016, '', 1, 'Mission Proxima, de novembre 2016 à juin 2017.'],
  ['En quelle année le télescope spatial James Webb a-t-il été lancé ?', 2021, '', 1, 'Le 25 décembre 2021.'],
  ['En quelle année le télescope spatial Hubble a-t-il été lancé ?', 1990, '', 1],
  ['Tous les combien d’années la comète de Halley revient-elle près de la Terre ?', 76, 'ans', 1, 'Environ 75 à 76 ans.'],
  ['À quelle vitesse la Station spatiale internationale file-t-elle autour de la Terre ?', 27600, 'km/h', 1, 'Environ 27 600 km/h.'],
  ['En quelle année a eu lieu Apollo 17, dernière mission Apollo à se poser sur la Lune ?', 1972, '', 1],
  // difficulté 2
  ['Combien de planètes du système solaire possèdent des anneaux ?', 4, 'planètes', 2, 'Jupiter, Saturne, Uranus et Neptune.'],
  ['Combien de secondes la lumière met-elle pour aller de la Lune à la Terre ?', 1.3, 's', 2, 'Environ 1,3 seconde.'],
  ['Quel pourcentage de la masse du système solaire le Soleil représente-t-il ?', 99.86, '%', 2, 'Environ 99,86 %.'],
  ['En quelle année Pluton a-t-elle été découverte ?', 1930, '', 2, 'Par Clyde Tombaugh.'],
  ['Combien de minutes la Station spatiale internationale met-elle pour faire le tour de la Terre ?', 92, 'min', 2, 'Environ 90 à 93 minutes selon son altitude.'],
  ['En quelle année Jean-Loup Chrétien est-il devenu le premier Français dans l’espace ?', 1982, '', 2],
  ['Combien de jours a duré la mission Apollo 11, du décollage à l’amerrissage ?', 8, 'jours', 2, 'Environ 8 jours et 3 heures (16-24 juillet 1969).'],
  ['Quel est le diamètre de la Lune ?', 3474, 'km', 2, 'Environ 3 474 km, à peu près un quart de celui de la Terre.'],
  ['Combien de fois le diamètre du Soleil est-il plus grand que celui de la Terre ?', 109, 'fois', 2, 'Environ 109 fois.'],
  ['Combien d’années dure une révolution de Saturne autour du Soleil ?', 29.5, 'ans', 2, 'Environ 29,5 ans.'],
  ['En quelle année les sondes Voyager 1 et 2 ont-elles été lancées ?', 1977, '', 2],
  ['De combien de degrés l’axe de rotation de la Terre est-il incliné ?', 23.4, '°', 2, 'Environ 23,4° : c’est ce qui crée les saisons.'],
  // difficulté 3
  ['Combien d’heures dure un jour sur Jupiter (une rotation sur elle-même) ?', 10, 'h', 3, 'Environ 9 h 55 min : la rotation la plus rapide du système solaire.'],
  ['Combien d’années dure une révolution d’Uranus autour du Soleil ?', 84, 'ans', 3],
  ['Combien de kilomètres mesure une année-lumière, en milliards de kilomètres ?', 9460, 'milliards de km', 3, 'Environ 9 461 milliards de km.'],
  ['En quelle année a eu lieu le premier lancement de la fusée européenne Ariane ?', 1979, '', 3, 'Le 24 décembre 1979, depuis Kourou.'],
  ['Combien de Terres pourrait-on faire tenir dans le volume du Soleil ?', 1300000, 'Terres', 3, 'Environ 1,3 million.'],
  ['Quel pourcentage de la pesanteur terrestre ressent-on à la surface de Mars ?', 38, '%', 3, 'Environ 38 %.'],
])
