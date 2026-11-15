import { build, type Row } from './_helpers'

const T = 'Comment s’appelle ce célèbre tableau ?'

const rows: Row[] = [
  // Rébus dessins animés et contes
  [1, '👸🍎7️⃣🧙‍♂️ — Quel dessin animé ?', 'Blanche-Neige et les sept nains', 'Cendrillon;La Belle au bois dormant;Raiponce', 'Blanche-Neige;Blanche Neige;Blanche-Neige et les 7 nains'],
  [1, '🪵👦👃 — Quel dessin animé ?', 'Pinocchio', 'Peter Pan;Dumbo;Bambi'],
  [1, '🧞‍♂️🪔🐒 — Quel dessin animé ?', 'Aladdin', 'Sinbad;Hercule;Mulan'],
  [1, '🧜‍♀️🦀🌊 — Quel dessin animé ?', 'La Petite Sirène', 'Ponyo;Vaiana;Atlantide', 'Petite Sirène;The Little Mermaid'],
  [1, '🐘👂🎪 — Quel dessin animé ?', 'Dumbo', 'Babar;Le Roi Lion;Bambi'],
  [1, '🐻🐍🐅👦 — Quel dessin animé ?', 'Le Livre de la jungle', 'Tarzan;Le Roi Lion;Kirikou', 'Livre de la jungle'],
  [1, '👗👠🎃 — Quel conte ou dessin animé ?', 'Cendrillon', 'Raiponce;Blanche-Neige;La Belle au bois dormant'],
  [1, '🧽🍍🌊 — Quel dessin animé ?', 'Bob l’éponge', 'Les Razmoket;Fourchette Man;Rocko', 'Bob l eponge;SpongeBob'],
  [1, '🐶👦🌍🧣 — Quelle bande dessinée ?', 'Tintin', 'Spirou;Boule et Bill;Astérix', 'Les Aventures de Tintin'],
  [1, '🐱🐭💥 — Quel duo de dessin animé ?', 'Tom et Jerry', 'Titi et Grosminet;Pif et Hercule;Mickey et Pluto', 'Tom & Jerry'],
  [2, '🧙‍♂️🥤💪🐗 — Quelle bande dessinée ?', 'Astérix', 'Obélix;Lucky Luke;Les Schtroumpfs', 'Asterix;Astérix et Obélix'],
  [1, '🐼🥋🍜 — Quel film d’animation ?', 'Kung Fu Panda', 'Madagascar;Rio;Le Roi Lion'],
  [2, '🐰🥕🏜️ — Quel personnage de dessin animé ?', 'Bugs Bunny', 'Roger Rabbit;Jeannot Lapin;Panpan', 'Bugs'],
  [2, '🦊🐰👮 — Quel film d’animation ?', 'Zootopie', 'Les Animaux de la ferme;Rio;Madagascar'],
  // Peinture
  [1, T, 'La Joconde', 'La Jeune Fille à la perle;Le Cri;La Naissance de Vénus', 'Mona Lisa;Joconde', '', 'wm:Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg|Léonard de Vinci, Wikimedia Commons|Domaine public'],
  [1, T, 'La Nuit étoilée', 'Les Tournesols;Impression, soleil levant;La Chambre à Arles', 'Nuit étoilée;The Starry Night;Starry Night', '', 'wm:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg|Vincent van Gogh (Google Art Project), Wikimedia Commons|Domaine public'],
  [2, T, 'La Grande Vague de Kanagawa', 'La Nuit étoilée;Le Cri;Le Radeau de la Méduse', 'La Vague;Grande Vague;La Grande Vague;Vague de Kanagawa', '', 'wm:Tsunami_by_hokusai_19th_century.jpg|Katsushika Hokusai, Wikimedia Commons|Domaine public'],
  [1, T, 'Le Cri', 'La Nuit étoilée;Guernica;Le Baiser', 'Cri;The Scream', '', 'wm:The_Scream.jpg|Edvard Munch, Wikimedia Commons|Domaine public'],
  [2, T, 'La Jeune Fille à la perle', 'La Joconde;La Laitière;La Dame à l’hermine', 'Jeune Fille à la perle;La Jeune Fille à la boucle d’oreille;Girl with a Pearl Earring', '', 'wm:Johannes_Vermeer_(1632-1675)_-_The_Girl_With_The_Pearl_Earring_(1665).jpg|Johannes Vermeer, Wikimedia Commons|Domaine public'],
  [2, T, 'La Liberté guidant le peuple', 'Le Radeau de la Méduse;Le Serment des Horaces;Le Sacre de Napoléon', 'Liberté guidant le peuple;La Liberté;Le 28 juillet', '', 'wm:Eug%C3%A8ne_Delacroix_-_Le_28_Juillet._La_Libert%C3%A9_guidant_le_peuple.jpg|Eugène Delacroix, Wikimedia Commons|Domaine public'],
  [2, T, 'La Naissance de Vénus', 'Le Printemps;La Création d’Adam;La Joconde', 'Naissance de Vénus;The Birth of Venus', '', 'wm:Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg|Sandro Botticelli (Google Art Project), Wikimedia Commons|Domaine public'],
  // Arts
  [1, 'Qui a peint la Joconde ?', 'Léonard de Vinci', 'Michel-Ange;Raphaël;Botticelli', 'De Vinci;Leonard de Vinci;Vinci'],
  [1, 'Quel peintre espagnol a réalisé « Guernica » ?', 'Pablo Picasso', 'Salvador Dalí;Joan Miró;Francisco de Goya', 'Picasso'],
  [2, 'Quel peintre impressionniste est célèbre pour ses « Nymphéas » ?', 'Claude Monet', 'Auguste Renoir;Edgar Degas;Paul Cézanne', 'Monet'],
  [1, 'Quel peintre néerlandais s’est coupé une partie de l’oreille ?', 'Vincent van Gogh', 'Rembrandt;Vermeer;Piet Mondrian', 'Van Gogh;Vincent Van Gogh'],
  [2, 'Quel peintre surréaliste est célèbre pour ses montres molles ?', 'Salvador Dalí', 'René Magritte;Max Ernst;Joan Miró', 'Dalí;Dali'],
  [2, 'Quel artiste a peint le plafond de la chapelle Sixtine ?', 'Michel-Ange', 'Léonard de Vinci;Raphaël;Donatello', 'Michelangelo'],
  [2, 'Quel sculpteur français a réalisé « Le Penseur » ?', 'Auguste Rodin', 'Camille Claudel;Aristide Maillol;Antoine Bourdelle', 'Rodin'],
  [1, 'Dans quel musée parisien est exposée la Joconde ?', 'Le Louvre', 'Le musée d’Orsay;Le centre Pompidou;Le Grand Palais', 'Louvre'],
  // BD
  [2, 'Qui sont les deux créateurs d’Astérix ?', 'Goscinny et Uderzo', 'Hergé et Jacobs;Franquin et Morris;Peyo et Franquin', 'Goscinny;Uderzo;René Goscinny et Albert Uderzo'],
  [1, 'Qui est le créateur de Tintin ?', 'Hergé', 'Franquin;Peyo;Morris', ''],
  [1, 'Comment s’appelle le chien de Tintin ?', 'Milou', 'Idéfix;Rantanplan;Pif', ''],
  [1, 'Comment s’appelle le chien d’Obélix ?', 'Idéfix', 'Milou;Rantanplan;Cubitus', 'Idefix'],
  [1, 'Quel cow-boy « tire plus vite que son ombre » ?', 'Lucky Luke', 'Buffalo Bill;Blueberry;Jerry Spring', ''],
  [1, 'Quel personnage de Franquin est célèbre pour ses gaffes ?', 'Gaston Lagaffe', 'Spirou;Boule;Marsupilami', 'Gaston'],
  [1, 'De quelle couleur sont les Schtroumpfs ?', 'Bleus', 'Verts;Rouges;Jaunes', 'Bleu'],
  [2, 'Qui prépare la potion magique dans « Astérix » ?', 'Panoramix', 'Abraracourcix;Assurancetourix;Agecanonix', ''],
  // Super-héros
  [1, 'Quel est le vrai nom de Batman ?', 'Bruce Wayne', 'Clark Kent;Peter Parker;Tony Stark', 'Wayne'],
  [1, 'Dans quelle ville fictive Batman protège-t-il les habitants ?', 'Gotham City', 'Metropolis;Star City;Central City', 'Gotham'],
  [1, 'Quel est le vrai nom de Spider-Man ?', 'Peter Parker', 'Clark Kent;Bruce Banner;Matt Murdock', 'Parker'],
  [2, 'Sur quelle planète est né Superman ?', 'Krypton', 'Mars;Vulcain;Asgard', ''],
  // Disney
  [1, 'Qui a créé Mickey Mouse ?', 'Walt Disney', 'Tex Avery;Walter Lantz;Hanna et Barbera', 'Disney'],
  [1, 'Comment s’appelle la compagne de Mickey ?', 'Minnie', 'Daisy;Pluto;Clarabelle'],
  // Harry Potter
  [1, 'Dans quelle maison de Poudlard Harry Potter est-il réparti ?', 'Gryffondor', 'Serpentard;Poufsouffle;Serdaigle'],
  [1, 'Comment s’appelle le sport pratiqué sur des balais dans « Harry Potter » ?', 'Le quidditch', 'Le squash;Le volobalai;Le zonko', 'Quidditch'],
  [1, 'Qui est l’auteure de la saga « Harry Potter » ?', 'J. K. Rowling', 'Suzanne Collins;Stephenie Meyer;Agatha Christie', 'Rowling;JK Rowling'],
  [3, 'Qui a peint « Les Demoiselles d’Avignon » ?', 'Pablo Picasso', 'Henri Matisse;Georges Braque;Paul Gauguin', 'Picasso'],
  [3, 'Qui a créé le Marsupilami ?', 'André Franquin', 'Hergé;Peyo;Morris', 'Franquin'],
  [3, 'Qui a créé les Schtroumpfs ?', 'Peyo', 'Franquin;Hergé;Uderzo', ''],
  [3, 'Qui a peint « Impression, soleil levant » ?', 'Claude Monet', 'Auguste Renoir;Camille Pissarro;Édouard Manet', 'Monet'],
  [3, 'Qui a sculpté le « David » de Florence ?', 'Michel-Ange', 'Donatello;Rodin;Le Bernin', 'Michelangelo'],
  [3, 'Qui est le dessinateur d’Astérix ?', 'Albert Uderzo', 'René Goscinny;Hergé;Jean Tabary', 'Uderzo'],
  [3, 'Quel peintre est connu pour ses « Tournesols » ?', 'Vincent van Gogh', 'Claude Monet;Paul Gauguin;Paul Cézanne', 'Van Gogh'],
]

export const CULTURE_POP = build('culture-pop', rows)
