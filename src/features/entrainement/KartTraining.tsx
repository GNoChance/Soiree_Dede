import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Button } from '@/components/ui/Button'
import { victoryConfetti } from '@/components/ui/confetti'
import { buildDrivers } from '@/games/dede-kart/drivers'
import type { Game } from '@/games/dede-kart/engine/Game'
import type { Fx, Hazard, UsePayload } from '@/games/dede-kart/engine/items'
import { TRACKS } from '@/games/dede-kart/tracks'
import type { PlayerInfo } from '@/games/types'
import { fmtLap, readRecord, submitRecord, type Verdict } from './records'
import { ChoiceCard, EndScreen, FOOT_NOTE, TrainingHeader } from './ui'

// La scène 3D (three) n'est chargée qu'au départ de la course.
const KartRace = lazy(() => import('@/games/dede-kart/KartRace'))

interface Setup {
  track: number
  laps: 2 | 3 | 5
  /** Bots ajoutés (la grille compte 1 + bots karts). */
  bots: 3 | 5 | 7
}

const DEFAULT: Setup = { track: 0, laps: 3, bots: 5 }
const recId = (track: number) => `dede-kart:${track}`
const ordinal = (n: number) => `${n}${n === 1 ? 'er' : 'e'}`

interface RaceEnd {
  place: number
  total: number
  /** Temps de course (s). */
  time: number | null
  best: number | null
  verdict: Verdict | null
}

type Stage = { kind: 'pick' } | { kind: 'race'; round: number } | { kind: 'end'; end: RaceEnd }

/** Dédé Kart en entraînement : course contre des bots, sur ce téléphone seulement. */
export default function KartTraining({ me, color, title, onBack }: { me: PlayerInfo; color: string; title: string; onBack: () => void }) {
  const [setup, setSetup] = useState<Setup>(DEFAULT)
  const [stage, setStage] = useState<Stage>({ kind: 'pick' })

  if (stage.kind === 'race') {
    return (
      <Suspense fallback={<p className="p-8 text-center font-display text-xl font-extrabold">Préparation de la piste…</p>}>
        <KartRun
          key={stage.round}
          me={me}
          setup={setup}
          onEnd={(end) => setStage({ kind: 'end', end })}
          onQuit={() => setStage({ kind: 'pick' })}
        />
      </Suspense>
    )
  }

  if (stage.kind === 'end') {
    const { end } = stage
    const track = TRACKS[setup.track]
    return (
      <EndScreen
        emoji={end.place === 1 ? '🏆' : end.place <= 3 ? '🥈' : '🏁'}
        headline={`${track.emoji} ${track.name}`}
        score={`${ordinal(end.place)} / ${end.total}`}
        detail={end.time !== null ? `Course en ${fmtLap(end.time)}` : 'Tu n’as pas fini la course'}
        verdict={end.verdict}
        format={fmtLap}
        extra={
          <div className="sticker-sm bg-surface p-3 text-center font-display text-lg font-extrabold">
            ⏱️ Meilleur tour : {end.best !== null ? fmtLap(end.best) : '—'}
          </div>
        }
        onReplay={() => setStage({ kind: 'race', round: Date.now() })}
        onChange={() => setStage({ kind: 'pick' })}
        onBack={onBack}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-8">
      <TrainingHeader title={title} color={color} onBack={onBack} />

      <h2 className="text-center text-2xl">Choisis ton circuit</h2>
      <div className="flex flex-col gap-3">
        {TRACKS.map((t, i) => {
          const rec = readRecord(recId(i))
          return (
            <ChoiceCard
              key={t.id}
              on={setup.track === i}
              onClick={() => setSetup({ ...setup, track: i })}
              emoji={t.emoji}
              title={t.name}
              record={rec !== null ? `tour en ${fmtLap(rec)}` : null}
            />
          )
        })}
      </div>

      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Tours</span>
        <SegmentedControl
          ariaLabel="Nombre de tours"
          value={String(setup.laps)}
          onChange={(v) => setSetup({ ...setup, laps: Number(v) as Setup['laps'] })}
          options={[2, 3, 5].map((n) => ({ value: String(n), label: `${n} tours` }))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Adversaires</span>
        <SegmentedControl
          ariaLabel="Nombre de bots"
          value={String(setup.bots)}
          onChange={(v) => setSetup({ ...setup, bots: Number(v) as Setup['bots'] })}
          options={[3, 5, 7].map((n) => ({ value: String(n), label: `${n} bots` }))}
        />
      </div>

      <Button size="lg" fullWidth onClick={() => setStage({ kind: 'race', round: Date.now() })}>
        C’est parti ! 🏎️
      </Button>
      <p className="text-center text-sm font-bold text-muted">{FOOT_NOTE}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* La course                                                                    */
/* -------------------------------------------------------------------------- */

/** Départ : 4,5 s (le temps que la 3D charge, puis les feux). */
const START_DELAY = 4500

function KartRun({ me, setup, onEnd, onQuit }: { me: PlayerInfo; setup: Setup; onEnd: (e: RaceEnd) => void; onQuit: () => void }) {
  const track = TRACKS[setup.track]
  const botIds = useMemo(() => Array.from({ length: setup.bots }, (_, k) => `bot${k + 1}`), [setup.bots])
  const drivers = useMemo(() => buildDrivers([me.id], botIds, { [me.id]: me }), [me, botIds])
  const [goAt] = useState(() => Date.now() + START_DELAY)
  const [confirm, setConfirm] = useState(false)

  // Pièges et effets : l'équivalent local de state.hazards / state.fx (le serveur n'existe pas ici).
  const game = useRef<Game | null>(null)
  const items = useRef<{ hazards: Hazard[]; fx: Fx[]; seq: number }>({ hazards: [], fx: [], seq: 0 })
  const sync = useCallback(() => {
    const now = Date.now()
    const it = items.current
    it.hazards = it.hazards.filter((h) => Date.parse(h.at) > now - (h.type === 'ball' ? 6000 : 30000))
    it.fx = it.fx.filter((f) => Date.parse(f.until) > now)
    game.current?.syncItems(it.hazards, it.fx)
  }, [])
  useEffect(() => {
    const t = window.setInterval(sync, 1000)
    return () => clearInterval(t)
  }, [sync])
  const onReady = useCallback(
    (g: Game | null) => {
      game.current = g
      sync()
    },
    [sync],
  )
  const onUse = useCallback(
    (id: string, u: UsePayload) => {
      const it = items.current
      const now = Date.now()
      if (u.item === 'ball' || u.item === 'glue' || u.item === 'butter' || u.item === 'hen') {
        it.hazards = [...it.hazards, { id: ++it.seq, type: u.item, owner: id, x: u.x ?? 0, z: u.z ?? 0, h: u.h ?? 0, at: new Date(now).toISOString() }]
      } else {
        for (const target of new Set(u.targets ?? [])) {
          if (target === id) continue
          it.fx = [...it.fx, { id: ++it.seq, type: u.item, target, by: id, until: new Date(now + 3000).toISOString() }]
        }
      }
      sync()
    },
    [sync],
  )
  const onHit = useCallback(
    (_id: string, hazard: number) => {
      items.current.hazards = items.current.hazards.filter((h) => h.id !== hazard)
      sync()
    },
    [sync],
  )

  // Mes temps de tour (le premier part du feu vert).
  const laps = useRef<{ last: number; times: number[] }>({ last: goAt, times: [] })
  const onLap = useCallback((id: string) => {
    if (id !== me.id) return
    const now = Date.now()
    laps.current.times.push((now - laps.current.last) / 1000)
    laps.current.last = now
  }, [me.id])

  const finished = useRef(false)
  const onFinish = useCallback(
    (results: { id: string; time: number | null; me: boolean }[]) => {
      if (finished.current) return
      finished.current = true
      const place = Math.max(1, results.findIndex((r) => r.me) + 1)
      const mine = results.find((r) => r.me)
      const best = laps.current.times.length ? Math.min(...laps.current.times) : null
      const verdict = best !== null ? submitRecord(recId(setup.track), best, true) : null
      if (verdict?.beaten || place === 1) victoryConfetti(1600)
      // petit temps pour savourer la ligne d'arrivée
      window.setTimeout(() => onEnd({ place, total: results.length, time: mine?.time ?? null, best, verdict }), 1500)
    },
    [setup.track, onEnd],
  )

  return (
    <KartRace
      track={track}
      laps={setup.laps}
      drivers={drivers}
      meId={me.id}
      localBots={botIds}
      botIds={botIds}
      goAt={goAt}
      now={Date.now}
      showResults={false}
      onLap={onLap}
      onUse={onUse}
      onHit={onHit}
      onFinish={onFinish}
      onReady={onReady}
    >
      <button
        type="button"
        onClick={() => (confirm ? onQuit() : setConfirm(true))}
        onBlur={() => setConfirm(false)}
        className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-chip border-[3px] border-ink bg-surface px-3 py-1.5 text-sm font-extrabold text-text shadow-sticker-sm"
      >
        {confirm ? 'Sûr ? Quitter' : '✖ Quitter'}
      </button>
    </KartRace>
  )
}
