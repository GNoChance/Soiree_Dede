// OUTRO : les deux téléphones sur le Hub, nom de l'app, QR code scannable, URL. Dernière seconde figée.
import React from 'react'
import { AbsoluteFill, staticFile, useCurrentFrame } from 'remotion'
import { HubScreen } from '../app-screens'
import { QrCode } from '../ui/QrCode'
import { Sfx } from '../audio'
import { C, DISPLAY, sticker } from '../theme'
import { APP_URL, SEQ } from '../timeline'
import { POSE, SPRING, clamp01, glide, mixPose, motionBlur, sp, type Pose, type SpringCfg } from '../motion'
import { PhoneRig } from './PhoneRig'
import { ANDROID_HUB_AT } from './AndroidTutorial'

/** Au-delà de cette frame locale, tout est figé (dernière seconde scannable). */
const FREEZE = SEQ.outro.duration - 66

/** Spring forcé à 1 une fois FREEZE atteint. */
const st = (f: number, delay: number, cfg: SpringCfg) => (f >= FREEZE ? 1 : sp(f, delay, cfg))

const IPHONE_FROM: Pose = { x: -480, y: 760, s: 0.7, rx: 4, ry: 40, rz: -10 }
const galaxyPose = (f: number): Pose => mixPose(POSE.tutoGalaxy, POSE.outroGalaxy, f >= FREEZE ? 1 : glide(f, 0, { stiffness: 80, damping: 20 }))
const iphonePose = (f: number): Pose => mixPose(IPHONE_FROM, POSE.outroIphone, f >= FREEZE ? 1 : glide(f, 6, { stiffness: 80, damping: 20 }))

export const Outro: React.FC = () => {
  const f = useCurrentFrame()
  const title = st(f, 10, SPRING.bouncy)
  const qr = st(f, 22, { stiffness: 200, damping: 16 })
  const url = st(f, 34, SPRING.bouncy)
  const line = st(f, 44, SPRING.snappy)
  const hubG = SEQ.android.duration - ANDROID_HUB_AT + f

  return (
    <AbsoluteFill>
      <PhoneRig device="iphone" pose={iphonePose(f)} blur={f >= FREEZE ? 0 : motionBlur(iphonePose, f)}>
        <HubScreen t={200 + f} width={440} height={956} safeTop={58} />
      </PhoneRig>
      <PhoneRig device="galaxy" pose={galaxyPose(f)} blur={f >= FREEZE ? 0 : motionBlur(galaxyPose, f)}>
        <HubScreen t={hubG} width={412} height={915} safeTop={40} />
      </PhoneRig>

      {/* nom de l'app */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 90, display: 'flex', flexDirection: 'column', alignItems: 'center', transform: `translateY(${(1 - title) * -260}px) scale(${0.6 + 0.4 * title}) rotate(${(1 - title) * -6 - 1.5}deg)`, opacity: clamp01(title * 2) }}>
        {['Les Soirées', 'de Dédé'].map((l) => (
          <div key={l} style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 128, lineHeight: 1.0, letterSpacing: -1.5, color: '#fff', WebkitTextStroke: `5px ${C.ink}`, paintOrder: 'stroke fill', textShadow: `7px 7px 0 ${C.ink}` }}>
            {l}
          </div>
        ))}
      </div>

      {/* QR code */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1040, display: 'flex', justifyContent: 'center' }}>
        <div style={{ padding: 22, background: '#fff', borderRadius: 44, border: `6px solid ${C.ink}`, boxShadow: sticker(12), transform: `translateY(${(1 - qr) * 500}px) scale(${0.5 + 0.5 * qr}) rotate(${(1 - qr) * 10}deg)`, opacity: clamp01(qr * 2) }}>
          <QrCode value={`https://${APP_URL}`} size={400} logoSrc={staticFile('icons/icon-192.png')} />
        </div>
      </div>

      {/* URL */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 1548, display: 'flex', justifyContent: 'center' }}>
        <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 62, lineHeight: 1.2, color: C.ink, background: C.sun, border: `5px solid ${C.ink}`, boxShadow: sticker(8), borderRadius: 999, padding: '6px 46px 2px', transform: `scale(${url})`, opacity: clamp01(url * 2) }}>
          {APP_URL}
        </div>
      </div>

      {/* appel à l'action */}
      <div style={{ position: 'absolute', left: 60, right: 60, top: 1686, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 52, lineHeight: 1.1, color: '#fff', WebkitTextStroke: `3px ${C.ink}`, paintOrder: 'stroke fill', textShadow: `4px 4px 0 ${C.ink}`, opacity: clamp01(line * 2), transform: `translateY(${(1 - line) * 40}px)` }}>
        Scanne ou ouvre le lien<br />et rejoins la partie !
      </div>

      <Sfx name="whoosh" at={0} volume={0.5} />
      <Sfx name="jingle" at={8} volume={0.8} />
    </AbsoluteFill>
  )
}
