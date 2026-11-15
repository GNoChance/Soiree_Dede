// Banque de catégories du Petit bac (contenu rempli par l'agent contenu).
export interface BacCategory {
  id: string // 'pays'
  label: string // 'Pays'
  emoji: string
  /** Catégorie jouable facilement avec les lettres difficiles ? (sert au tirage) */
  easy?: boolean
}
export const CATEGORIES: BacCategory[] = [
  // Classiques
  { id: 'pays', label: 'Pays', emoji: '🌍', easy: true },
  { id: 'ville', label: 'Ville', emoji: '🏙️', easy: true },
  { id: 'prenom', label: 'Prénom', emoji: '🧑', easy: true },
  { id: 'animal', label: 'Animal', emoji: '🐾', easy: true },
  { id: 'metier', label: 'Métier', emoji: '👷', easy: true },
  { id: 'fruit-legume', label: 'Fruit ou légume', emoji: '🍎', easy: true },
  { id: 'marque', label: 'Marque', emoji: '🏷️' },
  { id: 'celebrite', label: 'Célébrité', emoji: '🌟' },
  { id: 'film', label: 'Film', emoji: '🎬' },
  { id: 'serie', label: 'Série', emoji: '📺' },
  { id: 'chanteur', label: 'Chanteur·se', emoji: '🎤' },
  { id: 'objet-maison', label: 'Objet de la maison', emoji: '🛋️', easy: true },
  { id: 'sport', label: 'Sport', emoji: '⚽', easy: true },
  { id: 'plat', label: 'Plat', emoji: '🍝', easy: true },
  { id: 'dessert', label: 'Dessert', emoji: '🍰', easy: true },
  { id: 'boisson', label: 'Boisson', emoji: '🥤', easy: true },
  { id: 'vetement', label: 'Vêtement', emoji: '👕', easy: true },
  { id: 'couleur', label: 'Couleur', emoji: '🎨', easy: true },
  { id: 'instrument', label: 'Instrument de musique', emoji: '🎸' },
  { id: 'partie-corps', label: 'Partie du corps', emoji: '🦶', easy: true },
  { id: 'transport', label: 'Moyen de transport', emoji: '🚲', easy: true },
  { id: 'ustensile', label: 'Ustensile de cuisine', emoji: '🍴', easy: true },
  { id: 'meuble', label: 'Meuble', emoji: '🪑', easy: true },
  { id: 'oiseau', label: 'Oiseau', emoji: '🐦' },
  { id: 'cours-deau', label: "Cours d'eau", emoji: '🌊' },
  { id: 'montagne', label: 'Montagne', emoji: '⛰️' },
  { id: 'langue', label: 'Langue', emoji: '🗣️', easy: true },
  { id: 'verbe', label: 'Verbe', emoji: '✍️' },
  { id: 'fleur-plante', label: 'Fleur ou plante', emoji: '🌸' },
  { id: 'ingredient', label: 'Ingrédient', emoji: '🧂', easy: true },
  // Fun
  { id: 'jeu', label: 'Jeu (de société ou vidéo)', emoji: '🎲' },
  { id: 'personnage-dessin-anime', label: 'Personnage de dessin animé', emoji: '🐭' },
  { id: 'super-heros', label: 'Super-héros', emoji: '🦸' },
  { id: 'vacances', label: "Chose qu'on emporte en vacances", emoji: '🧳' },
  { id: 'excuse-retard', label: 'Excuse pour être en retard', emoji: '⏰' },
  { id: 'rime-en-e', label: 'Mot qui rime avec « -é »', emoji: '🔤' },
  { id: 'nom-chien', label: 'Nom de chien', emoji: '🐶', easy: true },
  { id: 'cri-animal', label: "Cri d'animal", emoji: '🦁' },
  { id: 'pretexte-partir', label: 'Prétexte pour quitter une soirée', emoji: '🚪' },
  { id: 'sac-a-main', label: "Chose qu'on trouve dans un sac à main", emoji: '👜' },
  { id: 'chose-qui-fait-peur', label: 'Chose qui fait peur', emoji: '👻' },
  { id: 'surnom', label: 'Surnom affectueux', emoji: '💕' },
  { id: 'titre-chanson', label: 'Titre de chanson', emoji: '🎵' },
  { id: 'sous-le-lit', label: "Chose qu'on trouve sous le lit", emoji: '🛏️' },
  { id: 'super-pouvoir', label: 'Super-pouvoir', emoji: '⚡' },
]
/** Lettres tirables (exclut les lettres trop dures par défaut). */
export const LETTERS: string[] = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'L', 'M', 'N', 'O', 'P', 'R', 'S', 'T', 'U', 'V',
]
