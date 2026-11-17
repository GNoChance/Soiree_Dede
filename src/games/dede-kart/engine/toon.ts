import * as THREE from 'three'

let ramp: THREE.DataTexture | null = null

/** Dégradé en 4 paliers : donne l'ombrage « dessin animé » (aplats nets au lieu d'un dégradé lisse). */
function gradient() {
  if (!ramp) {
    ramp = new THREE.DataTexture(new Uint8Array([110, 170, 225, 255]), 4, 1, THREE.RedFormat)
    ramp.minFilter = ramp.magFilter = THREE.NearestFilter
    ramp.needsUpdate = true
  }
  return ramp
}

/** Matériau cartoon (couleur optionnelle : laissée blanche pour les maillages instanciés colorés). */
export function toon(color?: THREE.ColorRepresentation) {
  return new THREE.MeshToonMaterial({ color: color ?? '#FFFFFF', gradientMap: gradient() })
}

let ink: THREE.MeshBasicMaterial | null = null

/** Contour noir façon sticker : même forme, légèrement grossie, dont on ne voit que l'envers. */
export function outline(geo: THREE.BufferGeometry, grow = 1.06) {
  ink ??= new THREE.MeshBasicMaterial({ color: '#1B1B2F', side: THREE.BackSide })
  const m = new THREE.Mesh(geo, ink)
  m.scale.setScalar(grow)
  return m
}
