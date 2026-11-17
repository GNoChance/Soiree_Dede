// Place un téléphone (centre, échelle, rotation 3D légère, flou de mouvement).
import React from 'react'
import { IPhone17ProMax, IPHONE_OUTER, type StatusBarMode } from '../devices/IPhone17ProMax'
import { GalaxyUltra, GALAXY_OUTER } from '../devices/GalaxyUltra'
import type { Pose } from '../motion'

export const PhoneRig: React.FC<{
  device: 'iphone' | 'galaxy'
  pose: Pose
  blur?: number
  statusBar?: StatusBarMode
  children?: React.ReactNode
}> = ({ device, pose, blur = 0, statusBar = 'dark', children }) => {
  const O = device === 'iphone' ? IPHONE_OUTER : GALAXY_OUTER
  const rx = pose.rx ?? 0
  const ry = pose.ry ?? 0
  const rz = pose.rz ?? 0
  const o = pose.o ?? 1
  if (o <= 0.001) return null
  const has3d = Math.abs(rx) > 0.05 || Math.abs(ry) > 0.05
  const transform = [
    has3d ? 'perspective(2600px)' : '',
    has3d ? `rotateX(${rx}deg) rotateY(${ry}deg)` : '',
    Math.abs(rz) > 0.02 ? `rotate(${rz}deg)` : '',
    `scale(${pose.s})`,
  ].join(' ')
  const Device = device === 'iphone' ? IPhone17ProMax : GalaxyUltra
  return (
    <div
      style={{
        position: 'absolute', left: pose.x - O.w / 2, top: pose.y - O.h / 2, width: O.w, height: O.h,
        transform, transformOrigin: '50% 50%', opacity: o,
        filter: blur > 0.3 ? `blur(${blur.toFixed(2)}px)` : undefined,
      }}
    >
      <Device scale={1} statusBar={statusBar}>{children}</Device>
    </div>
  )
}

/** Écran plein (contenu de l'écran logique du device). */
export const Fill: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'absolute', inset: 0, ...style }}>{children}</div>
)
