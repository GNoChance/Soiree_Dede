import { build, type Row } from './_helpers'

const F = 'À quel pays appartient ce drapeau ?'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
const rows: Row[] = [
  [1, F, 'Le Portugal', 'L’Espagne;Le Brésil;La Bolivie', 'Portugal', '', 'pt'],
  [1, F, 'La Suède', 'La Finlande;Le Danemark;La Norvège', 'Suède;Suede', '', 'se'],
  [1, F, 'L’Ukraine', 'La Suède;La Roumanie;La Pologne', 'Ukraine', '', 'ua'],
  [1, 'Quelle est la capitale de l’Italie ?', 'Rome', 'Milan;Naples;Florence', 'Roma'],
  [1, 'Quel fleuve traverse Paris ?', 'La Seine', 'La Loire;La Marne;Le Rhône', 'Seine'],
  [1, 'Quelle mer borde Marseille, Nice et Toulon ?', 'La mer Méditerranée', 'La mer du Nord;L’océan Atlantique;La mer Noire', 'Méditerranée;Mer Méditerranée'],
  [1, 'Quelle île française est surnommée « l’île de Beauté » ?', 'La Corse', 'La Sardaigne;La Réunion;Belle-Île', 'Corse'],
  [1, 'Quelle ville italienne est célèbre pour ses canaux et ses gondoles ?', 'Venise', 'Florence;Vérone;Naples', 'Venezia'],
  [1, 'Quel est le plus grand pays d’Amérique du Sud ?', 'Le Brésil', 'L’Argentine;Le Pérou;La Colombie', 'Brésil;Bresil'],
  [1, 'Dans quelle chaîne de montagnes se trouve le mont Blanc ?', 'Les Alpes', 'Les Pyrénées;Le Jura;Le Massif central', 'Alpes'],
  [1, 'Combien d’États composent les États-Unis ?', '50', '48;51;52', 'cinquante'],
  [1, 'Quelle ville est surnommée « la Grosse Pomme » ?', 'New York', 'Chicago;Los Angeles;San Francisco', 'New-York;NYC'],
  [1, 'Dans quelle ville se trouve le Kremlin ?', 'Moscou', 'Saint-Pétersbourg;Kiev;Minsk', 'Moscow'],
  [1, 'Quelles chutes célèbres se trouvent à la frontière entre le Canada et les États-Unis ?', 'Les chutes du Niagara', 'Les chutes Victoria;Les chutes d’Iguaçu;Les chutes de l’Ange', 'Niagara;Chutes du Niagara'],
  [1, 'Quelle région française a pour capitale Rennes ?', 'La Bretagne', 'La Normandie;Les Pays de la Loire;Le Centre-Val de Loire', 'Bretagne'],
  [2, F, 'Le Maroc', 'Le Vietnam;La Tunisie;La Turquie', 'Maroc', '', 'ma'],
  [2, F, 'Le Liban', 'Chypre;L’Autriche;Le Pérou', 'Liban', '', 'lb'],
  [2, F, 'Le Vietnam', 'La Chine;Le Maroc;La Corée du Nord', 'Vietnam;Viêt Nam;Viet Nam', '', 'vn'],
  [2, 'Quelle est la capitale du Maroc ?', 'Rabat', 'Casablanca;Marrakech;Fès'],
  [2, 'Quel fleuve traverse Londres ?', 'La Tamise', 'La Severn;La Clyde;La Mersey', 'Tamise;Thames'],
  [2, 'Quelle est la capitale de la Norvège ?', 'Oslo', 'Bergen;Stockholm;Trondheim'],
  [2, 'Quelle est la capitale de l’Argentine ?', 'Buenos Aires', 'Córdoba;Rosario;Montevideo', 'Buenos-Aires'],
  [2, 'Quel fleuve forme la Camargue avant de se jeter dans la Méditerranée ?', 'Le Rhône', 'La Durance;Le Var;L’Hérault', 'Rhône;Rhone'],
  [2, 'Quelle ville est surnommée « la capitale des Gaules » ?', 'Lyon', 'Paris;Vienne;Autun'],
  [2, 'Quel canal relie la mer Méditerranée à la mer Rouge ?', 'Le canal de Suez', 'Le canal de Panama;Le canal de Corinthe;Le canal du Midi', 'Suez;Canal de Suez'],
  [2, 'Quelle est la capitale de l’Écosse ?', 'Édimbourg', 'Glasgow;Aberdeen;Dundee', 'Edimbourg;Edinburgh'],
  [2, 'Quelle est la capitale de la Pologne ?', 'Varsovie', 'Cracovie;Gdansk;Wroclaw', 'Warszawa'],
  [2, 'Dans quel océan se trouve l’île de La Réunion ?', 'L’océan Indien', 'L’océan Atlantique;L’océan Pacifique;L’océan Austral', 'Indien;Océan Indien'],
  [2, 'Quel petit pays est niché dans les Pyrénées, entre la France et l’Espagne ?', 'L’Andorre', 'Monaco;Le Liechtenstein;Saint-Marin', 'Andorre;Andorra'],
  [2, 'Quel est le plus long fleuve d’Amérique du Sud ?', 'L’Amazone', 'L’Orénoque;Le Paraná;Le Magdalena', 'Amazone'],
  [3, F, 'La Croatie', 'La Serbie;La Slovénie;La Slovaquie', 'Croatie', '', 'hr'],
  [3, F, 'Le Kenya', 'Le Malawi;Le Soudan du Sud;La Tanzanie', 'Kenya', '', 'ke'],
  [3, 'Quel est le point culminant des Pyrénées ?', 'L’Aneto', 'Le Vignemale;Le Canigou;Le pic du Midi de Bigorre', 'Aneto;Pic d’Aneto'],
  [3, 'Quelle est la plus vaste étendue d’eau fermée du monde, entre l’Europe et l’Asie ?', 'La mer Caspienne', 'La mer Noire;La mer d’Aral;La mer Morte', 'Caspienne;Mer Caspienne'],
  [3, 'Quelle ville est le chef-lieu de la Guadeloupe ?', 'Basse-Terre', 'Pointe-à-Pitre;Fort-de-France;Cayenne', 'Basse Terre'],
  [3, 'Avec combien de pays la France métropolitaine partage-t-elle une frontière terrestre ?', '8', '6;7;10', 'huit'],
  [3, 'Quel pays est entièrement enclavé dans l’Afrique du Sud ?', 'Le Lesotho', 'L’Eswatini;Le Botswana;La Namibie', 'Lesotho'],
  [3, 'Dans quel pays se trouve la ville de Tombouctou ?', 'Le Mali', 'Le Niger;Le Tchad;La Mauritanie', 'Mali'],
  [3, 'Quel est le plus haut sommet du Massif central ?', 'Le puy de Sancy', 'Le puy de Dôme;Le plomb du Cantal;Le mont Mézenc', 'Puy de Sancy;Sancy'],
  [3, 'Quel est le plus haut sommet d’Amérique du Sud ?', 'L’Aconcagua', 'Le Chimborazo;Le Huascarán;Le Cotopaxi', 'Aconcagua'],
]

export const GEOGRAPHIE_2 = build('geographie', rows)
