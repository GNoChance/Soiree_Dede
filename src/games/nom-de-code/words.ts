/**
 * Pioche de Nom de Code : noms communs concrets, tout public, 3 à 9 lettres (lisibles sur une
 * grille 5×5 de téléphone), sans doublon une fois normalisés. 25 sont tirés par manche.
 */
import { shuffle } from '@/features/teams/teams'

export const NDC_WORDS: readonly string[] = [
  // animaux
  'chat', 'chien', 'lion', 'tigre', 'ours', 'loup', 'renard', 'lapin', 'souris', 'cheval',
  'vache', 'cochon', 'mouton', 'chèvre', 'poule', 'canard', 'oie', 'aigle', 'hibou', 'pigeon',
  'corbeau', 'perroquet', 'pingouin', 'phoque', 'baleine', 'dauphin', 'requin', 'poulpe', 'crabe', 'homard',
  'crevette', 'tortue', 'serpent', 'lézard', 'crocodile', 'crapaud', 'girafe', 'zèbre', 'éléphant', 'singe',
  'gorille', 'panda', 'koala', 'kangourou', 'chameau', 'hérisson', 'écureuil', 'castor', 'abeille', 'fourmi',
  'papillon', 'araignée', 'escargot', 'moustique', 'libellule', 'mouche', 'guêpe', 'licorne', 'dragon', 'dinosaure',
  'mammouth', 'paon', 'cygne', 'flamant', 'pélican', 'vautour', 'hamster', 'taupe', 'chouette', 'autruche',
  // nourriture
  'pomme', 'poire', 'banane', 'cerise', 'fraise', 'orange', 'citron', 'raisin', 'ananas', 'melon',
  'pastèque', 'pêche', 'abricot', 'prune', 'kiwi', 'mangue', 'tomate', 'carotte', 'salade', 'poireau',
  'oignon', 'patate', 'haricot', 'brocoli', 'radis', 'maïs', 'pizza', 'burger', 'frite', 'crêpe',
  'gâteau', 'tarte', 'biscuit', 'bonbon', 'glace', 'chocolat', 'fromage', 'yaourt', 'beurre', 'pain',
  'croissant', 'baguette', 'omelette', 'soupe', 'sushi', 'pâtes', 'riz', 'sucre', 'poivre', 'miel',
  'confiture', 'café', 'thé', 'lait', 'jus', 'œuf', 'chips', 'popcorn', 'noisette', 'potiron',
  // maison et objets
  'table', 'chaise', 'lit', 'lampe', 'canapé', 'tapis', 'rideau', 'miroir', 'horloge', 'réveil',
  'armoire', 'tiroir', 'étagère', 'coussin', 'couette', 'oreiller', 'bougie', 'vase', 'cadre', 'clé',
  'serrure', 'porte', 'fenêtre', 'balcon', 'escalier', 'ascenseur', 'cuisine', 'frigo', 'four', 'poêle',
  'casserole', 'couteau', 'cuillère', 'assiette', 'verre', 'tasse', 'bol', 'bouteille', 'théière', 'éponge',
  'balai', 'savon', 'brosse', 'peigne', 'serviette', 'baignoire', 'douche', 'robinet', 'valise', 'sac',
  'parapluie', 'lunettes', 'montre', 'bague', 'collier', 'chapeau', 'casquette', 'écharpe', 'gant', 'botte',
  'chaussure', 'pantalon', 'chemise', 'robe', 'jupe', 'pyjama', 'manteau', 'ceinture', 'cravate', 'bouton',
  'poche', 'panier', 'boîte', 'cage', 'seau', 'pelle', 'marteau', 'clou', 'scie', 'échelle',
  'corde', 'chaîne', 'brouette', 'arrosoir', 'tondeuse', 'plumeau',
  // transports et lieux
  'voiture', 'vélo', 'moto', 'bus', 'train', 'avion', 'bateau', 'fusée', 'camion', 'tracteur',
  'métro', 'taxi', 'radeau', 'canoë', 'maison', 'château', 'école', 'église', 'mairie', 'musée',
  'cinéma', 'théâtre', 'hôpital', 'gare', 'port', 'phare', 'pont', 'tour', 'plage', 'île',
  'forêt', 'montagne', 'désert', 'volcan', 'rivière', 'lac', 'océan', 'mer', 'grotte', 'jungle',
  'prairie', 'jardin', 'ferme', 'cirque', 'zoo', 'stade', 'piscine', 'parc', 'marché', 'boutique',
  'banque', 'prison', 'igloo', 'cabane', 'tente', 'village', 'ville', 'route', 'tunnel', 'autoroute',
  'aéroport', 'fontaine', 'manège', 'cascade', 'barrage', 'moulin', 'pyramide', 'usine', 'bureau', 'garage',
  // personnages et métiers
  'roi', 'reine', 'prince', 'princesse', 'chevalier', 'pirate', 'sorcier', 'fée', 'ogre', 'géant',
  'lutin', 'fantôme', 'robot', 'ninja', 'cowboy', 'clown', 'magicien', 'docteur', 'pompier', 'policier',
  'facteur', 'boulanger', 'cuisinier', 'jardinier', 'pilote', 'marin', 'soldat', 'détective', 'juge', 'artiste',
  'peintre', 'chanteur', 'danseur', 'acteur', 'écrivain', 'bébé', 'papi', 'mamie', 'voisin', 'espion',
  'vampire', 'momie', 'zombie', 'sirène', 'cyclope', 'astronome', 'fermier', 'berger', 'plombier', 'dentiste',
  // nature et espace
  'soleil', 'lune', 'étoile', 'planète', 'comète', 'nuage', 'pluie', 'neige', 'orage', 'éclair',
  'vent', 'tempête', 'glacier', 'arbre', 'fleur', 'rose', 'tulipe', 'feuille', 'herbe', 'cactus',
  'palmier', 'sapin', 'chêne', 'racine', 'graine', 'pierre', 'rocher', 'sable', 'caillou', 'diamant',
  'trésor', 'cristal', 'perle', 'galaxie', 'satellite', 'météore', 'aurore', 'brume', 'tornade', 'iceberg',
  // sport, jeux et musique
  'football', 'tennis', 'rugby', 'golf', 'boxe', 'judo', 'ski', 'surf', 'natation', 'course',
  'ballon', 'raquette', 'filet', 'but', 'médaille', 'trophée', 'coupe', 'échecs', 'dominos', 'carte',
  'puzzle', 'poupée', 'peluche', 'toupie', 'yoyo', 'guitare', 'piano', 'violon', 'batterie', 'trompette',
  'tambour', 'flûte', 'micro', 'disque', 'radio', 'photo', 'vidéo', 'film', 'livre', 'journal',
  'crayon', 'stylo', 'gomme', 'cahier', 'règle', 'ciseaux', 'colle', 'tableau', 'craie', 'cartable',
  'dessin', 'peinture', 'patin', 'luge', 'skate', 'karaté', 'bowling', 'billard', 'fléchette', 'quille',
  // technique
  'clavier', 'écran', 'téléphone', 'tablette', 'console', 'manette', 'câble', 'laser', 'aimant', 'ampoule',
  'pile', 'moteur', 'roue', 'antenne', 'radar', 'code', 'puce', 'boomerang', 'casque', 'caméra',
  // fêtes et aventures
  'cadeau', 'fête', 'masque', 'costume', 'couronne', 'épée', 'bouclier', 'arc', 'flèche', 'canon',
  'boussole', 'coffre', 'cloche', 'sifflet', 'drapeau', 'lanterne', 'torche', 'enveloppe', 'timbre', 'lettre',
  'colis', 'billet', 'pièce', 'ticket', 'confetti', 'guirlande', 'feu', 'carnaval', 'sorcière', 'citadelle',
  // corps
  'main', 'pied', 'tête', 'nez', 'oreille', 'bouche', 'dent', 'cheveu', 'bras', 'jambe',
  'genou', 'doigt', 'cœur', 'ventre', 'dos', 'coude', 'épaule', 'langue', 'moustache', 'barbe',
]

/** Tire `n` mots distincts au hasard (sans remise). */
export function pickWords(n: number): string[] {
  return shuffle(NDC_WORDS).slice(0, n)
}
