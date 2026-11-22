import { Avatar } from '@/components/ui/Avatar'
import { getGame } from '@/games/registry'
import { buildAwards } from '@/features/recap/cards'
import type { SoireeRecap } from '@/features/recap/api'
import { fmtDuration, gameLabel, type MiniProfile } from '@/features/stats/api'
import type { AlbumSoiree } from './api'

/** Date longue (« samedi 14 novembre 2026 »). */
export const albumDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' })

const MEDALS = ['🥇', '🥈', '🥉']
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`

function profilesOf(s: AlbumSoiree) {
  const m = new Map<string, MiniProfile>()
  for (const p of s.players) m.set(p.profile_id, p)
  for (const r of s.standings) m.set(r.profile_id, r)
  return m
}

/** Qui a gagné quoi, par jeu : « Kevin ×2, Manon ». */
function winnersByGame(s: AlbumSoiree) {
  const out = new Map<string, Map<string, { name: string; n: number }>>()
  for (const m of s.matches) {
    const g = out.get(m.game_id) ?? new Map()
    for (const w of m.winners) g.set(w.profile_id, { name: w.nickname, n: (g.get(w.profile_id)?.n ?? 0) + 1 })
    out.set(m.game_id, g)
  }
  return out
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-lg font-extrabold">{title}</h3>
      {children}
    </section>
  )
}

/** Une page d'album = une soirée. Utilisée par le livre à l'écran et par la page d'impression. */
export function AlbumLeaf({ soiree: s }: { soiree: AlbumSoiree }) {
  const who = profilesOf(s)
  const name = (id: string) => who.get(id)?.nickname ?? '?'
  const podium = s.standings.filter((r) => r.points > 0).slice(0, 3)
  const wins = winnersByGame(s)
  const awards = buildAwards(s as unknown as SoireeRecap).filter((a) => a.key !== 'star').slice(0, 4)
  const h = s.highlights
  const hasMoments = !!h.margin || awards.length > 0 || h.trophies.length > 0 || h.words.length > 0 || !!h.dilemma

  return (
    <article className="album-leaf flex flex-col gap-4 rounded-card border-[3px] border-ink bg-surface p-4 text-text shadow-sticker">
      <header>
        <p className="text-2xl font-extrabold capitalize leading-tight">{albumDate(s.started_at)}</p>
        <p className="font-bold text-muted">
          {s.host ? `Chez ${s.host.nickname} · ` : ''}
          {fmtDuration(s.duration_min)} · {plural(s.games_played, 'partie')} · {plural(s.players.length, 'présent·e', 'présent·e·s')}
        </p>
      </header>

      {podium.length > 0 && (
        <Section title="👑 Star de la soirée">
          <ol className="flex items-end justify-center gap-3">
            {podium.map((r, i) => (
              <li key={r.profile_id} className="flex min-w-0 flex-1 flex-col items-center text-center">
                <Avatar slug={r.slug} tenue={r.equipped_tenue} frame={null} size={i === 0 ? 84 : 64} expression={i === 0 ? 'champion' : 'joie'} />
                <span className="text-xl leading-none">{MEDALS[i]}</span>
                <span className="w-full truncate text-sm font-extrabold">{r.nickname}</span>
                <span className="text-xs font-bold text-muted">{r.points} pts</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="🎉 Les présents">
        <div className="flex flex-wrap gap-x-2 gap-y-1">
          {s.players.map((p) => (
            <div key={p.profile_id} className="flex w-14 flex-col items-center">
              <Avatar slug={p.slug} tenue={p.equipped_tenue} frame={null} size={44} />
              <span className="w-full truncate text-center text-xs font-bold">{p.nickname}</span>
            </div>
          ))}
        </div>
      </Section>

      {s.games.length > 0 && (
        <Section title="🎮 Les jeux">
          <ul className="flex flex-col gap-1">
            {s.games.map((g) => {
              const w = [...(wins.get(g.game_id)?.values() ?? [])].sort((a, b) => b.n - a.n).slice(0, 3)
              return (
                <li key={g.game_id} className="text-sm leading-snug">
                  <span className="font-extrabold">{gameLabel(g.game_id, getGame)}</span>
                  {g.played > 1 && <span className="font-bold text-muted"> ×{g.played}</span>}
                  {w.length > 0 && <span className="font-bold text-muted"> — 🏆 {w.map((x) => (x.n > 1 ? `${x.name} ×${x.n}` : x.name)).join(', ')}</span>}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {hasMoments && (
        <Section title="⭐ Moments forts">
          <ul className="flex flex-col gap-1.5 text-sm font-bold leading-snug">
            {h.margin && (
              <li>
                💪 Plus grosse victoire : {name(h.margin.profile_id)} avec {h.margin.points} pts, soit {h.margin.lead} d’avance !
              </li>
            )}
            {awards.map((a) => (
              <li key={a.key}>
                {a.emoji} {a.title} : {a.who[0]?.nickname} ({a.big})
              </li>
            ))}
            {h.trophies.map((t, i) => (
              <li key={`t${i}`}>
                🏆 Trophée « {t.name} » débloqué par {name(t.profile_id)}
              </li>
            ))}
            {h.words.map((w, i) => (
              <li key={`w${i}`}>
                ✍️ Petit Bac : « {w.text} » ({w.category}
                {w.letter ? `, en ${w.letter}` : ''}) par {name(w.profile_id)}
              </li>
            ))}
            {h.dilemma && (
              <li>
                🤔 Dilemme qui a divisé : « {h.dilemma.a} » ({h.dilemma.count_a}) ou « {h.dilemma.b} » ({h.dilemma.count_b}) ?
              </li>
            )}
          </ul>
        </Section>
      )}
    </article>
  )
}
