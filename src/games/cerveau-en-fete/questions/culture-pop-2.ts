import { build, type Row } from './_helpers'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
const rows: Row[] = [
  // Difficulté 1
  [1, '🎲🏠🏨💰 — Quel jeu de société ?', 'Le Monopoly', 'Le Cluedo;La Bonne Paye;Le Scrabble', 'Monopoly'],
  [1, '🐢🥷🍕 — Quels héros ?', 'Les Tortues Ninja', 'Les Power Rangers;Les Totally Spies;Les Pyjamasques', 'Tortues Ninja;Teenage Mutant Ninja Turtles'],
  [1, 'Comment s’appelle l’étoile de mer rose, meilleur ami de Bob l’éponge ?', 'Patrick', 'Carlo;Gary;Plankton', 'Patrick Étoile;Patrick Star'],
  [1, 'Quel chat orange et paresseux adore les lasagnes ?', 'Garfield', 'Grosminet;Félix le chat;Azraël'],
  [1, 'Comment s’appelle le capitaine ami de Tintin ?', 'Haddock', 'Crochet;Nemo;Flam', 'Capitaine Haddock;Le capitaine Haddock'],
  [1, 'Comment s’appelle le fiancé de la poupée Barbie ?', 'Ken', 'Bob;Max;Steve'],
  [1, 'Quel jeu télévisé culte se déroule dans un fort au milieu de la mer, avec des tigres et des clés à gagner ?', 'Fort Boyard', 'Intervilles;Koh-Lanta;La Carte aux trésors', 'Fort-Boyard'],
  [1, 'Quelle marque de pneus a pour mascotte un bonhomme blanc appelé Bibendum ?', 'Michelin', 'Goodyear;Continental;Bridgestone'],
  [1, 'Comment s’appellent les trois neveux de Donald Duck ?', 'Riri, Fifi et Loulou', 'Tic, Tac et Toc;Pif, Paf et Pouf;Zig, Zag et Zoug', 'Riri Fifi Loulou;Riri Fifi et Loulou'],
  [1, 'Comment s’appelle l’oncle richissime et radin de Donald, qui plonge dans son coffre-fort rempli de pièces ?', 'Picsou', 'Gripsou;Géo Trouvetou;Gontran Bonheur', 'Oncle Picsou;Balthazar Picsou;Scrooge'],
  [1, 'Quelle petite fille vit dans les montagnes suisses avec son grand-père ?', 'Heidi', 'Candy;Fifi Brindacier;Princesse Sarah'],
  [1, 'Comment s’appellent les quatre frères bandits, ennemis jurés de Lucky Luke ?', 'Les Dalton', 'Les Rapetou;Les Pieds Nickelés;Les Bonnot', 'Dalton;Daltons;Les Daltons;Frères Dalton'],
  [1, 'Quel est le nom d’emprunt de Superman, journaliste au Daily Planet ?', 'Clark Kent', 'Bruce Wayne;Peter Parker;Barry Allen', 'Kent'],
  [1, 'Quel casse-tête en forme de cube, aux faces colorées à reconstituer, a été inventé par un professeur hongrois ?', 'Le Rubik’s Cube', 'Le Tangram;Le taquin;Le Tetris', 'Rubik’s Cube;Rubiks cube;Rubik cube;Rubik;Cube de Rubik'],
  [1, 'Comment s’appelle l’ours de « Bonne nuit les petits » ?', 'Nounours', 'Pimprenelle;Nicolas;Le Marchand de sable'],
  // Difficulté 2
  [2, '🔍🔪🕯️🏚️ — Quel jeu de société ?', 'Le Cluedo', 'Le Monopoly;Le Loup-garou;Le Trivial Pursuit', 'Cluedo'],
  [2, 'Comment s’appelle le chat de Gargamel ?', 'Azraël', 'Grosminet;Félix;Garfield', 'Azrael'],
  [2, 'Comment s’appelle le cheval de Lucky Luke ?', 'Jolly Jumper', 'Tornado;Petit Tonnerre;Rantanplan', 'Jolly'],
  [2, 'Comment s’appellent les deux détectives moustachus qui se ressemblent dans « Tintin » ?', 'Dupond et Dupont', 'Laurel et Hardy;Pif et Hercule;Boule et Bill', 'Dupont et Dupond;Les Dupondt;Dupondt'],
  [2, 'Dans « Astérix », de quoi les Gaulois ont-ils peur ?', 'Que le ciel leur tombe sur la tête', 'Que les Romains gagnent;Que la potion s’épuise;Que la mer les engloutisse', '', 'QCM'],
  [2, 'De quel pays viennent les célèbres briques LEGO ?', 'Le Danemark', 'La Suède;L’Allemagne;Les Pays-Bas', 'Danemark'],
  [2, 'Quelle girafe en caoutchouc, née en 1961, est le plus célèbre jouet de bébé en France ?', 'Sophie la girafe', 'Zoé la girafe;Gigi la girafe;Lulu la girafe', 'Sophie'],
  [2, 'Dans « Fort Boyard », comment s’appelle le vieux sage qui pose des énigmes du haut de sa vigie ?', 'Le Père Fouras', 'Passe-Partout;Passe-Muraille;La Boule', 'Père Fouras;Fouras;Pere Fouras'],
  [2, 'Quel ours venu du Pérou, en duffle-coat, adore la marmelade ?', 'Paddington', 'Winnie;Baloo;Petit Ours Brun'],
  [2, 'Comment s’appelle le savant sourd et distrait des aventures de Tintin ?', 'Le professeur Tournesol', 'Le professeur Nimbus;Le professeur Calys;Le professeur Mortimer', 'Tournesol;Professeur Tournesol;Tryphon Tournesol'],
  [2, 'Quel robot géant, piloté par Actarus, était la vedette de Récré A2 ?', 'Goldorak', 'Mazinger Z;Gundam;Voltron'],
  [2, 'Comment s’appelle le gros monstre orange de « L’Île aux enfants » ?', 'Casimir', 'Hippolyte;Léonard;Gloubi-Boulga'],
  [2, 'Quelle super-héroïne amazone possède un lasso de vérité ?', 'Wonder Woman', 'Catwoman;Supergirl;Black Widow'],
  [2, 'Comment appelle-t-on les poupées russes en bois qui s’emboîtent les unes dans les autres ?', 'Les matriochkas', 'Les babouchkas;Les balalaïkas;Les chapkas', 'Matriochka;Matriochkas;Matrioshka;Matryoshka'],
  [2, 'Quel animateur a présenté « Qui veut gagner des millions ? » sur TF1 à partir de 2000 ?', 'Jean-Pierre Foucault', 'Julien Lepers;Nagui;Arthur', 'Foucault;JP Foucault'],
  // Difficulté 3
  [3, 'Comment s’appelle le petit oiseau jaune, meilleur ami de Snoopy ?', 'Woodstock', 'Titi;Piou-Piou;Zazu'],
  [3, 'Sur quelle chaîne était diffusé le « Club Dorothée » ?', 'TF1', 'Antenne 2;FR3;La Cinq'],
  [3, 'Quel illustrateur a dessiné la célèbre vache de « La Vache qui rit » ?', 'Benjamin Rabier', 'Hergé;Albert Uderzo;Jean Effel', 'Rabier'],
  [3, 'Dans la série « Il était une fois… », comment s’appelle le vieux sage à longue barbe blanche ?', 'Maestro', 'Pierrot;Le Gros;Merlin'],
  [3, 'Comment s’appelle le marteau du super-héros Thor ?', 'Mjöllnir', 'Excalibur;Gungnir;Stormbreaker', 'Mjolnir;Mjollnir;Mjölnir'],
  [3, 'Quelle cantatrice surnommée « le Rossignol milanais » apparaît dans « Tintin » ?', 'Bianca Castafiore', 'Maria Callas;Irma;Carmen', 'Castafiore;La Castafiore'],
  [3, 'Comment s’appelle la tortue de « Boule et Bill » ?', 'Caroline', 'Franklin;Cunégonde;Joséphine'],
  [3, 'Quel pirate de l’espace balafré, avec un bandeau sur l’œil, est le héros d’un célèbre dessin animé japonais ?', 'Albator', 'Capitaine Flam;Cobra;Goldorak', 'Capitaine Albator;Harlock'],
  [3, 'Comment s’appelle le jeune héros des « Mystérieuses Cités d’or » ?', 'Esteban', 'Tao;Zia;Mendoza'],
  [3, 'De quelle couleur est Barbapapa ?', 'Rose', 'Noir;Jaune;Vert'],
]

export const CULTURE_POP_2 = build('culture-pop', rows)
