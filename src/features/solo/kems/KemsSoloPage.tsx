import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { Navigate, useNavigate } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { burst, victoryConfetti } from '@/components/ui/confetti'
import { CHARACTERS, getCharacter, type Character } from '@/data/characters'
import { getExpression } from '@/data/expressions'
import { toastError } from '@/features/soiree/errors'
import { pickExpression } from '@/features/soiree/players'
import { TEAM_INFO } from '@/features/teams/teams'
import { IDLE_EXPRESSION, SIGN_EXPRESSIONS } from '@/games/kems/bot'
import { PlayingScreen } from '@/games/kems/Play'
import { RevealPanel } from '@/games/kems/Reveal'
import { ScorePills } from '@/games/kems/Parts'
import { explainKems, KemsSoloSim, pickOppSign } from '@/games/kems/solo'
import type { KemsSecret, KemsState } from '@/games/kems/types'
import type { BaseGameState, PlayerInfo } from '@/games/types'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'
import { useSession } from '@/store/session'
import { LevelGauge } from '../LevelGauge'
import { nextLevel, readLevel, starsText, writeLevel } from '../level'

const PREF_KEY = 'solo:kems:prefs'
interface Prefs {
  partner: string
  opps: [string, string]
  sign: string
  target: 3 | 5 | 7
}

const exprLabel = (e: string) => `${getExpression(e)?.emoji ?? ''} ${getExpression(e)?.label ?? e}`

function readPrefs(mySlug: string): Prefs {
  const pool = CHARACTERS.filter((c) => c.slug !== mySlug).map((c) => c.slug)
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null') as Prefs | null
    const all = p ? [p.partner, ...p.opps] : []
    if (p && all.length === 3 && new Set(all).size === 3 && all.every((s) => pool.includes(s as never)) && (SIGN_EXPRESSIONS as readonly string[]).includes(p.sign)) {
      return { ...p, target: [3, 5, 7].includes(p.target) ? p.target : 3 }
    }
  } catch {
    /* stockage bloqué */
  }
  const sh = [...pool].sort(() => Math.random() - 0.5)
  return { partner: sh[0], opps: [sh[1], sh[2]], sign: 'clin_oeil', target: 3 }
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

/** Kems en solo : toi + un bot coéquipier contre 2 bots. Route /solo/kems (rien n'est compté). */
export default function KemsSoloPage() {
  const navigate = useNavigate()
  const profile = useSession((s) => s.profile)
  const pid = profile?.id ?? 'local'
  const [level, setLevel] = useState(() => readLevel('kems', pid))
  const [prefs, setPrefs] = useState<Prefs | null>(() => (profile ? readPrefs(profile.slug) : null))
  const [playing, setPlaying] = useState(false)
  const [round, setRound] = useState(0)

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
  if (!profile) return null
  if (!me || !prefs) return <Navigate to="/" replace />

  const save = (p: Prefs) => {
    setPrefs(p)
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(p))
    } catch {
      /* stockage bloqué */
    }
  }

  if (!playing) {
    return <Pick me={me} prefs={prefs} level={level} onChange={save} onStart={() => (setRound((r) => r + 1), setPlaying(true))} onBack={() => navigate('/')} />
  }
  return (
    <KemsSoloGame
      key={round}
      me={me}
      prefs={prefs}
      level={level}
      onLevel={(l) => {
        setLevel(l)
        writeLevel('kems', l, pid)
      }}
      onReplay={() => setRound((r) => r + 1)}
      onChange={() => setPlaying(false)}
      onBack={() => navigate('/')}
    />
  )
}

/* ------------------------------------------------------------------ choix des bots et du signe */

type Role = 'partner' | 'opp0' | 'opp1'

function Pick({ me, prefs, level, onChange, onStart, onBack }: { me: PlayerInfo; prefs: Prefs; level: number; onChange: (p: Prefs) => void; onStart: () => void; onBack: () => void }) {
  const [role, setRole] = useState<Role>('partner')
  const roles: Array<{ id: Role; label: string; slug: string }> = [
    { id: 'partner', label: 'Ton coéquipier', slug: prefs.partner },
    { id: 'opp0', label: 'Adversaire 1', slug: prefs.opps[0] },
    { id: 'opp1', label: 'Adversaire 2', slug: prefs.opps[1] },
  ]
  const assign = (slug: string) => {
    const cur: Record<Role, string> = { partner: prefs.partner, opp0: prefs.opps[0], opp1: prefs.opps[1] }
    const other = (Object.keys(cur) as Role[]).find((r) => cur[r] === slug)
    if (other && other !== role) cur[other] = cur[role] // échange de places
    cur[role] = slug
    fx.pop()
    onChange({ ...prefs, partner: cur.partner, opps: [cur.opp0, cur.opp1] })
  }
  const partner = getCharacter(prefs.partner) ?? CHARACTERS[0]
  return (
    <div className="flex flex-col gap-4 pb-8">
      <button type="button" onClick={onBack} className="flex min-h-12 items-center gap-2 self-start font-extrabold">
        <ArrowLeft className="size-6" /> Retour
      </button>
      <div className="rounded-card border-[3px] border-ink bg-[#FF9F43] p-4 text-center text-[#1f1b2e] shadow-sticker">
        <p className="font-display text-sm font-extrabold uppercase tracking-wide">Jouer seul 🤖</p>
        <h1 className="text-3xl">🤠 Kems</h1>
        <p className="mt-1 text-sm font-bold">Toi + un bot contre 2 bots. Ici, le signe se fait avec le visage des chibis !</p>
      </div>

      <h2 className="text-center text-2xl">Qui joue ?</h2>
      <div className="grid grid-cols-3 gap-2">
        {roles.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRole(r.id)}
            aria-pressed={role === r.id}
            className={cn('flex flex-col items-center gap-1 rounded-card border-[3px] border-ink p-2 font-extrabold', role === r.id ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-surface shadow-sticker-sm')}
          >
            <Avatar slug={r.slug} tenue="default" size={60} />
            <span className="text-xs leading-tight">{r.label}</span>
            <span className="text-sm">{r.id === 'partner' ? '🔴' : '🔵'}</span>
          </button>
        ))}
      </div>
      <p className="text-center text-sm font-bold text-muted">Touche un rôle, puis un perso :</p>
      <div className="grid grid-cols-4 gap-2">
        {CHARACTERS.filter((c) => c.slug !== me.slug).map((c) => {
          const taken = roles.find((r) => r.slug === c.slug)
          return (
            <motion.button key={c.slug} type="button" whileTap={{ scale: 0.92 }} onClick={() => assign(c.slug)} className={cn('flex flex-col items-center gap-0.5 rounded-card border-[3px] border-ink p-1 text-xs font-extrabold', taken ? 'bg-surface shadow-sticker-sm' : 'bg-surface opacity-70')}>
              <Avatar slug={c.slug} tenue="default" size={48} />
              <span className="max-w-full truncate">{c.nickname}</span>
            </motion.button>
          )
        })}
      </div>

      <h2 className="text-center text-2xl">🤫 Votre signe secret</h2>
      <p className="text-center text-sm font-bold">
        Choisis avec {partner.nickname} l’expression qui voudra dire « j’ai un carré ! ». Quand {partner.nickname} la fera, crie KEMS. Les autres guettent aussi…
      </p>
      <div className="grid grid-cols-4 gap-2">
        {SIGN_EXPRESSIONS.map((e) => {
          const on = prefs.sign === e
          return (
            <motion.button key={e} type="button" whileTap={{ scale: 0.92 }} onClick={() => (fx.pop(), onChange({ ...prefs, sign: e }))} aria-pressed={on} className={cn('flex flex-col items-center gap-0.5 rounded-card border-[3px] border-ink p-1 text-xs font-extrabold', on ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-surface shadow-sticker-sm')}>
              <Avatar slug={partner.slug} tenue="default" expression={pickExpression(partner, e)} size={48} />
              <span className="max-w-full truncate">{exprLabel(e)}</span>
            </motion.button>
          )
        })}
      </div>

      <h2 className="text-center text-2xl">Points pour gagner</h2>
      <div className="grid grid-cols-3 gap-2">
        {([3, 5, 7] as const).map((n) => (
          <button key={n} type="button" onClick={() => onChange({ ...prefs, target: n })} aria-pressed={prefs.target === n} className={cn('min-h-12 rounded-chip border-[3px] border-ink font-display text-xl font-extrabold', prefs.target === n ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-surface shadow-sticker-sm')}>
            {n}
          </button>
        ))}
      </div>

      <div className="flex flex-col items-center gap-1 rounded-card border-[3px] border-ink bg-surface p-3 text-center shadow-sticker-sm">
        <p className="font-display text-lg font-extrabold">Niveau des bots</p>
        <LevelGauge level={level} size={30} />
        <p className="text-sm font-bold text-muted">Il monte quand tu gagnes, il baisse quand tu perds.</p>
      </div>

      <Button size="lg" fullWidth onClick={onStart}>
        C’est parti avec {partner.nickname} !
      </Button>
      <p className="text-center text-sm font-bold text-muted">Partie d’entraînement : rien n’est compté.</p>
    </div>
  )
}

/* ------------------------------------------------------------------ partie */

function KemsSoloGame({ me, prefs, level, onLevel, onReplay, onChange, onBack }: { me: PlayerInfo; prefs: Prefs; level: number; onLevel: (l: number) => void; onReplay: () => void; onChange: () => void; onBack: () => void }) {
  const chars = useMemo(() => [prefs.partner, ...prefs.opps].map((s) => getCharacter(s) ?? CHARACTERS[0]), [prefs])
  const infos = useMemo(() => chars.map(botInfo), [chars])
  const [partner, o1, o2] = infos
  const players = useMemo(() => Object.fromEntries([me, ...infos].map((p) => [p.id, p])), [me, infos])
  const sim = useMemo(
    () => new KemsSoloSim({ me: me.id, partner: partner.id, opps: [o1.id, o2.id], mySign: prefs.sign, oppSign: pickOppSign(prefs.sign), level, target: prefs.target }, Date.now()),
    // une partie par montage (key du parent)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const seen = useRef(sim.version)
  useEffect(() => {
    const t = window.setInterval(() => {
      sim.step(Date.now())
      if (sim.version !== seen.current) {
        seen.current = sim.version
        bump()
      }
    }, 100)
    return () => window.clearInterval(t)
  }, [sim])

  const s = sim.state as unknown as KemsState
  const sec = (sim.x.secrets?.[me.id] ?? null) as KemsSecret | null
  const outcome = sim.outcome
  const act = async (a: Record<string, unknown>): Promise<BaseGameState | null> => {
    const err = sim.act(me.id, a, Date.now())
    if (err) {
      toastError(new Error(err))
      return null
    }
    return sim.state as unknown as BaseGameState
  }

  // Fin de partie : niveau qui s'adapte (une seule fois), fête ou consolation.
  const ended = useRef(false)
  const [endLevel, setEndLevel] = useState<{ from: number; to: number } | null>(null)
  useEffect(() => {
    if (!outcome || ended.current) return
    const t = window.setTimeout(() => {
      ended.current = true
      const to = nextLevel(level, outcome)
      setEndLevel({ from: level, to })
      onLevel(to)
      if (outcome === 'win') {
        victoryConfetti()
        fx.fanfare()
      } else if (outcome === 'loss') fx.fail()
      else burst()
    }, 4500)
    return () => window.clearTimeout(t)
  }, [outcome, level, onLevel])

  const now = Date.now()
  const face = (id: string, p: PlayerInfo) => {
    const f = sim.faces[id]
    return f && f.until > now ? pickExpression(p, f.expr) : pickExpression(p, IDLE_EXPRESSION)
  }
  const sq = sim.myHand.length === 4 && new Set(sim.myHand.map((c) => c.slice(0, -1))).size === 1
  const why = useMemo(() => (endLevel && outcome ? explainKems(sim.rounds, outcome, partner.nickname.replace(' 🤖', '')) : null), [endLevel, outcome, sim, partner.nickname])

  const table = (
    <div className="grid grid-cols-4 gap-1.5 rounded-card border-[3px] border-ink bg-surface p-2 shadow-sticker-sm" aria-label="Les joueurs">
      {[
        { p: me, team: '🔴', label: 'Toi' },
        { p: partner, team: '🔴', label: 'Coéquipier' },
        { p: o1, team: '🔵', label: 'Adversaire' },
        { p: o2, team: '🔵', label: 'Adversaire' },
      ].map(({ p, team, label }) => (
        <div key={p.id} className="flex min-w-0 flex-col items-center">
          <Avatar slug={p.slug} tenue={p.equippedTenue} expression={face(p.id, p)} size={56} />
          <span className="w-full truncate text-center text-[11px] font-extrabold">
            {team} {p.id === me.id ? label : p.nickname.replace(' 🤖', '')}
          </span>
        </div>
      ))}
    </div>
  )
  const myFace = sim.faces[me.id]
  const signSlot = (
    <motion.button
      type="button"
      whileTap={{ scale: 0.95 }}
      onClick={() => (fx.pop(), sim.humanSign(Date.now()), (seen.current = sim.version), bump())}
      className={cn(
        'flex min-h-14 w-full items-center justify-center gap-2 rounded-bubble border-[3px] border-ink font-display text-xl font-extrabold shadow-sticker',
        sq ? 'bg-mint text-[#1f1b2e]' : 'bg-surface',
      )}
    >
      {getExpression(prefs.sign)?.emoji ?? '🤫'} Faire le signe {myFace ? '✔' : ''}
    </motion.button>
  )

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={onChange} className="flex min-h-12 items-center gap-2 font-extrabold">
          <ArrowLeft className="size-6" /> {outcome ? 'Retour' : 'Arrêter'}
        </button>
        <span className="flex items-center gap-2 font-display text-lg font-extrabold">
          🤠 Kems <LevelGauge level={level} size={14} />
        </span>
      </div>

      <AnimatePresence>
        {endLevel && outcome && <End outcome={outcome} from={endLevel.from} to={endLevel.to} lines={why?.lines ?? []} oppSign={sim.cfg.oppSign} partner={partner} onReplay={onReplay} onChange={onChange} onBack={onBack} />}
      </AnimatePresence>

      {s.phase === 'playing' && <PlayingScreen s={s} meId={me.id} sec={sec} players={players} act={act as never} above={table} signSlot={signSlot} />}
      {(s.phase === 'reveal' || s.phase === 'finished') && s.call && (
        <>
          {table}
          <ScorePills s={s} meTeam="red" />
          <RevealPanel key={s.round} s={s} call={s.call} players={players} showTimer={s.phase === 'reveal'} />
          <p className="text-center text-sm font-bold text-muted">
            Signe des {TEAM_INFO.blue.short} : {exprLabel(sim.cfg.oppSign)}
          </p>
          {s.phase === 'reveal' && (
            <Button fullWidth size="lg" icon={<ArrowRight className="size-5" />} onClick={() => void act({ type: 'next' })}>
              Manche suivante
            </Button>
          )}
        </>
      )}
      <p className="text-center text-xs font-bold text-muted">Partie d’entraînement : rien n’est compté.</p>
    </div>
  )
}

function End({ outcome, from, to, lines, oppSign, partner, onReplay, onChange, onBack }: { outcome: 'win' | 'loss' | 'draw'; from: number; to: number; lines: string[]; oppSign: string; partner: PlayerInfo; onReplay: () => void; onChange: () => void; onBack: () => void }) {
  const title = outcome === 'win' ? 'Gagné ! 🎉' : outcome === 'loss' ? 'Perdu… 😢' : 'Égalité ! 🤝'
  const accent = outcome === 'win' ? 'var(--color-mint)' : outcome === 'loss' ? 'var(--color-bubblegum)' : 'var(--color-sky)'
  const move = to > from ? `Les bots passent à ${starsText(to)} 💪` : to < from ? `Les bots redescendent à ${starsText(to)}` : `Les bots restent à ${starsText(to)}`
  return (
    <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }} className="flex flex-col items-center gap-3 rounded-card border-[3px] border-ink p-4 text-center text-[#1f1b2e] shadow-sticker" style={{ background: accent }}>
      <h2 className="text-4xl">{title}</h2>
      <LevelGauge level={to} size={30} onColor />
      <p className="font-extrabold">{move}</p>
      {lines.map((l) => (
        <p key={l} className="w-full rounded-bubble border-[3px] border-ink bg-white px-3 py-2 text-left text-base leading-snug font-bold shadow-sticker-sm">
          💡 {l}
        </p>
      ))}
      <p className="text-sm font-bold">Le signe des Bleus était : {exprLabel(oppSign)}</p>
      <div className="flex w-full flex-col gap-2">
        <Button size="lg" fullWidth onClick={onReplay}>
          Rejouer avec {partner.nickname.replace(' 🤖', '')}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onChange}>
            Changer d’équipe
          </Button>
          <Button variant="secondary" onClick={onBack}>
            Accueil
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
