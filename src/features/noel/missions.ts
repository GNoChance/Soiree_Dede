/** Missions du jour de l'événement de Noël (ids tirés par le serveur, supabase/features/noel.sql). */
export const NOEL_MISSIONS: Record<string, { label: string; family: 'defi' | 'hotte' | 'surprise' }> = {
  d_finish: { label: 'Termine le défi du jour', family: 'defi' },
  d_400: { label: 'Fais au moins 400 points au défi du jour', family: 'defi' },
  d_beat: { label: 'Fais mieux qu’hier au défi du jour', family: 'defi' },
  d_morning: { label: 'Termine le défi du jour avant midi', family: 'defi' },
  h_play: { label: 'Ouvre la Hotte du jour', family: 'hotte' },
  h_3: { label: 'Au moins 3/5 à la Hotte du jour', family: 'hotte' },
  h_4: { label: 'Au moins 4/5 à la Hotte du jour', family: 'hotte' },
  h_fast: { label: 'Finis la Hotte en moins d’une minute', family: 'hotte' },
  s_advent: { label: 'Ouvre la case du jour du calendrier de l’Avent', family: 'surprise' },
  s_card: { label: 'Crée une carte maison', family: 'surprise' },
  s_challenge: { label: 'Lance un défi à un pote', family: 'surprise' },
  s_shop: { label: 'Achète un article en boutique', family: 'surprise' },
  s_combo: { label: 'Fais le défi du jour ET la Hotte', family: 'surprise' },
  s_d550: { label: 'Fais au moins 550 points au défi du jour', family: 'surprise' },
}

/** Où aller pour faire la mission (bouton de la carte). */
export const NOEL_MISSION_LINK: Record<'defi' | 'hotte' | 'surprise', string> = {
  defi: '/defi',
  hotte: '/noel/hotte',
  surprise: '/noel',
}

export const missionLabel = (id: string) => NOEL_MISSIONS[id]?.label ?? 'Mission surprise'
