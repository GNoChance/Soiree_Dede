import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Flag, Hourglass, ListOrdered, Loader2, SkipForward } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { burst, victoryConfetti } from '@/components/ui/confetti'
import { playSound, vibrate } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { forceAppUpdate } from '@/lib/forceUpdate'
import { ConfirmModal } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import { HoleEnd } from './HoleEnd'
import { fmtClock, useDeadlineTick } from './useTick'
import { TvButton } from '@/features/tv/TvButton'
import { useTv } from '@/features/tv/tv'
import type { GamePlayProps, PlayerInfo } from '../types'
import { MAX_STROKES, PICKED_UP, floorHeight } from './holes'
import { MARK_DOT, holeAt, markOf, scoreLabel, spriteOf } from './logic'
import { useGolfNet } from './net'
import { ScoreCard } from './ScoreCard'
import { MiniGolfTv } from './TvView'
import { mgActions, type GolfMsg, type MiniGolfState } from './types'
import type { GolfScene, StrokeResult, Vec3 } from './scene/GolfScene'

type Get = (id: string) => PlayerInfo
type Flow = 'loading' | 'ready' | 'unsupported' | 'outdated'

/** Sous TvContext (route /soiree/:id/tele) : vue télé en lecture seule. */
export default function MiniGolfPlay(props: GamePlayProps) {
  return useTv() ? <MiniGolfTv {...props} /> : <GolfScreen {...props} />
}

interface Saved {
  hole: number
  strokes: number
  water: number
  mill: number
  pos: Vec3
}

const saveKey = (matchId: string) => `mg:${matchId}`
function readSaved(matchId: string): Saved | null {
  try {
    const raw = sessionStorage.getItem(saveKey(matchId))
    return raw ? (JSON.parse(raw) as Saved) : null
  } catch {
    return null
  }
}
function writeSaved(matchId: string, v: Saved) {
  try {
    sessionStorage.setItem(saveKey(matchId), JSON.stringify(v))
  } catch {
    /* stockage indisponible */
  }
}

function GolfScreen({ matchId, soireeId, state, meId, isHost, players, act, pending }: GamePlayProps) {
  const s = state as unknown as MiniGolfState
  const get: Get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const isPlayer = s.players.includes(meId)
  const left = useDeadlineTick(s, act, isPlayer || isHost)
  const [board, setBoard] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [confirmNext, setConfirmNext] = useState(false)
  const unfinished = s.players.filter((id) => !s.done.includes(id))

  // Les autres rentrent leur balle : petit bandeau.
  const [shout, setShout] = useState<{ key: string; player: string; text: string } | null>(null)
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    const lh = s.last_hole
    const key = lh ? `${lh.id}:${lh.at}` : ''
    const first = lastKey.current === null
    lastKey.current = key
    if (first || !lh || lh.id === meId) return
    const par = s.pars[lh.hole] ?? 3
    setShout({ key, player: lh.id, text: lh.holed ? `rentré en ${lh.strokes} ! ${MARK_DOT[markOf(lh.strokes, par)]}` : 'balle ramassée 🧺' })
    if (lh.holed) playSound('pop')
  }, [s.last_hole, s.pars, meId])
  useEffect(() => {
    if (!shout) return
    const t = window.setTimeout(() => setShout(null), 2400)
    return () => clearTimeout(t)
  }, [shout])

  return (
    <div className="flex flex-col gap-3 pb-4">
      <Course key={matchId} s={s} matchId={matchId} meId={meId} isPlayer={isPlayer} get={get} players={players} act={act} left={left} onBoard={() => setBoard(true)} />

      {isHost && s.phase === 'playing' && (s.timer === 0 || unfinished.length < s.players.length) && (
        <Button variant="secondary" size="sm" icon={<SkipForward className="size-4" />} onClick={() => (unfinished.length ? setConfirmNext(true) : void act(mgActions.next()))}>
          Clore le trou
        </Button>
      )}
      {isHost && s.phase === 'hole_end' && (
        <Button size="lg" icon={<SkipForward className="size-5" />} onClick={() => void act(mgActions.next())}>
          Trou suivant
        </Button>
      )}
      {(isHost || !isPlayer) && <TvButton soireeId={soireeId} />}
      {isHost && (
        <Button variant="ghost" size="sm" icon={<Flag className="size-4" />} onClick={() => setConfirmEnd(true)}>
          Terminer la partie
        </Button>
      )}

      <AnimatePresence>
        {shout && (
          <motion.div
            key={shout.key}
            initial={{ y: -80, opacity: 0, rotate: -6 }}
            animate={{ y: 0, opacity: 1, rotate: -2 }}
            exit={{ y: -80, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
            className="sticker pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto flex w-max max-w-[90vw] items-center gap-2 bg-sun px-3 py-1.5 text-[#1f1b2e]"
          >
            <Avatar slug={get(shout.player).slug} expression={mood(get(shout.player), 'proud')} size={36} />
            <span className="font-display text-lg font-extrabold">
              {get(shout.player).nickname} : {shout.text}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomSheet open={board} onClose={() => setBoard(false)} title="Carte de score">
        <ScoreCard s={s} players={players} meId={meId} current={s.phase === 'playing' ? s.hole : undefined} />
      </BottomSheet>

      <ConfirmModal
        open={confirmNext}
        onClose={() => setConfirmNext(false)}
        title="Clore le trou ?"
        confirmLabel="Clore le trou"
        loading={pending}
        onConfirm={async () => {
          await act(mgActions.next())
          setConfirmNext(false)
        }}
      >
        {`${unfinished.map((id) => get(id).nickname).join(', ')} n’${unfinished.length > 1 ? 'ont' : 'a'} pas fini : ${PICKED_UP} sur ce trou.`}
      </ConfirmModal>
      <ConfirmModal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="Terminer la partie ?"
        danger
        confirmLabel="Terminer"
        loading={pending}
        onConfirm={async () => {
          await act(mgActions.endGame())
          setConfirmEnd(false)
        }}
      >
        Les trous pas encore joués compteront {PICKED_UP} coups pour tout le monde.
      </ConfirmModal>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Le trou (scène 3D) + mon jeu                                                */
/* -------------------------------------------------------------------------- */

interface Local {
  hole: number
  strokes: number
  water: number
  mill: number
  /** Mon trou est joué (rentré ou ramassé), en attente d'envoi ou envoyé. */
  finished: null | { holed: boolean; strokes: number }
}

function Course({ s, matchId, meId, isPlayer, get, players, act, left, onBoard }: {
  s: MiniGolfState
  matchId: string
  meId: string
  isPlayer: boolean
  get: Get
  players: Record<string, PlayerInfo>
  act: GamePlayProps['act']
  left: number
  onBoard: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<GolfScene | null>(null)
  const [flow, setFlow] = useState<Flow>('loading')
  const [updating, setUpdating] = useState(false)
  const [local, setLocal] = useState<Local>({ hole: -1, strokes: 0, water: 0, mill: 0, finished: null })
  const [rolling, setRolling] = useState(false)
  const [banner, setBanner] = useState<{ id: number; text: string; sub: string; tone: string } | null>(null)
  const def = holeAt(s, s.hole)
  const par = s.pars[s.hole] ?? def.par
  const startLeft = useCountdown(s.phase === 'playing' ? s.hole_started_at : null)
  const announcing = s.phase === 'playing' && startLeft > 0
  const serverDone = s.done.includes(meId)
  const myTurn = isPlayer && s.phase === 'playing' && !serverDone && !local.finished && local.hole === s.hole
  const canShoot = myTurn && !announcing && local.strokes < MAX_STROKES

  const live = useRef({ s, local, meId })
  useEffect(() => {
    live.current = { s, local, meId }
  })

  // --------------------------------------------------------------- réseau (fantômes)
  const send = useGolfNet(matchId, (m: GolfMsg) => {
    const sc = sceneRef.current
    const st = live.current.s
    if (!sc || m.id === meId || m.h !== st.hole || !st.players.includes(m.id)) return
    const p = playerOrPlaceholder(players, m.id)
    sc.setGhost(m.id, { color: p.color, sprite: spriteOf(p) }, [m.x, m.y, m.z], m.s)
  })
  const lastSend = useRef(0)
  const publish = useCallback((pos: Vec3, st: 0 | 1 | 2, force = false) => {
    const now = performance.now()
    if (!force && now - lastSend.current < 125) return
    lastSend.current = now
    const L = live.current
    send({ id: meId, h: L.s.hole, x: +pos[0].toFixed(3), y: +pos[1].toFixed(3), z: +pos[2].toFixed(3), n: L.local.strokes, s: st })
  }, [send, meId])

  // --------------------------------------------------------------- envoi du résultat du trou
  const submit = useCallback(async (hole: number, strokes: number, holed: boolean, stats: { water: number; mill_hits: number; bank_shot: 0 | 1 }) => {
    const L0 = live.current.s
    const minAt = new Date(L0.hole_started_at).getTime() + Math.max(1, strokes - stats.water) * 1500 + 400
    const wait = minAt - serverNow()
    // laisse aussi le temps aux effets (le dernier envoi peut terminer la partie)
    await new Promise((r) => setTimeout(r, Math.max(wait, 1300)))
    for (let attempt = 0; attempt < 4; attempt++) {
      const cur = live.current.s
      if (cur.hole !== hole || cur.phase !== 'playing' || cur.done.includes(meId)) return
      const res = await act(mgActions.hole(hole, strokes, holed, stats))
      if (res) return
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    }
  }, [act, meId])

  const onStrokeEnd = useCallback((r: StrokeResult) => {
    const L = live.current.local
    if (L.finished || L.hole !== live.current.s.hole) return
    const strokes = L.strokes + 1 + (r.water ? 1 : 0)
    const water = L.water + (r.water ? 1 : 0)
    const mill = L.mill + (r.mill ? 1 : 0)
    setRolling(false)
    let finished: Local['finished'] = null
    const hole = L.hole
    const parNow = live.current.s.pars[hole] ?? 3
    if (r.holed) {
      finished = { holed: true, strokes }
      const mk = markOf(strokes, parNow)
      setBanner({ id: Date.now(), text: strokes === 1 ? 'TROU EN UN !' : `Rentré en ${strokes} !`, sub: `${MARK_DOT[mk]} ${scoreLabel(strokes, parNow)}`, tone: strokes === 1 ? 'bg-tomato text-white' : mk === 'under' ? 'bg-mint text-[#1f1b2e]' : 'bg-sun text-[#1f1b2e]' })
      if (strokes === 1) {
        playSound('fanfare')
        vibrate([40, 30, 40, 30, 160])
        victoryConfetti(1600)
      } else {
        playSound('success')
        burst({ x: 0.5, y: 0.4 }, mk === 'under' ? 140 : 80)
      }
      publish(r.pos, 2, true)
      void submit(hole, strokes, true, { water, mill_hits: mill, bank_shot: r.bounces >= 3 ? 1 : 0 })
    } else if (strokes >= MAX_STROKES) {
      finished = { holed: false, strokes: Math.min(strokes, PICKED_UP) }
      setBanner({ id: Date.now(), text: 'Balle ramassée', sub: `🧺 ${MAX_STROKES} coups sans rentrer : ${PICKED_UP} inscrits`, tone: 'bg-grape text-white' })
      playSound('fail')
      publish(r.pos, 2, true)
      void submit(hole, Math.min(strokes, PICKED_UP), false, { water, mill_hits: mill, bank_shot: 0 })
    } else {
      if (r.water) setBanner({ id: Date.now(), text: 'Plouf !', sub: '💦 +1 coup de pénalité', tone: 'bg-sky text-[#1f1b2e]' })
      else if (r.out) setBanner({ id: Date.now(), text: 'Hors piste !', sub: '↩️ La balle revient', tone: 'bg-grape text-white' })
      publish(r.pos, 1, true)
    }
    setLocal({ hole, strokes, water, mill, finished })
    writeSaved(matchId, { hole, strokes, water, mill, pos: r.pos })
  }, [matchId, publish, submit])

  const callbacks = useRef({ onStrokeEnd, publish })
  useEffect(() => {
    callbacks.current = { onStrokeEnd, publish }
  })

  useEffect(() => {
    if (!banner) return
    const t = window.setTimeout(() => setBanner(null), 2000)
    return () => clearTimeout(t)
  }, [banner])

  // --------------------------------------------------------------- montage de la scène
  useEffect(() => {
    let alive = true
    let scene: GolfScene | null = null
    import('./scene/GolfScene')
      .then(({ GolfScene: Scene }) => {
        if (!alive || !host.current) return
        try {
          scene = new Scene(host.current, {
            dark: document.documentElement.classList.contains('dark'),
            now: serverNow,
            ball: isPlayer ? { color: playerOrPlaceholder(players, meId).color } : undefined,
            callbacks: {
              onShot: () => setRolling(true),
              onStrokeEnd: (r) => callbacks.current.onStrokeEnd(r),
              onRolling: (p) => callbacks.current.publish(p, 0),
            },
          })
        } catch (e) {
          console.warn('[mini-golf] WebGL indisponible', e)
          setFlow('unsupported')
          return
        }
        sceneRef.current = scene
        setFlow('ready')
      })
      .catch((e) => {
        console.warn('[mini-golf] chargement de la scène impossible', e)
        if (alive) setFlow('outdated')
      })
    return () => {
      alive = false
      sceneRef.current = null
      scene?.dispose()
    }
    // Scène créée une seule fois (couleur du joueur figée au montage).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --------------------------------------------------------------- nouveau trou
  const loadedHole = useRef(-1)
  useEffect(() => {
    const sc = sceneRef.current
    if (flow !== 'ready' || !sc || s.phase === 'finished') return
    if (loadedHole.current === s.hole) return
    loadedHole.current = s.hole
    const d = holeAt(s, s.hole)
    const saved = readSaved(matchId)
    const resume = saved && saved.hole === s.hole && !s.done.includes(meId) ? saved : null
    const tee: Vec3 = [d.tee[0], floorHeight(d, d.tee[0], d.tee[1]) + 0.1, d.tee[1]]
    const mine = isPlayer && !s.done.includes(meId)
    sc.loadHole(d, mine ? resume?.pos ?? tee : null, serverNow() < new Date(s.hole_started_at).getTime())
    for (const id of s.players) sc.removeGhost(id)
    setRolling(false)
    setLocal({ hole: s.hole, strokes: resume?.strokes ?? 0, water: resume?.water ?? 0, mill: resume?.mill ?? 0, finished: null })
    if (mine && !resume) writeSaved(matchId, { hole: s.hole, strokes: 0, water: 0, mill: 0, pos: tee })
  }, [flow, s, matchId, meId, isPlayer])

  useEffect(() => {
    sceneRef.current?.setCanShoot(canShoot)
  }, [canShoot, flow])

  // Position au repos rediffusée régulièrement (nouveaux venus, télé).
  useEffect(() => {
    if (!myTurn || flow !== 'ready') return
    const id = window.setInterval(() => {
      const sc = sceneRef.current
      const p = sc?.ballPosition()
      if (sc && p && !sc.isRolling()) callbacks.current.publish(p, 1, true)
    }, 2500)
    return () => clearInterval(id)
  }, [myTurn, flow])

  const unfinished = s.players.length - s.done.length
  const finishedMine = (local.finished && local.hole === s.hole) || serverDone
  const myScore = s.cards?.[meId]?.[s.hole]
  const clock = s.phase === 'playing' && s.deadline ? (announcing ? s.timer * 1000 : left) : null

  return (
    <div className="flex flex-col gap-2">
      <div ref={host} className="sticker relative h-[calc(100dvh-12.5rem)] max-h-[760px] min-h-[420px] w-full overflow-hidden bg-sunk select-none">
        {/* HUD haut */}
        <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
          <div className="sticker-sm flex min-w-0 flex-col bg-surface/90 px-2 py-1 leading-tight">
            <span className="font-display text-base font-extrabold">
              Trou {s.hole + 1}/{s.holes.length} <span className="text-muted">· par {par}</span>
            </span>
            <span className="truncate text-xs font-bold text-muted">{def.name}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {clock !== null && (
              <span className={cn('sticker-sm flex items-center gap-0.5 px-1.5 py-0.5 font-display text-base font-extrabold tabular-nums', clock <= 10000 && !announcing ? 'animate-pulse bg-tomato text-white' : 'bg-surface/90')}>
                <Hourglass className="size-3.5" />
                {fmtClock(clock)}
              </span>
            )}
            <button type="button" onClick={onBoard} className="sticker-sm pointer-events-auto flex items-center gap-1 bg-surface/90 px-2 py-1 text-sm font-extrabold" aria-label="Voir la carte de score">
              <ListOrdered className="size-4" /> Carte
            </button>
          </div>
        </div>

        {flow === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
            <Loader2 className="size-8 animate-spin" />
            <span className="font-display font-extrabold">Préparation du parcours…</span>
          </div>
        )}
        {flow === 'outdated' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="text-5xl">🔄</span>
            <span className="font-display text-xl font-extrabold">L’appli doit être mise à jour.</span>
            <span className="text-sm text-muted">Une nouvelle version est sortie : mets à jour pour retrouver le parcours (ta partie continue).</span>
            <Button
              disabled={updating}
              onClick={() => {
                setUpdating(true)
                void forceAppUpdate()
              }}
            >
              {updating ? 'Mise à jour…' : 'Mettre à jour'}
            </Button>
          </div>
        )}
        {flow === 'unsupported' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
            <span className="text-5xl">😵</span>
            <span className="font-display text-xl font-extrabold">La 3D ne démarre pas sur cet appareil.</span>
            <span className="text-sm text-muted">Ferme les autres applis et rouvre celle-ci ; sinon tu marqueras {PICKED_UP} à chaque trou.</span>
          </div>
        )}

        {/* Annonce du trou */}
        <AnimatePresence>
          {announcing && flow === 'ready' && (
            <motion.div key={`ann${s.hole}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-4">
              <motion.div
                initial={{ scale: 2.4, rotate: -14 }}
                animate={{ scale: 1, rotate: -3 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 300, damping: 14 }}
                className="sticker bg-sun px-5 py-3 text-center text-[#1f1b2e]"
                style={{ boxShadow: '7px 7px 0 0 var(--ink)' }}
              >
                <div className="font-display text-lg font-extrabold">Trou {s.hole + 1}</div>
                <div className="font-display text-3xl leading-none font-extrabold">{def.name}</div>
                <div className="mt-1 text-sm font-bold">{def.blurb}</div>
                <div className="mt-1 font-display text-xl font-extrabold">⛳ par {par}</div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bas : coups / aide / attente */}
        {flow === 'ready' && s.phase === 'playing' && !announcing && (
          <div className="pointer-events-none absolute inset-x-2 bottom-2 z-10 flex flex-col items-center gap-1">
            {myTurn && !rolling && local.strokes === 0 && s.hole === 0 && <GestureHint />}
            {isPlayer && !finishedMine && (
              <span className="sticker-sm bg-surface/90 px-3 py-1 font-display text-2xl leading-none font-extrabold">
                Coup {Math.min(local.strokes + 1, MAX_STROKES)} <span className="text-base text-muted">/ {MAX_STROKES}</span>
              </span>
            )}
            {isPlayer && myTurn && !rolling && local.strokes > 0 && <span className="sticker-sm bg-surface/80 px-2 py-0.5 text-xs font-bold">Tire en arrière, lâche !</span>}
            {(finishedMine || !isPlayer) && (
              <span className="sticker-sm flex items-center gap-1.5 bg-surface/90 px-2 py-1 text-sm font-extrabold">
                {myScore !== undefined && <span>{MARK_DOT[markOf(myScore, par)]} {scoreLabel(myScore, par)} ·</span>}
                {!isPlayer && <span>👀 Tu regardes ·</span>}
                <Hourglass className="size-3.5 animate-spin [animation-duration:3s]" />
                {s.done.length} / {s.players.length} ont fini
              </span>
            )}
          </div>
        )}

        <AnimatePresence>{banner && <HoleBanner key={banner.id} b={banner} />}</AnimatePresence>
        <AnimatePresence>{s.phase === 'hole_end' && <HoleEnd key={`end${s.hole}`} s={s} get={get} meId={meId} left={left} />}</AnimatePresence>
      </div>
      {s.phase === 'playing' && unfinished > 0 && s.done.length > 0 && !finishedMine && isPlayer && (
        <p className="text-center text-xs font-bold text-muted">{s.done.length} joueur{s.done.length > 1 ? 's ont' : ' a'} déjà fini ce trou</p>
      )}
    </div>
  )
}

/** Main animée : tirer en arrière puis lâcher. */
function GestureHint() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
      <motion.span animate={{ y: [0, 46, 46, 0], opacity: [1, 1, 0, 0] }} transition={{ repeat: Infinity, duration: 2, times: [0, 0.55, 0.7, 1] }} className="text-4xl drop-shadow-[2px_2px_0_white]">
        👆
      </motion.span>
      <span className="sticker-sm bg-surface/90 px-2 py-0.5 text-center text-sm font-extrabold">Pose le doigt, tire en arrière, lâche !</span>
    </motion.div>
  )
}

function HoleBanner({ b }: { b: { text: string; sub: string; tone: string } }) {
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      <motion.div
        initial={{ scale: 3, rotate: -25 }}
        animate={{ scale: 1, rotate: -5 }}
        exit={{ scale: 0.4, rotate: 15, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 360, damping: 12 }}
        className={cn('sticker px-6 py-3 text-center', b.tone)}
        style={{ boxShadow: '7px 7px 0 0 var(--ink)' }}
      >
        <div className="font-display text-5xl leading-none font-extrabold tracking-tight">{b.text}</div>
        <div className="mt-1 font-display text-lg font-extrabold">{b.sub}</div>
      </motion.div>
    </motion.div>
  )
}
