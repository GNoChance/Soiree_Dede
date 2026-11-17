import React from 'react'
import { C, DISPLAY, sticker } from '../theme'
import { Avatar, Badge, BottomNav, Chibi, H1, Icon, Pop, Scroller, ScreenBase, Segmented, bob, ramp, sp, wiggle } from './common'

export interface InventoryScreenProps {
  t: number
  width?: number
  height?: number
  safeTop?: number
  scrollY?: number
  /** Onglet actif : 0 = Expressions, 1 = Tenues (le contenu reste celui des expressions). */
  tab?: 0 | 1
  /** Si défini : l'expression à cet index se « débloque » à la frame `unlockAt`. */
  unlockIndex?: number
  unlockAt?: number
}

const EXPR: { id: string; label: string; open: boolean }[] = [
  { id: 'joie', label: 'Joie', open: true },
  { id: 'cool', label: 'Cool', open: true },
  { id: 'surprise', label: 'Surprise', open: true },
  { id: 'clin_oeil', label: 'Clin d’œil', open: true },
  { id: 'reflexion', label: 'Réflexion', open: true },
  { id: 'bisou', label: 'Bisou', open: true },
  { id: 'amoureux', label: 'Amoureux', open: true },
  { id: 'boude', label: 'Boude', open: true },
  { id: 'colere', label: 'Colère', open: true },
  { id: 'gamer', label: 'Gamer', open: false },
  { id: 'dodo', label: 'Dodo', open: false },
  { id: 'pleurs', label: 'Pleurs', open: false },
]
const EQUIPPED = 1 // cool

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ t, width = 440, height = 956, safeTop = 54, scrollY = 0, tab = 0, unlockIndex, unlockAt = 0 }) => {
  const count = 9 + (unlockIndex !== undefined && t >= unlockAt ? 1 : 0)
  const eq = sp(t, 10, { stiffness: 380, damping: 11 })
  const cols = 3
  const gap = 12
  const cardW = (width - 32 - gap * (cols - 1)) / cols
  const imgS = Math.round(cardW * 0.8)
  return (
    <ScreenBase width={width} height={height}>
      <Scroller safeTop={safeTop} scrollY={scrollY}>
        <Pop t={t} delay={0}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <H1 size={42}>Inventaire</H1>
              <Badge bg={C.mint} style={{ marginTop: 6 }}>{count}/12 débloqués</Badge>
            </div>
            <div style={{ transform: `scale(${eq}) rotate(${-30 * (1 - eq)}deg) translateY(${bob(t, 0, 6, 84)}px)` }}>
              <Avatar slug="kevin" expression="cool" size={84} badge={<Icon name="check" size={14} stroke={4} />} />
            </div>
          </div>
        </Pop>
        <Pop t={t} delay={8} from={20}>
          <Segmented options={['Expressions', 'Tenues 👕']} active={tab} fontSize={16} />
        </Pop>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
          {EXPR.map((e, i) => {
            const justUnlocked = unlockIndex === i && t >= unlockAt
            const open = e.open || justUnlocked
            const equipped = i === EQUIPPED
            const reveal = justUnlocked ? sp(t, unlockAt, { stiffness: 350, damping: 8 }) : 1
            const flash = justUnlocked ? 1 - ramp(t, unlockAt, unlockAt + 30) : 0
            return (
              <Pop key={e.id} t={t} delay={14 + i * 4} from={36}>
                <div style={{ transform: `scale(${justUnlocked ? 1 + 0.12 * Math.sin(reveal * Math.PI) : 1}) rotate(${justUnlocked ? wiggle(t, 0, 6 * flash, 20) : 0}deg)` }}>
                  <div
                    style={{
                      position: 'relative', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                      padding: '8px 4px', border: `3px solid ${C.ink}`, borderRadius: 24, boxShadow: sticker(4),
                      background: equipped ? C.sun : flash > 0.05 ? '#fff3c4' : C.surface, color: C.ink,
                    }}
                  >
                    <div style={{ position: 'relative', width: imgS, height: imgS }}>
                      <Chibi
                        slug="kevin" expression={e.id} size={imgS} thumb
                        style={{
                          transform: open && equipped ? `translateY(${bob(t, 10, 4)}px)` : undefined,
                          filter: open ? 'none' : 'brightness(0)', opacity: open ? 1 : 0.4,
                        }}
                      />
                      {!open && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="lock" size={30} color="#fff" stroke={3} style={{ filter: `drop-shadow(0 2px 0 ${C.ink})` }} />
                        </div>
                      )}
                    </div>
                    <span style={{ fontFamily: DISPLAY, fontWeight: 800, fontSize: 14, lineHeight: 1.3 }}>{open ? e.label : '???'}</span>
                    {equipped && (
                      <span style={{ position: 'absolute', right: -6, top: -6, width: 26, height: 26, borderRadius: '50%', background: C.mint, border: `2px solid ${C.ink}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="check" size={16} stroke={4} />
                      </span>
                    )}
                    {justUnlocked && flash > 0.02 && (
                      <div style={{ position: 'absolute', inset: -3, borderRadius: 24, boxShadow: `0 0 0 ${6 * flash}px ${C.mint}`, opacity: flash, pointerEvents: 'none' }} />
                    )}
                  </div>
                </div>
              </Pop>
            )
          })}
        </div>
      </Scroller>
      <BottomNav active={1} t={t} delay={4} width={width} />
    </ScreenBase>
  )
}
