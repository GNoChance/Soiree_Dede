/** Règles en 3 blocs courts : utilisées par `definition.rules` et le carrousel du générique. */
export const DP_RULE_BLOCKS: { title: string; text: string }[] = [
  { title: '🎲 Le dé et le plateau', text: 'Tout le monde lance ses 2 dés en même temps. Les pions avancent tout seuls sur le plateau : tu n’as rien à choisir. À 5 joueurs et plus, le plateau s’agrandit avec des zones en plus.' },
  { title: '⭐ Les étoiles et les pièces', text: 'Passe sur une étoile avec 30 pièces (15 pour ta première) : elle est à toi ! Le plus d’étoiles gagne.' },
  { title: '🎮 Le mini-jeu de chaque manche', text: 'À chaque tour, un mini-jeu rapporte des pièces : 1er 10, 2e 6, 3e 4. Pas assez de monde ? Ajoute des bots dans les options.' },
]

export const DP_RULES_TEXT = DP_RULE_BLOCKS.map((b) => `${b.title} : ${b.text}`).join(' ')
