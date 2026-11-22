import { build, type Row } from './_helpers'

// Lot 2 (2026-11-22) : ajouté en fin de banque pour garder les identifiants existants.
const rows: Row[] = [
  // Rébus
  [1, '🏊‍♀️🛟🏖️ — Quelle série culte des années 1990 ?', 'Alerte à Malibu', 'Les Feux de l’amour;Deux flics à Miami;Hawaï police d’État', 'Baywatch'],
  [1, '🖤✋👧🏫 — Quelle série Netflix ?', 'Mercredi', 'Sabrina;Riverdale;Stranger Things', 'Wednesday'],
  [1, '🐞🐈‍⬛🦸‍♀️🗼 — Quel dessin animé français ?', 'Miraculous', 'Code Lyoko;Les Supers Nanas;W.I.T.C.H.', 'Miraculous Ladybug;Ladybug;Ladybug et Chat Noir'],
  [1, '🐱🪳🪳🪳 — Quel dessin animé français ?', 'Oggy et les Cafards', 'Tom et Jerry;Les Lapins Crétins;Garfield', 'Oggy'],
  [2, '♟️👩‍🦰🏆 — Quelle mini-série Netflix ?', 'Le Jeu de la dame', 'The Crown;Mercredi;La Chronique des Bridgerton', 'Jeu de la dame;The Queen’s Gambit'],
  [2, '🔪🩸🔬 — Quelle série ?', 'Dexter', 'Hannibal;Mindhunter;Bones'],
  [2, '🧢🪒🥃🇬🇧 — Quelle série britannique ?', 'Peaky Blinders', 'Boardwalk Empire;Downton Abbey;Ripper Street'],
  [2, '👠👗🍸🗽 — Quelle série ?', 'Sex and the City', 'Gossip Girl;Desperate Housewives;Ugly Betty', 'SATC'],
  [2, '🧥🚬🔍 — Quel lieutenant de série ?', 'Columbo', 'Derrick;Maigret;Navarro'],
  // Culture séries
  [1, 'Quel personnage de « Friends » est interprété par Jennifer Aniston ?', 'Rachel Green', 'Monica Geller;Phoebe Buffay;Emily Waltham', 'Rachel'],
  [1, 'Dans « Game of Thrones », quel personnage joue Peter Dinklage ?', 'Tyrion Lannister', 'Jaime Lannister;Bran Stark;Petyr Baelish', 'Tyrion'],
  [1, 'Quel outil MacGyver a-t-il toujours sur lui ?', 'Un couteau suisse', 'Un marteau;Une lampe torche;Un tournevis', 'Couteau suisse'],
  [1, 'Quel acteur joue le héros du « Prince de Bel-Air » ?', 'Will Smith', 'Eddie Murphy;Denzel Washington;Martin Lawrence', 'Smith'],
  [1, 'Comment s’appelle le héros de « Dragon Ball » ?', 'Son Goku', 'Vegeta;Krilin;Gohan', 'Goku;Sangoku;San Goku'],
  [1, 'Quel dessin animé russe raconte les bêtises d’une petite fille chez un gros ours ?', 'Masha et Michka', 'Peppa Pig;Petit Ours Brun;Trotro', 'Masha;Masha et l’ours;Masha and the Bear'],
  [1, 'Quel lapin de dessin animé lance « Quoi de neuf, docteur ? » ?', 'Bugs Bunny', 'Roger Rabbit;Jojo Lapin;Coco Lapin', 'Bugs'],
  [1, 'Quel acteur britannique incarne Mr Bean ?', 'Rowan Atkinson', 'Hugh Laurie;John Cleese;Benny Hill', 'Atkinson'],
  [1, 'Dans « La Casa de Papel », de quoi les braqueurs portent-ils les noms ?', 'De villes', 'De planètes;De peintres;De fleurs', 'Des villes;Villes;Noms de villes', 'QCM'],
  [1, 'Dans quelle série française Jean Dujardin et Alexandra Lamy forment-ils un couple ?', 'Un gars, une fille', 'Scènes de ménages;Caméra Café;Kaamelott', 'Un gars une fille'],
  [1, 'Comment s’appelle la voiture qui parle dans « K 2000 » ?', 'KITT', 'KARR;HAL;Herbie', 'Kit'],
  [2, 'Dans « Friends », quel est le métier de Ross ?', 'Paléontologue', 'Archéologue;Géologue;Astronome', 'Paleontologue'],
  [2, 'Dans « Kaamelott », quel chevalier répond souvent « C’est pas faux » ?', 'Perceval', 'Karadoc;Lancelot;Gauvain', 'Perceval de Galles'],
  [2, 'Dans « Stranger Things », comment s’appelle la dimension parallèle ?', 'Le Monde à l’envers', 'L’Autre Côté;La Zone fantôme;Le Néant', 'Monde à l’envers;Upside Down'],
  [2, 'Quelle série dérivée de « Breaking Bad » est consacrée à l’avocat Saul Goodman ?', 'Better Call Saul', 'El Camino;Ozark;The Shield'],
  [2, 'Quels acteurs jouent Jean-Claude Convenant et Hervé Dumont dans « Caméra Café » ?', 'Bruno Solo et Yvan Le Bolloc’h', 'Kad et Olivier;Éric et Ramzy;Omar et Fred', 'Bruno Solo et Yvan Le Bolloch', 'QCM'],
  [2, 'Quelle actrice incarne la commissaire Julie Lescaut ?', 'Véronique Genest', 'Corinne Touzet;Mimie Mathy;Ingrid Chauvin', 'Genest'],
  [2, 'Dans quel lieu se déroule la série « H » avec Jamel Debbouze, Éric et Ramzy ?', 'Un hôpital', 'Un lycée;Un commissariat;Une caserne', 'Hôpital;L’hôpital'],
  [2, 'Dans « Ma sorcière bien-aimée », que remue Samantha pour faire de la magie ?', 'Son nez', 'Ses oreilles;Ses sourcils;Sa bouche', 'Le nez;Nez'],
  [2, 'Quel acteur joue Sherlock Holmes dans la série « Sherlock » de la BBC ?', 'Benedict Cumberbatch', 'Martin Freeman;Jonny Lee Miller;Robert Downey Jr.', 'Cumberbatch'],
  [2, 'Quel acteur s’est fait connaître en jouant le Dr Doug Ross dans « Urgences » ?', 'George Clooney', 'Brad Pitt;Patrick Dempsey;Noah Wyle', 'Clooney'],
  [3, 'De quelle race est le chien Scooby-Doo ?', 'Dogue allemand', 'Saint-bernard;Labrador;Boxer', 'Danois;Grand danois;Dogue'],
  [3, 'Quel acteur allemand incarne l’inspecteur Derrick ?', 'Horst Tappert', 'Fritz Wepper;Rolf Schimpf;Siegfried Lowitz', 'Tappert'],
  [3, 'Comment s’appelle le chien des Simpson en version française ?', 'Petit Papa Noël', 'Rex;Boule de Neige;Snoopy', 'Santa’s Little Helper'],
  [3, 'Dans « Fais pas ci, fais pas ça », quelle famille fait face aux Lepic ?', 'Les Bouley', 'Les Martin;Les Durand;Les Dupuis', 'Bouley'],
  [3, 'Comment Jean et Alex se surnomment-ils dans « Un gars, une fille » ?', 'Chouchou et Loulou', 'Doudou et Chouchou;Mimi et Loulou;Bibou et Choupette', '', 'QCM'],
  [3, 'Quel acteur joue Malotru dans « Le Bureau des légendes » ?', 'Mathieu Kassovitz', 'Jean-Pierre Darroussin;Vincent Cassel;Tahar Rahim', 'Kassovitz'],
  [3, 'Dans quel restaurant Penny est-elle serveuse dans « The Big Bang Theory » ?', 'The Cheesecake Factory', 'Central Perk;Los Pollos Hermanos;Luke’s Diner', 'Cheesecake Factory'],
  [3, 'De quelle couleur est la Ford Gran Torino de « Starsky et Hutch » ?', 'Rouge', 'Noire;Bleue;Jaune', 'Rouge et blanche;Rouge et blanc'],
  [3, 'Comment s’appelle le gentleman-espion au chapeau melon de « Chapeau melon et bottes de cuir » ?', 'John Steed', 'Simon Templar;James West;Napoleon Solo', 'Steed'],
  [3, 'Quel feuilleton américain se déroule dans la ville de Genoa City ?', 'Les Feux de l’amour', 'Amour, gloire et beauté;Santa Barbara;Dallas', 'Feux de l’amour;The Young and the Restless'],
]

export const SERIES_2 = build('series', rows)
