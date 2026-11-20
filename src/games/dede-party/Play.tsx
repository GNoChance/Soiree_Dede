import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Flag, HelpCircle, SkipForward } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { BottomSheet } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import { fx, playSound } from '@/lib/feedback'
import { ConfirmModal } from '@/features/soiree/components'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { TvButton } from '@/features/tv/TvButton'
import { useTv } from '@/features/tv/tv'
import type { GamePlayProps } from '../types'
import { boardViewAt, moverLine, rollLine, useBoardView } from './anim'
import { Board } from './GameBoard'
import { Stage } from './Stage'
import { CELL_INFO, STAR_PRICE, HALF_PRICE, SIZE_LABEL, cellTypesOf, quarterOf, starsInPlay, type BoardDef } from './board'
import { MiniMap, TRANSPORT_LOOK } from './MiniMap'
import { MINIGAMES } from './minigames'
import { Countdown, DedeHost, Die, DoneStrip, Scoreboard, useDeadlineTick, type Get } from './Parts'
import { AwardsScreen, Curtain, IntroScreen, MechChip, MgIntroScreen, MgResultScreen, MoveBanner, MoveCenter, useCurtain } from './Screens'
import { DedePartyTv } from './TvView'
import { dpActions, type DedePartyState } from './types'

/** Sous TvContext (route /soiree/:id/tele) : vue télé en lecture seule. */
export default function DedePartyPlay(props: GamePlayProps) {
  return useTv() ? <DedePartyTv {...props} /> : <PhoneView {...props} />
}

const PHASE_LABEL: Partial<Record<DedePartyState['phase'], string>> = {
  intro: 'Générique',
  roll: 'Lancer de dé',
  move: 'Déplacements',
  mg_intro: 'Mini-jeu',
  mg_play: 'Mini-jeu',
  mg_result: 'Résultats',
  awards: 'Cérémonie',
}

function PhoneView({ soireeId, state, meId, isHost, players, act, pending }: GamePlayProps) {
  const live = state as unknown as DedePartyState
  // Rideau de théâtre entre le plateau, les mini-jeux et la cérémonie : `s` = state affiché.
  const { shown: s, closed } = useCurtain(live)
  const get: Get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const isPlayer = s.players.includes(meId)
  const left = useDeadlineTick(live, act, isPlayer || isHost)
  const r = useRoll(s, meId, act)
  const view = useBoardView(s)
  const [help, setHelp] = useState(false)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const snap = view.snap
  const board = view.board
  const mg = s.mg

  // Mon pion vient de bouger : petit son à chaque évènement.
  const lastEv = useRef(0)
  useEffect(() => {
    const n = view.events.length
    if (n > lastEv.current) {
      const e = view.events[0]
      if (e?.t === 'star' || e?.t === 'jackpot') playSound('fanfare')
      else if (e?.t === 'pub' || e?.t === 'star_poor' || (e?.t === 'riton' && e.k === 'steal') || (e?.t === 'tp' && e.k === 'ice')) playSound('fail')
      else if (e) playSound('cash')
    }
    lastEv.current = n
  }, [view.events])

  let main: React.ReactNode = null
  if (s.phase === 'intro') main = <IntroScreen s={s} get={get} />
  else if (s.phase === 'roll' || s.phase === 'move') {
    // Même scène 3D du lancer aux déplacements (pas de rechargement entre les deux).
    const moving = s.phase === 'move'
    main = (
      <div className="flex flex-col gap-2">
        {!moving && (
          <p className="text-center font-display text-xl font-extrabold leading-tight">
            Tour {s.round} / {s.rounds}
            {s.round === s.rounds ? ' · 🔥 la Finale !' : isPlayer && !r.mine ? ' : lance tes dés !' : ''}
          </p>
        )}
        <MechChip board={board} mech={snap.mech} meCell={snap.pos[meId]} className="self-center" />
        <Stage
          s={s}
          view={view}
          get={get}
          className="aspect-[4/5] max-h-[58dvh]"
          meId={meId}
          top={moving ? <MoveBanner s={s} view={view} get={get} /> : undefined}
          bottom={moving ? undefined : <RollOverlay r={r} isPlayer={isPlayer} />}
          center={moving ? <MoveCenter s={s} view={view} get={get} /> : undefined}
        />
        <DedeHost
          line={moving ? moverLine(s, view, get) : rollLine(s)}
          size={58}
          expression={moving && view.events.some((e) => e.t === 'pub' || (e.t === 'riton' && e.k === 'steal')) ? 'pleurs' : 'joie'}
        />
        {!moving && <RollBelow s={s} meId={meId} isPlayer={isPlayer} get={get} left={left} r={r} />}
      </div>
    )
  }
  else if (s.phase === 'mg_intro' && mg) main = <MgIntroScreen s={s} mg={mg} />
  else if (s.phase === 'mg_play' && mg) main = <MgPlayPhase s={s} meId={meId} isPlayer={isPlayer} get={get} act={act} left={left} />
  else if (s.phase === 'mg_result' && mg) main = <MgResultScreen mg={mg} get={get} meId={meId} />
  else if (s.phase === 'awards') main = <AwardsScreen s={s} get={get} />

  return (
    <div className="flex flex-col gap-3 pb-4">
      <Curtain closed={closed} fixed />
      <div className="flex items-center gap-2">
        {isPlayer ? (
          <div className="sticker flex min-w-0 flex-1 items-center gap-2 bg-surface px-2 py-1">
            <Avatar slug={get(meId).slug} tenue={get(meId).equippedTenue} size={40} />
            <span className="flex flex-col leading-tight">
              <span className="font-display text-xl font-extrabold tabular-nums">
                ⭐ {snap.stars[meId] ?? 0} · 🪙 {snap.coins[meId] ?? 0}
              </span>
              <span className="text-xs font-bold text-muted">
                {s.double_left[meId] > 0 ? `🎲🎲🎲 Triple dé : ${s.double_left[meId]}` : 'Triple dé utilisé'}
                {s.half_price[meId] ? ` · ⭐ à ${HALF_PRICE} 🪙 !` : ''}
              </span>
            </span>
          </div>
        ) : (
          <div className="sticker flex-1 bg-surface px-3 py-2 font-display font-extrabold">👀 Tu regardes l’émission</div>
        )}
        <div className="flex flex-col items-end gap-1">
          <span className={cn('sticker-sm px-2 font-display text-sm font-extrabold', mg?.finale && s.phase.startsWith('mg') ? 'bg-tomato text-white' : 'bg-sky text-[#1f1b2e]')}>
            {PHASE_LABEL[s.phase] ?? ''}
          </span>
          {s.deadline && s.phase !== 'move' && s.phase !== 'awards' && <Countdown left={left} />}
        </div>
      </div>

      {main}

      {s.phase !== 'mg_play' && s.phase !== 'mg_intro' && s.phase !== 'awards' && s.phase !== 'intro' && (
        <Scoreboard s={s} snap={snap} get={get} meId={meId} highlight={view.mover?.id ?? null} />
      )}

      <div className="flex flex-wrap justify-center gap-2">
        <Button variant="secondary" size="sm" icon={<HelpCircle className="size-4" />} onClick={() => setHelp(true)}>
          Les cases
        </Button>
        {(isHost || !isPlayer) && <TvButton soireeId={soireeId} />}
      </div>
      {isHost && s.phase !== 'finished' && (
        <div className="flex flex-wrap justify-center gap-2">
          <Button variant="ghost" size="sm" icon={<SkipForward className="size-4" />} onClick={() => setConfirmSkip(true)}>
            Passer cette étape
          </Button>
          <Button variant="ghost" size="sm" icon={<Flag className="size-4" />} onClick={() => setConfirmEnd(true)}>
            Terminer la partie
          </Button>
        </div>
      )}

      <BottomSheet open={help} onClose={() => setHelp(false)} title={`${board.emoji} ${board.name}`}>
        <div className="flex flex-col gap-2">
          <div className="sticker-sm flex flex-col gap-0.5 bg-sun/30 px-3 py-2">
            <span className="font-display font-extrabold">✨ La particularité du plateau</span>
            <span className="text-sm font-bold leading-snug">{board.rule}</span>
          </div>
          {cellTypesOf(board).map((t) => (
            <div key={t} className="flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-chip border-[3px] border-ink text-2xl shadow-sticker-sm" style={{ background: CELL_INFO[t].color }}>
                {CELL_INFO[t].emoji}
              </span>
              <span className="leading-tight">
                <span className="font-display font-extrabold">{CELL_INFO[t].label}</span>
                <span className="block text-sm font-bold text-muted">{CELL_INFO[t].effect}</span>
              </span>
            </div>
          ))}
          <p className="mt-1 text-sm font-bold">
            ⭐ Une étoile s’achète toute seule ({STAR_PRICE} 🪙, ta première à {HALF_PRICE} 🪙) dès que tu passes ou t’arrêtes dessus, puis elle déménage dans une autre Loge.
          </p>
          {board.size !== 's' && <BigBoardHelp board={board} players={s.players.length} />}
          {board.id === 'grand' && (
            <p className="text-sm font-bold">
              🔀 Aux {countWord(board.forks.length)} embranchements, personne ne choisit : la flèche jaune montre la voie ouverte, et elle bascule après chaque pion. 🎭 La Scène rapporte gros, 📺 le Tunnel de la pub coûte cher !
            </p>
          )}
          {board.id === 'mer' && (
            <p className="text-sm font-bold">
              🌊 La marée suit un cycle : 2 tours basse, 1 tour haute. La flèche bleue montre la voie ouverte.{' '}
              {board.size === 's'
                ? 'Les pions sur le Banc de sable quand la mer monte reviennent sur la Digue avec 5 pièces de moins.'
                : 'Les pions sur un banc de sable quand la mer monte sont ramenés au rivage avec 5 pièces de moins.'}
            </p>
          )}
          {board.id === 'kermesse' && <p className="text-sm font-bold">🎟️ La cagnotte démarre à 5 pièces et grossit à chaque péage. Ta case d’arrivée compte : il faut s’arrêter PILE sur une Tombola avec ses dés.</p>}
          {board.id === 'camping' && <p className="text-sm font-bold">🦝 À la fin de chaque tour, Riton lance 1 dé et remonte le sentier. Un coup il vole, un coup il rend : regarde son sac avant de lancer !</p>}
          {board.id === 'ski' && <p className="text-sm font-bold">🚡 Les pointillés montrent où mènent les télésièges (vert) et les plaques de verglas (bleu). Seul un arrêt pile avec tes dés compte. 🛷 Du Sommet, la Grande Luge te ramène au Départ (+5).</p>}
          <p className="text-sm font-bold">
            🎮 Mini-jeu à chaque tour : 1er 10 🪙, 2e 6, 3e 4, les autres 2 (doublé au dernier tour). À la fin, 2 étoiles bonus : Roi des mini-jeux et Prix de la poisse !
          </p>
          {board.size === 's' ? (
            <Board s={s} view={boardViewAt(s, Infinity)} get={get} portrait className="mt-1" />
          ) : (
            <MiniMap board={board} snap={boardViewAt(s, Infinity).snap} order={s.order} get={get} meId={meId} className="mt-1 w-full" />
          )}
        </div>
      </BottomSheet>

      <ConfirmModal
        open={confirmSkip}
        onClose={() => setConfirmSkip(false)}
        title="Passer cette étape ?"
        confirmLabel="Passer"
        loading={pending}
        onConfirm={async () => {
          await act(dpActions.skip())
          setConfirmSkip(false)
        }}
      >
        Les retardataires lancent d’office ou ne marquent rien au mini-jeu.
      </ConfirmModal>
      <ConfirmModal
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="Terminer la partie ?"
        confirmLabel="Place à la cérémonie"
        danger
        loading={pending}
        onConfirm={async () => {
          await act(dpActions.endGame())
          setConfirmEnd(false)
        }}
      >
        Les étoiles bonus sont remises tout de suite et le classement est figé.
      </ConfirmModal>
    </div>
  )
}

const COUNT_WORDS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf']
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n)

/** Aide des grandes tailles : quartiers ouverts, portes, transports, Haltes, étoiles par zone. */
function BigBoardHelp({ board, players }: { board: BoardDef; players: number }) {
  const kinds = [...new Set(Object.values(board.transports).map((t) => t.kind))]
  const pack = (board.extra.pack as Array<{ name: string; start: number }> | undefined) ?? []
  const booths = board.cells.filter((t) => t === 'tombola').length
  return (
    <div className="sticker-sm flex flex-col gap-1 bg-sky/20 px-3 py-2 text-sm font-bold leading-snug">
      <span className="font-display text-base font-extrabold">
        🗺️ {SIZE_LABEL[board.size]}
        {board.title ? ` : ${board.title}` : ''}
      </span>
      <span>
        Quartiers ouverts :{' '}
        {board.quarters.map((q, k) => (
          <span key={q.id} className="whitespace-nowrap">
            {k > 0 ? ' · ' : ''}
            {q.emoji} {q.name}
          </span>
        ))}
      </span>
      <span>🚪 Chaque quartier a sa porte : personne ne choisit, elle s’ouvre un pion sur deux (la flèche montre la voie ouverte).</span>
      {kinds.length > 0 && <span>{kinds.map((k) => TRANSPORT_LOOK[k].emoji).join(' ')} Bacs, télécabines, pistes : le voyage ne compte que pour 1 pas, même s’il va loin.</span>}
      {board.cells.includes('halt') && <span>🏁 Halte : +5 pièces quand tu y débarques, comme au Départ.</span>}
      {board.starts?.length ? <span>🏁 Au départ, les pions sont répartis par deux sur les Haltes.</span> : null}
      {board.id === 'kermesse' && booths > 1 && <span>🎟️ Les {booths} guichets de la Tombola se partagent la même cagnotte.</span>}
      {pack.length > 0 && (
        <span>
          🦝 Riton a de la famille :{' '}
          {pack.map((p, k) => `${k > 0 ? ', ' : ''}${p.name}${quarterOf(board, p.start) ? ` (${quarterOf(board, p.start)!.name})` : ''}`).join('')}. Même règle que lui.
        </span>
      )}
      <span>⭐ {starsInPlay(board, players)} étoiles en jeu : chaque quartier a la sienne, et une étoile achetée déménage dans sa zone.</span>
    </div>
  )
}

/** Lancer : le gros bouton est incrusté en bas du plateau 3D ; après le lancer, mes dés. */
function useRoll(s: DedePartyState, meId: string, act: GamePlayProps['act']) {
  const [rolling, setRolling] = useState<null | boolean>(null)
  const roll = async (triple: boolean) => {
    if (rolling !== null) return
    setRolling(triple)
    fx.whoosh()
    const t0 = Date.now()
    const r = await act(dpActions.roll(triple))
    // Laisser les dés tourner un peu, pour le plaisir.
    await new Promise((res) => setTimeout(res, Math.max(0, 600 - (Date.now() - t0))))
    setRolling(null)
    if (r) playSound('success')
  }
  return { rolling, roll, mine: s.rolls[meId] ?? null, canTriple: (s.double_left[meId] ?? 0) > 0 }
}

function RollOverlay({ r, isPlayer }: { r: ReturnType<typeof useRoll>; isPlayer: boolean }) {
  if (!isPlayer) return null
  if (!r.mine) {
    return (
      <motion.button
        type="button"
        onClick={() => void r.roll(false)}
        disabled={r.rolling !== null}
        animate={r.rolling === null ? { rotate: [-3, 3, -3], y: [0, -5, 0] } : undefined}
        transition={{ repeat: Infinity, duration: 1.2 }}
        whileTap={{ scale: 0.9 }}
        className="pointer-events-auto flex items-center gap-2.5 rounded-bubble border-4 border-ink bg-sun px-4 py-2 shadow-sticker-lg"
        aria-label="Lancer les dés"
      >
        <span className="flex gap-1.5">
          <Die value={null} size={46} rolling={r.rolling !== null} />
          <Die value={null} size={46} rolling={r.rolling !== null} />
          {r.rolling === true && <Die value={null} size={46} rolling />}
        </span>
        <span className="font-display text-2xl font-extrabold text-[#1f1b2e]">Lancer !</span>
      </motion.button>
    )
  }
  const total = r.mine.dice.reduce((a, b) => a + b, 0)
  return (
    <motion.div initial={{ scale: 0.4 }} animate={{ scale: 1 }} className="sticker flex items-center gap-2 bg-surface/95 px-3 py-2">
      {r.mine.dice.map((d, i) => (
        <Die key={i} value={d} size={44} />
      ))}
      <span className="font-display text-xl font-extrabold leading-tight">
        = {total} case{total > 1 ? 's' : ''} !
      </span>
    </motion.div>
  )
}

function RollBelow({ s, meId, isPlayer, get, left, r }: { s: DedePartyState; meId: string; isPlayer: boolean; get: Get; left: number; r: ReturnType<typeof useRoll> }) {
  const rolled = s.players.filter((id) => s.rolls[id])
  if (isPlayer && !r.mine) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button variant="secondary" size="md" disabled={!r.canTriple || r.rolling !== null} onClick={() => void r.roll(true)}>
          🎲🎲🎲 Triple dé {r.canTriple ? `(${s.double_left[meId]})` : '(utilisé)'}
        </Button>
        <p className="text-center text-sm font-bold text-muted">Le Triple dé ajoute un troisième dé : une fois par partie !</p>
        <p className="text-center text-sm font-bold text-muted">Pas lancé dans {Math.ceil(left / 1000)} s ? Dédé lance pour toi.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="sticker-sm bg-surface px-3 py-1 text-center font-display font-extrabold">Les autres lancent ({rolled.length}/{s.players.length})…</p>
      <DoneStrip ids={s.players} done={rolled} get={get} />
    </div>
  )
}

function MgPlayPhase({ s, meId, isPlayer, get, act, left }: { s: DedePartyState; meId: string; isPlayer: boolean; get: Get; act: GamePlayProps['act']; left: number }) {
  const mg = s.mg!
  const def = MINIGAMES[mg.kind]
  const [sentNo, setSentNo] = useState<number | null>(null)
  const submitted = mg.submitted.includes(meId) || sentNo === mg.no
  const submit = useCallback(
    async (payload: Record<string, unknown>) => {
      const r = await act(dpActions.submit(mg.no, payload))
      if (r) setSentNo(mg.no)
      return Boolean(r)
    },
    [act, mg.no],
  )
  const Play = def.Play
  return (
    <div className="flex flex-col gap-3">
      <div className="sticker flex items-center gap-2 px-3 py-2 text-[#1f1b2e]" style={{ background: def.color }}>
        <span className="text-3xl">{def.emoji}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-display text-lg font-extrabold">{def.name}</p>
          <p className="text-sm font-bold">{def.rule}</p>
        </div>
        {mg.finale && <span className="sticker-sm bg-tomato px-1.5 font-display text-sm font-extrabold text-white">×2</span>}
      </div>
      {isPlayer && <Play mg={mg} meId={meId} players={s.players} get={get} submit={submit} submitted={submitted} />}
      {(!isPlayer || submitted) && (
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          {!isPlayer && <Avatar slug={get(meId).slug} tenue={get(meId).equippedTenue} expression={mood(get(meId), 'think')} size={80} bounce />}
          <p className="font-display text-xl font-extrabold">{isPlayer ? 'Envoyé ✔ En attente des autres…' : 'Les candidats jouent…'}</p>
          <DoneStrip ids={s.players} done={mg.submitted} get={get} />
          <p className="text-sm font-bold text-muted">Fin dans {Math.ceil(left / 1000)} s</p>
        </div>
      )}
    </div>
  )
}
