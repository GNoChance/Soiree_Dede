import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { burst, victoryConfetti } from '@/components/ui/confetti'
import { accentColorOf, CHARACTERS, getCharacter, type Character, type CharacterSlug } from '@/data/characters'
import { pickSideColors } from '@/features/duel/logic'
import { pickExpression } from '@/features/soiree/players'
import { BnMatchContext } from '@/games/bataille-navale/context'
import { getGame } from '@/games/registry'
import type { PlayerInfo } from '@/games/types'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { useSession } from '@/store/session'
import { LearnedCard } from './LearnedCard'
import { LevelGauge } from './LevelGauge'
import { SOLO_LOADERS, isSoloGame, type SoloGameModule, type WhyKit } from './games'
import { nextLevel, readLevel, starsText, writeLevel } from './level'
import { forgetMem, learn, learnRate, newInsight, noteWhy, readMem, writeMem, type MemBase } from './memory'
import { useSoloMatch, type SoloOutcome } from './useSoloMatch'
import { explain, learnedLine, type Explanation } from './why/voice'
import { WhyCard, WhyPanel } from './why/WhyPanel'

const BOT_KEY = 'solo:bot'
const readBot = (): Character => {
  try {
    const c = getCharacter(localStorage.getItem(BOT_KEY) ?? '')
    if (c) return c
  } catch {
    /* stockage bloqué */
  }
  return CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)]
}
const saveBot = (slug: string) => {
  try {
    localStorage.setItem(BOT_KEY, slug)
  } catch {
    /* stockage bloqué */
  }
}

const botInfo = (c: Character): PlayerInfo => ({
  id: `bot-${c.slug}`,
  slug: c.slug,
  nickname: `${c.nickname} 🤖`,
  firstName: c.firstName,
  expressions: c.expressions,
  equipped: 'joie',
  equippedTenue: 'default',
  color: c.color,
})

/** Jouer seul contre un bot (Morpion, 4 à la suite, Bataille navale, Échecs) : route /solo/:gameId. */
export default function SoloPage() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const profile = useSession((s) => s.profile)
  // Niveau et mémoire du bot rangés par profil (téléphone partagé).
  const pid = profile?.id ?? 'local'
  const game = gameId ? getGame(gameId) : undefined
  const [mod, setMod] = useState<SoloGameModule | null>(null)
  const [bot, setBot] = useState<Character>(readBot)
  const [levels, setLevels] = useState<Record<string, number>>({})
  const level = levels[`${gameId}:${pid}`] ?? (gameId ? readLevel(gameId, pid) : 3)
  // Mémoire relue après chaque écriture (memVersion) : objet stable entre deux rendus.
  const [memVersion, setMemVersion] = useState(0)
  const mem = useMemo(() => (memVersion >= 0 && mod && gameId ? readMem(mod.learner, gameId, pid) : null), [mod, gameId, pid, memVersion])
  const [playing, setPlaying] = useState(false)
  const [round, setRound] = useState(0)

  useEffect(() => {
    if (!isSoloGame(gameId)) return
    let alive = true
    void SOLO_LOADERS[gameId]().then((m) => alive && setMod(m))
    return () => {
      alive = false
    }
  }, [gameId])

  const insights = useMemo(() => (mod && mem ? mod.learner.insights(mem) : []), [mod, mem])

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
            color: accentColorOf(profile.slug),
          }
        : null,
    [profile],
  )

  if (!isSoloGame(gameId) || !game) return <Navigate to="/" replace />
  if (!me) return null

  const back = () => navigate('/')

  if (!playing || !mod) {
    return (
      <SoloPick
        title={`${game.emoji} ${game.name}`}
        color={game.color}
        bot={bot}
        level={level}
        loading={!mod}
        learned={
          mod && mem ? (
            <LearnedCard
              bot={bot}
              insights={insights}
              rate={learnRate(level, mem.streak)}
              known={mem.n > 0}
              onForget={() => {
                forgetMem(gameId, pid)
                setMemVersion((v) => v + 1)
              }}
            />
          ) : null
        }
        onPick={(c) => {
          fx.pop()
          setBot(c)
          saveBot(c.slug)
        }}
        onStart={() => {
          setRound((r) => r + 1)
          setPlaying(true)
        }}
        onBack={back}
      />
    )
  }

  return (
    <SoloGame
      key={`${bot.slug}-${round}`}
      gameId={gameId}
      title={`${game.emoji} ${game.name}`}
      mod={mod}
      me={me}
      bot={botInfo(bot)}
      level={level}
      mem={mem}
      // le joueur commence la 1re partie, puis on alterne
      first={round % 2 === 1 ? me.id : botInfo(bot).id}
      onLevel={(l) => {
        setLevels((v) => ({ ...v, [`${gameId}:${pid}`]: l }))
        writeLevel(gameId, l, pid)
      }}
      onMem={(m) => {
        writeMem(gameId, pid, m)
        setMemVersion((v) => v + 1)
      }}
      onReplay={() => setRound((r) => r + 1)}
      onChangeBot={() => setPlaying(false)}
      onBack={back}
    />
  )
}

/* ------------------------------------------------------------------ choix de l'adversaire */

function SoloPick(props: {
  title: string
  color: string
  bot: Character
  level: number
  loading: boolean
  /** 2b : « Ce que {Perso} sait de toi ». */
  learned: ReactNode
  onPick: (c: Character) => void
  onStart: () => void
  onBack: () => void
}) {
  const { title, color, bot, level, loading, learned, onPick, onStart, onBack } = props
  return (
    <div className="flex flex-col gap-4 pb-8">
      <button type="button" onClick={onBack} className="flex min-h-12 items-center gap-2 self-start font-extrabold">
        <ArrowLeft className="size-6" /> Retour
      </button>
      <div className="rounded-card border-[3px] border-ink p-4 text-center shadow-sticker" style={{ background: color }}>
        <p className="font-display text-sm font-extrabold uppercase tracking-wide text-[#1f1b2e]">Jouer seul 🤖</p>
        <h1 className="text-3xl text-[#1f1b2e]">{title}</h1>
      </div>

      <h2 className="text-center text-2xl">Choisis ton adversaire</h2>
      <div className="grid grid-cols-3 gap-3">
        {CHARACTERS.map((c) => {
          const on = c.slug === bot.slug
          return (
            <motion.button
              key={c.slug}
              type="button"
              whileTap={{ scale: 0.92 }}
              onClick={() => onPick(c)}
              aria-pressed={on}
              className={cn(
                'flex flex-col items-center gap-1 rounded-card border-[3px] border-ink p-2 font-extrabold',
                on ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-surface shadow-sticker-sm',
              )}
            >
              <Avatar slug={c.slug} tenue="default" expression={on ? 'joie' : pickExpression(c, 'cool', 'clin_oeil')} size={72} bounce={on} />
              <span className="truncate text-base">{c.nickname}</span>
            </motion.button>
          )
        })}
      </div>

      <div className="flex flex-col items-center gap-1 rounded-card border-[3px] border-ink bg-surface p-3 text-center shadow-sticker-sm">
        <p className="font-display text-lg font-extrabold">Niveau du bot</p>
        <LevelGauge level={level} size={30} />
        <p className="text-sm font-bold text-muted">Il monte quand tu gagnes, il baisse quand tu perds.</p>
      </div>

      {learned}

      <Button size="lg" fullWidth loading={loading} onClick={onStart}>
        C’est parti contre {bot.nickname} !
      </Button>
      <p className="text-center text-sm font-bold text-muted">Partie d’entraînement : rien n’est compté.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ partie */

const BOT_SAYS: Record<string, string> = {
  joie: 'Hé hé ! 😏',
  surprise: 'Oh ?! 😮',
  appris: 'Je te connais ! 💡',
}
const MOOD_FACE: Record<string, string[]> = { joie: ['joie'], surprise: ['surprise'], appris: ['clin_oeil', 'cool'] }

function SoloGame(props: {
  gameId: string
  title: string
  mod: SoloGameModule
  me: PlayerInfo
  bot: PlayerInfo
  level: number
  /** 2b : mémoire du bot (lue au début de la partie). */
  mem: MemBase | null
  first: string
  onLevel: (l: number) => void
  onMem: (m: MemBase) => void
  onReplay: () => void
  onChangeBot: () => void
  onBack: () => void
}) {
  const { gameId, title, mod, me, bot, level, first, onLevel, onMem, onReplay, onChangeBot, onBack } = props
  const reduce = useReducedMotion()
  const slug = bot.slug as CharacterSlug
  // Mémoire figée au début de la partie (le bot ne lit rien de la partie en cours).
  const [mem] = useState(props.mem)
  const rate = mem ? learnRate(level, mem.streak) : 0
  const { state: s, secret, act, thinking, mood, outcome, log } = useSoloMatch({ mod, gameId, meId: me.id, botId: bot.id, level, first, perso: slug, mem, rate })
  const [endLevel, setEndLevel] = useState<{ from: number; to: number } | null>(null)
  const topRef = useRef<HTMLDivElement>(null)
  // 2a : explication (ou compliment) ; 2b : habitude repérée à cette partie.
  const [ex, setEx] = useState<Explanation | null>(null)
  const [kit, setKit] = useState<WhyKit | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)
  const [panel, setPanel] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  /** Fin de partie : le bot apprend (une fois), puis prépare son explication. */
  const debrief = useCallback(
    (res: SoloOutcome) => {
      let learned: MemBase | null = null
      if (mem) {
        try {
          const r = newInsight(mod.learner, learn(mod.learner, mem, log))
          learned = r.mem
          if (r.insight) setFresh(learnedLine(slug, r.insight.text))
          onMem(learned)
        } catch (e) {
          console.warn('[solo] apprentissage', e)
        }
      }
      void (async () => {
        try {
          const [k, moments] = await Promise.all([mod.loadWhy(), mod.findMoments(log, res === 'win' ? 'bot' : 'me')])
          const e = explain({ slug, why: k.why, outcome: res, moments, lastWhy: mem?.lastWhy, seed: log.id })
          if (!alive.current) return
          setKit(k)
          setEx(e)
          if (learned && res === 'loss' && e.moment) onMem(noteWhy(learned, e.moment.type))
        } catch (e) {
          console.warn('[solo] explication', e)
        }
      })()
    },
    [mem, mod, log, slug, onMem],
  )

  // Fin de partie : niveau qui s'adapte (une seule fois), fête ou consolation.
  const ended = useRef(false)
  useEffect(() => {
    if (!outcome || ended.current) return
    const to = nextLevel(level, outcome)
    const t = window.setTimeout(() => {
      ended.current = true
      setEndLevel({ from: level, to })
      onLevel(to)
      debrief(outcome)
      if (outcome === 'win') {
        victoryConfetti()
        fx.fanfare()
      } else if (outcome === 'loss') fx.fail()
      else burst()
      topRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    }, 900)
    return () => window.clearTimeout(t)
  }, [outcome, level, onLevel, reduce, debrief])

  const colors = useMemo(() => pickSideColors(me.color, bot.color), [me.color, bot.color])
  const get = useMemo(() => (id: string) => (id === bot.id ? bot : me), [me, bot])
  const ctx = useMemo(() => ({ matchId: '', act }), [act])
  const duel = s.duel
  if (!duel || s.board == null) return null

  const Board = mod.Board
  const isMyTurn = s.phase === 'playing' && duel.turn === me.id
  const botExpr = endLevel
    ? pickExpression(bot, ...(outcome === 'win' ? ['pleurs', 'boude'] : outcome === 'loss' ? ['joie', 'cool'] : ['clin_oeil', 'surprise']))
    : mood
      ? pickExpression(bot, ...(MOOD_FACE[mood] ?? [mood]))
      : thinking
        ? pickExpression(bot, 'reflexion')
        : pickExpression(bot, 'cool', 'clin_oeil')
  const bubble = endLevel
    ? outcome === 'win'
      ? 'Bien joué… 😤'
      : outcome === 'loss'
        ? 'Gagné ! 🏆'
        : 'Match nul ! 🤝'
    : mood
      ? BOT_SAYS[mood]
      : thinking
        ? '💭'
        : null

  return (
    <div ref={topRef} className="flex scroll-mt-4 flex-col gap-3 pb-6">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onChangeBot} className="flex min-h-12 items-center gap-2 font-extrabold">
          <ArrowLeft className="size-6" /> {outcome ? 'Retour' : 'Arrêter'}
        </button>
        <span className="truncate font-display text-lg font-extrabold">{title}</span>
      </div>

      {/* Le bot */}
      <div className="flex items-center gap-3 rounded-card border-[3px] border-ink bg-surface p-2 pr-3 shadow-sticker-sm">
        <div className="relative">
          <Avatar slug={bot.slug} tenue="default" expression={botExpr} size={68} bounce={thinking && !reduce} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-display text-xl font-extrabold">{bot.nickname}</span>
          <LevelGauge level={level} size={18} />
        </div>
        <AnimatePresence mode="wait">
          {bubble && (
            <motion.span
              key={bubble}
              initial={{ scale: 0.4, opacity: 0, rotate: -8 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              exit={{ scale: 0.6, opacity: 0 }}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-bubble border-[3px] border-ink px-3 py-1 font-display text-lg font-extrabold shadow-sticker-sm',
                bubble === '💭' ? 'bg-sky text-[#1f1b2e]' : 'bg-paper',
              )}
              aria-label={bubble === '💭' ? `${bot.nickname} réfléchit` : undefined}
            >
              {bubble === '💭' ? (
                <>
                  <span className="text-2xl leading-none">💭</span>
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      aria-hidden
                      className="inline-block size-2 rounded-full bg-[#1f1b2e]"
                      animate={reduce ? undefined : { y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }}
                    />
                  ))}
                </>
              ) : (
                bubble
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Fin de partie */}
      <AnimatePresence>
        {endLevel && outcome && (
          <SoloEnd
            outcome={outcome}
            from={endLevel.from}
            to={endLevel.to}
            bot={bot}
            ex={ex}
            fresh={fresh}
            onShow={() => setPanel(true)}
            onReplay={onReplay}
            onChangeBot={onChangeBot}
            onBack={onBack}
          />
        )}
      </AnimatePresence>
      {panel && ex && kit && (
        <WhyPanel ex={ex} kit={kit} local={mod.local} log={log} me={me} bot={bot} colors={colors} onClose={() => setPanel(false)} />
      )}

      {/* Consigne */}
      {!outcome && (s.phase === 'playing' || s.phase === 'setup') && (
        <motion.div
          key={`${duel.turn}-${duel.moves}-${s.phase}`}
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={cn(
            'flex items-center justify-center gap-2 rounded-full border-[3px] border-ink px-3 py-1 text-center font-display text-lg font-extrabold',
            isMyTurn ? 'bg-sun text-[#1f1b2e] shadow-sticker-sm' : 'bg-surface',
          )}
        >
          {s.phase === 'setup'
            ? duel.ready.includes(me.id)
              ? `Prêt ! ${bot.nickname} aussi…`
              : (mod.setupHint ?? 'Prépare-toi, puis valide !')
            : isMyTurn
              ? mod.hint(s.board, me.id)
              : `${bot.nickname} réfléchit…`}
        </motion.div>
      )}

      <BnMatchContext.Provider value={ctx}>
        <Board
          board={s.board}
          me={me.id}
          isMyTurn={isMyTurn}
          onMove={(move) => void act({ type: 'move', move })}
          onReady={() => void act({ type: 'ready' })}
          pending={false}
          duel={duel}
          phase={s.phase}
          spectator={false}
          get={get}
          colors={colors}
          secret={secret}
        />
      </BnMatchContext.Provider>
    </div>
  )
}

function SoloEnd({
  outcome,
  from,
  to,
  bot,
  ex,
  fresh,
  onShow,
  onReplay,
  onChangeBot,
  onBack,
}: {
  outcome: SoloOutcome
  from: number
  to: number
  bot: PlayerInfo
  /** 2a : explication / compliment (null pendant l'analyse). */
  ex: Explanation | null
  /** 2b : habitude repérée à cette partie (« 🧠 J'ai capté un truc : … »). */
  fresh: string | null
  onShow: () => void
  onReplay: () => void
  onChangeBot: () => void
  onBack: () => void
}) {
  const title = outcome === 'win' ? 'Gagné ! 🎉' : outcome === 'loss' ? 'Perdu… 😢' : 'Égalité ! 🤝'
  const accent = outcome === 'win' ? 'var(--color-mint)' : outcome === 'loss' ? 'var(--color-bubblegum)' : 'var(--color-sky)'
  const move = to > from ? `Le bot passe à ${starsText(to)} 💪` : to < from ? `Le bot redescend à ${starsText(to)}` : `Le bot reste à ${starsText(to)}`
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0, rotate: -3 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      exit={{ opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      className="flex flex-col items-center gap-3 rounded-card border-[3px] border-ink p-4 text-center text-[#1f1b2e] shadow-sticker"
      style={{ background: accent }}
    >
      <h2 className="text-4xl">{title}</h2>
      <div className="flex flex-col items-center gap-1">
        <LevelGauge level={to} size={30} onColor />
        <p className="font-extrabold">{move}</p>
      </div>
      <WhyCard ex={ex} bot={bot} onShow={onShow} />
      {fresh && (
        <motion.p
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="w-full rounded-bubble border-[3px] border-ink bg-white px-3 py-2 text-left text-base leading-snug font-bold text-[#1f1b2e] shadow-sticker-sm"
        >
          <span className="mr-1 inline-block -rotate-3 rounded-chip border-2 border-ink bg-sun px-1.5 text-xs font-extrabold uppercase">nouveau</span> 🧠 {fresh}
        </motion.p>
      )}
      <div className="flex w-full flex-col gap-2">
        <Button size="lg" fullWidth onClick={onReplay}>
          Rejouer contre {bot.nickname.replace(' 🤖', '')}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onChangeBot}>
            Changer d’adversaire
          </Button>
          <Button variant="secondary" onClick={onBack}>
            Accueil
          </Button>
        </div>
      </div>
      <p className="text-sm font-bold opacity-80">Partie d’entraînement : rien n’est compté.</p>
    </motion.div>
  )
}
