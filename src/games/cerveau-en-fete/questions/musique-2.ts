import { build, type Row } from './_helpers'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
const rows: Row[] = [
  // Rébus
  [1, '🌹🎶🇫🇷 — Quelle chanson d’Édith Piaf ?', 'La Vie en rose', 'Milord;L’Hymne à l’amour;Padam padam', 'Vie en rose'],
  [1, '💜🌧️ — Quelle chanson de Prince ?', 'Purple Rain', 'Kiss;When Doves Cry;Little Red Corvette'],
  [1, '👶🦈🎶 — Quelle comptine ?', 'Baby Shark', 'Petit Escargot;Une souris verte;Les Petits Poissons dans l’eau'],
  [1, '🐟🐟💃 — Quel tube de soirée de Patrick Sébastien ?', 'Les Sardines', 'Le Petit Bonhomme en mousse;Tourner les serviettes;La Danse des canards', 'Sardines'],
  [1, '🌙🚶‍♂️ — Quel pas de danse rendu célèbre par Michael Jackson ?', 'Le moonwalk', 'Le smurf;Le robot;Le jerk', 'Moonwalk;Moon walk'],
  [2, '🌧️☔🕺 — Quelle chanson de comédie musicale ?', 'Singin’ in the Rain', 'Over the Rainbow;Moon River;New York, New York', 'Singing in the Rain;Singin in the Rain;Chantons sous la pluie'],
  [2, '🍁☀️🪶 — Quelle chanson de Joe Dassin ?', 'L’Été indien', 'Salut les amoureux;Et si tu n’existais pas;À toi', 'Été indien;L’Ete indien'],
  [2, '🌍🤝🎶 — Quelle chanson caritative de 1985 ?', 'We Are the World', 'Do They Know It’s Christmas?;Heal the World;Imagine'],
  [2, '👁️🐯 — Quelle chanson de Survivor ?', 'Eye of the Tiger', 'The Final Countdown;We Will Rock You;Don’t Stop Believin’'],
  [3, '🌬️🏆🍬 — Quelle chanson de Renaud ?', 'Mistral gagnant', 'Morgane de toi;Laisse béton;Dès que le vent soufflera'],
  // Culture musique
  [1, 'Quel chanteur est surnommé « le King » ?', 'Elvis Presley', 'Johnny Cash;Chuck Berry;Frank Sinatra', 'Elvis;Presley'],
  [1, 'Quel chanteur britannique a chanté « Rocket Man » ?', 'Elton John', 'Billy Joel;Rod Stewart;Phil Collins', 'Elton'],
  [1, 'Quel chanteur français a chanté « Que je t’aime » ?', 'Johnny Hallyday', 'Michel Sardou;Eddy Mitchell;Claude François', 'Johnny;Hallyday'],
  [1, 'Quel chanteur a créé « Alexandrie Alexandra » ?', 'Claude François', 'Mike Brant;Joe Dassin;Michel Delpech', 'Cloclo;Claude Francois'],
  [1, 'Quelle chanteuse interprète « I Will Always Love You » dans le film « Bodyguard » ?', 'Whitney Houston', 'Mariah Carey;Toni Braxton;Tina Turner', 'Whitney;Houston'],
  [1, 'Combien de musiciens compte un quatuor ?', '4', '3;5;8', 'quatre'],
  [1, 'De quel pays la samba est-elle originaire ?', 'Le Brésil', 'L’Argentine;Cuba;Le Portugal', 'Brésil;Bresil'],
  [1, 'Quelle chanteuse a chanté « Désenchantée » ?', 'Mylène Farmer', 'Patricia Kaas;Jeanne Mas;Vanessa Paradis', 'Farmer;Mylene Farmer'],
  [1, 'Quel chanteur canadien a percé adolescent avec la chanson « Baby » ?', 'Justin Bieber', 'Shawn Mendes;Justin Timberlake;The Weeknd', 'Bieber'],
  [1, 'De quel instrument jouait Jimi Hendrix ?', 'La guitare', 'La basse;La batterie;Le piano', 'Guitare;Guitare électrique'],
  [2, 'Comment s’appelaient les danseuses de Claude François ?', 'Les Clodettes', 'Les Charlottes;Les Coquettes;Les Claudines', 'Clodettes'],
  [2, 'Quelle chanteuse française a chanté « Je veux » et « On ira » ?', 'Zaz', 'Louane;Indila;Nolwenn Leroy'],
  [2, 'Quel compositeur polonais est célèbre pour ses nocturnes et ses mazurkas pour piano ?', 'Frédéric Chopin', 'Franz Liszt;Robert Schumann;Sergueï Rachmaninov', 'Chopin;Frederic Chopin'],
  [2, 'Qui a composé « La Marseillaise » ?', 'Rouget de Lisle', 'Hector Berlioz;Étienne Méhul;Jean-Philippe Rameau', 'Claude Joseph Rouget de Lisle;Rouget de l’Isle;Rouget'],
  [2, 'Quel groupe suédois a chanté « The Final Countdown » ?', 'Europe', 'Roxette;Scorpions;Bon Jovi'],
  [2, 'Quelle chanteuse a chanté « Paroles, paroles » avec Alain Delon ?', 'Dalida', 'Mireille Mathieu;Sylvie Vartan;Nana Mouskouri'],
  [2, 'Quel chanteur a écrit « Les Copains d’abord » ?', 'Georges Brassens', 'Jacques Brel;Léo Ferré;Georges Moustaki', 'Brassens'],
  [2, 'Quel groupe français a chanté « L’Aventurier » ?', 'Indochine', 'Téléphone;Noir Désir;Les Rita Mitsouko'],
  [2, 'Quel groupe britannique a enregistré « Stairway to Heaven » ?', 'Led Zeppelin', 'Deep Purple;Black Sabbath;The Who', 'Led Zep'],
  [2, 'Quelle comédie musicale française de 1998 met en scène Quasimodo et Esmeralda ?', 'Notre-Dame de Paris', 'Les Dix Commandements;Roméo et Juliette;Le Roi Soleil', 'Notre Dame de Paris'],
  [2, 'Combien de lignes compte une portée musicale ?', '5', '4;6;7', 'cinq'],
  [3, 'Qui a composé « Le Carnaval des animaux » ?', 'Camille Saint-Saëns', 'Maurice Ravel;Claude Debussy;Paul Dukas', 'Saint-Saëns;Saint Saens'],
  [3, 'Qui a composé les « Gymnopédies » pour piano ?', 'Erik Satie', 'Claude Debussy;Gabriel Fauré;Francis Poulenc', 'Satie'],
  [3, 'Quel chanteur a chanté « Le Sud » en 1975 ?', 'Nino Ferrer', 'Michel Fugain;Hervé Vilard;Julien Clerc', 'Ferrer'],
  [3, 'Quelle chanteuse a écrit et interprété « L’Aigle noir » ?', 'Barbara', 'Juliette Gréco;Dalida;Françoise Hardy'],
  [3, 'Quel instrument est souvent surnommé « le roi des instruments » ?', 'L’orgue', 'Le piano;Le violon;La harpe', 'Orgue'],
  [3, 'Qui a composé la musique du film « Il était une fois dans l’Ouest » ?', 'Ennio Morricone', 'Nino Rota;John Williams;Maurice Jarre', 'Morricone'],
  [3, 'Comment s’appelle le signe placé au début de la portée qui fixe le nom des notes ?', 'La clé', 'Le bémol;Le dièse;Le point d’orgue', 'Clé;Clef;La clef;Clé de sol'],
  [3, 'Combien de noires vaut une ronde ?', '4', '2;3;8', 'quatre'],
  [3, 'Quelle chanteuse a fait gagner l’Eurovision 1977 à la France avec « L’Oiseau et l’Enfant » ?', 'Marie Myriam', 'Frida Boccara;Nicole Croisille;Sheila', 'Myriam'],
]

export const MUSIQUE_2 = build('musique', rows)
