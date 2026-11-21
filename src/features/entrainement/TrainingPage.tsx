import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Button } from '@/components/ui/Button'
import { victoryConfetti } from '@/components/ui/confetti'
import { getCharacter } from '@/data/characters'
import { ConfirmModal } from '@/features/soiree/components'
import { ScoreCard } from '@/games/mini-golf/ScoreCard'
import { ScoreSheet } from '@/games/bowling/ScoreSheet'
import { getGame } from '@/games/registry'
import type { BaseGameState, GameDefinition, PlayerInfo } from '@/games/types'
import type { MgCourse, MiniGolfState } from '@/games/mini-golf/types'
import type { BowlingState } from '@/games/bowling/types'
import { useSession } from '@/store/session'
import { bwAct, bwStart } from './bwLocal'
import { isTrainingGame } from './games'
import { mgAct, mgDiff, mgStart, mgTotal } from './mgLocal'
import { fmtDiff, readRecord, submitRecord, type Verdict } from './records'
import { ChoiceCard, EndScreen, FOOT_NOTE, TrainingHeader } from './ui'
import { useLocalMatch } from './useLocalMatch'

const KartTraining = lazy(() => import('./KartTraining'))

/** Mode entraînement : route /entrainement/:gameId (Mini-golf, Bowling, Dédé Kart), seul, rien n'est compté. */
export default function TrainingPage() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const profile = useSession((s) => s.profile)
  const game = gameId ? getGame(gameId) : undefined
  const me = useMemo<PlayerInfo | null>(
    () =>
      profile
        ? {
            id: profile.id,
            slug: profile.slug,
            nickname: profile.nickname,
            firstName: profile.first_name,
            expressions: profile.expressions?.length ? profile.expressions : (getCharacter(profile.slug)?.expressions ?? ['joie']),
            equipped: profile.equipped_expression ?? 'joie',
            equippedTenue: profile.equipped_tenue ?? 'default',
            color: getCharacter(profile.slug)?.color ?? '#FFB703',
          }
        : null,
    [profile],
  )
  if (!isTrainingGame(gameId) || !game) return <Navigate to="/" replace />
  if (!me) return null
  const back = () => navigate('/')
  const title = `${game.emoji} ${game.name}`
  if (gameId === 'dede-kart') {
    return (
      <Suspense fallback={null}>
        <KartTraining me={me} color={game.color} title={title} onBack={back} />
      </Suspense>
    )
  }
  return gameId === 'mini-golf' ? <GolfTraining me={me} game={game} title={title} onBack={back} /> : <BowlingTraining me={me} game={game} title={title} onBack={back} />
}

/* -------------------------------------------------------------------------- */
/* Partie locale : le vrai composant Play du jeu, alimenté par un moteur local   */
/* -------------------------------------------------------------------------- */

function LocalPlay<S>({ game, me, init, reduce, onFinish, onQuit }: {
  game: GameDefinition
  me: PlayerInfo
  init: () => S
  reduce: Parameters<typeof useLocalMatch<S>>[1]
  onFinish: (s: S) => void
  onQuit: () => void
}) {
  const [state, act] = useLocalMatch<S>(init, reduce)
  // « solo: » : le Mini-golf ne diffuse rien sur le réseau.
  const [matchId] = useState(() => `solo:${Date.now()}`)
  const players = useMemo(() => ({ [me.id]: me }), [me])
  const [confirm, setConfirm] = useState(false)
  const finished = (state as unknown as BaseGameState).phase === 'finished'
  useEffect(() => {
    if (finished) onFinish(state)
  }, [finished, state, onFinish])
  const Play = game.Play
  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setConfirm(true)}>
        ← Quitter l’entraînement
      </Button>
      <Suspense fallback={<p className="p-8 text-center font-display text-xl font-extrabold">Chargement…</p>}>
        <Play matchId={matchId} soireeId="" state={state as unknown as BaseGameState} secret={null} meId={me.id} isHost={false} players={players} act={act as never} pending={false} onExit={onQuit} />
      </Suspense>
      <ConfirmModal open={confirm} onClose={() => setConfirm(false)} title="Quitter ?" danger confirmLabel="Quitter" onConfirm={onQuit}>
        Ta partie d’entraînement sera perdue.
      </ConfirmModal>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Mini-golf                                                                    */
/* -------------------------------------------------------------------------- */

const COURSES: { id: MgCourse; emoji: string; title: string; text: string }[] = [
  { id: 'kermesse', emoji: '🎪', title: 'La Kermesse', text: '9 trous, toujours les mêmes' },
  { id: 'random', emoji: '🎲', title: 'Aléatoire', text: '9 trous tirés au sort' },
  { id: 'express', emoji: '⚡', title: 'Express', text: '5 trous, vite fait' },
  { id: 'defi', emoji: '🏔️', title: 'Le Défi', text: '9 longs trous pour les costauds' },
]
const golfRec = (c: MgCourse) => `mini-golf:${c}`

function GolfTraining({ me, game, title, onBack }: { me: PlayerInfo; game: GameDefinition; title: string; onBack: () => void }) {
  const [course, setCourse] = useState<MgCourse>('kermesse')
  const [stage, setStage] = useState<{ kind: 'pick' } | { kind: 'play'; round: number } | { kind: 'end'; s: MiniGolfState; verdict: Verdict }>({ kind: 'pick' })
  if (stage.kind === 'play') {
    return (
      <LocalPlay<MiniGolfState>
        key={stage.round}
        game={game}
        me={me}
        init={() => mgStart(me.id, course, Date.now())}
        reduce={(s, a, now) => mgAct(s, a, now)}
        onFinish={(s) => {
          const verdict = submitRecord(golfRec(course), mgDiff(s), true)
          if (verdict.beaten) victoryConfetti(1600)
          setStage({ kind: 'end', s, verdict })
        }}
        onQuit={() => setStage({ kind: 'pick' })}
      />
    )
  }
  if (stage.kind === 'end') {
    const { s, verdict } = stage
    const d = mgDiff(s)
    return (
      <EndScreen
        emoji={d < 0 ? '🏆' : '⛳'}
        headline="Parcours terminé !"
        score={`${mgTotal(s)} coups`}
        detail={`${fmtDiff(d)} par le par ${s.pars.reduce((a, b) => a + b, 0)}`}
        verdict={verdict}
        format={(n) => `${mgTotal(s) - d + n} coups (${fmtDiff(n)})`}
        extra={<ScoreCard s={s} players={{ [me.id]: me }} meId={me.id} />}
        onReplay={() => setStage({ kind: 'play', round: Date.now() })}
        onChange={() => setStage({ kind: 'pick' })}
        onBack={onBack}
      />
    )
  }
  return (
    <div className="flex flex-col gap-4 pb-8">
      <TrainingHeader title={title} color={game.color} onBack={onBack} />
      <h2 className="text-center text-2xl">Choisis ton parcours</h2>
      <div className="flex flex-col gap-3">
        {COURSES.map((c) => {
          const r = readRecord(golfRec(c.id))
          return <ChoiceCard key={c.id} on={course === c.id} onClick={() => setCourse(c.id)} emoji={c.emoji} title={c.title} text={c.text} record={r !== null ? `${fmtDiff(r)} par` : null} />
        })}
      </div>
      <Button size="lg" fullWidth onClick={() => setStage({ kind: 'play', round: Date.now() })}>
        C’est parti ! ⛳
      </Button>
      <p className="text-center text-sm font-bold text-muted">{FOOT_NOTE}</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Bowling                                                                      */
/* -------------------------------------------------------------------------- */

const bwRec = (n: number) => `bowling:${n}`

function BowlingTraining({ me, game, title, onBack }: { me: PlayerInfo; game: GameDefinition; title: string; onBack: () => void }) {
  const [frames, setFrames] = useState<3 | 5 | 10>(5)
  const [stage, setStage] = useState<{ kind: 'pick' } | { kind: 'play'; round: number } | { kind: 'end'; s: BowlingState; verdict: Verdict }>({ kind: 'pick' })
  if (stage.kind === 'play') {
    return (
      <LocalPlay<BowlingState>
        key={stage.round}
        game={game}
        me={me}
        init={() => bwStart(me.id, frames, Date.now())}
        reduce={(s, a, now) => bwAct(s, a, now)}
        onFinish={(s) => {
          const verdict = submitRecord(bwRec(frames), s.scores[me.id] ?? 0, false)
          if (verdict.beaten) victoryConfetti(1600)
          setStage({ kind: 'end', s, verdict })
        }}
        onQuit={() => setStage({ kind: 'pick' })}
      />
    )
  }
  if (stage.kind === 'end') {
    const { s, verdict } = stage
    const score = s.scores[me.id] ?? 0
    return (
      <EndScreen
        emoji={score >= frames * 20 ? '🏆' : '🎳'}
        headline="Partie terminée !"
        score={`${score} pts`}
        detail={`${frames} frames`}
        verdict={verdict}
        format={(n) => `${n} pts`}
        extra={<ScoreSheet player={me} sheet={s.sheets[me.id] ?? []} frames={frames} me done />}
        onReplay={() => setStage({ kind: 'play', round: Date.now() })}
        onChange={() => setStage({ kind: 'pick' })}
        onBack={onBack}
      />
    )
  }
  return (
    <div className="flex flex-col gap-4 pb-8">
      <TrainingHeader title={title} color={game.color} onBack={onBack} />
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Nombre de frames</span>
        <SegmentedControl
          ariaLabel="Nombre de frames"
          value={String(frames)}
          onChange={(v) => setFrames(Number(v) as 3 | 5 | 10)}
          options={[3, 5, 10].map((n) => ({ value: String(n), label: n === 10 ? '10 (officiel)' : String(n) }))}
        />
        <p className="text-center text-lg font-extrabold">
          {readRecord(bwRec(frames)) !== null ? `🏆 Ton record : ${readRecord(bwRec(frames))} pts` : 'Pas encore de record'}
        </p>
      </div>
      <Button size="lg" fullWidth onClick={() => setStage({ kind: 'play', round: Date.now() })}>
        C’est parti ! 🎳
      </Button>
      <p className="text-center text-sm font-bold text-muted">{FOOT_NOTE}</p>
    </div>
  )
}
