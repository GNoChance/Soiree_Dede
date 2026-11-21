import type { PersonalityId } from './api'

export interface Personality {
  emoji: string
  title: string
  line: string
}

/** « Personnalités » drôles du Wrapped (choisies côté SQL, textes ici). */
const PERSONALITIES: Record<PersonalityId, Personality> = {
  noctambule: { emoji: '🦉', title: 'Le noctambule', line: 'Les autres dorment, toi tu lances « encore une dernière ». Spoiler : ce n’est jamais la dernière.' },
  champion: { emoji: '🏆', title: 'Le stratège', line: 'Tu gagnes plus d’une partie sur deux. Les autres commencent à te regarder de travers.' },
  assidu: { emoji: '🔥', title: 'L’increvable du défi', line: 'Ton défi du jour, c’est sacré. Même en vacances, même sous la pluie.' },
  collectionneur: { emoji: '🎒', title: 'Le collectionneur', line: 'Trophées, tenues, stickers : ton armoire déborde, et tu en veux encore !' },
  sociable: { emoji: '🎈', title: 'L’âme de la fête', line: 'Tu as joué avec tout le monde. Une soirée sans toi, c’est une soirée sans sel.' },
  touche_a_tout: { emoji: '🎲', title: 'Le touche-à-tout', line: 'Pas un jeu ne t’a échappé. Tu as tout essayé, et tu t’es même amusé·e.' },
  fidele: { emoji: '💛', title: 'Le pilier de soirée', line: 'Toujours présent·e quand ça joue. Les soirées de Dédé, c’est un peu chez toi.' },
  bon_joueur: { emoji: '🌈', title: 'Le bon joueur', line: 'Gagner, perdre, peu importe : toi, tu es là pour rigoler. Et ça vaut tous les trophées !' },
  curieux: { emoji: '🐣', title: 'Le·la curieux·se', line: 'Ton année vient à peine de commencer. La prochaine soirée sera la bonne !' },
}

export const personalityOf = (id: PersonalityId): Personality => PERSONALITIES[id] ?? PERSONALITIES.bon_joueur
