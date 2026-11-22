import type { FunStats, MiniProfile } from './api'

/** Une carte de stat décalée. Phrases neutres en genre : on n'utilise que le pseudo. */
export interface FunCard {
  id: string
  emoji: string
  title: string
  big: string
  text: string
  tone: 'sky' | 'sun' | 'mint' | 'grape' | 'tomato' | 'pink'
  who?: MiniProfile
}

type Ok = Extract<FunStats, { enough: true }>
const MIN = 5
const pct = (w: number, n: number) => Math.round((w / n) * 100)

const SLOT: Record<string, { label: string; when: string }> = {
  matin: { label: 'Le matin', when: 'avant midi' },
  aprem: { label: 'L’après-midi', when: 'entre midi et 18 h' },
  soir: { label: 'En soirée', when: 'entre 18 h et 23 h' },
  nuit: { label: 'La nuit', when: 'après 23 h' },
}
const DAYS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']

function fmtMin(min: number) {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`
}

/** Transforme les chiffres du serveur en cartes ; une carte n'apparaît que si les données la justifient. */
export function buildFunCards(d: Ok, nick: string, gameName: (id: string) => string): FunCard[] {
  const out: FunCard[] = []

  // Heures
  const slots = d.slots.filter((s) => s.played >= MIN).map((s) => ({ ...s, rate: pct(s.wins, s.played) }))
  if (slots.length >= 2) {
    const best = slots.reduce((a, b) => (b.rate > a.rate ? b : a))
    const worst = slots.reduce((a, b) => (b.rate < a.rate ? b : a))
    if (best.rate > worst.rate) {
      if (worst.rate < 50)
        out.push({
          id: 'worst-hour', emoji: '🧟', title: 'Heure maudite', tone: 'tomato', big: `${100 - worst.rate} %`,
          text: `${nick} perd ${100 - worst.rate} % de ses parties ${SLOT[worst.slot].when} (${worst.played} parties jouées)`,
        })
      out.push({
        id: 'best-hour', emoji: '🌟', title: 'Heure de gloire', tone: 'sun', big: `${best.rate} %`,
        text: `${SLOT[best.slot].label}, ${nick} gagne ${best.rate} % de ses parties. Redoutable !`,
      })
    }
  }

  // Jeux
  const games = d.per_game.filter((g) => g.played >= MIN).map((g) => ({ ...g, rate: pct(g.wins, g.played) }))
  if (games.length >= 2) {
    const best = games.reduce((a, b) => (b.rate > a.rate ? b : a))
    const worst = games.reduce((a, b) => (b.rate < a.rate ? b : a))
    if (best.rate > worst.rate) {
      out.push({
        id: 'fetish', emoji: '💘', title: 'Jeu fétiche', tone: 'pink', big: `${best.rate} %`,
        text: `Sur ${gameName(best.game_id)}, ${nick} gagne ${best.rate} % du temps (${best.wins} sur ${best.played})`,
      })
      out.push({
        id: 'cursed-game', emoji: '🪦', title: 'Jeu maudit', tone: 'grape', big: `${worst.rate} %`,
        text: `${gameName(worst.game_id)} et ${nick} : ${worst.wins} victoire${worst.wins > 1 ? 's' : ''} sur ${worst.played}. Une histoire compliquée`,
      })
    }
  }

  // Séries
  if (d.streak.win >= 3)
    out.push({
      id: 'streak-win', emoji: '🔥', title: 'Plus longue série', tone: 'sun', big: `${d.streak.win}`,
      text: `${d.streak.win} victoires d’affilée pour ${nick}. Personne n’a rien pu faire`,
    })
  if (d.streak.loss >= 3)
    out.push({
      id: 'streak-loss', emoji: '🧊', title: 'Pire galère', tone: 'sky', big: `${d.streak.loss}`,
      text: `${d.streak.loss} défaites d’affilée pour ${nick}. Courage, ça ne peut que remonter`,
    })

  // Duels
  const rival = [...d.duels].sort((a, b) => b.their_wins - a.their_wins)[0]
  if (rival && rival.their_wins >= 3)
    out.push({
      id: 'rival', emoji: '😈', title: 'Rival n°1', tone: 'tomato', big: `${rival.their_wins}`, who: rival,
      text: `${rival.nickname} a battu ${nick} ${rival.their_wins} fois en duel (contre ${rival.my_wins} dans l’autre sens)`,
    })
  const victim = [...d.duels].sort((a, b) => b.my_wins - a.my_wins)[0]
  if (victim && victim.my_wins >= 3 && victim.profile_id !== rival?.profile_id)
    out.push({
      id: 'victim', emoji: '🎯', title: 'Victime préférée', tone: 'mint', big: `${victim.my_wins}`, who: victim,
      text: `${nick} a battu ${victim.nickname} ${victim.my_wins} fois en duel. Pauvre ${victim.nickname}`,
    })

  // Duos
  const mates = d.mates.filter((m) => m.together >= MIN).map((m) => ({ ...m, rate: pct(m.wins, m.together) }))
  if (mates.length >= 2) {
    const best = mates.reduce((a, b) => (b.rate > a.rate ? b : a))
    const worst = mates.reduce((a, b) => (b.rate < a.rate ? b : a))
    if (best.rate > worst.rate) {
      out.push({
        id: 'duo-magic', emoji: '✨', title: 'Duo magique', tone: 'mint', big: `${best.rate} %`, who: best,
        text: `${nick} + ${best.nickname} : ${best.rate} % de victoires quand ils sont dans la même partie`,
      })
      out.push({
        id: 'duo-cursed', emoji: '💀', title: 'Duo maudit', tone: 'grape', big: `${worst.rate} %`, who: worst,
        text: `${nick} + ${worst.nickname} : seulement ${worst.rate} % de victoires quand ils jouent ensemble`,
      })
    }
  }
  if (d.mates[0] && d.mates[0].together >= MIN)
    out.push({
      id: 'bestie', emoji: '🫶', title: 'Pote n°1', tone: 'pink', big: `${d.mates[0].together}`, who: d.mates[0],
      text: `${nick} a joué ${d.mates[0].together} parties avec ${d.mates[0].nickname}. Inséparables`,
    })

  // Jours
  const days = d.days.filter((x) => x.played >= MIN).map((x) => ({ ...x, rate: pct(x.wins, x.played) }))
  if (days.length >= 2) {
    const best = days.reduce((a, b) => (b.rate > a.rate ? b : a))
    const worst = days.reduce((a, b) => (b.rate < a.rate ? b : a))
    if (best.rate > worst.rate) {
      out.push({
        id: 'lucky-day', emoji: '🍀', title: 'Jour porte-bonheur', tone: 'mint', big: DAYS[best.dow],
        text: `Le ${DAYS[best.dow]}, ${nick} gagne ${best.rate} % de ses parties`,
      })
      out.push({
        id: 'unlucky-day', emoji: '🌧️', title: 'Jour maudit', tone: 'sky', big: DAYS[worst.dow],
        text: `Le ${DAYS[worst.dow]}, ${nick} ne gagne que ${worst.rate} % de ses parties`,
      })
    }
  }

  // Soirée record
  if (d.longest_soiree && d.longest_soiree.minutes >= 30)
    out.push({
      id: 'longest', emoji: '🌙', title: 'Soirée marathon', tone: 'sun', big: fmtMin(d.longest_soiree.minutes),
      text: `La plus longue soirée de ${nick} : ${fmtMin(d.longest_soiree.minutes)} et ${d.longest_soiree.games} parties`,
    })
  return out
}
