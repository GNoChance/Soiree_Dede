/**
 * Caméra : derrière la boule pendant la visée, la suit pendant le roulement,
 * puis plan rapproché sur les quilles ; angle de côté pour le replay.
 * Lissage exponentiel indépendant du framerate.
 */
import * as THREE from 'three'
import { BALL_START_Z, LANE_LEN } from './physics'

export type CamMode = 'aim' | 'follow' | 'pins' | 'replay'

const damp = (k: number, dt: number) => 1 - Math.exp(-k * dt)

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  mode: CamMode = 'aim'
  private pos = new THREE.Vector3()
  private look = new THREE.Vector3()
  private tPos = new THREE.Vector3()
  private tLook = new THREE.Vector3()

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.05, 80)
    this.target('aim', new THREE.Vector3(0, 0, BALL_START_Z))
    this.pos.copy(this.tPos)
    this.look.copy(this.tLook)
    this.apply()
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect
    // Écran étroit (portrait) : champ un peu plus large.
    this.camera.fov = aspect < 0.7 ? 40 : 34
    this.camera.updateProjectionMatrix()
  }

  /** Point focal courant (pour l'ombre portée). */
  focus() {
    return this.look
  }

  private target(mode: CamMode, ball: THREE.Vector3) {
    switch (mode) {
      case 'aim':
        this.tPos.set(ball.x * 0.5, 1.2, BALL_START_Z + 2.9)
        this.tLook.set(ball.x * 0.25, 0.0, -LANE_LEN * 0.5)
        break
      case 'follow': {
        const z = Math.max(ball.z, -LANE_LEN + 3.4)
        this.tPos.set(ball.x * 0.6, 0.8, z + 2.1)
        this.tLook.set(ball.x * 0.4, 0.05, z - 5)
        break
      }
      case 'pins':
        this.tPos.set(0, 1.15, -LANE_LEN + 2.3)
        this.tLook.set(0, -0.05, -LANE_LEN - 0.5)
        break
      case 'replay':
        this.tPos.set(0.55, 0.45, -LANE_LEN + 1.5)
        this.tLook.set(-0.12, 0.1, -LANE_LEN - 0.45)
        break
    }
  }

  update(dt: number, mode: CamMode, ball: THREE.Vector3) {
    if (mode === 'follow' && ball.z < -LANE_LEN + 3.6) mode = 'pins'
    this.mode = mode
    this.target(mode, ball)
    const k = mode === 'follow' ? 9 : mode === 'aim' ? 5 : 3
    this.pos.lerp(this.tPos, damp(k, dt))
    this.look.lerp(this.tLook, damp(k, dt))
    this.apply()
  }

  /** Saut immédiat (début de replay). */
  snap(mode: CamMode, ball: THREE.Vector3) {
    this.target(mode, ball)
    this.pos.copy(this.tPos)
    this.look.copy(this.tLook)
    this.mode = mode
    this.apply()
  }

  private apply() {
    this.camera.position.copy(this.pos)
    this.camera.lookAt(this.look)
  }
}
