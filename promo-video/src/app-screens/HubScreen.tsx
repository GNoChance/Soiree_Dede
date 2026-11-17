import React from 'react'
import { C, DISPLAY, sticker } from '../theme'
import { Avatar, Badge, BottomNav, Button, Card, GAMES, Icon, Pop, Scroller, ScreenBase, clamp01, ramp, sp, wiggle } from './common'

export interface HubScreenProps {
  t: number
  width?: number
  height?: number
  safeTop?: number
  scrollY?: number
  /** Index (0-5) d'une carte de jeu « pressée » (rebond), optionnel. */
  pressIndex?: number
  /** Frame locale du « press ». */
  pressAt?: number
  /** Frame locale où le bouton Rejoindre est pressé (optionnel). */
  joinPressAt?: number
}

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR').replace(/ /g, ' ')

export const HubScreen: React.FC<HubScreenProps> = ({ t, width = 440, height = 956, safeTop = 54, scrollY = 0, pressIndex, pressAt = 0, joinPressAt }) => {
  const xpRatio = 0.72 * sp(t, 20, { stiffness: 90, damping: 16 })
  const xpVal = 1080 * (xpRatio / 0.72)
  const wins = Math.round(42 * ramp(t, 14, 54))
  const avPop = sp(t, 2, { stiffness: 400, damping: 12 })
  const banner = sp(t, 16, { stiffness: 320, damping: 14 })
  const pulse = 1 + 0.04 * Math.sin((t / 84) * Math.PI * 2) * (t > 40 ? 1 : 0)
  const joinPress = joinPressAt !== undefined && t >= joinPressAt ? Math.min(1, (t - joinPressAt) / 6) * (t < joinPressAt + 14 ? 1 : 0) : 0

  return (
    <ScreenBase width={width} height={height}>
      <Scroller safeTop={safeTop} scrollY={scrollY}>
        {/* Profil */}
        <Pop t={t} delay={0}>
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ transform: `scale(${0.6 + 0.4 * avPop}) rotate(${-10 * (1 - avPop)}deg)` }}>
                <Avatar slug="kevin" expression="cool" size={76} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.muted }}>Salut,</div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 32, lineHeight: 1.1 }}>Keke !</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <Badge bg={C.grape} color="#fff">Niveau 7</Badge>
                  <Badge bg={C.sun}><Icon name="trophy" size={14} stroke={2.8} /> {wins} victoires</Badge>
                </div>
              </div>
            </div>
            <div>
              <div style={{ height: 16, borderRadius: 999, border: `3px solid ${C.ink}`, background: C.sunk, overflow: 'hidden', boxSizing: 'border-box' }}>
                <div style={{ height: '100%', width: `${Math.max(xpRatio * 100, 4)}%`, background: C.mint, borderRadius: 999 }} />
              </div>
              <div style={{ marginTop: 4, fontSize: 12, fontWeight: 700, color: C.muted }}>{fmt(xpVal)} / 1&nbsp;500 XP</div>
            </div>
          </Card>
        </Pop>

        {/* Soirée en cours */}
        <div style={{ opacity: clamp01(banner * 2), transform: `scale(${0.7 + 0.3 * banner}) rotate(${-4 * (1 - banner)}deg)` }}>
          <div style={{ position: 'relative', overflow: 'hidden', boxSizing: 'border-box', border: `3px solid ${C.ink}`, borderRadius: 24, boxShadow: sticker(4), background: C.bubblegum, padding: 16, color: C.ink }}>
            <div
              style={{
                position: 'absolute', left: '-50%', top: '-100%', width: '200%', height: '300%', opacity: 0.25, pointerEvents: 'none',
                background: 'repeating-conic-gradient(#fff 0deg 10deg, transparent 10deg 24deg)', transform: `rotate(${(t / 60) * 20}deg)`,
              }}
            />
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ transform: `rotate(${wiggle(t, 0, 6, 96)}deg)` }}>
                <Avatar slug="dede" expression="joie" size={72} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, letterSpacing: 0.7, textTransform: 'uppercase' }}>🎉 Soirée en cours</div>
                <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 28, lineHeight: 1.15 }}>chez Dédé</div>
                <div style={{ display: 'flex', marginTop: 4 }}>
                  {(['cycy', 'manon', 'mika', 'cecile', 'marius'] as const).map((s, i) => {
                    const a = sp(t, 30 + i * 5, { stiffness: 400, damping: 12 })
                    return <div key={s} style={{ marginLeft: i ? -8 : 0, transform: `scale(${a})` }}><Avatar slug={s} size={30} /></div>
                  })}
                </div>
              </div>
            </div>
            <div style={{ position: 'relative', marginTop: 12, transform: `scale(${pulse * (1 - 0.04 * joinPress)}) translate(${4 * joinPress}px, ${4 * joinPress}px)` }}>
              <Button style={{ boxShadow: joinPress > 0.5 ? sticker(0) : sticker(4) }}>🎉 Rejoindre</Button>
            </div>
          </div>
        </div>

        <Pop t={t} delay={26} from={20}>
          <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 26, lineHeight: 1.1 }}>Les jeux</div>
        </Pop>

        {GAMES.map((g, i) => {
          const press = pressIndex === i ? sp(t, pressAt, { stiffness: 500, damping: 9 }) : 0
          const tilt = (i % 2 === 0 ? -1.2 : 1.2) * (1 - 0.6 * press)
          return (
            <Pop key={g.id} t={t} delay={32 + i * 7} from={50}>
              <div style={{ transform: `rotate(${tilt}deg) scale(${1 - 0.03 * press})` }}>
                <Card bg={g.color} style={{ display: 'flex', alignItems: 'center', gap: 16, color: C.ink }}>
                  <span style={{ fontSize: 52, lineHeight: 1, display: 'block', transform: `rotate(${wiggle(t, i * 20, 8, 210)}deg)` }}>{g.emoji}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 25, lineHeight: 1.15 }}>{g.name}</div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.3, fontWeight: 600 }}>{g.tagline}</div>
                    <Badge bg={C.surface} style={{ marginTop: 8 }} size={13}>{g.min}-9 joueurs</Badge>
                  </div>
                </Card>
              </div>
            </Pop>
          )
        })}
      </Scroller>
      <BottomNav active={0} t={t} delay={6} width={width} />
    </ScreenBase>
  )
}
