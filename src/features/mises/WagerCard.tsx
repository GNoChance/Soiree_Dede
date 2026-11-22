import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { burst } from '@/components/ui/confetti'
import type { BaseGameState, PlayerInfo } from '@/games/types'
import { PronosPicker } from '@/features/pronos/PronosPicker'
import { toastError } from '@/features/soiree/errors'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { fmtOdds, useMatchWagers, WAGER_STAKES } from './api'

/** Règle des cotes, affichée telle quelle. */
function OddsHelp() {
  return (
    <details className="text-sm leading-snug text-muted">
      <summary className="cursor-pointer font-extrabold">Comment marchent les cotes ?</summary>
      <ul className="mt-1 list-disc pl-5">
        <li>Plus un joueur gagne souvent à ce jeu, plus sa cote est petite (de ×1,5 à ×5).</li>
        <li>Ton joueur gagne : tu touches mise × cote. Sinon, ta mise est perdue.</li>
        <li>Partie annulée ou sans gagnant : tu es remboursé·e.</li>
        <li>Paris ouverts 45 s après le lancement (duels : jusqu’au 1er coup).</li>
      </ul>
    </details>
  )
}

/**
 * Paris en pièces 🪙 des spectateurs (membres de la soirée qui ne jouent pas cette partie) :
 * choisir un joueur, une mise (10 / 25 / 50), valider. Ensuite : rappel du pari, puis résultat.
 * Ne rend rien pour un joueur de la partie.
 */
export function WagerCard({ matchId, state, meId, byId, finished }: { matchId: string; state: BaseGameState; meId: string; byId: Record<string, PlayerInfo>; finished: boolean }) {
  const players = Array.isArray((state as { players?: unknown }).players) ? ((state as { players: string[] }).players) : []
  const enabled = Boolean(meId) && players.length >= 2 && !players.includes(meId)
  const { data, place, refetch } = useMatchWagers(matchId, enabled, String(finished))
  const [pick, setPick] = useState<string | null>(null)
  const [stake, setStake] = useState<number>(10)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const left = useCountdown(data?.open ? data.closes_at : null, 500)
  const prevStatus = useRef<string | undefined>(undefined)

  const mine = data?.mine ?? null
  // Fin de partie : si le pari n'apparaît pas encore réglé, une relecture de plus.
  useEffect(() => {
    if (!(finished && mine?.status === 'open')) return
    const t = window.setTimeout(() => void refetch(), 1500)
    return () => clearTimeout(t)
  }, [finished, mine?.status, refetch])
  // Fête seulement si on a vu le pari en cours (pas en revenant plus tard sur une partie terminée).
  useEffect(() => {
    if (mine?.status === 'won' && prevStatus.current === 'open') {
      fx.cash()
      burst()
    }
    prevStatus.current = mine?.status
  }, [mine?.status])

  if (!enabled || !data || !data.can_bet) return null
  const nick = (id: string) => playerOrPlaceholder(byId, id).nickname

  // ---- Résultat
  if (finished || (mine && mine.status !== 'open')) {
    if (!mine) return null
    const line = `${mine.stake} 🪙 sur ${nick(mine.pick)}, cote ${fmtOdds(mine.odds)}`
    const view =
      mine.status === 'won'
        ? { cls: 'bg-mint', title: `🎉 Pari gagné : +${mine.payout} 🪙 !`, sub: line }
        : mine.status === 'lost'
          ? { cls: 'bg-bubblegum', title: `😬 Pari perdu : −${mine.stake} 🪙`, sub: `${nick(mine.pick)} n’a pas gagné. (${line})` }
          : mine.status === 'refunded'
            ? { cls: 'bg-sky', title: `↩️ Pari remboursé : ${mine.stake} 🪙 rendus`, sub: 'Partie annulée ou sans gagnant.' }
            : { cls: 'bg-surface', title: '⏳ Résultat du pari…', sub: line }
    return (
      <motion.div initial={{ scale: 0.8, rotate: -3, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} className={cn('sticker flex flex-col gap-1 p-3 text-[#1f1b2e]', view.cls)} role="status">
        <span className="font-display text-xl leading-tight font-extrabold">{view.title}</span>
        <span className="text-sm font-bold">{view.sub}</span>
      </motion.div>
    )
  }

  // ---- Paris fermés
  if (!data.open) {
    if (!mine) return null
    return (
      <div className="sticker flex items-center gap-2 bg-sun p-3 text-[#1f1b2e]" role="status">
        <Lock className="size-5 shrink-0" />
        <span className="font-bold leading-tight">
          Tu as misé <b>{mine.stake} 🪙</b> sur <b>{nick(mine.pick)}</b>, cote {fmtOdds(mine.odds)} → <b>{mine.gain} 🪙</b> s’il gagne. Croise les doigts 🤞
        </span>
      </div>
    )
  }

  // ---- Paris ouverts : pari posé (résumé)
  const secs = Math.ceil(left / 1000)
  const timer = (
    <span className="shrink-0 rounded-full border-2 border-ink bg-sun px-2 text-sm font-extrabold text-[#1f1b2e] tabular-nums">{secs}s</span>
  )
  if (mine && !editing) {
    return (
      <div className="sticker flex flex-col gap-2 bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-lg leading-tight font-extrabold">🎟️ Pari posé !</span>
          {timer}
        </div>
        <p className="font-bold leading-snug">
          Tu as misé <b>{mine.stake} 🪙</b> sur <b>{nick(mine.pick)}</b>, cote {fmtOdds(mine.odds)} → tu gagnes <b>{mine.gain} 🪙</b> s’il gagne.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setPick(mine.pick)
            setStake(mine.stake)
            setEditing(true)
          }}
        >
          Changer d’avis
        </Button>
      </div>
    )
  }

  // ---- Paris ouverts : choisir
  const budget = data.coins + (mine?.stake ?? 0)
  const odds = pick ? Number(data.odds[pick] ?? 0) : 0
  const submit = async () => {
    if (!pick) return
    setBusy(true)
    try {
      await place(pick, stake)
      fx.cash()
      setEditing(false)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <motion.div initial={{ y: 16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="sticker flex flex-col gap-3 bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-xl leading-tight font-extrabold">🪙 Mise sur le gagnant !</span>
        {timer}
      </div>
      <p className="text-sm font-bold text-muted">
        Ton solde : <span className="text-text">{data.coins} 🪙</span>
        {data.total > 0 && ` · ${data.total} pari${data.total > 1 ? 's' : ''} posé${data.total > 1 ? 's' : ''}`}
      </p>
      <PronosPicker
        playerIds={players}
        byId={byId}
        meId={meId}
        myPick={pick}
        onPick={(id) => {
          fx.pop()
          setPick(id)
        }}
        caption={(id) => (
          <span className="flex flex-col items-center leading-tight">
            <span className="rounded-full border-2 border-ink bg-sun px-2 text-sm font-extrabold text-[#1f1b2e]">{fmtOdds(Number(data.odds[id] ?? 0))}</span>
            {(data.backers[id] ?? 0) > 0 && <span className="text-xs font-bold text-muted">🎟️ {data.backers[id]}</span>}
          </span>
        )}
      />
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Ta mise">
        {WAGER_STAKES.map((s) => {
          const off = s > budget
          return (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={stake === s}
              disabled={off}
              onClick={() => {
                fx.tick()
                setStake(s)
              }}
              className={cn(
                'min-h-14 rounded-card border-[3px] border-ink font-display text-xl font-extrabold shadow-sticker-sm active:scale-95',
                stake === s ? 'bg-sun text-[#1f1b2e]' : 'bg-surface',
                off && 'opacity-40',
              )}
            >
              {s} 🪙
            </button>
          )
        })}
      </div>
      {budget < WAGER_STAKES[0] ? (
        <p className="text-center font-bold text-muted">Pas assez de pièces pour miser (il en faut 10). Joue une partie ! 🎲</p>
      ) : (
        <Button size="lg" fullWidth loading={busy} disabled={!pick || stake > budget} onClick={() => void submit()}>
          {pick ? `Je mise ${stake} 🪙 sur ${nick(pick)} (${fmtOdds(odds)})` : 'Choisis un joueur'}
        </Button>
      )}
      {pick && stake <= budget && (
        <p className="text-center text-sm font-bold">
          S’il gagne, tu touches <b>{Math.floor(stake * odds)} 🪙</b>.
        </p>
      )}
      {editing && (
        <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Garder mon pari
        </Button>
      )}
      <OddsHelp />
    </motion.div>
  )
}
