import type { MiniProfile } from '@/features/stats/api'
import type { RecapAward, SoireeRecap } from './api'

/** Une « carte » d'award prête à afficher (textes bienveillants et rigolos). */
export interface AwardView {
  key: string
  emoji: string
  title: string
  /** Grosse valeur (ex. « 4 victoires »). */
  big: string
  line: string
  bg: string
  who: MiniProfile[]
  /** Sticker préféré : expression + tenue d'envoi. */
  sticker?: { expression: string; tenue: string; total: number }
}

export type RecapCard = { kind: 'numbers' } | { kind: 'topgame' } | { kind: 'award'; view: AwardView } | { kind: 'standings' } | { kind: 'final' }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`

export function profilesOf(r: SoireeRecap) {
  const map = new Map<string, MiniProfile>()
  for (const p of r.players) map.set(p.profile_id, p)
  for (const s of r.standings) map.set(s.profile_id, s)
  return map
}

function awardView(a: RecapAward, who: MiniProfile): AwardView {
  const x = a.extra ?? {}
  switch (a.id) {
    case 'serie':
      return {
        key: a.id, emoji: '🔥', title: 'Série en or', bg: 'bg-tangerine', who: [who],
        big: plural(a.value, 'victoire') + ' d’affilée',
        line: 'On ne t’arrête plus ! Quelqu’un a une cheminée à éteindre.',
      }
    case 'bluff': {
      const parts: string[] = []
      if (x.as_undercover) parts.push(`${plural(x.as_undercover, 'victoire')} en infiltré·e`)
      if (x.as_wolf) parts.push(`${plural(x.as_wolf, 'victoire')} en loup`)
      return {
        key: a.id, emoji: '🎭', title: 'Roi / Reine du bluff', bg: 'bg-lime', who: [who],
        big: plural(a.value, 'bluff') + ' réussi' + (a.value > 1 ? 's' : ''),
        line: `${parts.join(' et ')}. Un visage innocent, un cœur de menteur : bravo l’artiste !`,
      }
    }
    case 'deuxieme':
      return {
        key: a.id, emoji: '🥈', title: 'Collectionneur de 2es places', bg: 'bg-sky', who: [who],
        big: plural(a.value, 'médaille') + ' d’argent',
        line: 'Toujours juste derrière le soleil. L’argent, ça brille aussi !',
      }
    case 'pasdebol':
      return {
        key: a.id, emoji: '🍀', title: 'Pas de bol de la soirée', bg: 'bg-bubblegum', who: [who],
        big: plural(a.value, 'dernière place'),
        line: 'La malchance t’adore, mais toi tu gardes le sourire. Le courage, ça compte aussi !',
      }
    case 'bavard':
      return {
        key: a.id, emoji: '💬', title: 'Le plus bavard', bg: 'bg-mint', who: [who],
        big: plural(a.value, 'message'),
        line: 'Les doigts qui fument ! Heureusement qu’il y avait quelqu’un pour animer le chat.',
      }
    case 'devin':
      return {
        key: a.id, emoji: '🔮', title: 'Meilleur devin', bg: 'bg-sky', who: [who],
        big: plural(a.value, 'bon pronostic', 'bons pronostics') + (x.bets ? ` sur ${x.bets}` : ''),
        line: 'Madame Irma, c’est toi ? Tu avais tout vu venir avant même le début de la partie !',
      }
    default:
      return {
        key: a.id, emoji: '🎟️', title: 'Sticker préféré de la soirée', bg: 'bg-sun', who: [who],
        big: `${plural(x.total ?? a.value, 'envoi')} en tout`,
        line: `Le plus envoyé de la soirée, et son plus grand fan : ${who.nickname} (${plural(a.value, 'fois', 'fois')}).`,
        sticker: { expression: x.expression ?? 'joie', tenue: x.tenue ?? 'default', total: x.total ?? a.value },
      }
  }
}

/** Awards à montrer : Star (classement) puis ceux calculés par le serveur. */
export function buildAwards(r: SoireeRecap): AwardView[] {
  const out: AwardView[] = []
  const stars = r.standings.filter((s) => s.rank === 1 && s.points > 0)
  if (stars.length > 0 && r.games_played > 0) {
    out.push({
      key: 'star', emoji: '👑', title: stars.length > 1 ? 'Stars de la soirée' : 'Star de la soirée', bg: 'bg-sun', who: stars,
      big: `${stars[0].points} pts`,
      line: stars.length > 1 ? 'Égalité parfaite au sommet : on partage la couronne !' : 'Le grand·e gagnant·e ! Tout le monde peut applaudir.',
    })
  }
  const profiles = profilesOf(r)
  for (const a of r.awards) {
    const who = profiles.get(a.profile_id)
    if (who) out.push(awardView(a, who))
  }
  return out
}

export function buildCards(r: SoireeRecap): RecapCard[] {
  const cards: RecapCard[] = [{ kind: 'numbers' }]
  if (r.top_game) cards.push({ kind: 'topgame' })
  for (const view of buildAwards(r)) cards.push({ kind: 'award', view })
  cards.push({ kind: 'standings' }, { kind: 'final' })
  return cards
}
