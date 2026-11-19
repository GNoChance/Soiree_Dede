/**
 * Répliques de Dédé, l'animatrice de l'émission. `{name}` = le joueur concerné.
 * Choix déterministe (même réplique sur la télé et les téléphones pour un même évènement).
 */

export type LineKind =
  | 'intro'
  | 'roll'
  | 'start'
  | 'clap'
  | 'pub'
  | 'star'
  | 'star_exact'
  | 'star_poor'
  | 'card_good'
  | 'card_bad'
  | 'card'
  | 'nothing'
  | 'mg_intro'
  | 'mg_result'
  | 'finale'
  | 'king'
  | 'poisse'
  | 'winner'
  | 'tie'
  | 'self'
  | 'fork_scene'
  | 'fork_scene_no'
  | 'fork_tunnel'
  | 'fork_tunnel_no'

const LINES: Record<LineKind, string[]> = {
  intro: [
    'Bonsoir et bienvenue dans Dédé Party ! Applaudissez nos candidats !',
    'Mesdames et messieurs, l’émission va commencer… Silence sur le plateau !',
    'Ce soir, une seule question : qui repartira avec le plus d’étoiles ?',
    'Installez-vous, prenez vos dés, c’est parti pour Dédé Party !',
  ],
  roll: [
    'Tout le monde tape ses dés, on ne traîne pas !',
    'Les dés, s’il vous plaît ! Le plateau n’attend pas.',
    'Un petit lancer et on y va !',
    'Allez, allez, on lance ! J’ai une émission à boucler, moi.',
    'Pensez au Triple dé… mais une seule fois, hein !',
    'Deux dés chacun, et que ça roule ! Le plateau est grand, il faut des mollets.',
  ],
  start: [
    '{name} repasse par le Départ : 5 pièces, cadeau de la production !',
    'Un tour complet pour {name} ! La prod paie, +5 !',
    '{name} boucle la boucle. Ça mérite 5 pièces !',
  ],
  clap: [
    'On applaudit {name} bien fort ! +3 pièces.',
    'Le public adore {name} ! Trois pièces !',
    'Bravo {name} ! Allez, un tonnerre d’applaudissements.',
    '{name} fait un triomphe. Enfin, un petit triomphe : +3.',
    'Que d’amour pour {name} ce soir !',
  ],
  pub: [
    'Oh non… page de pub pour {name} ! −3 pièces.',
    '{name}, on coupe ! Petite page de pub, ça coûte 3 pièces.',
    'Et c’est la pub ! Désolée {name}, la lessive ne se vend pas toute seule.',
    'Coupure publicitaire ! {name} paie l’addition.',
    '{name} tombe sur la pub. Ne zappez pas, on revient !',
    'Aïe aïe aïe, {name}… les annonceurs te remercient.',
  ],
  star: [
    '{name} achète l’étoile ! Quelle classe !',
    'UNE ÉTOILE POUR {name} ! Le public est debout !',
    'Et voilà {name} qui décroche une étoile ! Ça brille !',
    'Une étoile de plus pour {name}. Les autres, il va falloir se réveiller !',
    'Bingo ! {name} met l’étoile dans sa poche.',
  ],
  star_exact: [
    'Pile sur l’étoile ! {name}, c’est du grand art !',
    '{name} s’arrête PILE dessus ! Je n’en reviens pas !',
    'Atterrissage parfait de {name} sur l’étoile !',
  ],
  star_poor: [
    '{name} passe devant l’étoile… mais les poches sont vides !',
    'Il faut 30 pièces, {name} (15 pour ta première). Reviens avec des sous !',
    'L’étoile te fait coucou, {name}… pas assez de pièces.',
    'Si près du but, {name} ! Mais il manque des pièces.',
  ],
  card_good: [
    'Enveloppe surprise pour {name}… et c’est une bonne nouvelle !',
    'Oh, la belle carte pour {name} !',
    '{name} a de la chance ce soir, dites donc !',
  ],
  card_bad: [
    'Enveloppe surprise… oups, pas de chance {name} !',
    'Ah ! Celle-là, {name} ne l’attendait pas.',
    'La carte n’est pas tendre avec {name}…',
  ],
  card: [
    'Enveloppe surprise ! Voyons ce que le sort réserve à {name}…',
    '{name} ouvre une enveloppe… suspense !',
    'Une enveloppe pour {name} ! Qu’est-ce qu’il y a dedans ?',
  ],
  nothing: [
    '{name} se pose en coulisses. Tranquille.',
    'Petite pause en loge pour {name}.',
    '{name} avance, mine de rien…',
  ],
  mg_intro: [
    'Place au mini-jeu ! Tout le monde à son téléphone !',
    'Et maintenant… le mini-jeu ! Les pièces sont en jeu !',
    'Mini-jeu ! Le premier rafle 10 pièces !',
    'On se concentre, c’est l’heure du mini-jeu !',
  ],
  mg_result: [
    'Bravo {name}, champion du mini-jeu !',
    'Le mini-jeu est pour {name} ! Applaudissements !',
    '{name} rafle la mise ! Qui l’arrêtera ?',
    'Quelle performance de {name} !',
  ],
  finale: [
    'Dernier tour : c’est LA FINALE, les gains du mini-jeu sont doublés !',
    'La Finale ! Tout peut encore basculer !',
    'Ultime tour ! Mini-jeu à gains doublés, accrochez-vous !',
  ],
  king: [
    'Première étoile bonus : le Roi des mini-jeux… {name} !',
    'L’étoile du Roi des mini-jeux revient à… {name} !',
  ],
  poisse: [
    'Et le Prix de la poisse, pour le plus de pages de pub, va à… {name} !',
    'Étoile de consolation, le Prix de la poisse : {name} ! Courage !',
  ],
  winner: [
    'Le grand vainqueur de Dédé Party, c’est {name} ! Bravo !',
    '{name} remporte l’émission ! Quelle soirée !',
    'Et la star de ce soir est… {name} !',
  ],
  tie: [
    'Égalité parfaite ! Je n’ai jamais vu ça dans mon émission !',
    'Ex aequo ! Tout le monde est gagnant… enfin presque !',
  ],
  self: [
    'Bon, c’est moi qui joue, là. Je me commente, c’est mon émission !',
    'Dédé est candidate ET animatrice. Personne n’a rien dit, hein ?',
    'Je joue, mais je reste impartiale. Promis.',
  ],
  fork_scene: [
    'L’aiguillage envoie {name} sur La Scène ! Souris, tu passes à l’antenne !',
    'Par ici {name}, en scène ! Le public n’attend que toi.',
    'Tapis rouge pour {name} : direction La Scène, les applaudissements sont offerts !',
    '{name} monte sur scène ! Attention aux projecteurs, ça chauffe.',
  ],
  fork_scene_no: [
    'Tout droit pour {name} ! La Scène, ce sera pour le prochain. Jaloux ?',
    'Pas de scène pour {name} : l’aiguillage a dit « circulez » !',
    '{name} file tout droit… et l’aiguillage tourne pour le suivant, petit veinard !',
    'Raccourci pour {name} ! Moins de gloire, mais ça avance.',
  ],
  fork_tunnel: [
    'Oh non, {name} part dans le Tunnel de la pub ! Trois coupures d’affilée, courage !',
    'L’aiguillage est sans pitié : {name}, direction le Tunnel de la pub !',
    '{name} entre dans le Tunnel de la pub… On se retrouve après la lessive et les yaourts.',
    'Tunnel de la pub pour {name} ! Garde tes pièces près du cœur.',
  ],
  fork_tunnel_no: [
    'Ouf ! {name} évite le Tunnel de la pub. Le suivant ne rigolera pas autant…',
    'Tout droit, {name} ! Le tunnel sera pour le prochain, hi hi.',
    '{name} passe à côté de la pub. Les annonceurs sont déçus, pas moi.',
    'Aiguillage sympa : pas de tunnel pour {name} ! Il se retourne déjà vers le suivant…',
  ],
}

function hash(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Réplique de Dédé pour un évènement (même `key` = même réplique partout). */
export function dedeLine(kind: LineKind, key: string, name = ''): string {
  const list = LINES[kind]
  return list[hash(`${kind}:${key}`) % list.length].replace(/\{name\}/g, name)
}

/** Nombre total de répliques (pour les docs / tests). */
export const DEDE_LINES_COUNT = Object.values(LINES).reduce((n, l) => n + l.length, 0)
