-- =============================================================================
-- CONTENU DE LA HOTTE DU JOUR (événement de Noël) — idempotent : vide puis remplit les 3 banques.
-- Tables : hotte.sql. 40 quiz, 20 chants (domaine public), 20 « combien ».
-- =============================================================================
delete from public.hotte_quiz;
delete from public.hotte_songs;
delete from public.hotte_estimates;

insert into public.hotte_quiz(prompt, answer, distractors) values
  -- Traditions de Noël en France
  ('Parmi les desserts de Noël provençaux, que sont les « quatre mendiants » ?', 'Des fruits secs', array['Des biscuits', 'Des santons', 'Des bougies']),
  ('Que cache-t-on dans la galette des rois ?', 'Une fève', array['Une pièce d’or', 'Une noisette', 'Un grelot']),
  ('À quelle date tombe traditionnellement l’Épiphanie ?', 'Le 6 janvier', array['Le 1er janvier', 'Le 26 décembre', 'Le 2 février']),
  ('Quel jour fête-t-on la Saint-Nicolas ?', 'Le 6 décembre', array['Le 1er décembre', 'Le 24 décembre', 'Le 11 novembre']),
  ('Quelle ville française accueille le plus ancien marché de Noël du pays, né en 1570 ?', 'Strasbourg', array['Colmar', 'Lille', 'Reims']),
  ('Dans une crèche provençale, comment appelle-t-on les petites figurines ?', 'Les santons', array['Les lutins', 'Les fèves', 'Les pantins']),
  ('Selon la tradition, que fait-on sous une branche de gui ?', 'On s’embrasse', array['On chante', 'On se serre la main', 'On fait la sieste']),
  ('De quelle couleur sont les baies du houx ?', 'Rouges', array['Blanches', 'Bleues', 'Violettes']),
  ('En Alsace, comment appelle-t-on les petits biscuits de Noël ?', 'Les bredele', array['Les bretzels', 'Les spätzle', 'Les knacks']),
  ('À l’origine, qu’était la bûche de Noël ?', 'Une vraie bûche dans la cheminée', array['Un pain en forme de sapin', 'Une bougie géante', 'Un fromage de montagne']),
  ('Quel fruit glissait-on autrefois dans les souliers des enfants à Noël ?', 'Une orange', array['Une banane', 'Un ananas', 'Une pastèque']),
  ('Comment appelle-t-on le repas de fête du soir du 24 décembre ?', 'Le réveillon', array['Le brunch', 'Le goûter', 'Le pique-nique']),
  ('Quel sapin de Noël est le plus vendu en France ?', 'Le Nordmann', array['L’épicéa', 'Le mélèze', 'Le pin parasol']),
  ('Avec l’or et l’encens, quel est le troisième cadeau des Rois mages ?', 'La myrrhe', array['La cannelle', 'Le miel', 'La soie']),
  -- Noël dans le monde
  ('Dans quel pays se trouve Rovaniemi, le village officiel du Père Noël ?', 'En Finlande', array['En Norvège', 'En Suède', 'En Islande']),
  ('Comment dit-on « Joyeux Noël » en espagnol ?', 'Feliz Navidad', array['Buon Natale', 'Frohe Weihnachten', 'Merry Christmas']),
  ('En Australie, en quelle saison fête-t-on Noël ?', 'En été', array['En hiver', 'Au printemps', 'En automne']),
  ('Au Japon, quel plat est devenu une tradition populaire de Noël ?', 'Le poulet frit', array['Les sushis', 'La raclette', 'La pizza']),
  ('Quel pays offre chaque année à Londres le grand sapin de Trafalgar Square ?', 'La Norvège', array['La Suède', 'La Finlande', 'Le Canada']),
  ('Dans quel pays le chant « Douce nuit » a-t-il été composé, en 1818 ?', 'En Autriche', array['En Allemagne', 'En Suisse', 'En France']),
  -- Films, contes et musique
  ('Dans « Maman, j’ai raté l’avion ! », dans quelle ville la famille part-elle fêter Noël ?', 'Paris', array['Londres', 'Rome', 'New York']),
  ('De quelle couleur est le Grinch ?', 'Vert', array['Rouge', 'Bleu', 'Violet']),
  ('Comment s’appelle le chien du Grinch ?', 'Max', array['Rex', 'Milou', 'Pluto']),
  ('Dans « La Reine des neiges », comment s’appelle le bonhomme de neige ?', 'Olaf', array['Sven', 'Kristoff', 'Hans']),
  ('Sur quel royaume règne Elsa dans « La Reine des neiges » ?', 'Arendelle', array['Corona', 'Agrabah', 'Atlantica']),
  ('Dans « Le Pôle Express », quel premier cadeau de Noël le garçon choisit-il ?', 'Un grelot du traîneau', array['Un train électrique', 'Un sifflet de contrôleur', 'Un bonnet rouge']),
  ('Dans le film « Elfe », comment s’appelle le héros élevé par les elfes du Père Noël ?', 'Buddy', array['Bernard', 'Dobby', 'Legolas']),
  ('Dans « Le Père Noël est une ordure », quelle association répond au téléphone ?', 'SOS Détresse Amitié', array['SOS Père Noël', 'Allô Réconfort', 'SOS Solitude Joyeuse']),
  ('Qui a composé la musique du ballet « Casse-Noisette » ?', 'Tchaïkovski', array['Mozart', 'Beethoven', 'Vivaldi']),
  ('Qui a écrit « Un chant de Noël », l’histoire de l’avare Scrooge ?', 'Charles Dickens', array['Jules Verne', 'Victor Hugo', 'Mark Twain']),
  -- Le Père Noël et ses rennes
  ('Quel renne du Père Noël est célèbre pour son nez rouge ?', 'Rudolph', array['Comète', 'Tonnerre', 'Cupidon']),
  ('Chez les rennes, qui porte des bois ?', 'Les mâles et les femelles', array['Seulement les mâles', 'Seulement les femelles', 'Seulement les chefs de troupeau']),
  ('Par où le Père Noël entre-t-il dans les maisons ?', 'Par la cheminée', array['Par la fenêtre', 'Par le garage', 'Par la chatière']),
  -- Hiver et neige
  ('Combien de branches possède un flocon de neige ?', 'Six', array['Quatre', 'Cinq', 'Huit']),
  ('Vers quelle date commence l’hiver en France ?', 'Le 21 décembre', array['Le 1er décembre', 'Le 21 novembre', 'Le 1er janvier']),
  ('Lequel de ces animaux ne vit pas au pôle Nord ?', 'Le manchot', array['L’ours polaire', 'Le morse', 'Le renard polaire']),
  -- Gastronomie de fête
  ('Quel gâteau italien de Noël, en forme de dôme, est garni de fruits confits ?', 'Le panettone', array['Le tiramisu', 'La panna cotta', 'Le cannolo']),
  ('Quel dessert de Noël anglais est flambé avant d’être servi ?', 'Le Christmas pudding', array['Le cheesecake', 'Le crumble', 'Le brownie']),
  ('Quel ingrédient sucré est indispensable au pain d’épices ?', 'Le miel', array['Le caramel', 'La confiture', 'Le sirop d’érable']),
  ('Avec quel fruit fabrique-t-on les marrons glacés ?', 'La châtaigne', array['Le marron d’Inde', 'La noix', 'La noisette']);

insert into public.hotte_songs(line, answer, distractors) values
  -- Mon beau sapin (paroles françaises de Laurent Delcasso, 1856)
  ('Mon beau sapin, ___ des forêts', 'roi', array['prince', 'chef', 'géant']),
  ('Mon beau sapin, roi des forêts, que j’aime ta ___ !', 'verdure', array['ramure', 'coiffure', 'figure']),
  ('Mon beau sapin, roi des forêts, tu gardes ta ___', 'parure', array['fourrure', 'toiture', 'ceinture']),
  ('Joli sapin, comme ils sont doux, et tes bonbons et tes ___ !', 'joujoux', array['cadeaux', 'gâteaux', 'bijoux']),
  -- Il est né le divin enfant (traditionnel, XIXe siècle)
  ('Il est né le divin enfant, jouez ___, résonnez musettes !', 'hautbois', array['violons', 'tambours', 'pianos']),
  ('Il est né le divin enfant, jouez hautbois, résonnez ___ !', 'musettes', array['trompettes', 'clochettes', 'guitares']),
  ('Depuis plus de ___ mille ans, nous le promettaient les prophètes', 'quatre', array['deux', 'trois', 'dix']),
  ('Une étable est son logement, un peu de ___ est sa couchette', 'paille', array['laine', 'mousse', 'neige']),
  -- Les anges dans nos campagnes (traditionnel)
  ('Les anges dans nos ___ ont entonné l’hymne des cieux', 'campagnes', array['villages', 'vallées', 'chaumières']),
  ('Et l’écho de nos ___ redit ce chant mélodieux', 'montagnes', array['vallées', 'forêts', 'clochers']),
  ('Les anges dans nos campagnes… Gloria in excelsis ___', 'Deo', array['Domino', 'Maria', 'Noël']),
  -- Minuit, chrétiens (Placide Cappeau, 1843)
  ('Minuit, chrétiens, c’est l’heure ___', 'solennelle', array['éternelle', 'fraternelle', 'officielle']),
  ('Peuple, à ___, attends ta délivrance !', 'genoux', array['table', 'cheval', 'minuit']),
  -- Entre le bœuf et l’âne gris (traditionnel)
  ('Entre le bœuf et l’âne ___, dort, dort, dort le petit fils', 'gris', array['blanc', 'noir', 'roux']),
  ('Mille anges divins, mille ___ volent à l’entour de ce grand Dieu d’amour', 'séraphins', array['chérubins', 'lutins', 'pingouins']),
  ('Entre les roses et les ___, dort, dort, dort le petit fils', 'lys', array['lilas', 'iris', 'tulipes']),
  -- La Marche des rois, D’où viens-tu bergère, Un flambeau Jeannette Isabelle, Guillaume prends ton tambourin (traditionnels)
  ('De bon matin, j’ai rencontré le train de trois grands ___ qui allaient en voyage', 'rois', array['princes', 'ducs', 'chefs']),
  ('D’où viens-tu, ___, d’où viens-tu ?', 'bergère', array['fermière', 'meunière', 'laitière']),
  ('Un flambeau, Jeannette, Isabelle, un flambeau, courons au ___ !', 'berceau', array['château', 'ruisseau', 'village']),
  ('Guillaume, prends ton ___, toi, prends ta flûte, Robin', 'tambourin', array['violon', 'pipeau', 'clairon']);

insert into public.hotte_estimates(prompt, answer, unit) values
  ('Combien de rennes tirent le traîneau du Père Noël (sans compter Rudolph) ?', 8, 'rennes'), -- source : poème « A Visit from St. Nicholas » (1823), qui nomme 8 rennes
  ('Combien de desserts sert-on à Noël dans la tradition provençale ?', 13, 'desserts'), -- source : tradition des treize desserts de Provence
  ('Combien de cases compte un calendrier de l’Avent classique ?', 24, 'cases'), -- source : une case par jour, du 1er au 24 décembre
  ('Combien de jours séparent Noël de l’Épiphanie (la fête des Rois) ?', 12, 'jours'), -- source : du 25 décembre au 6 janvier, les « douze jours de Noël »
  ('En Espagne, combien de grains de raisin avale-t-on à minuit le soir du Nouvel An ?', 12, 'grains de raisin'), -- source : tradition des « doce uvas », un grain par coup de minuit
  ('Dans la chanson anglaise « The Twelve Days of Christmas », combien de cadeaux sont offerts en tout ?', 364, 'cadeaux'), -- source : cumul sur les 12 jours, 1 + 3 + 6 + … + 78 = 364
  ('Quel âge a le petit héros de « Maman, j’ai raté l’avion ! » ?', 8, 'ans'), -- source : film de 1990, le héros a 8 ans
  ('Combien de dimanches compte l’Avent ?', 4, 'dimanches'), -- source : calendrier liturgique, les 4 dimanches avant Noël
  ('À combien de degrés Fahrenheit l’eau gèle-t-elle ?', 32, 'degrés Fahrenheit'), -- source : 0 °C = 32 °F
  ('Record de froid sur Terre : combien de degrés sous zéro a-t-on mesurés en Antarctique ?', 89, 'degrés sous zéro'), -- source : −89,2 °C à la base Vostok le 21 juillet 1983 (record homologué par l’OMM)
  ('Quel angle sépare deux branches voisines d’un flocon de neige ?', 60, 'degrés'), -- source : symétrie hexagonale du cristal de glace, 360 / 6
  ('Sur combien de pays s’étend la Laponie ?', 4, 'pays'), -- source : Norvège, Suède, Finlande et Russie
  ('Du pôle Nord au pôle Sud, combien de kilomètres le Père Noël doit-il parcourir à la surface du globe ?', 20000, 'kilomètres'), -- source : demi-méridien terrestre, environ 20 004 km
  ('Combien de semaines faut-il patienter entre deux Noëls ?', 52, 'semaines'), -- source : 365 jours = 52 semaines et 1 jour
  ('Combien de fois le Père Noël dit-il « Ho ! » dans son célèbre rire ?', 3, 'fois'), -- source : « Ho ! Ho ! Ho ! »
  ('Combien de jours fériés compte une année en France ?', 11, 'jours fériés'), -- source : Code du travail, art. L. 3133-1 (11 fêtes légales, hors Alsace-Moselle)
  ('Combien de jours séparent la Saint-Nicolas de Noël ?', 19, 'jours'), -- source : du 6 au 25 décembre
  ('Combien de lettres faut-il pour écrire « Joyeux Noël » ?', 10, 'lettres'), -- source : 6 lettres + 4 lettres
  ('Quel jour de décembre fête-t-on la Saint-Sylvestre ?', 31, 'décembre'), -- source : calendrier, dernier jour de l’année
  ('Combien de minutes dure la journée de Noël, de minuit à minuit ?', 1440, 'minutes'); -- source : 24 heures × 60 minutes
