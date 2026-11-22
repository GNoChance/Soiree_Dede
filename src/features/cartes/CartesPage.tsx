import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import { Pencil, Trash2, EyeOff, Eye } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { usePlayers } from '@/features/soiree/players'
import { toastError } from '@/features/soiree/errors'
import { AOV_LEVELS, KIND_INFO } from '@/games/action-ou-verite/setup'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'
import { AuthorBadge } from './AuthorBadge'
import {
  type CardGame,
  type CardKind,
  type CardPayload,
  type CustomCard,
  createCard,
  deleteCard,
  fetchCards,
  hideCard,
  updateCard,
} from './api'

const GAME_INFO: Record<CardGame, { name: string; emoji: string; color: string; hint: string }> = {
  'tu-preferes': { name: 'Tu préfères ?', emoji: '🤔', color: '#C4B5FD', hint: 'Deux choix impossibles' },
  'action-ou-verite': { name: 'Action ou vérité', emoji: '🎯', color: '#FF8FA3', hint: 'Défis et questions gênantes' },
  'qui-de-nous': { name: 'Qui de nous ?', emoji: '🫵', color: '#FFB703', hint: 'Désigne le coupable' },
}
const GAME_IDS = Object.keys(GAME_INFO) as CardGame[]
const isGame = (v: string | null): v is CardGame => !!v && v in GAME_INFO

const MAX = { dilemma: 120, text: 300, question: 200 }
const QDN_PREFIX = 'Qui de nous '

/* -------------------------------------------------------------------------- */
/* Aperçu d'une carte, au style du jeu                                         */
/* -------------------------------------------------------------------------- */

function CardPreview({ card, compact }: { card: Pick<CustomCard, 'game_id' | 'kind' | 'payload'>; compact?: boolean }) {
  const p = card.payload
  const size = compact ? 'text-base' : 'text-xl'
  const base = 'rounded-card border-[3px] border-ink p-3 font-display leading-tight font-extrabold break-words text-[#1f1b2e] shadow-sticker-sm'
  if (card.game_id === 'tu-preferes') {
    return (
      <div className="flex flex-col gap-2">
        <div className={cn(base, size)} style={{ backgroundColor: '#4CC9F0' }}>
          <span className="mr-1 text-xs opacity-70">A</span>
          {String(p.a ?? '') || '…'}
        </div>
        <div className="text-center font-display text-sm font-extrabold text-muted">ou</div>
        <div className={cn(base, size)} style={{ backgroundColor: '#FF8FA3' }}>
          <span className="mr-1 text-xs opacity-70">B</span>
          {String(p.b ?? '') || '…'}
        </div>
      </div>
    )
  }
  if (card.game_id === 'action-ou-verite') {
    const info = KIND_INFO[card.kind === 'verite' ? 'verite' : 'action']
    const lvl = AOV_LEVELS.find((l) => l.id === Number(p.level)) ?? AOV_LEVELS[0]
    return (
      <div className={cn(base, 'flex flex-col gap-1', info.text)} style={{ backgroundColor: info.color }}>
        <span className="text-xs tracking-wide">
          {info.emoji} {info.label} · {lvl.emoji} {lvl.label}
        </span>
        <span className={size}>{String(p.text ?? '') || '…'}</span>
      </div>
    )
  }
  return (
    <div className={cn(base, size)} style={{ backgroundColor: '#FFB703' }}>
      {String(p.text ?? '') || '…'}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Formulaire                                                                  */
/* -------------------------------------------------------------------------- */

interface FormState {
  a: string
  b: string
  text: string
  kind: 'action' | 'verite'
  level: 1 | 2 | 3
}
const EMPTY: FormState = { a: '', b: '', text: '', kind: 'action', level: 2 }

function Field({ label, value, onChange, max, placeholder, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; max: number; placeholder: string; rows?: number }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-display text-lg font-extrabold">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, max))}
        rows={rows}
        placeholder={placeholder}
        className="w-full resize-none rounded-card border-[3px] border-ink bg-surface p-3 text-lg leading-snug text-text shadow-sticker-sm outline-none placeholder:text-muted focus:bg-sunk"
      />
      <span className="self-end text-xs font-bold text-muted">
        {value.length}/{max}
      </span>
    </label>
  )
}

function CardForm({ game, editing, onDone, onSaved }: { game: CardGame; editing: CustomCard | null; onDone: () => void; onSaved: (c: CustomCard, isNew: boolean) => void }) {
  const [f, setF] = useState<FormState>(EMPTY)
  const [busy, setBusy] = useState(false)

  // Charge la carte à modifier, ou repart d'un formulaire neuf quand le jeu change.
  useEffect(() => {
    if (editing) {
      const p = editing.payload
      setF({
        a: String(p.a ?? ''),
        b: String(p.b ?? ''),
        text: String(p.text ?? ''),
        kind: editing.kind === 'verite' ? 'verite' : 'action',
        level: ([1, 2, 3].includes(Number(p.level)) ? Number(p.level) : 2) as 1 | 2 | 3,
      })
    } else {
      setF({ ...EMPTY, text: game === 'qui-de-nous' ? QDN_PREFIX : '' })
    }
  }, [editing, game])

  const set = (patch: Partial<FormState>) => setF((s) => ({ ...s, ...patch }))
  const kind: CardKind = game === 'tu-preferes' ? 'dilemma' : game === 'qui-de-nous' ? 'question' : f.kind
  const payload: CardPayload =
    game === 'tu-preferes'
      ? { a: f.a.trim(), b: f.b.trim() }
      : game === 'qui-de-nous'
        ? { text: finishQuestion(f.text) }
        : { text: f.text.trim(), level: f.level }
  const valid =
    game === 'tu-preferes'
      ? f.a.trim().length >= 2 && f.b.trim().length >= 2
      : game === 'qui-de-nous'
        ? f.text.trim().length > QDN_PREFIX.trim().length + 3
        : f.text.trim().length >= 5

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true)
    try {
      const saved = editing ? await updateCard(editing.id, payload) : await createCard(game, kind, payload)
      fx.pop()
      toast.success(editing ? 'Carte modifiée ✓' : 'Carte ajoutée ! Elle va entrer dans les parties ✍️')
      onSaved(saved, !editing)
      setF({ ...EMPTY, text: game === 'qui-de-nous' ? QDN_PREFIX : '', kind: f.kind, level: f.level })
      if (editing) onDone()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const info = GAME_INFO[game]
  return (
    <Card className="flex flex-col gap-4" accent={undefined}>
      <h2 className="text-2xl">
        {editing ? 'Modifier la carte' : 'Nouvelle carte'} {info.emoji}
      </h2>

      {game === 'tu-preferes' && (
        <>
          <Field label="Tu préfères… (A)" value={f.a} onChange={(v) => set({ a: v })} max={MAX.dilemma} placeholder="manger une pizza à l’ananas tous les jours" />
          <Field label="…ou (B)" value={f.b} onChange={(v) => set({ b: v })} max={MAX.dilemma} placeholder="ne plus jamais manger de pizza" />
        </>
      )}

      {game === 'action-ou-verite' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {(['action', 'verite'] as const).map((k) => {
              const on = f.kind === k
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    fx.tick()
                    set({ kind: k })
                  }}
                  aria-pressed={on}
                  className={cn(
                    'min-h-14 rounded-card border-[3px] border-ink font-display text-xl font-extrabold shadow-sticker-sm transition-colors',
                    on ? KIND_INFO[k].text : 'bg-sunk text-muted opacity-70 shadow-none',
                  )}
                  style={on ? { backgroundColor: KIND_INFO[k].color } : undefined}
                >
                  {KIND_INFO[k].emoji} {KIND_INFO[k].label}
                </button>
              )
            })}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {AOV_LEVELS.map((l) => {
              const on = f.level === l.id
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    fx.tick()
                    set({ level: l.id })
                  }}
                  aria-pressed={on}
                  className={cn(
                    'flex flex-col items-center rounded-card border-[3px] border-ink px-1 py-2 font-display font-extrabold shadow-sticker-sm transition-colors',
                    on ? 'text-[#1f1b2e]' : 'bg-sunk text-muted opacity-70 shadow-none',
                  )}
                  style={on ? { backgroundColor: l.color } : undefined}
                >
                  <span className="text-2xl">{l.emoji}</span>
                  <span className="text-base">{l.label}</span>
                </button>
              )
            })}
          </div>
          <Field
            label={f.kind === 'action' ? 'Le défi à relever' : 'La question gênante'}
            value={f.text}
            onChange={(v) => set({ text: v })}
            max={MAX.text}
            rows={3}
            placeholder={f.kind === 'action' ? 'Imite Dédé quand il rate sa partie de Kart.' : 'Quelle est ta pire excuse pour ne pas venir à une soirée ?'}
          />
        </>
      )}

      {game === 'qui-de-nous' && (
        <Field label="La question" value={f.text} onChange={(v) => set({ text: v })} max={MAX.question} rows={3} placeholder="Qui de nous finirait le gâteau en cachette ?" />
      )}

      <div className="flex flex-col gap-2">
        <span className="font-display text-sm font-extrabold text-muted">Aperçu</span>
        <CardPreview card={{ game_id: game, kind, payload }} />
      </div>

      <div className="flex gap-3">
        {editing && (
          <Button variant="secondary" onClick={onDone} className="flex-1">
            Annuler
          </Button>
        )}
        <Button onClick={submit} disabled={!valid} loading={busy} size="lg" className="flex-[2]">
          {editing ? 'Enregistrer' : 'Ajouter la carte'}
        </Button>
      </div>
    </Card>
  )
}

/** « Qui de nous … » : ajoute le « ? » final s'il manque. */
function finishQuestion(t: string): string {
  const s = t.trim().replace(/\s+/g, ' ')
  return /[?!.]$/.test(s) ? s : `${s} ?`
}

/* -------------------------------------------------------------------------- */
/* Page                                                                        */
/* -------------------------------------------------------------------------- */

export function CartesPage() {
  const [params, setParams] = useSearchParams()
  const profile = useSession((s) => s.profile)
  const me = profile?.id
  const isAdmin = !!(profile as { is_admin?: boolean } | null)?.is_admin
  const { byId } = usePlayers()
  const [cards, setCards] = useState<CustomCard[] | null>(null)
  const [game, setGame] = useState<CardGame>(() => {
    const j = params.get('jeu')
    return isGame(j) ? j : 'tu-preferes'
  })
  const [editing, setEditing] = useState<CustomCard | null>(null)
  const [filterGame, setFilterGame] = useState<CardGame | 'all'>('all')
  const [filterAuthor, setFilterAuthor] = useState<string>('all')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setCards(await fetchCards())
    } catch (e) {
      toastError(e)
      setCards((c) => c ?? [])
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const pickGame = (g: CardGame) => {
    fx.pop()
    setGame(g)
    setEditing(null)
    setParams({ jeu: g }, { replace: true })
  }

  const mine = useMemo(() => (cards ?? []).filter((c) => c.author_id === me).length, [cards, me])
  const authors = useMemo(() => [...new Set((cards ?? []).map((c) => c.author_id))], [cards])
  const shown = useMemo(
    () =>
      (cards ?? []).filter(
        (c) => (filterGame === 'all' || c.game_id === filterGame) && (filterAuthor === 'all' || c.author_id === filterAuthor),
      ),
    [cards, filterGame, filterAuthor],
  )

  const onSaved = (c: CustomCard, isNew: boolean) => {
    setCards((prev) => (isNew ? [c, ...(prev ?? [])] : (prev ?? []).map((x) => (x.id === c.id ? c : x))))
  }

  const remove = async (c: CustomCard) => {
    if (confirmDel !== c.id) {
      fx.tick()
      setConfirmDel(c.id)
      return
    }
    try {
      await deleteCard(c.id)
      setCards((prev) => (prev ?? []).filter((x) => x.id !== c.id))
      if (editing?.id === c.id) setEditing(null)
      setConfirmDel(null)
      toast.success('Carte supprimée')
    } catch (e) {
      toastError(e)
    }
  }

  const toggleHidden = async (c: CustomCard) => {
    try {
      await hideCard(c.id, !c.hidden)
      setCards((prev) => (prev ?? []).map((x) => (x.id === c.id ? { ...x, hidden: !c.hidden } : x)))
    } catch (e) {
      toastError(e)
    }
  }

  const chip = (on: boolean) =>
    cn(
      'rounded-full border-2 border-ink px-3 py-1 font-display text-sm font-extrabold transition-colors',
      on ? 'bg-sun text-[#1f1b2e] shadow-sticker-sm' : 'bg-surface text-text',
    )

  return (
    <div className="flex flex-col gap-4 pb-6">
      <div>
        <h1 className="text-3xl">✍️ Mes cartes</h1>
        <p className="text-base text-muted">
          Écris tes blagues internes : elles entrent dans les parties de toute la bande !
          {me ? ` (${mine}/200 cartes écrites par toi)` : ''}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {GAME_IDS.map((g) => {
          const info = GAME_INFO[g]
          const on = game === g
          return (
            <motion.button
              key={g}
              type="button"
              whileTap={{ scale: 0.9, rotate: -3 }}
              onClick={() => pickGame(g)}
              aria-pressed={on}
              className={cn(
                'flex flex-col items-center gap-0.5 rounded-card border-[3px] border-ink px-1 py-2 text-center font-display font-extrabold text-[#1f1b2e] transition-all',
                on ? 'shadow-sticker' : 'opacity-60 saturate-50',
              )}
              style={{ backgroundColor: info.color }}
            >
              <span className="text-3xl">{info.emoji}</span>
              <span className="text-sm leading-tight">{info.name}</span>
            </motion.button>
          )
        })}
      </div>

      <CardForm game={game} editing={editing && editing.game_id === game ? editing : null} onDone={() => setEditing(null)} onSaved={onSaved} />

      <div className="flex flex-col gap-3">
        <h2 className="text-2xl">Les cartes de la bande</h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={chip(filterGame === 'all')} onClick={() => setFilterGame('all')}>
            Tous les jeux
          </button>
          {GAME_IDS.map((g) => (
            <button key={g} type="button" className={chip(filterGame === g)} onClick={() => setFilterGame(g)}>
              {GAME_INFO[g].emoji} {GAME_INFO[g].name}
            </button>
          ))}
        </div>
        {authors.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={chip(filterAuthor === 'all')} onClick={() => setFilterAuthor('all')}>
              Tout le monde
            </button>
            {authors.map((a) => (
              <button key={a} type="button" className={chip(filterAuthor === a)} onClick={() => setFilterAuthor(a)}>
                {a === me ? 'Moi' : (byId[a]?.nickname ?? '…')}
              </button>
            ))}
          </div>
        )}

        {cards === null && <p className="text-muted">Chargement…</p>}
        {cards !== null && shown.length === 0 && (
          <Card className="text-center">
            <p className="text-lg font-bold">Aucune carte ici pour l’instant.</p>
            <p className="text-muted">Écris la première, c’est juste au-dessus ☝️</p>
          </Card>
        )}

        {shown.map((c) => {
          const own = c.author_id === me
          return (
            <Card key={c.id} className={cn('flex flex-col gap-2', c.hidden && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral" tilted={false}>
                  {GAME_INFO[c.game_id].emoji} {GAME_INFO[c.game_id].name}
                </Badge>
                <AuthorBadge by={c.author_id} />
                {c.hidden && <Badge tone="tomato" tilted={false}>Masquée</Badge>}
              </div>
              <CardPreview card={c} compact />
              {(own || isAdmin) && (
                <div className="flex flex-wrap gap-2">
                  {own && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Pencil className="size-4" />}
                      onClick={() => {
                        setGame(c.game_id)
                        setEditing(c)
                        setConfirmDel(null)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                    >
                      Modifier
                    </Button>
                  )}
                  {isAdmin && !own && (
                    <Button size="sm" variant="secondary" icon={c.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />} onClick={() => void toggleHidden(c)}>
                      {c.hidden ? 'Réafficher' : 'Masquer'}
                    </Button>
                  )}
                  <Button size="sm" variant="danger" icon={<Trash2 className="size-4" />} onClick={() => void remove(c)}>
                    {confirmDel === c.id ? 'Sûr ? Supprimer' : 'Supprimer'}
                  </Button>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
