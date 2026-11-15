import confetti from 'canvas-confetti'

const COLORS = ['#FFB703', '#EF476F', '#06D6A0', '#4CC9F0', '#8B5CF6', '#FF8FA3', '#FB8500']
const base = { colors: COLORS, disableForReducedMotion: true, zIndex: 100 }

/** Explosion ponctuelle (origin 0..1, defaut : centre-bas). */
export function burst(origin: { x: number; y: number } = { x: 0.5, y: 0.7 }, particleCount = 90) {
  void confetti({ ...base, particleCount, spread: 75, startVelocity: 45, origin })
}

/** Canons gauche + droite pendant `ms` : victoire. */
export function victoryConfetti(ms = 1800) {
  const end = Date.now() + ms
  const frame = () => {
    void confetti({ ...base, particleCount: 5, angle: 60, spread: 60, origin: { x: 0, y: 0.8 } })
    void confetti({ ...base, particleCount: 5, angle: 120, spread: 60, origin: { x: 1, y: 0.8 } })
    if (Date.now() < end) requestAnimationFrame(frame)
  }
  frame()
  burst({ x: 0.5, y: 0.5 }, 140)
}

/** Pluie de confettis du haut de l'ecran. */
export function confettiRain(ms = 2500) {
  const end = Date.now() + ms
  const frame = () => {
    void confetti({ ...base, particleCount: 3, startVelocity: 18, spread: 160, angle: 270, gravity: 0.7, origin: { x: Math.random(), y: -0.1 } })
    if (Date.now() < end) requestAnimationFrame(frame)
  }
  frame()
}

/** Confettis partant d'un element DOM (ex: bouton). */
export function burstFrom(el: Element, particleCount = 50) {
  const r = el.getBoundingClientRect()
  burst({ x: (r.left + r.width / 2) / window.innerWidth, y: (r.top + r.height / 2) / window.innerHeight }, particleCount)
}
