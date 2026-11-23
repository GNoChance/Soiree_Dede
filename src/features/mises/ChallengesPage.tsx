import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import { ArrowLeft, Swords } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { burst } from '@/components/ui/confetti'
import { getGame } from '@/games/registry'
import type { PlayerInfo } from '@/games/types'
import { toastError } from '@/features/soiree/errors'
import { playerOrPlaceholder, usePlayers } from '@/features/soiree/players'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { toast } from '@/store/toast'
import {
  CHALLENGE_STAKES,
  cancelChallenge,
  challengeGames,
  createChallenge,
  fetchChallengeOptions,
  playChallenge,
  respondChallenge,
  untilLabel,
  useMyChallenges,
  type Challenge,
  type ChallengeOptions,
} from './api'

const gameName = (id: string) => {
  const g = getGame(id)
  return g ? `${g.emoji} ${g.name}` : id
}
const stakeLabel = (s: number) => (s ? `${s} 🪙` : 'pour la gloire')

/** Ligne « avatar + texte » d'un défi. */
function ChallengeRow({ c, byId, children, tone }: { c: Challenge; byId: Record<string, PlayerInfo>; children: ReactNode; tone?: string }) {
  const other = playerOrPlaceholder(byId, c.other_id)
  return (
    <Card className={cn('flex flex-col gap-3', tone)}>
      <div className="flex items-center gap-3">
        <Avatar slug={other.slug} tenue={other.equippedTenue} expression={other.equipped} size={56} />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </Card>
  )
}

/** Formulaire « Défier un pote » : ami -> jeu en duel -> enjeu. */
function NewChallenge({ byId, preset, onDone, onCancel }: { byId: Record<string, PlayerInfo>; preset: string | null; onDone: () => void; onCancel: () => void }) {
  const [opts, setOpts] = useState<ChallengeOptions | null>(null)
  const [friend, setFriend] = useState<string | null>(preset)
  const [game, setGame] = useState<string | null>(null)
  const [stake, setStake] = useState(10)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    fetchChallengeOptions().then((o) => {
      setOpts(o)
      // Lien « Défier » d'un non-ami (ou défi déjà en cours) : pas de présélection.
      if (preset && !o.friends.some((x) => x.id === preset && !x.open)) setFriend(null)
    }, toastError)
  }, [preset])
  if (!opts) return <Skeleton className="h-64 w-full" />
  const games = challengeGames()
  const f = opts.friends.find((x) => x.id === friend)
  const max = f?.max_stake ?? 0
  const okStake = stake <= max
  const send = async () => {
    if (!friend || !game) return
    setBusy(true)
    try {
      await createChallenge(friend, game, stake)
      fx.success()
      burst()
      toast.success(`⚔️ Défi envoyé à ${playerOrPlaceholder(byId, friend).nickname} !`)
      onDone()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xl">⚔️ Nouveau défi</h2>
        <span className="rounded-full border-2 border-ink bg-sun px-3 font-extrabold text-[#1f1b2e]">{opts.coins} 🪙</span>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg">1. Qui veux-tu défier ?</h3>
        {opts.friends.length === 0 && <p className="font-bold text-muted">Ajoute d’abord des amis (onglet Amis) !</p>}
        <div className="grid grid-cols-3 gap-2">
          {opts.friends.map((x) => {
            const p = playerOrPlaceholder(byId, x.id)
            const sel = friend === x.id
            return (
              <button
                key={x.id}
                type="button"
                disabled={x.open}
                aria-pressed={sel}
                onClick={() => {
                  fx.pop()
                  setFriend(x.id)
                }}
                className={cn(
                  'flex min-h-24 flex-col items-center justify-center gap-1 rounded-card border-[3px] border-ink p-2 shadow-sticker-sm active:scale-95',
                  sel ? 'bg-sun text-[#1f1b2e]' : 'bg-surface',
                  x.open && 'opacity-50',
                )}
              >
                <Avatar slug={p.slug} tenue={p.equippedTenue} expression={sel ? 'joie' : p.equipped} size={48} />
                <span className="max-w-full truncate text-sm font-extrabold">{p.nickname}</span>
                {x.open && <span className="text-[11px] font-bold">défi en cours</span>}
              </button>
            )
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg">2. À quel jeu ?</h3>
        <div className="grid grid-cols-2 gap-2">
          {games.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={game === g.id}
              onClick={() => {
                fx.pop()
                setGame(g.id)
              }}
              className={cn(
                'flex min-h-16 items-center gap-2 rounded-card border-[3px] border-ink p-2 text-left font-display text-base font-extrabold shadow-sticker-sm active:scale-95',
                game === g.id ? 'text-[#1f1b2e]' : 'bg-surface',
              )}
              style={game === g.id ? { background: g.color } : undefined}
            >
              <span className="text-3xl">{g.emoji}</span>
              <span className="leading-tight">{g.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-lg">3. L’enjeu</h3>
        <div className="grid grid-cols-5 gap-1.5">
          {CHALLENGE_STAKES.map((s) => {
            const off = Boolean(friend) && s > max
            return (
              <button
                key={s}
                type="button"
                aria-pressed={stake === s}
                disabled={off}
                onClick={() => {
                  fx.tick()
                  setStake(s)
                }}
                className={cn(
                  'min-h-14 rounded-card border-[3px] border-ink font-display text-base font-extrabold shadow-sticker-sm active:scale-95',
                  stake === s ? 'bg-sun text-[#1f1b2e]' : 'bg-surface',
                  off && 'opacity-40',
                )}
              >
                {s === 0 ? '0' : s}
                <span className="block text-xs">🪙</span>
              </button>
            )
          })}
        </div>
        <p className="text-sm leading-snug text-muted">
          {friend ? `Jusqu’à ${max} 🪙 avec ${playerOrPlaceholder(byId, friend).nickname} (le solde de chacun). ` : ''}
          Chacun met l’enjeu, le gagnant empoche tout. Égalité : remboursé. Annuler la partie quand on joue le défi = abandon, l’autre empoche tout.
        </p>
      </section>

      {friend && game && okStake && (
        <motion.p initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="sticker bg-sky p-3 text-center font-display text-lg leading-tight font-extrabold text-[#1f1b2e]">
          « {playerOrPlaceholder(byId, friend).nickname}, je te défie au {gameName(game)} ! Enjeu : {stakeLabel(stake)} »
        </motion.p>
      )}
      <Button size="lg" fullWidth loading={busy} disabled={!friend || !game || !okStake} icon={<Swords className="size-6" />} onClick={() => void send()}>
        Envoyer le défi
      </Button>
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Annuler
      </Button>
    </Card>
  )
}

/** /defis-potes : défis reçus, à jouer, envoyés, historique + formulaire. */
export function ChallengesPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const preset = params.get('ami')
  const { byId } = usePlayers()
  const { data, error, refetch } = useMyChallenges()
  const [creating, setCreating] = useState(Boolean(preset))
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (id: string, fn: () => Promise<unknown>, done?: () => void) => {
    setBusy(id)
    try {
      await fn()
      done?.()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(null)
      void refetch()
    }
  }
  const nick = (id: string) => playerOrPlaceholder(byId, id).nickname
  const list = data?.challenges ?? []
  const received = list.filter((c) => c.status === 'pending' && c.role === 'received')
  const sent = list.filter((c) => c.status === 'pending' && c.role === 'sent')
  const toPlay = list.filter((c) => c.status === 'accepted')
  const past = list.filter((c) => c.status !== 'pending' && c.status !== 'accepted')

  const play = (c: Challenge) =>
    run(c.id, async () => {
      if (c.match_id && c.match_status === 'playing') return navigate(`/partie/${c.match_id}`)
      const { soiree_id } = await playChallenge(c.id)
      navigate(`/soiree/${soiree_id}`)
    })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" aria-label="Retour" onClick={() => navigate(-1)} icon={<ArrowLeft className="size-5" />} />
        <h1 className="min-w-0 flex-1 truncate text-3xl">Défis entre potes</h1>
        {data && <span className="shrink-0 rounded-full border-2 border-ink bg-sun px-3 font-extrabold text-[#1f1b2e]">{data.coins} 🪙</span>}
      </div>

      {!data && !error && <Skeleton className="h-40 w-full" />}
      {error && !data && <Card className="font-bold">Les défis ne sont pas disponibles pour le moment.</Card>}

      {data && !creating && (
        <Button size="lg" fullWidth icon={<Swords className="size-6" />} onClick={() => setCreating(true)}>
          Défier un pote
        </Button>
      )}
      {data && creating && (
        <NewChallenge
          byId={byId}
          preset={preset}
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false)
            void refetch()
          }}
        />
      )}

      {received.length > 0 && <h2 className="text-2xl">📨 Défis reçus</h2>}
      {received.map((c) => (
        <ChallengeRow key={c.id} c={c} byId={byId} tone="ring-4 ring-tomato">
          <p className="font-display text-lg leading-tight font-extrabold">
            {nick(c.other_id)} te défie au {gameName(c.game_id)} !
          </p>
          <p className="text-sm font-bold text-muted">
            Enjeu : {stakeLabel(c.stake)} chacun · répondre avant {untilLabel(c.expires_at)}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button size="md" loading={busy === c.id} onClick={() => void run(c.id, () => respondChallenge(c.id, true), () => { fx.success(); burst(); toast.success(c.stake ? `Défi accepté ! ${c.stake} 🪙 mis en jeu.` : 'Défi accepté !') })}>
              J’accepte
            </Button>
            <Button variant="secondary" size="md" disabled={busy === c.id} onClick={() => void run(c.id, () => respondChallenge(c.id, false))}>
              Non merci
            </Button>
          </div>
          {c.stake > 0 && <p className="mt-1 text-xs text-muted">En acceptant, {c.stake} 🪙 sont bloqués jusqu’à la fin du duel.</p>}
        </ChallengeRow>
      ))}

      {toPlay.length > 0 && <h2 className="text-2xl">⚔️ À jouer</h2>}
      {toPlay.map((c) => (
        <ChallengeRow key={c.id} c={c} byId={byId}>
          <p className="font-display text-lg leading-tight font-extrabold">
            Toi vs {nick(c.other_id)} · {gameName(c.game_id)}
          </p>
          <p className="text-sm font-bold text-muted">{c.stake ? `Pot : ${2 * c.stake} 🪙 pour le gagnant` : 'Pour la gloire'}</p>
          <Button className="mt-2" size="md" fullWidth loading={busy === c.id} onClick={() => void play(c)}>
            {c.match_id && c.match_status === 'playing' ? 'Rejoindre le duel' : 'Jouer maintenant'}
          </Button>
          {!c.match_id && <p className="mt-1 text-xs text-muted">Ouvre une soirée à deux (ou la vôtre) : l’hôte lance le duel depuis le salon.</p>}
        </ChallengeRow>
      ))}

      {sent.length > 0 && <h2 className="text-2xl">📤 Envoyés</h2>}
      {sent.map((c) => (
        <ChallengeRow key={c.id} c={c} byId={byId}>
          <p className="font-bold leading-tight">
            {gameName(c.game_id)} contre {nick(c.other_id)} · {stakeLabel(c.stake)}
          </p>
          <p className="text-sm text-muted">En attente de réponse (encore {untilLabel(c.expires_at)})</p>
          <Button className="mt-2" variant="secondary" size="sm" loading={busy === c.id} onClick={() => void run(c.id, () => cancelChallenge(c.id))}>
            Annuler le défi
          </Button>
        </ChallengeRow>
      ))}

      {past.length > 0 && <h2 className="text-2xl">📜 Derniers défis</h2>}
      {past.map((c) => (
        <ChallengeRow key={c.id} c={c} byId={byId}>
          <p className="font-bold leading-tight">
            {gameName(c.game_id)} · {c.role === 'sent' ? 'contre' : 'de'} {nick(c.other_id)}
          </p>
          <p className="text-sm font-extrabold">{pastLabel(c)}</p>
        </ChallengeRow>
      ))}

      {data && list.length === 0 && !creating && (
        <Card className="text-center font-bold text-muted">Aucun défi pour l’instant. Lance le premier ! 😈</Card>
      )}
    </div>
  )
}

function pastLabel(c: Challenge): string {
  switch (c.status) {
    case 'finished':
      if (!c.winner_id) return c.stake ? '🤝 Égalité : enjeux remboursés' : '🤝 Égalité'
      return c.winner_id === c.other_id ? `😭 Perdu${c.stake ? ` (−${c.stake} 🪙)` : ''}` : `🏆 Gagné${c.stake ? ` (+${c.stake} 🪙)` : ''}`
    case 'void':
      return c.stake ? '↩️ Annulé : enjeux remboursés' : '↩️ Annulé'
    case 'declined':
      return '🙅 Refusé'
    case 'cancelled':
      return '✖️ Retiré'
    case 'expired':
      return '⌛ Expiré (pas de réponse en 48 h)'
    default:
      return ''
  }
}
