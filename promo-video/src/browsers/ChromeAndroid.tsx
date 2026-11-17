import React from 'react'
import { Img, staticFile } from 'remotion'
import { Ico, clamp01, easeOut, lerp, seg, type Pt } from '../devices/common'

const F = 'Roboto, "Google Sans", "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const W = 412
const H = 915
const TOP = 92 // toolbar + barre d'état
export const CHROME_CONTENT = { top: TOP, w: W, h: H - TOP } as const
const TB_CY = 64

// Menu
const MENU_W = 322
const MENU_L = W - 8 - MENU_W
const MENU_T = 40
const ICON_ROW = 56
const ITEM_H = 48
const MENU_ITEMS = [
  { label: 'Nouvel onglet', icon: 'tab' },
  { label: 'Nouvel onglet de navigation privée', icon: 'incognito' },
  { label: 'Historique', icon: 'clock' },
  { label: 'Téléchargements', icon: 'download' },
  { label: 'Favoris', icon: 'star' },
  { label: "Ajouter à l'écran d'accueil", icon: 'addHome' },
  { label: 'Paramètres', icon: 'gear' },
]
const ITEMS_TOP = MENU_T + ICON_ROW + 9
const MENU_H = ICON_ROW + 9 + MENU_ITEMS.length * ITEM_H + 8
// Dialog
const DLG_W = 312
const DLG_L = (W - DLG_W) / 2
const DLG_T = 330
const DLG_H = 214

export const CHROME_TARGETS = {
  menuButton: { x: 376, y: TB_CY } as Pt,
  addToHomeItem: { x: MENU_L + MENU_W / 2, y: ITEMS_TOP + 5 * ITEM_H + ITEM_H / 2 } as Pt,
  installButton: { x: DLG_L + DLG_W - 24 - 44, y: DLG_T + DLG_H - 24 - 20 } as Pt,
}

const BLUE = '#0b57d0'

export const ChromeAndroid: React.FC<{
  content: React.ReactNode
  url: string
  typedUrl?: string
  caretVisible?: boolean
  menuOpen?: number
  highlight?: string
  installDialog?: number
  installingProgress?: number
  installPressed?: boolean
}> = ({ content, url, typedUrl, caretVisible = true, menuOpen = 0, highlight, installDialog = 0, installingProgress, installPressed }) => {
  const m = easeOut(menuOpen)
  const d = easeOut(installDialog)
  const typing = typedUrl !== undefined
  const ip = installingProgress ?? 0
  const toastIn = easeOut(seg(ip, 0, 0.08)) * (1 - easeOut(seg(ip, 0.94, 1)))
  const done = ip >= 0.55

  return (
    <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden', fontFamily: F, color: '#1f1f1f', background: '#fff' }}>
      {/* contenu */}
      <div style={{ position: 'absolute', left: 0, top: TOP, width: W, height: H - TOP, overflow: 'hidden' }}>{content}</div>

      {/* barre d'outils Chrome */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: TOP, background: '#f8f9fc', boxShadow: '0 1px 0 rgba(0,0,0,0.06)' }}>
        <div style={{ position: 'absolute', left: 8, top: TB_CY - 20, width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico n="home" size={24} color="#444746" sw={1.7} /></div>
        <div style={{ position: 'absolute', left: 52, top: TB_CY - 22, width: 252, height: 44, borderRadius: 22, background: '#e9edf6', display: 'flex', alignItems: 'center', padding: '0 14px', boxSizing: 'border-box', gap: 8, fontSize: 15.5 }}>
          {typing ? (
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>{typedUrl}<span style={{ display: 'inline-block', width: 2, height: 20, background: BLUE, verticalAlign: -4, marginLeft: 1, opacity: caretVisible ? 1 : 0 }} /></div>
          ) : (
            <>
              <div style={{ width: 28, height: 28, borderRadius: 14, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: -6 }}><Ico n="lock" size={16} color="#444746" sw={2} /></div>
              <span style={{ whiteSpace: 'nowrap' }}>{url}</span>
            </>
          )}
        </div>
        <div style={{ position: 'absolute', left: 308, top: TB_CY - 18, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: 22, height: 22, borderRadius: 6, border: '2px solid #444746', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#444746' }}>1</div>
        </div>
        <div style={{ position: 'absolute', left: 352, top: TB_CY - 20, width: 40, height: 40, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m > 0.4 ? 'rgba(0,0,0,0.08)' : 'transparent', color: '#444746' }}><Ico n="moreV" size={24} /></div>
      </div>
      {/* barre gestuelle */}
      <div style={{ position: 'absolute', left: (W - 108) / 2, top: H - 12, width: 108, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.55)' }} />

      {/* menu déroulant */}
      {m > 0 && <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${0.0 * m})` }} />}
      {m > 0 && (
        <div style={{
          position: 'absolute', left: MENU_L, top: MENU_T, width: MENU_W, height: MENU_H, borderRadius: 16, background: '#fff',
          boxShadow: '0 2px 6px rgba(0,0,0,0.2), 0 12px 32px rgba(0,0,0,0.22)', transformOrigin: '100% 0%',
          transform: `scale(${lerp(0.55, 1, m)})`, opacity: clamp01(m * 2.5), overflow: 'hidden',
        }}>
          <div style={{ height: ICON_ROW, display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '0 6px', color: '#444746' }}>
            {['forward', 'star', 'download', 'info', 'refresh'].map((i) => (
              <div key={i} style={{ width: 44, height: 44, borderRadius: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico n={i} size={22} sw={1.8} /></div>
            ))}
          </div>
          <div style={{ height: 1, background: 'rgba(0,0,0,0.1)', margin: '4px 0' }} />
          {MENU_ITEMS.map((it) => (
            <div key={it.label} style={{ height: ITEM_H, display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px', fontSize: 15, whiteSpace: 'nowrap', background: highlight === it.label ? 'rgba(11,87,208,0.12)' : 'transparent' }}>
              <Ico n={it.icon} size={22} color="#444746" sw={1.7} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* boîte de dialogue d'installation */}
      {d > 0 && (
        <>
          <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${0.42 * d})` }} />
          <div style={{
            position: 'absolute', left: DLG_L, top: DLG_T, width: DLG_W, height: DLG_H, borderRadius: 28, background: '#f3edf7', boxSizing: 'border-box', padding: 24,
            boxShadow: '0 12px 40px rgba(0,0,0,0.3)', transform: `scale(${lerp(0.88, 1, d)})`, opacity: clamp01(d * 2),
          }}>
            <div style={{ fontSize: 22, fontWeight: 400, color: '#1d1b20', lineHeight: '28px' }}>Installer l'application</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 18 }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.2)', flexShrink: 0 }}>
                <Img src={staticFile('icons/icon-512.png')} style={{ width: '100%', height: '100%', display: 'block' }} />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 500, color: '#1d1b20' }}>Soirées Dédé</div>
                <div style={{ fontSize: 14, color: '#49454f', marginTop: 2 }}>{url}</div>
              </div>
            </div>
            <div style={{ position: 'absolute', right: 24, bottom: 24, display: 'flex', gap: 8 }}>
              <div style={{ height: 40, minWidth: 84, padding: '0 12px', boxSizing: 'border-box', borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5, fontWeight: 500, color: BLUE }}>Annuler</div>
              <div style={{ height: 40, width: 88, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14.5, fontWeight: 500, color: '#fff', background: installPressed ? '#0a46a8' : BLUE }}>Installer</div>
            </div>
          </div>
        </>
      )}

      {/* toast d'installation */}
      {installingProgress !== undefined && toastIn > 0 && (
        <div style={{
          position: 'absolute', left: 16, right: 16, bottom: 44, height: 52, borderRadius: 10, background: '#313033', color: '#f4eff4', display: 'flex', alignItems: 'center', gap: 14, padding: '0 16px',
          fontSize: 14.5, boxShadow: '0 6px 18px rgba(0,0,0,0.3)', opacity: toastIn, transform: `translateY(${(1 - toastIn) * 24}px)`,
        }}>
          {done ? (
            <div style={{ width: 24, height: 24, borderRadius: 12, background: '#7be39b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico n="check" size={15} color="#0a3d1c" sw={3} /></div>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="3" /><circle cx="12" cy="12" r="9" fill="none" stroke="#a8c7fa" strokeWidth="3" strokeLinecap="round" strokeDasharray={`${clamp01(ip / 0.55) * 56.5} 56.5`} transform="rotate(-90 12 12)" /></svg>
          )}
          <span>{done ? "Ajoutée à l'écran d'accueil" : 'Installation…'}</span>
        </div>
      )}
    </div>
  )
}
