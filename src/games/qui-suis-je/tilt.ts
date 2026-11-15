/**
 * Détection du geste « téléphone sur le front » — logique PURE (aucune API
 * navigateur, testable sous Node : voir test-qui-suis-je-front).
 *
 * Entrée : échantillons DeviceOrientationEvent {t, beta, gamma} (degrés).
 * On en déduit l'inclinaison de l'ÉCRAN par rapport à l'horizontale (« pitch ») :
 * composante verticale de la normale à l'écran, indépendante du mode
 * portrait / paysage et sans la discontinuité de gamma à ±90° :
 *     haut_terrestre_dans_repère_appareil = (-cosβ·sinγ, sinβ, cosβ·cosγ)
 *     pitch = asin(cosβ·cosγ)
 *   ≈ 0°   téléphone vertical sur le front (écran vers les autres) = neutre
 *   < 0    écran qui regarde le sol  → incliné VERS LE BAS  = « found »
 *   > 0    écran qui regarde le plafond → incliné VERS LE HAUT = « pass »
 *
 * Machine à états avec hystérésis :
 *  - on n'est « armé » qu'après `rearmMs` passés en zone neutre (|pitch| ≤ neutralDeg) ;
 *  - armé, un geste est émis quand |pitch| ≥ triggerDeg pendant `holdMs`
 *    (anti-pic) ; on est alors désarmé jusqu'au prochain retour au neutre.
 *  - la zone intermédiaire (neutralDeg < |pitch| < triggerDeg) ne déclenche rien
 *    et ne réarme pas.
 */

export type TiltGesture = 'found' | 'pass'

export interface TiltSample {
  /** Horodatage (ms, monotone). */
  t: number
  beta: number | null
  gamma: number | null
}

export interface TiltConfig {
  /** Seuil de déclenchement (degrés). */
  triggerDeg: number
  /** Zone neutre (degrés) à retrouver entre deux gestes. */
  neutralDeg: number
  /** Durée minimale au-delà du seuil avant de déclencher (ms). */
  holdMs: number
  /** Durée minimale en zone neutre pour (ré)armer (ms). */
  rearmMs: number
}

export const DEFAULT_TILT: TiltConfig = { triggerDeg: 40, neutralDeg: 22, holdMs: 70, rearmMs: 250 }

export interface TiltState {
  armed: boolean
  neutralSince: number | null
  candidate: TiltGesture | null
  candidateSince: number | null
  /** Dernier pitch calculé (degrés) ou null. */
  pitch: number | null
}

export const initialTiltState = (): TiltState => ({ armed: false, neutralSince: null, candidate: null, candidateSince: null, pitch: null })

const RAD = Math.PI / 180

/** Inclinaison de l'écran (degrés, -90..90) ; null si capteur muet. */
export function screenPitch(beta: number | null | undefined, gamma: number | null | undefined): number | null {
  if (beta == null || gamma == null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return null
  const z = Math.cos(beta * RAD) * Math.cos(gamma * RAD)
  return Math.asin(Math.max(-1, Math.min(1, z))) / RAD
}

/** Zone d'un pitch : 'found' (bas), 'pass' (haut), 'neutral' ou 'between'. */
export function tiltZone(pitch: number, cfg: TiltConfig = DEFAULT_TILT): TiltGesture | 'neutral' | 'between' {
  if (pitch <= -cfg.triggerDeg) return 'found'
  if (pitch >= cfg.triggerDeg) return 'pass'
  if (Math.abs(pitch) <= cfg.neutralDeg) return 'neutral'
  return 'between'
}

/** Fait avancer la machine d'un échantillon. Ne modifie pas `state`. */
export function stepTilt(state: TiltState, sample: TiltSample, cfg: TiltConfig = DEFAULT_TILT): { state: TiltState; gesture: TiltGesture | null } {
  const pitch = screenPitch(sample.beta, sample.gamma)
  if (pitch == null) return { state, gesture: null }
  const zone = tiltZone(pitch, cfg)
  const t = sample.t

  if (!state.armed) {
    if (zone === 'neutral') {
      const since = state.neutralSince ?? t
      const armed = t - since >= cfg.rearmMs
      return { state: { armed, neutralSince: since, candidate: null, candidateSince: null, pitch }, gesture: null }
    }
    return { state: { armed: false, neutralSince: null, candidate: null, candidateSince: null, pitch }, gesture: null }
  }

  if (zone === 'found' || zone === 'pass') {
    const since = state.candidate === zone && state.candidateSince != null ? state.candidateSince : t
    if (t - since >= cfg.holdMs) {
      return { state: { armed: false, neutralSince: null, candidate: null, candidateSince: null, pitch }, gesture: zone }
    }
    return { state: { ...state, candidate: zone, candidateSince: since, pitch }, gesture: null }
  }
  return { state: { ...state, candidate: null, candidateSince: null, pitch }, gesture: null }
}

/** Tous les gestes d'une suite d'échantillons. */
export function detectTiltAll(samples: TiltSample[], cfg: TiltConfig = DEFAULT_TILT, from: TiltState = initialTiltState()): Array<{ t: number; gesture: TiltGesture }> {
  let st = from
  const out: Array<{ t: number; gesture: TiltGesture }> = []
  for (const s of samples) {
    const r = stepTilt(st, s, cfg)
    st = r.state
    if (r.gesture) out.push({ t: s.t, gesture: r.gesture })
  }
  return out
}

/** Premier geste d'une suite d'échantillons : 'found' | 'pass' | null. */
export function detectTilt(samples: TiltSample[], cfg: TiltConfig = DEFAULT_TILT, from: TiltState = initialTiltState()): TiltGesture | null {
  return detectTiltAll(samples, cfg, from)[0]?.gesture ?? null
}
