import { build, type Row } from './_helpers'

const P = 'Quel animal voit-on sur cette photo ?'

const rows: Row[] = [
  // Photos (Wikimedia Commons)
  [1, P, 'Une girafe', 'Un okapi;Un zèbre;Un dromadaire', 'Girafe', '', 'wm:Giraffe-closeup-head.jpg|Rob Hooft, Wikimedia Commons|CC BY-SA 3.0'],
  [1, P, 'Un zèbre', 'Un âne;Un cheval;Un okapi', 'Zèbre;Zebre', '', 'wm:Equus_quagga_burchellii_-_Etosha,_2014.jpg|Yathin S Krishnappa, Wikimedia Commons|CC BY-SA 3.0'],
  [1, P, 'Un lion', 'Un tigre;Un puma;Une hyène', 'Lion', '', 'wm:Lion_waiting_in_Namibia.jpg|Kevin Pluck, Wikimedia Commons|CC BY 2.0'],
  [1, P, 'Un tigre', 'Un lion;Un léopard;Un jaguar', 'Tigre', '', 'wm:Male_Tiger_Ranthambhore.jpg|Koshy Koshy, Wikimedia Commons|CC BY 2.0'],
  [1, P, 'Un kangourou', 'Un wallaby;Un lièvre;Un daim', 'Kangourou', '', 'wm:Macropus_giganteus_-_Brunkerville.jpg|JJ Harrison, Wikimedia Commons|CC BY-SA 4.0'],
  [1, P, 'Un koala', 'Un paresseux;Un panda roux;Un ours brun', 'Koala', '', 'wm:Koala_climbing_tree.jpg|Diliff, Wikimedia Commons|CC BY-SA 3.0'],
  [1, 'Quel oiseau voit-on sur cette photo ?', 'Un manchot', 'Un cormoran;Un albatros;Un pélican', 'Manchot;Pingouin;Un pingouin', '', 'wm:Penguin_in_Antarctica_jumping_out_of_the_water.jpg|Christopher Michel, Wikimedia Commons|CC BY 2.0'],
  // Records et comparaisons
  [1, 'Quel est le plus grand animal du monde ?', 'La baleine bleue', 'L’éléphant d’Afrique;Le requin-baleine;Le cachalot', 'Baleine bleue'],
  [1, 'Quel est l’animal terrestre le plus rapide ?', 'Le guépard', 'Le lion;L’antilope;Le lévrier', 'Guépard'],
  [1, 'Quel est le plus grand animal terrestre ?', 'L’éléphant d’Afrique', 'Le rhinocéros;L’hippopotame;La girafe', 'Éléphant;Éléphant d’Afrique;Elephant'],
  [1, 'Quel est l’animal le plus haut du monde ?', 'La girafe', 'L’éléphant;L’autruche;Le dromadaire', 'Girafe'],
  [1, 'Quel est le plus gros oiseau du monde ?', 'L’autruche', 'L’émeu;Le condor;Le cygne', 'Autruche'],
  [2, 'Quel animal pond le plus gros œuf ?', 'L’autruche', 'Le cygne;L’émeu;Le casoar', 'Autruche'],
  [3, 'Quel oiseau est le plus rapide en piqué ?', 'Le faucon pèlerin', 'L’aigle royal;Le martinet;Le colibri', 'Faucon pèlerin;Faucon pelerin'],
  [3, 'Quel oiseau minuscule est capable de voler sur place et même en arrière ?', 'Le colibri', 'Le martinet;Le roitelet;Le moineau', 'Colibri'],
  // Anatomie, nombres
  [1, 'Combien de pattes a une araignée ?', '8', '6;10;12', 'huit'],
  [1, 'Combien de pattes a un insecte ?', '6', '4;8;10', 'six'],
  [2, 'Combien de bras a une pieuvre ?', '8', '6;10;12', 'huit'],
  [3, 'Combien de cœurs a une pieuvre ?', '3', '1;2;4', 'trois'],
  [1, 'Combien de bosses a un dromadaire ?', '1', '2;3;0', 'une;un'],
  [2, 'Comment appelle-t-on les dents allongées de l’éléphant ?', 'Les défenses', 'Les crocs;Les incisives;Les cornes', 'Défenses;Défense'],
  // Petits
  [1, 'Comment appelle-t-on le petit de la vache ?', 'Le veau', 'Le poulain;Le chevreau;L’agneau', 'Veau'],
  [2, 'Comment appelle-t-on le petit de la biche ?', 'Le faon', 'Le chevreau;Le marcassin;Le renardeau', 'Faon'],
  [2, 'Comment appelle-t-on le petit du cygne ?', 'Le cygneau', 'L’oison;Le caneton;Le poussin', 'Cygneau'],
  [2, 'Comment appelle-t-on le petit du lion ?', 'Le lionceau', 'Le chaton;Le lionnet;Le louveteau', 'Lionceau'],
  [3, 'Comment appelle-t-on le petit de l’oie ?', 'L’oison', 'Le cygneau;Le caneton;Le dindonneau', 'Oison'],
  [3, 'Comment appelle-t-on le petit du kangourou ?', 'Le joey', 'Le kanga;Le roo;Le wallaby', 'Joey'],
  [2, 'Comment appelle-t-on le petit de la chèvre ?', 'Le chevreau', 'L’agnelet;Le cabri;Le faon', 'Chevreau;Cabri'],
  // Cris
  [2, 'Comment appelle-t-on le cri de l’âne ?', 'Le braiment', 'Le hennissement;Le beuglement;Le bêlement', 'Braiment;Braire;Il brait'],
  [3, 'Comment appelle-t-on le cri du cerf ?', 'Le brame', 'Le râle;Le meuglement;Le grognement', 'Brame;Bramer'],
  // Comportement et espèces
  [1, 'Quel animal est surnommé « le roi des animaux » ?', 'Le lion', 'L’éléphant;Le tigre;L’ours', 'Lion'],
  [1, 'Quel est le principal aliment du panda géant ?', 'Le bambou', 'L’eucalyptus;Le miel;L’herbe', 'Bambou;Les bambous'],
  [1, 'Quel animal ne mange que des feuilles d’eucalyptus ?', 'Le koala', 'Le panda;Le paresseux;Le wombat', 'Koala'],
  [1, 'Quel mammifère est capable de voler ?', 'La chauve-souris', 'L’écureuil volant;Le colibri;Le lémurien', 'Chauve-souris;Chauve souris'],
  [2, 'Quel mammifère australien pond des œufs et a un bec de canard ?', 'L’ornithorynque', 'L’échidné;Le diable de Tasmanie;Le wombat', 'Ornithorynque'],
  [1, 'Quel animal change de couleur pour se camoufler ?', 'Le caméléon', 'Le gecko;L’iguane;La salamandre', 'Caméléon'],
  [1, 'Quel animal est le symbole du WWF ?', 'Le panda', 'Le tigre;L’ours polaire;L’éléphant', 'Panda;Le panda géant'],
  [1, 'Quel animal vit dans les régions polaires et se nourrit principalement de phoques ?', 'L’ours polaire', 'L’ours brun;Le loup arctique;Le renard polaire', 'Ours polaire;Ours blanc;L’ours blanc'],
  [2, 'Quel animal des Alpes hiberne tout l’hiver dans un terrier ?', 'La marmotte', 'Le chamois;Le bouquetin;Le lièvre variable', 'Marmotte'],
  [2, 'Quel oiseau est le symbole de la paix ?', 'La colombe', 'Le cygne;L’aigle;Le rossignol', 'Colombe;La colombe blanche'],
  [2, 'Quel animal peut régénérer sa queue après l’avoir perdue ?', 'Le lézard', 'Le serpent;La grenouille;La tortue', 'Lézard'],
  [2, 'Quel serpent dilate son capuchon quand il est menacé ?', 'Le cobra', 'Le python;La vipère;Le boa', 'Cobra'],
  [3, 'Chez quel animal marin est-ce le mâle qui porte les petits dans une poche ?', 'L’hippocampe', 'Le poisson-clown;La raie;La seiche', 'Hippocampe'],
  [2, 'Quel oiseau est l’emblème de la Nouvelle-Zélande ?', 'Le kiwi', 'Le kakapo;Le tui;Le moa', 'Kiwi'],
  [1, 'Quel animal a des piquants et se met en boule ?', 'Le hérisson', 'Le porc-épic;Le tatou;Le pangolin', 'Hérisson'],
  [2, 'Quel rapace nocturne est le symbole de la sagesse ?', 'La chouette', 'L’aigle;Le faucon;Le vautour', 'Chouette;Hibou;Le hibou'],
  [3, 'Quel marsupial a des empreintes digitales presque identiques à celles de l’humain ?', 'Le koala', 'Le wombat;Le kangourou;Le diable de Tasmanie', 'Koala'],
  [3, 'Quel est le plus gros poisson du monde ?', 'Le requin-baleine', 'Le grand requin blanc;L’espadon;Le thon rouge', 'Requin-baleine;Requin baleine'],
  [3, 'Quel animal possède le plus gros cerveau du règne animal ?', 'Le cachalot', 'La baleine bleue;L’éléphant;Le dauphin', 'Cachalot'],
  [3, 'Comment appelle-t-on aussi le fourmilier géant ?', 'Le tamanoir', 'Le pangolin;Le tatou;Le paresseux', 'Tamanoir'],
  [3, 'Combien d’ailes possède une abeille ?', '4', '2;6;8', 'quatre'],
  [3, 'Comment s’appelle le plus grand félin du monde ?', 'Le tigre', 'Le lion;Le jaguar;Le léopard', 'Tigre'],
]

export const ANIMAUX = build('animaux', rows)
