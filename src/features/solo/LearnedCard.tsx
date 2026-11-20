import { useState } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import type { Character } from '@/data/characters'
import { pickExpression } from '@/features/soiree/players'
import type { Insight } from './memory'
import { eOf, insightText } from './why/voice'

/**
 * « 🧠 Ce que {Perso} sait de toi » (écran de choix) : au plus 3 habitudes, les plus nettes,
 * 🎯 = il s'en sert, 👀 = il le sait seulement. Niveaux 1-2 et frein : tout en 👀.
 * « Oublier 🧽 » efface la mémoire de ce jeu (avec confirmation).
 */
export function LearnedCard({ bot, insights, rate, known, onForget }: { bot: Character; insights: Insight[]; rate: number; known: boolean; onForget: () => void }) {
  const [ask, setAsk] = useState(false)
  const top = insights.slice(0, 3)
  const she = eOf(bot.slug) === 'e'
  return (
    <section className="flex flex-col gap-2 rounded-card border-[3px] border-ink bg-surface p-3 shadow-sticker-sm" aria-label={`Ce que ${bot.nickname} sait de toi`}>
      <div className="flex items-center gap-2">
        <Avatar slug={bot.slug} tenue="default" expression={pickExpression(bot, top.length ? 'reflexion' : 'clin_oeil')} size={44} />
        <h2 className="min-w-0 flex-1 font-display text-lg leading-tight font-extrabold">🧠 Ce que {bot.nickname} sait de toi</h2>
      </div>
      {top.length === 0 ? (
        <p className="rounded-bubble border-2 border-ink bg-paper px-3 py-2 text-base font-bold">On ne se connaît pas encore !</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {top.map((i, k) => {
            const used = i.use && rate > 0
            return (
              <motion.li
                key={i.id}
                initial={{ x: -10, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.06 * k }}
                className="flex items-start gap-2 rounded-bubble border-2 border-ink bg-paper px-3 py-2 text-base leading-snug font-bold"
              >
                <span className="shrink-0 text-xl leading-none" role="img" aria-label={used ? 'il s’en sert' : 'il le sait'}>
                  {used ? '🎯' : '👀'}
                </span>
                <span>{insightText(bot.slug, i.text)}</span>
              </motion.li>
            )
          })}
        </ul>
      )}
      {top.length > 0 && rate === 0 && (
        <p className="text-sm font-bold text-muted">
          {she ? 'Elle' : 'Il'} le sait… mais {she ? 'elle' : 'il'} fait semblant de rien 😇
        </p>
      )}
      {known && (
        <button type="button" onClick={() => setAsk(true)} className="min-h-10 self-end rounded-chip border-2 border-ink bg-surface px-3 text-sm font-extrabold shadow-sticker-sm active:shadow-none">
          Oublier 🧽
        </button>
      )}
      <Modal open={ask} onClose={() => setAsk(false)} title="Oublier ?">
        <div className="flex flex-col gap-3">
          <p className="text-lg font-bold">Effacer ce que {bot.nickname} sait de toi à ce jeu ?</p>
          <Button
            fullWidth
            onClick={() => {
              setAsk(false)
              onForget()
            }}
          >
            Oui, on repart de zéro
          </Button>
          <Button variant="secondary" fullWidth onClick={() => setAsk(false)}>
            Non
          </Button>
        </div>
      </Modal>
    </section>
  )
}
