import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { cn } from '@/lib/cn'
import type { GameOptionsProps } from '../types'
import { BOARDS, MAP_IDS, SIZED, SIZE_LABEL, sizeFor, type MapId, type SizeId } from './board'
import { BoardThumb } from './BoardThumb'
import { effectiveBots } from './bots'
import { DP_DURATION, DP_ROUNDS, normalizeOptions, type DpMapChoice } from './setup'

/** Pastille de format d'un plateau selon le nombre de joueurs du salon (rien en format classique). */
function sizePill(map: MapId, players: number): string | null {
  const size = sizeFor(map, players)
  const b = SIZED[map][size]
  if (size === 's' || !b) return null
  const extra = size === 'l' ? (map === 'ski' ? 'tout le domaine, jusqu’au Pic' : 'l’archipel au complet') : `${b.quarters.length} quartiers en plus`
  return `${SIZE_LABEL[size]} · ${b.cells.length} cases · ${extra}`
}

/** Format « Au hasard » : le plus grand format que le tirage peut donner (selon le nombre de joueurs). */
function randomPill(players: number): string | null {
  const sizes: SizeId[] = MAP_IDS.map((id) => sizeFor(id, players))
  const top = sizes.includes('l') ? 'l' : sizes.includes('m') ? 'm' : null
  if (top === 'm') return SIZE_LABEL.m
  // À 7-8 joueurs, seuls la mer et le ski passent en format géant.
  return top === 'l' ? `${SIZE_LABEL.m}, géant sur ${MAP_IDS.filter((id) => sizeFor(id, players) === 'l').map((id) => BOARDS[id].emoji).join(' et ')}` : null
}

/** Options (hôte) : plateau (défaut « Au hasard »), durée de l'émission + rappel du mode télé. */
export function DedePartyOptions({ options, onChange, playerCount: humans }: GameOptionsProps) {
  const o = normalizeOptions(options)
  const bots = effectiveBots(o.bots, humans)
  // les bots comptent comme des joueurs (taille du plateau, nombre d'étoiles)
  const playerCount = humans + bots
  const maxBots = Math.max(0, 8 - humans)
  const pick = (map: DpMapChoice) => onChange({ ...options, map })
  const card = (selected: boolean) =>
    cn(
      'flex min-h-[72px] flex-col items-start gap-1 rounded-card border-[3px] border-ink px-2.5 py-2 text-left leading-tight transition-transform active:scale-95',
      selected ? 'bg-sun text-[#1f1b2e] shadow-sticker' : 'bg-surface shadow-sticker-sm',
    )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Plateau</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plateau">
          {MAP_IDS.map((id) => {
            const b = BOARDS[id]
            const on = o.map === id
            return (
              <button key={id} type="button" role="radio" aria-checked={on} className={card(on)} onClick={() => pick(id)}>
                <span className="flex w-full items-center gap-1.5">
                  <span className="text-2xl leading-none">{b.emoji}</span>
                  <span className="min-w-0 flex-1 font-display text-base font-extrabold">{b.name}</span>
                </span>
                <BoardThumb board={b} className="h-10 w-auto self-center" />
                <span className={cn('text-xs font-bold', on ? 'opacity-80' : 'text-muted')}>{b.pitch}</span>
                <FormatPill text={sizePill(id, playerCount)} />
              </button>
            )
          })}
          <button type="button" role="radio" aria-checked={o.map === 'random'} className={card(o.map === 'random')} onClick={() => pick('random')}>
            <span className="flex w-full items-center gap-1.5">
              <span className="text-2xl leading-none">🎲</span>
              <span className="font-display text-base font-extrabold">Au hasard</span>
            </span>
            <span className="self-center text-2xl leading-none" aria-hidden>
              {MAP_IDS.map((id) => BOARDS[id].emoji).join('')}
            </span>
            <span className={cn('text-xs font-bold', o.map === 'random' ? 'opacity-80' : 'text-muted')}>Surprise : l’un des 5, jamais le même que la dernière fois.</span>
            <FormatPill text={randomPill(playerCount)} />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <span className="font-display text-lg font-extrabold">Durée</span>
        <SegmentedControl
          ariaLabel="Durée"
          value={String(o.rounds)}
          onChange={(v) => onChange({ ...options, rounds: Number(v) })}
          options={DP_ROUNDS.map((r) => ({ value: String(r), label: DP_DURATION[r].label }))}
        />
        <p className="text-sm text-muted">
          {o.rounds} tours ({DP_DURATION[o.rounds].minutes}) : un lancer de dé et un mini-jeu à chaque tour. Le plus d’étoiles gagne !
        </p>
      </div>
      {maxBots > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-display text-lg font-extrabold">🤖 Bots</span>
          <SegmentedControl
            ariaLabel="Bots"
            value={String(bots)}
            onChange={(v) => onChange({ ...options, bots: Number(v) })}
            options={Array.from({ length: Math.min(maxBots, 4) + 1 }, (_, k) => k)
              .filter((k) => k >= 2 - humans)
              .map((k) => ({ value: String(k), label: k ? String(k) : 'Aucun' }))}
          />
          <p className="text-sm text-muted">
            {bots
              ? `${bots} bot${bots > 1 ? 's' : ''} lance${bots > 1 ? 'nt' : ''} les dés et joue${bots > 1 ? 'nt' : ''} les mini-jeux tout seul${bots > 1 ? 's' : ''}. Ils ne gagnent pas d’XP.`
              : 'Que des vrais joueurs.'}
          </p>
        </div>
      )}
      <div className="sticker-sm flex items-center gap-3 bg-sky/20 px-3 py-2">
        <span className="text-3xl">📺</span>
        <p className="text-sm font-bold leading-tight">Mets la télé pour le plateau en grand : bouton « Mode télé » une fois la partie lancée. Sans télé, chaque téléphone montre aussi le plateau.</p>
      </div>
    </div>
  )
}

function FormatPill({ text }: { text: string | null }) {
  if (!text) return null
  return <span className="rounded-chip border-2 border-ink bg-grape px-1.5 py-0.5 text-[11px] leading-tight font-extrabold text-white">🗺️ {text}</span>
}
