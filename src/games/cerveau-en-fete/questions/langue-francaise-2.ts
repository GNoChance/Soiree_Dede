import { build, type Row } from './_helpers'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
const rows: Row[] = [
  // Difficulté 1
  [1, '🥚🥚🥚🧺 — Quelle expression ?', 'Mettre tous ses œufs dans le même panier', 'Marcher sur des œufs;Tuer la poule aux œufs d’or;Faire d’une pierre deux coups', '', 'QCM'],
  [1, '🧈💰 — Quelle expression ?', 'Vouloir le beurre et l’argent du beurre', 'Faire son beurre;Mettre du beurre dans les épinards;Compter ses sous', '', 'QCM'],
  [1, '🐊😢 — Quelle expression ?', 'Verser des larmes de crocodile', 'Pleurer comme une madeleine;Avoir la larme à l’œil;Pleurer à chaudes larmes', 'Larmes de crocodile;Des larmes de crocodile'],
  [1, '🦶🍽️ — Quelle expression ?', 'Mettre les pieds dans le plat', 'Casser les pieds;Mettre la main à la pâte;Avoir un pied dans la tombe', 'Les pieds dans le plat'],
  [1, '🍐✂️2️⃣ — Quelle expression ?', 'Couper la poire en deux', 'Ramener sa fraise;Se fendre la poire;Tomber dans les pommes', 'Couper la poire en 2'],
  [1, '🍎🍏😵 — Quelle expression ?', 'Tomber dans les pommes', 'Couper la poire en deux;Ramener sa fraise;Pour des prunes', 'Dans les pommes'],
  [1, 'Que signifie « avoir la main verte » ?', 'Être doué pour le jardinage', 'Être jaloux;Être malade;Être un peu voleur', '', 'QCM'],
  [1, 'Que signifie « coûter les yeux de la tête » ?', 'Coûter très cher', 'Faire très mal;Faire très peur;Être très fatigant', '', 'QCM'],
  [1, 'Que signifie « avoir le cœur sur la main » ?', 'Être généreux', 'Être amoureux;Être très ému;Être en colère', '', 'QCM'],
  [1, 'Que signifie « prendre ses jambes à son cou » ?', 'S’enfuir en courant', 'Faire une chute;Faire des étirements;Se fatiguer', '', 'QCM'],
  [1, 'Quelle est la bonne orthographe de ce mot qui signifie « étrange » ?', 'Bizarre', 'Bizzare;Bizare;Bizzarre', '', 'QCM'],
  [1, 'Quelle est la bonne orthographe de ce mot qui signifie « au milieu de, entre » ?', 'Parmi', 'Parmis;Parmit;Parmie', '', 'QCM'],
  [1, 'Complétez : « Hier, nous … au cinéma. » (aller, passé composé)', 'sommes allés', 'avons allé;sommes allé;avons allés', '', 'QCM'],
  [1, 'Quel est le pluriel de « bijou » ?', 'Bijoux', 'Bijous;Bijoues;Bijouxs', '', 'QCM'],
  [1, 'Comment appelle-t-on un mot qui imite un bruit, comme « boum » ou « miaou » ?', 'Une onomatopée', 'Un acronyme;Un palindrome;Un néologisme', 'Onomatopée;Onomatopee'],
  // Difficulté 2
  [2, '🦢🎵 — Quelle expression ?', 'Le chant du cygne', 'Le vilain petit canard;Le cri du cœur;Le bec dans l’eau', 'Chant du cygne'],
  [2, '🐑5️⃣🦵 — Quelle expression ?', 'Un mouton à cinq pattes', 'Revenir à ses moutons;Le loup dans la bergerie;Le vilain petit canard', 'Mouton à cinq pattes;Mouton à 5 pattes'],
  [2, '🐘🏺💥 — Quelle expression ?', 'Comme un éléphant dans un magasin de porcelaine', 'Avoir une mémoire d’éléphant;Voir des éléphants roses;Faire d’une mouche un éléphant', '', 'QCM'],
  [2, 'Que signifie « donner sa langue au chat » ?', 'Renoncer à deviner', 'Garder un secret;Dire du mal de quelqu’un;Parler sans arrêt', '', 'QCM'],
  [2, 'Que signifie « se faire rouler dans la farine » ?', 'Se faire tromper', 'Se faire gronder;Se salir;Se faire féliciter', '', 'QCM'],
  [2, 'Que signifie « mettre la puce à l’oreille » ?', 'Éveiller les soupçons', 'Agacer quelqu’un;Chuchoter un secret;Donner une idée géniale', '', 'QCM'],
  [2, 'Que signifie « avoir les dents longues » ?', 'Être très ambitieux', 'Être bavard;Être méchant;Être très vieux', '', 'QCM'],
  [2, 'Que signifie « faire chou blanc » ?', 'Échouer', 'Avoir peur;Faire la paix;Rougir de honte', '', 'QCM'],
  [2, 'Le mot « poubelle » vient du nom d’un…', 'Préfet', 'Chiffonnier;Médecin;Maire', 'Un préfet;Préfet de la Seine'],
  [2, 'Comment appelle-t-on une répétition inutile, comme « monter en haut » ?', 'Un pléonasme', 'Un oxymore;Une litote;Un euphémisme', 'Pléonasme'],
  [2, 'Quelle figure de style compare sans utiliser « comme », par exemple « cet homme est un lion » ?', 'La métaphore', 'La comparaison;La personnification;L’hyperbole', 'Métaphore'],
  [2, 'Quelle est la bonne orthographe du mot qui désigne le fait de se connecter à Internet ?', 'Connexion', 'Connection;Conexion;Connextion', '', 'QCM'],
  [2, 'Complétez : « Il faut que tu … tes devoirs. » (faire)', 'fasses', 'fais;faisses;feras', '', 'QCM'],
  [2, 'Quel est le futur de « courir » à la 1re personne du singulier ?', 'Je courrai', 'Je courrais;Je courirai;Je courerai', '', 'QCM'],
  [2, 'Quelle est la lettre la plus utilisée en français ?', 'Le E', 'Le A;Le S;Le I', 'E'],
  // Difficulté 3
  [3, 'Que signifie « avoir maille à partir avec quelqu’un » ?', 'Avoir un différend avec lui', 'Partager ses biens avec lui;Partir en voyage avec lui;Lui devoir de l’argent', '', 'QCM'],
  [3, 'Que signifie « tirer le diable par la queue » ?', 'Avoir du mal à vivre avec peu d’argent', 'Prendre de gros risques;Faire des bêtises;Provoquer une dispute', '', 'QCM'],
  [3, 'Que signifie « peigner la girafe » ?', 'Faire un travail inutile', 'Se faire beau;Raconter des mensonges;Partir en voyage', '', 'QCM'],
  [3, 'Le mot « sandwich » vient du titre de noblesse d’un…', 'Comte', 'Duc;Baron;Marquis', 'Un comte;Le comte de Sandwich'],
  [3, 'De quelle langue vient le mot « algèbre » ?', 'L’arabe', 'Le grec;Le latin;L’hébreu', 'Arabe'],
  [3, 'De quelle langue vient le mot « robot » ?', 'Le tchèque', 'Le russe;L’allemand;L’anglais', 'Tchèque'],
  [3, 'Quelle figure de style associe deux mots contraires, comme « une obscure clarté » ?', 'L’oxymore', 'Le pléonasme;La litote;L’hyperbole', 'Oxymore;Oxymoron'],
  [3, 'Quelle est la bonne orthographe de ce mot qui désigne chaque apparition d’un élément ?', 'Occurrence', 'Occurence;Ocurrence;Occurance', '', 'QCM'],
  [3, 'Quel est le passé simple de « venir » à la 3e personne du singulier ?', 'Il vint', 'Il venit;Il vena;Il vînt', '', 'QCM'],
  [3, 'Quel est le seul mot de la langue française qui contient la lettre « ù » ?', 'Où', 'Là;Çà;Déjà', 'Ou'],
]

export const LANGUE_FRANCAISE_2 = build('langue-francaise', rows)
