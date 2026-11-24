import { motion } from 'framer-motion'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { useNoelState } from './api'
import { BandBar } from './BandGauge'
import { Flakes, MissionList, StreakLine, hotteButtonLabel } from './NoelParts'

/** Carte « Noël chez Dédé » en tête de l'accueil (pendant l'événement et la semaine qui suit). */
export function NoelHubCard() {
  const navigate = useNavigate()
  const { state: st } = useNoelState()
  if (!st || (st.phase !== 'live' && st.phase !== 'over')) return null
  const todo = st.missions.filter((m) => !m.done).length
  return (
    <motion.div
      initial={{ scale: 0.95, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="sticker relative flex flex-col gap-3 overflow-hidden rounded-card bg-surface"
    >
      <button
        type="button"
        onClick={() => navigate('/noel')}
        className="relative overflow-hidden bg-[linear-gradient(135deg,#C1121F,#9D0208_55%,#2D6A4F)] p-4 text-left text-white"
      >
        <Flakes count={6} />
        <p className="relative font-display text-2xl font-extrabold">🎄 Noël chez Dédé</p>
        <p className="relative text-sm font-bold text-white/90">
          {st.phase === 'over'
            ? 'C’est fini ! Va voir ton pass et la Grande Hotte.'
            : todo > 0
              ? `${todo} mission${todo > 1 ? 's' : ''} t’attend${todo > 1 ? 'ent' : ''} aujourd’hui`
              : 'Toutes les missions du jour sont faites, bravo ! 🎉'}
        </p>
      </button>
      {st.phase === 'live' && (
        <div className="flex flex-col gap-3 px-4">
          <MissionList st={st} link />
          <Button size="lg" fullWidth onClick={() => navigate('/noel/hotte')}>
            {hotteButtonLabel(st)}
          </Button>
        </div>
      )}
      <button type="button" onClick={() => navigate('/noel')} className="flex flex-col gap-2 px-4 pb-4 text-left">
        <div className="flex items-center justify-between gap-2">
          <StreakLine st={st} />
          <span className="font-display font-extrabold">Palier {st.tier}/30</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold">🛷</span>
          <div className="flex-1">
            <BandBar total={st.band.total} compact />
          </div>
        </div>
      </button>
    </motion.div>
  )
}
