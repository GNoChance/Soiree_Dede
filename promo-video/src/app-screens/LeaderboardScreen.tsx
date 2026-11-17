import React from 'react'
import { C, DISPLAY, sticker, type Slug } from '../theme'
import { Avatar, Badge, BottomNav, H1, Icon, Pop, Scroller, ScreenBase, Segmented, bob, clamp01, ramp, sp, wiggle } from './common'

export interface LeaderboardScreenProps {
  t: number
  width?: number
  height?: number
  safeTop?: number
  scrollY?: number
  /** Onglet de jeu actif : 0 Général, 1 Qui de nous ?, 2 Undercover. */
  board?: 0 | 1 | 2
  /** 0 = Tous, 1 = Mes amis. */
  scope?: 0 | 1
}

const REST: { slug: Slug; nick: string; wins: number; played: number; level: number }[] = [
  { slug: 'cycy', nick: 'Cycy', wins: 31, played: 64, level: 6 },
  { slug: 'manon', nick: 'Manon', wins: 28, played: 59, level: 6 },
  { slug: 'mika', nick: 'Mika', wins: 24, played: 55, level: 5 },
  { slug: 'cecile', nick: 'Cécile', wins: 19, played: 47, level: 4 },
  { slug: 'carole', nick: 'Karo', wins: 15, played: 38, level: 4 },
  { slug: 'marius', nick: 'Marius', wins: 11, played: 33, level: 3 },
]

export const LeaderboardScreen: React.FC<LeaderboardScreenProps> = ({ t, width = 440, height = 956, safeTop = 54, scrollY = 0, board = 0, scope = 0 }) => {
  const podium: { slug: Slug; nick: string; wins: number; expr: string; h: number; medal: string; bg: string; size: number; me?: boolean; order: number }[] = [
    { slug: 'kevin', nick: 'Keke', wins: 42, expr: 'joie', h: 104, medal: '🥈', bg: C.sky, size: 76, me: true, order: 1 },
    { slug: 'dede', nick: 'Dédé', wins: 58, expr: 'cool', h: 144, medal: '🥇', bg: C.sun, size: 96, order: 0 },
    { slug: 'nini', nick: 'Nini', wins: 37, expr: 'joie', h: 78, medal: '🥉', bg: C.tangerine, size: 76, order: 2 },
  ]
  const boards = ['Général', 'Qui de nous ?', 'Undercover']
  return (
    <ScreenBase width={width} height={height}>
      <Scroller safeTop={safeTop} scrollY={scrollY} gap={14}>
        <Pop t={t} delay={0}><H1 size={42}>Classement</H1></Pop>
        <Pop t={t} delay={5} from={16}><Segmented options={boards} active={board} fontSize={14} /></Pop>
        <Pop t={t} delay={9} from={16}><Segmented options={['Tous', 'Mes amis']} active={scope} fontSize={15} /></Pop>

        {/* Podium 2 - 1 - 3 */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 8, paddingTop: 36 }}>
          {podium.map((p) => {
            const d = 20 + p.order * 8
            const drop = sp(t, 36 + p.order * 8, { stiffness: 300, damping: 12 })
            const rise = sp(t, d, { stiffness: 120, damping: 14 })
            const crown = sp(t, 66, { stiffness: 300, damping: 8 })
            const first = p.order === 0
            return (
              <div key={p.slug} style={{ width: '33.33%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ position: 'relative', opacity: clamp01(drop * 1.5), transform: `translateY(${(1 - drop) * -90 + bob(t, p.order * 25, 5) * ramp(t, 80, 100)}px) scale(${0.5 + 0.5 * drop})` }}>
                  {first && (
                    <div style={{ position: 'absolute', top: -30, left: '50%', marginLeft: -20, zIndex: 2, transform: `scale(${crown}) rotate(${-12 + wiggle(t, 0, 5, 80) * ramp(t, 90, 110)}deg)` }}>
                      <Icon name="crown" size={40} color={C.ink} fill={C.sun} stroke={2.5} />
                    </div>
                  )}
                  <Avatar slug={p.slug} expression={p.expr} size={p.size} ring={p.me} />
                </div>
                <div style={{ marginTop: 4, fontFamily: DISPLAY, fontWeight: 800, fontSize: 17, lineHeight: 1.3 }}>{p.nick}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{p.wins} victoires</div>
                <div
                  style={{
                    boxSizing: 'border-box', marginTop: 8, width: '100%', height: p.h * rise, borderRadius: '24px 24px 0 0', overflow: 'hidden',
                    border: `3px solid ${C.ink}`, borderBottom: `3px solid ${C.ink}`, boxShadow: sticker(4), background: p.bg,
                    display: 'flex', justifyContent: 'center', paddingTop: 8, fontSize: 32,
                  }}
                >
                  <span style={{ opacity: ramp(t, d + 14, d + 24), transform: `scale(${0.4 + 0.6 * sp(t, d + 14, { stiffness: 400, damping: 9 })})` }}>{p.medal}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Liste */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
          {REST.map((r, i) => (
            <Pop key={r.slug} t={t} delay={100 + i * 7} from={40}>
              <div style={{ boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12, padding: 12, border: `3px solid ${C.ink}`, borderRadius: 24, boxShadow: sticker(4), background: C.surface }}>
                <span style={{ width: 32, textAlign: 'center', fontFamily: DISPLAY, fontWeight: 800, fontSize: 24 }}>{i + 4}</span>
                <Avatar slug={r.slug} expression="joie" size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 18, lineHeight: 1.3 }}>{r.nick}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.muted }}>{r.played} parties</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 20, lineHeight: 1.2 }}>{r.wins} 🏆</div>
                  <Badge bg={C.grape} color="#fff" rot={0} size={12}>Niv. {r.level}</Badge>
                </div>
              </div>
            </Pop>
          ))}
        </div>
      </Scroller>
      <BottomNav active={2} t={t} delay={4} width={width} />
    </ScreenBase>
  )
}
