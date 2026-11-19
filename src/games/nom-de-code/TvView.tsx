import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { burst } from '@/components/ui/confetti'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { TEAM_INFO } from '@/features/teams/teams'
import { useViewport } from '@/features/tv/tv'
import type { GamePlayProps, PlayerInfo } from '../types'
import { BOMB, NEUTRAL, tint } from './Grid'
import { guessersOf, majority } from './logic'
import { roundHeadline } from './RoundEnd'
import { ndcActions } from './setup'
import type { NdcState } from './types'

/**
 * Vue télé de Nom de Code (rendue par Play sous TvContext) : lecture seule, jamais de secret.
 * Seul `s` (state public) est lu : les cartes non dévoilées n'ont AUCUNE couleur tant que la manche
 * est en cours ; `s.key` (public) n'existe qu'en fin de manche.
 */

const GAP = 8
const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`

/** Taille des cartes selon la fenêtre et l'orientation. */
function useLayout() {
  const { w, h } = useViewport()
  const landscape = w > h * 1.05
  const availH = Math.max(240, h - 64)
  const gridW = landscape ? Math.min(w * 0.62, (availH - 24) * 1.28) : w - 24
  const cellW = Math.max(40, (gridW - GAP * 4) / 5)
  const cellH = landscape ? cellW / 1.25 : cellW / 0.95
  return { landscape, cellW, cellH }
}

function TvGrid({ s, players, cellW, cellH, showKey }: { s: NdcState; players: Record<string, PlayerInfo>; cellW: number; cellH: number; showKey: boolean }) {
  const reduce = useReducedMotion()
  const key = showKey ? s.key : null
  return (
    <div className="grid shrink-0" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: GAP, width: cellW * 5 + GAP * 4 }}>
      {s.words.map((w, i) => {
        const rev = s.revealed[String(i)]
        const heads = Object.entries(s.votes)
          .filter(([, v]) => v === i)
          .map(([pid]) => pid)
        const hidden = !rev && key ? tint(key[i]) : null
        let style: React.CSSProperties | undefined = hidden ?? undefined
        let face: React.ReactNode = null
        if (rev) {
          if (rev.color === 'neutral') style = { background: NEUTRAL, color: '#1f1b2e' }
          else if (rev.color === 'bomb') {
            style = { background: BOMB, color: '#ffffff' }
            face = (
              <span style={{ fontSize: cellH * 0.34 }} className="leading-none">
                💥
              </span>
            )
          } else {
            style = { background: TEAM_INFO[rev.color].color, color: TEAM_INFO[rev.color].text }
            const owner = s.teams.find((t) => t.id === rev.color)?.players[0]
            if (owner) face = <Avatar slug={playerOrPlaceholder(players, owner).slug} tenue={playerOrPlaceholder(players, owner).equippedTenue} size={Math.round(cellH * 0.36)} />
          }
        }
        const len = w.length
        const f = cellW < 110 ? 1.3 : 1
        const font = Math.round(cellW * f * (len <= 7 ? 0.15 : len <= 10 ? 0.125 : 0.105))
        return (
          <motion.div
            key={`${s.round}-${i}`}
            initial={false}
            animate={rev && !reduce ? { rotateY: [90, 0], scale: [1.08, 1] } : { rotateY: 0 }}
            transition={{ duration: 0.45 }}
            style={{ ...style, height: cellH }}
            className={cn('relative flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-chip border-[3px] border-ink px-1 text-center', !style && 'bg-surface text-text')}
          >
            {face}
            <span lang="fr" style={{ fontSize: font }} className="w-full break-words font-display font-extrabold leading-tight hyphens-auto">
              {w}
            </span>
            {hidden && key?.[i] === 'bomb' && <span className="absolute top-1 right-1 text-base">💣</span>}
            {heads.length > 0 && (
              <span className="absolute bottom-0.5 left-0 flex w-full justify-center -space-x-2">
                {heads.slice(0, 5).map((pid) => (
                  <Avatar key={pid} slug={playerOrPlaceholder(players, pid).slug} tenue={playerOrPlaceholder(players, pid).equippedTenue} size={Math.round(cellH * 0.34)} />
                ))}
              </span>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

function TeamCard({ s, id, live, players, big }: { s: NdcState; id: NdcState['turn']; live: boolean; players: Record<string, PlayerInfo>; big: boolean }) {
  const t = s.teams.find((x) => x.id === id)
  if (!t) return null
  const meta = TEAM_INFO[id]
  const active = live && s.turn === id && !t.eliminated
  return (
    <motion.div
      animate={active ? { scale: [1, 1.03, 1] } : { scale: 1 }}
      transition={active ? { repeat: Infinity, duration: 1.6 } : undefined}
      className={cn('sticker-sm flex items-center gap-3 rounded-card px-3 py-2', t.eliminated && 'opacity-40 grayscale')}
      style={{ backgroundColor: active ? meta.color : meta.soft, color: active ? meta.text : '#1f1b2e' }}
    >
      <span className={big ? 'text-5xl' : 'text-3xl'}>{t.eliminated ? '💀' : meta.emoji}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate font-display font-extrabold', big ? 'text-xl' : 'text-base')}>{meta.short}</span>
        <span className="flex -space-x-2">
          {t.players.map((p) => (
            <span key={p} className={cn('relative rounded-full', p === t.spy && 'ring-2 ring-ink')}>
              <Avatar slug={playerOrPlaceholder(players, p).slug} tenue={playerOrPlaceholder(players, p).equippedTenue} size={big ? 40 : 30} />
            </span>
          ))}
        </span>
      </div>
      <div className="flex flex-col items-center leading-none">
        <span className={cn('font-display font-extrabold tabular-nums', big ? 'text-6xl' : 'text-4xl')}>{t.total - t.found}</span>
        <span className="text-xs font-bold">mot{t.total - t.found > 1 ? 's' : ''}</span>
      </div>
    </motion.div>
  )
}

function CluePanelTv({ s, players, big }: { s: NdcState; players: Record<string, PlayerInfo>; big: boolean }) {
  const active = TEAM_INFO[s.turn]
  const team = s.teams.find((t) => t.id === s.turn)
  const need = majority(guessersOf(s, s.turn).length)
  if (s.phase === 'clue') {
    const spy = team ? playerOrPlaceholder(players, team.spy) : null
    return (
      <div className="sticker flex items-center justify-center gap-3 rounded-card bg-surface p-3 text-center">
        {spy && <Avatar slug={spy.slug} tenue={spy.equippedTenue} expression={mood(spy, 'think')} size={big ? 84 : 56} bounce />}
        <p className={cn('font-display font-extrabold', big ? 'text-3xl' : 'text-xl')}>🕵️ L’espion des {active.short} cherche un indice…</p>
      </div>
    )
  }
  if (s.phase === 'guess' && s.clue) {
    return (
      <motion.div
        key={`${s.clue.word}-${s.clue.n}`}
        initial={{ scale: 0.7, rotate: -3 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 12 }}
        className="sticker flex flex-col items-center gap-1 rounded-card p-3 text-center"
        style={{ backgroundColor: active.soft, color: '#1f1b2e' }}
      >
        <p className={cn('break-all font-display font-extrabold leading-tight uppercase', big ? 'text-5xl' : 'text-4xl')}>
          🔎 {s.clue.word} <span className="whitespace-nowrap">· {s.clue.n}</span>
        </p>
        <p className={cn('font-bold', big ? 'text-xl' : 'text-base')}>
          {active.emoji} Les {active.short} devinent · {s.guesses_left} essai{s.guesses_left > 1 ? 's' : ''} restant{s.guesses_left > 1 ? 's' : ''}
        </p>
        <p className={cn('font-bold opacity-80', big ? 'text-lg' : 'text-sm')}>
          Il faut {need} tête{need > 1 ? 's' : ''} sur un mot · Stop {s.stop.length}/{need}
        </p>
      </motion.div>
    )
  }
  return null
}

export function NdcTv({ state, act, players }: GamePlayProps) {
  const s = state as unknown as NdcState
  const { landscape, cellW, cellH } = useLayout()
  const live = s.phase === 'clue' || s.phase === 'guess'
  const ended = s.phase === 'round_end' || s.phase === 'finished'
  const left = useCountdown(live ? s.deadline : null)
  const timeUp = live && Boolean(s.deadline) && left <= 0
  const secs = Math.ceil(left / 1000)

  // Échéance : un tick idempotent (ré-essayé tant que la phase n'a pas bougé).
  useEffect(() => {
    if (!timeUp) return
    let t = 0
    let cancelled = false
    const send = async () => {
      if (cancelled) return
      await act(ndcActions.tick())
      if (!cancelled) t = window.setTimeout(() => void send(), 2500)
    }
    t = window.setTimeout(() => void send(), 400 + Math.random() * 800)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [timeUp, act])

  useEffect(() => {
    if (live && s.deadline && secs > 0 && secs <= 5) fx.tick()
  }, [live, s.deadline, secs])

  // Bruitages à chaque carte dévoilée.
  const seen = useRef<Set<string> | null>(null)
  useEffect(() => {
    const keys = Object.keys(s.revealed)
    const prev = seen.current
    seen.current = new Set(keys)
    if (!prev) return
    const fresh = keys.filter((k) => !prev.has(k)).map((k) => s.revealed[k])
    if (!fresh.length) return
    if (fresh.some((c) => c.color === 'bomb')) fx.fail()
    else if (fresh.some((c) => c.color === c.by)) fx.success()
    else fx.whoosh()
  }, [s.revealed])

  useEffect(() => {
    if (!ended) return
    fx.success()
    burst({ x: 0.5, y: 0.3 }, 120)
  }, [ended, s.round])

  const win = s.round_winner ? TEAM_INFO[s.round_winner] : null
  const timer =
    live && s.deadline ? (
      <span className={cn('sticker-sm rounded-full bg-surface px-4 py-1 text-center font-display text-3xl font-extrabold tabular-nums', secs <= 10 && 'text-tomato')}>⏱️ {mmss(Math.max(0, secs))}</span>
    ) : null

  const side = (
    <div className={cn('flex min-w-0 flex-col gap-3', landscape && 'flex-1 justify-center')}>
      {ended ? (
        <>
          <motion.p
            initial={{ scale: 0.6, rotate: -4 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 10 }}
            className={cn('sticker rounded-card p-4 text-center font-display font-extrabold', landscape ? 'text-4xl' : 'text-2xl')}
            style={win ? { backgroundColor: win.soft, color: '#1f1b2e' } : undefined}
          >
            {roundHeadline(s)}
          </motion.p>
          {s.total_rounds > 1 && (
            <div className="flex flex-wrap justify-center gap-2">
              {s.teams.map((t) => (
                <span key={t.id} className="sticker-sm rounded-full px-4 py-1 font-display text-2xl font-extrabold" style={{ backgroundColor: TEAM_INFO[t.id].soft, color: '#1f1b2e' }}>
                  {TEAM_INFO[t.id].emoji} {s.round_wins[t.id] ?? 0}
                </span>
              ))}
              <span className="w-full text-center text-base font-bold text-muted">
                Manche {s.round}/{s.total_rounds}
              </span>
            </div>
          )}
          {s.phase === 'round_end' && <p className="text-center text-lg font-bold text-muted">L’hôte lance la manche suivante…</p>}
        </>
      ) : (
        <>
          {timer && <div className="flex justify-center">{timer}</div>}
          <CluePanelTv s={s} players={players} big={landscape} />
        </>
      )}
      <div className="flex flex-col gap-2">
        {s.teams.map((t) => (
          <TeamCard key={t.id} s={s} id={t.id} live={live} players={players} big={landscape} />
        ))}
      </div>
    </div>
  )

  return (
    <div className={cn('flex h-full gap-4 p-3', landscape ? 'flex-row items-center justify-center' : 'flex-col items-center overflow-y-auto')}>
      {landscape ? (
        <>
          <TvGrid s={s} players={players} cellW={cellW} cellH={cellH} showKey={ended} />
          {side}
        </>
      ) : (
        <>
          <div className="w-full">{side}</div>
          <TvGrid s={s} players={players} cellW={cellW} cellH={cellH} showKey={ended} />
        </>
      )}
    </div>
  )
}

/** Résumé de fin de partie en grand : grille finale, équipes gagnantes en grosses têtes. */
export function NdcTvSummary({ s, players }: { s: NdcState; players: Record<string, PlayerInfo> }) {
  const { landscape, cellW, cellH } = useLayout()
  const winners = s.winners ?? (s.round_winner ? [s.round_winner] : [])
  const get = (id: string) => playerOrPlaceholder(players, id)
  const k = landscape ? 0.8 : 1
  return (
    <div className={cn('flex gap-4', landscape ? 'flex-row items-center justify-center' : 'flex-col items-center')}>
      {s.key && <TvGrid s={s} players={players} cellW={cellW * k} cellH={cellH * k} showKey />}
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4">
        <p className="text-center font-display text-2xl font-extrabold">{roundHeadline(s)}</p>
        {winners.map((w) => {
          const t = s.teams.find((x) => x.id === w)
          if (!t) return null
          return (
            <motion.div key={w} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center gap-2 text-center">
              <p className="font-display text-4xl font-extrabold" style={{ color: TEAM_INFO[w].color }}>
                {TEAM_INFO[w].emoji} Les {TEAM_INFO[w].short} gagnent !
              </p>
              <div className="flex flex-wrap justify-center gap-3">
                {t.players.map((id) => (
                  <div key={id} className="flex w-28 flex-col items-center">
                    <Avatar slug={get(id).slug} expression={mood(get(id), 'proud')} tenue={get(id).equippedTenue} size={landscape ? 96 : 72} bounce />
                    <span className="w-full truncate text-base font-extrabold">{get(id).nickname}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )
        })}
        {s.total_rounds > 1 && (
          <div className="flex flex-wrap justify-center gap-2">
            {s.teams.map((t) => (
              <span key={t.id} className="sticker-sm rounded-full px-4 py-1 font-display text-xl font-extrabold" style={{ backgroundColor: TEAM_INFO[t.id].soft, color: '#1f1b2e' }}>
                {TEAM_INFO[t.id].emoji} {s.round_wins[t.id] ?? 0} manche{(s.round_wins[t.id] ?? 0) > 1 ? 's' : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
