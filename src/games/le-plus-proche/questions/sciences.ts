import { mk } from './q'

export const SCIENCES = mk('sciences', [
  // difficulté 1
  ['Quelle est la température du zéro absolu, en degrés Celsius ?', -273.15, '°C', 1],
  ['Quelle est la valeur usuelle de l’accélération de la pesanteur à la surface de la Terre ?', 9.81, 'm/s²', 1],
  ['Quelle est la vitesse du son dans l’air à 20 °C ?', 343, 'm/s', 1],
  ['En quelle année les frères Wright ont-ils réalisé le premier vol motorisé ?', 1903, '', 1],
  ['Quel est le numéro atomique du carbone ?', 6, '', 1],
  ['Quel est le numéro atomique de l’oxygène ?', 8, '', 1],
  ['Quel pourcentage de l’air sec est constitué d’azote ?', 78, '%', 1, 'Environ 78 % (l’oxygène représente environ 21 %).'],
  ['Combien vaut 2 puissance 10 ?', 1024, '', 1],
  ['Combien y a-t-il de secondes dans une journée ?', 86400, 's', 1],
  ['En quelle année Charles Darwin a-t-il publié « L’Origine des espèces » ?', 1859, '', 1],
  ['Quelle est la tension nominale du courant domestique en France ?', 230, 'V', 1],
  ['Quelle est la fréquence du courant alternatif du réseau électrique français ?', 50, 'Hz', 1],
  // difficulté 2
  ['Quelle est la vitesse de la lumière dans le vide ?', 299792, 'km/s', 2, 'Exactement 299 792,458 km/s.'],
  ['Quel est le numéro atomique de l’or ?', 79, '', 2],
  ['Quel est le numéro atomique du fer ?', 26, '', 2],
  ['Quel est le numéro atomique de l’uranium ?', 92, '', 2],
  ['Combien d’éléments compte le tableau périodique actuel ?', 118, 'éléments', 2, 'Complet depuis 2016.'],
  ['En quelle année la structure en double hélice de l’ADN a-t-elle été publiée par Watson et Crick ?', 1953, '', 2],
  ['En quelle année Albert Einstein a-t-il publié la théorie de la relativité restreinte ?', 1905, '', 2],
  ['En quelle année Alexander Fleming a-t-il découvert la pénicilline ?', 1928, '', 2],
  ['Combien vaut 2 puissance 16 ?', 65536, '', 2],
  ['Combien y a-t-il de nombres premiers inférieurs à 100 ?', 25, 'nombres', 2],
  ['Quelle est la valeur approchée du nombre d’or, à trois décimales près ?', 1.618, '', 2],
  ['À quelle température l’eau bout-elle sous pression normale, en kelvins ?', 373, 'K', 2, '373,15 K.'],
  // difficulté 3
  ['En quelle année Isaac Newton a-t-il publié ses « Principia Mathematica » ?', 1687, '', 3],
  ['En quelle année l’électron a-t-il été découvert par J. J. Thomson ?', 1897, '', 3],
  ['En quelle année Alessandro Volta a-t-il présenté sa pile électrique ?', 1800, '', 3],
  ['À quelle température l’or fond-il ?', 1064, '°C', 3, 'Environ 1 064 °C.'],
  ['Quelle est la masse volumique de l’or ?', 19.3, 'g/cm³', 3, 'Environ 19,3 g/cm³.'],
  ['Combien y a-t-il de nombres premiers inférieurs à 1 000 ?', 168, 'nombres', 3],
  ['Combien vaut 10 factorielle (1 × 2 × 3 × … × 10) ?', 3628800, '', 3],
])
