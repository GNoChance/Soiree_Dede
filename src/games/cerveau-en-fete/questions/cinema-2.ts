import { build, type Row } from './_helpers'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
const rows: Row[] = [
  // Rébus
  [1, '🐶⚫⚪1️⃣0️⃣1️⃣ — Quel dessin animé Disney ?', 'Les 101 Dalmatiens', 'Rox et Rouky;Oliver et Compagnie;Les Aristochats', '101 Dalmatiens;Les Cent Un Dalmatiens'],
  [1, '🐶🍝❤️ — Quel dessin animé Disney ?', 'La Belle et le Clochard', 'Bambi;Pinocchio;Les Aristochats', 'Belle et le Clochard'],
  [1, '🕷️🕸️🦸‍♂️ — Quel super-héros ?', 'Spider-Man', 'Batman;Iron Man;Superman', 'Spiderman;L’Homme-Araignée'],
  [1, '🏠👦🎄🦹 — Quel film de Noël ?', 'Maman, j’ai raté l’avion !', 'Le Père Noël est une ordure;Le Grinch;Elfe', 'Maman j’ai raté l’avion;Home Alone'],
  [1, '🧚‍♀️🏴‍☠️🐊⏰ — Quel dessin animé Disney ?', 'Peter Pan', 'Le Livre de la jungle;Hercule;Mulan'],
  [1, '🐿️🌰🧊🦣 — Quel film d’animation ?', 'L’Âge de glace', 'Madagascar;Shrek;Rio', 'Âge de glace;Age de glace;Ice Age'],
  [2, '🧑‍🔬🚗⚡⏰ — Quel film de 1985 ?', 'Retour vers le futur', 'Terminator;Les Goonies;Gremlins', 'Back to the Future'],
  [2, '🌹🕯️⏰🫖 — Quel dessin animé Disney ?', 'La Belle et la Bête', 'Raiponce;Cendrillon;La Petite Sirène', 'Belle et la Bête'],
  [2, '🎈🏠👴 — Quel film Pixar ?', 'Là-haut', 'Coco;Vice-versa;Les Indestructibles', 'La haut;Up'],
  [2, '🧠😀😢😡 — Quel film Pixar ?', 'Vice-versa', 'Soul;Coco;Luca', 'Vice versa;Inside Out'],
  [2, '🐒🌍🗽 — Quel film ?', 'La Planète des singes', 'Le Livre de la jungle;Godzilla;Tarzan', 'Planète des singes;Planet of the Apes'],
  // Culture ciné
  [1, 'Quel acteur incarne Indiana Jones ?', 'Harrison Ford', 'Kevin Costner;Mel Gibson;Bruce Willis', 'Ford'],
  [1, 'Quel acteur joue le Terminator dans le film de 1984 ?', 'Arnold Schwarzenegger', 'Sylvester Stallone;Jean-Claude Van Damme;Dolph Lundgren', 'Schwarzenegger;Schwarzy'],
  [1, 'Comment s’appelle le phacochère du « Roi Lion » ?', 'Pumbaa', 'Timon;Rafiki;Zazu', 'Pumba'],
  [1, 'Quelle actrice joue Hermione Granger dans les films « Harry Potter » ?', 'Emma Watson', 'Emma Stone;Keira Knightley;Kristen Stewart', 'Watson'],
  [1, 'Comment s’appelle le bonhomme de neige de « La Reine des neiges » ?', 'Olaf', 'Sven;Kristoff;Hans'],
  [1, 'Quel acteur incarne Tony Stark, alias Iron Man, dans les films Marvel ?', 'Robert Downey Jr.', 'Chris Evans;Chris Hemsworth;Mark Ruffalo', 'Robert Downey Junior;Downey Jr;Downey'],
  [1, 'Quel acteur incarne Obélix dans « Astérix et Obélix : Mission Cléopâtre » ?', 'Gérard Depardieu', 'Christian Clavier;Jamel Debbouze;Gilles Lellouche', 'Depardieu'],
  [1, 'Comment s’appellent les petites créatures jaunes à lunettes qui servent Gru ?', 'Les Minions', 'Les Schtroumpfs;Les Lapins Crétins;Les Gremlins', 'Minions;Minion'],
  [1, 'Quel film de 1997 réunit Will Smith et Tommy Lee Jones en agents chargés de surveiller les extraterrestres ?', 'Men in Black', 'Independence Day;Mars Attacks!;Galaxy Quest', 'MIB'],
  [2, 'Qui a réalisé « Astérix et Obélix : Mission Cléopâtre » ?', 'Alain Chabat', 'Gérard Jugnot;Claude Zidi;Dominique Farrugia', 'Chabat'],
  [2, 'Quelle troupe de comédiens est à l’origine des « Bronzés » ?', 'Le Splendid', 'Les Inconnus;Les Nuls;Les Robins des Bois', 'Splendid;La troupe du Splendid'],
  [2, 'Dans quel film Thérèse et Pierre tiennent-ils la permanence de SOS Détresse Amitié un soir de Noël ?', 'Le Père Noël est une ordure', 'Les Bronzés font du ski;Papy fait de la résistance;Le Dîner de cons', 'Père Noël est une ordure'],
  [2, 'Quel acteur joue Clément Mathieu, le surveillant des « Choristes » ?', 'Gérard Jugnot', 'François Berléand;Jacques Perrin;Kad Merad', 'Jugnot'],
  [2, 'Quel acteur joue Hannibal Lecter dans « Le Silence des agneaux » ?', 'Anthony Hopkins', 'Jack Nicholson;Gary Oldman;Ralph Fiennes', 'Hopkins'],
  [2, 'Quel film de 1959 avec Charlton Heston est célèbre pour sa course de chars ?', 'Ben-Hur', 'Spartacus;Cléopâtre;Les Dix Commandements', 'Ben Hur'],
  [2, 'Quel acteur joue le Joker dans « The Dark Knight » (2008) ?', 'Heath Ledger', 'Joaquin Phoenix;Jared Leto;Jack Nicholson', 'Ledger'],
  [2, 'Quelle actrice joue Mary Poppins dans le film de 1964 ?', 'Julie Andrews', 'Audrey Hepburn;Judy Garland;Emily Blunt', 'Andrews'],
  [2, 'Quelle actrice a reçu l’Oscar de la meilleure actrice pour « La Môme » ?', 'Marion Cotillard', 'Audrey Tautou;Juliette Binoche;Sophie Marceau', 'Cotillard'],
  [2, 'Qui a réalisé « Edward aux mains d’argent » et « Charlie et la Chocolaterie » ?', 'Tim Burton', 'Terry Gilliam;Sam Raimi;Robert Zemeckis', 'Burton'],
  [3, 'Qui a réalisé « Les Choristes » (2004) ?', 'Christophe Barratier', 'Jean Becker;Claude Berri;Cédric Klapisch', 'Barratier'],
  [3, 'Quel film d’Étienne Chatiliez oppose les familles Le Quesnoy et Groseille ?', 'La vie est un long fleuve tranquille', 'Tanguy;Tatie Danielle;Le bonheur est dans le pré', 'Vie est un long fleuve tranquille'],
  [3, 'Quel film a remporté le tout premier Oscar du meilleur film d’animation, en 2002 ?', 'Shrek', 'Monstres & Cie;Jimmy Neutron;Lilo & Stitch'],
  [3, 'Qui a réalisé « Jeux interdits » (1952) ?', 'René Clément', 'Jean Renoir;Marcel Carné;Jacques Tati', 'Clément;Rene Clement'],
  [3, 'Qui a réalisé et joué « Les Vacances de M. Hulot » (1953) ?', 'Jacques Tati', 'Pierre Étaix;Fernandel;Bourvil', 'Tati'],
  [3, 'Quel film de Marcel Carné (1945) se déroule sur le boulevard du Crime, dans le monde du théâtre ?', 'Les Enfants du paradis', 'Quai des brumes;Hôtel du Nord;Le jour se lève', 'Enfants du paradis'],
  [3, 'Quel film muet français, avec Jean Dujardin, a remporté l’Oscar du meilleur film en 2012 ?', 'The Artist', 'Intouchables;Hugo Cabret;Amour', 'Artist'],
  [3, 'Dans quel film de 1966 Clint Eastwood, Lee Van Cleef et Eli Wallach s’affrontent-ils dans un cimetière ?', 'Le Bon, la Brute et le Truand', 'Pour une poignée de dollars;Et pour quelques dollars de plus;Il était une fois dans l’Ouest', 'Le Bon la Brute et le Truand;The Good, the Bad and the Ugly'],
  [3, 'Quel compositeur a signé la musique de « Star Wars », « Les Dents de la mer » et « Indiana Jones » ?', 'John Williams', 'Hans Zimmer;Ennio Morricone;Danny Elfman', 'Williams'],
  [3, 'Dans « Les Visiteurs », comment s’appelle le chevalier joué par Jean Reno ?', 'Godefroy de Montmirail', 'Lancelot du Lac;Perceval de Galles;Gauvain d’Orcanie', 'Godefroy;Godefroy le Hardi;Montmirail'],
]

export const CINEMA_2 = build('cinema', rows)
