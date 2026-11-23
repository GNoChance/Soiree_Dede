import { useState } from 'react'
import { motion } from 'framer-motion'
import { Hand, Send, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/features/soiree/errors'
import { TEAM_INFO } from '@/features/teams/teams'
import type { GamePlayProps } from '../types'
import { clueProblem, guessersOf, majority, myRole } from './logic'
import { ndcActions } from './setup'
import type { NdcState } from './types'

/**
 * Zone au-dessus de la grille : l'espion actif tape son indice (phase clue) ;
 * en phase guess, l'indice en grand, les essais, la majorité et « Stop, on passe ».
 */
export function CluePanel({ s, meId, act, pending }: { s: NdcState; meId: string; act: GamePlayProps['act']; pending: boolean }) {
  const role = myRole(s, meId)
  const active = TEAM_INFO[s.turn]
  const isActiveSpy = role.spy && role.team === s.turn
  const isActiveGuesser = role.team === s.turn && !role.spy
  const guessers = guessersOf(s, s.turn)
  const need = majority(guessers.length)
  const [aideDev, closeAideDev] = useAide('devineurs')

  return (
    <div className="flex flex-col gap-2">
      {s.phase === 'clue' && (isActiveSpy ? <ClueForm s={s} act={act} pending={pending} /> : (
        <p className="sticker rounded-card bg-surface p-3 text-center font-display text-lg font-extrabold">
          🕵️ {role.team === s.turn ? 'Votre espion' : `L’espion des ${active.short}`} cherche un indice…
        </p>
      ))}

      {s.phase === 'guess' && s.clue && (
        <motion.div
          key={`${s.clue.word}-${s.clue.n}`}
          initial={{ scale: 0.7, rotate: -3 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 12 }}
          className="sticker flex flex-col items-center gap-1 rounded-card p-3 text-center"
          style={{ backgroundColor: active.soft, color: '#1f1b2e' }}
        >
          {/* Indice long : la taille diminue et le mot passe à la ligne (jamais de débordement). */}
          <p className={cn('max-w-full font-display font-extrabold uppercase leading-tight [overflow-wrap:anywhere]', clueSize(s.clue.word))}>
            🔎 {s.clue.word} <span className="whitespace-nowrap">· {s.clue.n}</span>
          </p>
          <p className="text-sm font-bold">
            {active.emoji} Les {active.short} devinent · {s.guesses_left} essai{s.guesses_left > 1 ? 's' : ''} restant{s.guesses_left > 1 ? 's' : ''}
          </p>
        </motion.div>
      )}

      {s.phase === 'guess' && isActiveGuesser && aideDev && (
        <div className="rounded-chip border-[3px] border-ink bg-sun/30 p-2 text-sm leading-snug font-bold">
          <p>Touche un mot pour y poser ta tête. Quand la majorité de l’équipe est d’accord sur le même mot, il se retourne.</p>
          <p>Plus d’idée ? Appuie sur « Stop, on passe ».</p>
          <button type="button" onClick={closeAideDev} className="mt-1 font-display font-extrabold underline">J’ai compris</button>
        </div>
      )}

      {s.phase === 'guess' && isActiveGuesser && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-bold">
            {s.votes[meId] === undefined ? 'Touche un mot pour y poser ta tête.' : `Il faut ${need} tête${need > 1 ? 's' : ''} sur un mot pour le dévoiler.`}
          </p>
          <Button
            variant="secondary"
            size="sm"
            icon={<Hand className="size-4" />}
            disabled={s.turn_found === 0 || pending}
            onClick={() => void act(ndcActions.stop())}
            className={cn(s.stop.includes(meId) && 'ring-4 ring-sun')}
          >
            Stop, on passe ({s.stop.length}/{need})
          </Button>
        </div>
      )}
    </div>
  )
}

/** Taille de l'indice affiché en grand selon sa longueur (24 caractères max). */
function clueSize(word: string): string {
  const n = word.length
  return n <= 8 ? 'text-3xl' : n <= 12 ? 'text-2xl' : n <= 17 ? 'text-xl' : 'text-lg'
}

/**
 * Bouton de l'hôte « Passer le tour », placé sous la grille (loin de « Stop, on passe ») et
 * protégé par une confirmation : un tap par erreur ne fait plus perdre son tour à une équipe.
 */
export function SkipTurn({ act, pending }: { act: GamePlayProps['act']; pending: boolean }) {
  const [ask, setAsk] = useState(false)
  return (
    <div className="mt-4 flex justify-center">
      <Button variant="ghost" size="sm" icon={<SkipForward className="size-4" />} disabled={pending} onClick={() => setAsk(true)}>
        Passer le tour (hôte)
      </Button>
      <Modal open={ask} onClose={() => setAsk(false)} title="Passer le tour ?">
        <p className="mb-4 text-base font-bold">L’équipe qui joue perd son tour : c’est à l’équipe suivante de jouer.</p>
        <div className="flex flex-col gap-2">
          <Button
            fullWidth
            variant="danger"
            icon={<SkipForward className="size-5" />}
            disabled={pending}
            onClick={() => {
              setAsk(false)
              void act(ndcActions.skip())
            }}
          >
            Oui, on passe
          </Button>
          <Button fullWidth variant="secondary" onClick={() => setAsk(false)}>
            Non, on continue
          </Button>
        </div>
      </Modal>
    </div>
  )
}

/** Aide « premières fois » : visible tant que l'aide n'a pas été fermée (clé dede:aide:nom-de-code:<aide>). */
function useAide(name: string): [boolean, () => void] {
  const key = 'dede:aide:nom-de-code:' + name
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== 'ok'
    } catch {
      return true
    }
  })
  const close = () => {
    setOpen(false)
    try {
      localStorage.setItem(key, 'ok')
    } catch {
      /* sans stockage : l'aide reste refermable pour la session */
    }
  }
  return [open, close]
}

function ClueForm({ s, act, pending }: { s: NdcState; act: GamePlayProps['act']; pending: boolean }) {
  const [word, setWord] = useState('')
  const [n, setN] = useState<number | null>(null)
  const [aide, closeAide] = useAide('indice')
  const problem = word.trim() ? clueProblem(word, n ?? 1, s) : null
  const send = async () => {
    if (n === null || problem) return
    const r = await act(ndcActions.clue(word.trim(), n))
    if (r) {
      setWord('')
      setN(null)
    }
  }
  return (
    <div className="sticker flex flex-col gap-2 rounded-card bg-surface p-3">
      <p className="font-display text-lg font-extrabold">🕵️ À toi ! Un mot pour relier plusieurs mots de ton équipe</p>
      {aide && (
        <div className="rounded-chip border-[3px] border-ink bg-sun/30 p-2 text-sm leading-snug font-bold">
          <p>Exemple : la grille a POMME, BANANE, CERISE → écris « FRUIT » et choisis 3.</p>
          <p>Autre exemple : LUNE et SOLEIL → « CIEL », 2.</p>
          <p>Interdit : un mot qui est écrit sur la grille.</p>
          <button type="button" onClick={closeAide} className="mt-1 font-display font-extrabold underline">J’ai compris</button>
        </div>
      )}
      <input
        value={word}
        onChange={(e) => setWord(e.target.value)}
        maxLength={24}
        placeholder="Ton indice…"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="done"
        className="h-14 w-full rounded-chip border-[3px] border-ink bg-surface px-3 font-display text-2xl font-extrabold text-text outline-none placeholder:text-base placeholder:text-muted focus:ring-4 focus:ring-sun"
      />
      {problem && <p className="text-sm font-bold text-tomato">{errorMessage(new Error(problem))}</p>}
      <p className="text-sm font-bold">Combien de mots ?</p>
      <div className="grid grid-cols-9 gap-1">
        {Array.from({ length: 9 }, (_, i) => i + 1).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setN(k)}
            className={cn('h-11 rounded-chip border-[3px] border-ink font-display text-lg font-extrabold', n === k ? 'bg-sun text-[#1f1b2e]' : 'bg-sunk text-text')}
          >
            {k}
          </button>
        ))}
      </div>
      <Button fullWidth icon={<Send className="size-5" />} disabled={!word.trim() || n === null || Boolean(problem) || pending} onClick={() => void send()}>
        Envoyer l’indice
      </Button>
    </div>
  )
}
