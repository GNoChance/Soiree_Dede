import React from 'react'
import { Img, staticFile } from 'remotion'
import { Ico, SQUIRCLE_IOS, clamp01, lerp, easeOut, type Pt } from '../devices/common'

const F = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
const W = 440
const H = 956

// Barre flottante
const BAR_TOP = 880
const BAR_H = 52
const BAR_CY = BAR_TOP + BAR_H / 2
// Menu ⋯
const MENU_W = 264
const MENU_RIGHT = 426
const MENU_ITEM_H = 46
const MENU_PAD = 8
const MENU_ITEMS = [
  { label: 'Partager', icon: 'share' },
  { label: 'Ajouter aux signets', icon: 'bookmark' },
  { label: 'Ajouter aux favoris', icon: 'star' },
  { label: 'Rechercher dans la page', icon: 'search' },
  { label: 'Nouvel onglet', icon: 'plus' },
  { label: 'Version ordinateur', icon: 'desktop' },
]
const MENU_H = MENU_ITEMS.length * MENU_ITEM_H + MENU_PAD * 2
const MENU_BOTTOM = BAR_TOP - 10
const MENU_TOP = MENU_BOTTOM - MENU_H
// Share sheet
const SHARE_H = 560
const SHARE_TOP = H - SHARE_H
const LIST_TOP = 226
const ROW_H = 56
const SHARE_ROWS = [
  { label: 'Copier', icon: 'copy' },
  { label: 'Ajouter à la liste de lecture', icon: 'glasses' },
  { label: 'Ajouter aux signets', icon: 'bookmark' },
  { label: 'Ajouter aux favoris', icon: 'star' },
  { label: 'Rechercher dans la page', icon: 'search' },
  { label: "Sur l'écran d'accueil", icon: 'plusSquare' },
  { label: 'Imprimer', icon: 'printer' },
]
const LIST_CONTENT = SHARE_ROWS.length * ROW_H + 40
const LIST_VISIBLE = SHARE_H - LIST_TOP
const MAX_SCROLL = LIST_CONTENT - LIST_VISIBLE
const HOME_IDX = 5
// Add sheet
const ADD_TOP = 96

/** Position (points écran) de « Sur l'écran d'accueil » pour un shareScroll donné (feuille entièrement montée). */
export const addToHomeItemAt = (shareScroll: number): Pt => ({
  x: W / 2,
  y: SHARE_TOP + LIST_TOP + HOME_IDX * ROW_H + ROW_H / 2 - clamp01(shareScroll) * MAX_SCROLL,
})
export const SAFARI_TARGETS = {
  moreButton: { x: 400, y: BAR_CY } as Pt,
  shareItem: { x: MENU_RIGHT - MENU_W / 2, y: MENU_TOP + MENU_PAD + MENU_ITEM_H / 2 } as Pt,
  addToHomeItemAt,
  /** valeur à shareScroll = 1 */
  addToHomeItem: addToHomeItemAt(1),
  addButton: { x: 388, y: ADD_TOP + 30 } as Pt,
}

const glass = (alpha = 0.6): React.CSSProperties => ({
  background: `rgba(246,246,249,${alpha})`,
  backdropFilter: 'blur(26px) saturate(1.8)',
  WebkitBackdropFilter: 'blur(26px) saturate(1.8)',
  border: '1px solid rgba(255,255,255,0.7)',
  boxShadow: '0 8px 28px rgba(15,20,40,0.18), 0 1px 3px rgba(15,20,40,0.12), inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(255,255,255,0.25)',
})

const AppIcon: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ width: size, height: size, clipPath: SQUIRCLE_IOS, flexShrink: 0, background: '#fff' }}>
    <Img src={staticFile('icons/icon-512.png')} style={{ width: '100%', height: '100%', display: 'block' }} />
  </div>
)

const Caret: React.FC<{ on: boolean }> = ({ on }) => (
  <span style={{ display: 'inline-block', width: 2, height: 19, marginLeft: 1, background: '#0a84ff', verticalAlign: -3, opacity: on ? 1 : 0, borderRadius: 1 }} />
)

const GroupIcon: React.FC<{ bg: string; children: React.ReactNode }> = ({ bg, children }) => (
  <div style={{ width: 60, height: 60, borderRadius: 14, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>{children}</div>
)

export const SafariIOS26: React.FC<{
  content: React.ReactNode
  url: string
  typedUrl?: string
  caretVisible?: boolean
  menuOpen?: number
  highlight?: string
  shareSheet?: number
  shareScroll?: number
  addSheet?: number
}> = ({ content, url, typedUrl, caretVisible = true, menuOpen = 0, highlight, shareSheet = 0, shareScroll = 0, addSheet = 0 }) => {
  const m = clamp01(menuOpen)
  const sh = easeOut(shareSheet)
  const ad = easeOut(addSheet)
  const typing = typedUrl !== undefined
  const hl = (label: string): boolean => highlight === label

  return (
    <div style={{ position: 'relative', width: W, height: H, overflow: 'hidden', fontFamily: F, color: '#111', background: '#fff' }}>
      <div style={{ position: 'absolute', inset: 0 }}>{content}</div>

      {/* scrim menu */}
      {m > 0 && <div style={{ position: 'absolute', inset: 0, background: `rgba(255,255,255,${0.18 * m})` }} />}

      {/* barre flottante liquid glass */}
      <div style={{ position: 'absolute', left: 14, top: BAR_TOP, width: 52, height: BAR_H, borderRadius: 26, ...glass(0.58), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ico n="chevronLeft" size={26} color="#1c1c1e" sw={2.2} />
      </div>
      <div style={{ position: 'absolute', left: 76, top: BAR_TOP, width: 288, height: BAR_H, borderRadius: 26, ...glass(0.58), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 17, fontWeight: 500, letterSpacing: -0.2 }}>
        {typing ? (
          <div style={{ width: '100%', padding: '0 18px', boxSizing: 'border-box', whiteSpace: 'nowrap', overflow: 'hidden', fontWeight: 400 }}>
            {typedUrl}<Caret on={caretVisible} />
          </div>
        ) : (
          <>
            <Ico n="lock" size={14} color="#3a3a3c" sw={2.4} />
            <span>{url}</span>
          </>
        )}
      </div>
      <div style={{ position: 'absolute', left: 374, top: BAR_TOP, width: 52, height: BAR_H, borderRadius: 26, ...glass(0.58), display: 'flex', alignItems: 'center', justifyContent: 'center', background: m > 0.5 ? 'rgba(255,255,255,0.9)' : undefined }}>
        <Ico n="more" size={28} color="#1c1c1e" />
      </div>
      {/* indicateur d'accueil */}
      <div style={{ position: 'absolute', left: (W - 140) / 2, top: H - 13, width: 140, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.85)' }} />

      {/* menu contextuel ⋯ */}
      {m > 0 && (
        <div style={{
          position: 'absolute', left: MENU_RIGHT - MENU_W, top: MENU_TOP, width: MENU_W, height: MENU_H, borderRadius: 28,
          ...glass(0.78), backdropFilter: 'blur(40px) saturate(2)', WebkitBackdropFilter: 'blur(40px) saturate(2)',
          transformOrigin: '100% 100%', transform: `scale(${lerp(0.4, 1, easeOut(m))})`, opacity: clamp01(m * 2.2),
          padding: MENU_PAD, boxSizing: 'border-box',
        }}>
          {MENU_ITEMS.map((it, i) => (
            <div key={it.label} style={{
              height: MENU_ITEM_H, borderRadius: 21, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 0 16px', fontSize: 16.5, letterSpacing: -0.2,
              background: hl(it.label) ? 'rgba(60,60,67,0.14)' : 'transparent', transform: hl(it.label) ? 'scale(0.985)' : undefined,
              borderBottom: i === 2 ? '0' : undefined,
            }}>
              <span>{it.label}</span>
              <Ico n={it.icon} size={22} color="#1c1c1e" sw={1.7} />
            </div>
          ))}
        </div>
      )}

      {/* scrim feuilles */}
      {(sh > 0 || ad > 0) && <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${0.3 * sh + 0.12 * ad})` }} />}

      {/* feuille de partage */}
      {sh > 0 && (
        <div style={{
          position: 'absolute', left: 6, right: 6, top: SHARE_TOP, height: SHARE_H + 20, borderRadius: 40, overflow: 'hidden',
          background: 'rgba(242,242,247,0.94)', backdropFilter: 'blur(40px) saturate(1.8)', WebkitBackdropFilter: 'blur(40px) saturate(1.8)',
          boxShadow: '0 -4px 40px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.9)',
          transform: `translateY(${(1 - sh) * (SHARE_H + 60)}px)`,
        }}>
          {/* aperçu du site */}
          <div style={{ position: 'absolute', left: 14, right: 14, top: 18, height: 72, display: 'flex', alignItems: 'center', gap: 14 }}>
            <AppIcon size={54} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16.5, fontWeight: 600, letterSpacing: -0.2, whiteSpace: 'nowrap' }}>Les Soirées de Dédé</div>
              <div style={{ fontSize: 14, color: '#8a8a8e', marginTop: 2 }}>{url} &nbsp;›</div>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: 17, background: 'rgba(120,120,128,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Ico n="x" size={16} color="#6c6c70" sw={2.6} />
            </div>
          </div>
          {/* rangée d'apps génériques */}
          <div style={{ position: 'absolute', left: 0, right: 0, top: 106, height: 100, display: 'flex', paddingLeft: 8 }}>
            {[
              { l: 'Messages', bg: 'linear-gradient(#5be86d,#22c748)', i: 'bubble', fill: true },
              { l: 'Mail', bg: 'linear-gradient(#58b6ff,#1a7cf0)', i: 'mail' },
              { l: 'Notes', bg: 'linear-gradient(#ffe36a,#f7c11a)', i: 'note' },
              { l: 'Rappels', bg: 'linear-gradient(#ff8d7a,#f5493e)', i: 'check' },
              { l: 'Plus', bg: 'linear-gradient(#d9d9de,#b9b9c0)', i: 'more' },
            ].map((a) => (
              <div key={a.l} style={{ width: 84, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                <div style={{ width: 62, height: 62, clipPath: SQUIRCLE_IOS, background: a.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
                  <Ico n={a.i} size={30} color="#fff" sw={a.fill ? 0 : 1.9} fill={a.fill ? '#fff' : 'none'} />
                </div>
                <div style={{ fontSize: 12, color: '#3c3c43' }}>{a.l}</div>
              </div>
            ))}
          </div>
          {/* liste d'actions */}
          <div style={{ position: 'absolute', left: 10, right: 10, top: LIST_TOP, height: LIST_VISIBLE, overflow: 'hidden' }}>
            <div style={{ transform: `translateY(${-clamp01(shareScroll) * MAX_SCROLL}px)` }}>
              <div style={{ background: '#fff', borderRadius: 22, overflow: 'hidden' }}>
                {SHARE_ROWS.map((r, i) => (
                  <div key={r.label} style={{
                    height: ROW_H, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px 0 18px', fontSize: 16.5, letterSpacing: -0.2,
                    background: hl(r.label) ? 'rgba(60,60,67,0.12)' : '#fff',
                    borderTop: i === 0 ? 'none' : '0.7px solid rgba(60,60,67,0.16)',
                  }}>
                    <span>{r.label}</span>
                    <Ico n={r.icon} size={23} color="#1c1c1e" sw={1.7} />
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ position: 'absolute', left: (W - 12 - 140) / 2, top: SHARE_H - 13, width: 140, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.85)' }} />
        </div>
      )}

      {/* feuille « Sur l'écran d'accueil » */}
      {ad > 0 && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: ADD_TOP, height: H - ADD_TOP + 20, borderRadius: '40px 40px 0 0', background: '#f2f2f7',
          boxShadow: '0 -6px 40px rgba(0,0,0,0.2)', transform: `translateY(${(1 - ad) * (H - ADD_TOP + 40)}px)`, overflow: 'hidden',
        }}>
          <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 600, letterSpacing: -0.2 }}>Sur l'écran d'accueil</div>
          <div style={{ position: 'absolute', left: 18, top: 13, height: 34, padding: '0 16px', borderRadius: 17, background: 'rgba(255,255,255,0.9)', boxShadow: '0 1px 4px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', fontSize: 16, color: '#111' }}>Annuler</div>
          <div style={{ position: 'absolute', right: 18, top: 13, height: 34, padding: '0 16px', borderRadius: 17, background: hl('Ajouter') ? '#0a6fe8' : '#0a84ff', boxShadow: '0 2px 8px rgba(10,132,255,0.4)', display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 600, color: '#fff' }}>Ajouter</div>

          <div style={{ position: 'absolute', left: 16, right: 16, top: 84, background: '#fff', borderRadius: 24, overflow: 'hidden' }}>
            <div style={{ height: 92, display: 'flex', alignItems: 'center', padding: '0 16px', gap: 14 }}>
              <AppIcon size={60} />
              <div style={{ flex: 1, fontSize: 18, fontWeight: 500, letterSpacing: -0.3, display: 'flex', alignItems: 'center' }}>
                Soirées Dédé<span style={{ width: 2, height: 22, background: '#0a84ff', marginLeft: 1, borderRadius: 1 }} />
              </div>
              <div style={{ width: 22, height: 22, borderRadius: 11, background: '#c7c7cc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ico n="x" size={12} color="#fff" sw={3} /></div>
            </div>
            <div style={{ height: 0.7, background: 'rgba(60,60,67,0.18)', marginLeft: 16 }} />
            <div style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 16.5, color: '#8a8a8e' }}>{url}</div>
          </div>
          <div style={{ position: 'absolute', left: 36, right: 30, top: 240, fontSize: 13, lineHeight: 1.35, color: '#8a8a8e' }}>
            Une icône sera ajoutée à votre écran d'accueil pour accéder rapidement à ce site web.
          </div>
          <div style={{ position: 'absolute', left: 16, right: 16, top: 306, background: '#fff', borderRadius: 24, height: 58, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px 0 18px', fontSize: 16.5, letterSpacing: -0.2 }}>
            <span>Ouvrir en tant qu'app web</span>
            <div style={{ width: 52, height: 31, borderRadius: 16, background: '#34c759', position: 'relative', boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.05)' }}>
              <div style={{ position: 'absolute', right: 2, top: 2, width: 27, height: 27, borderRadius: 14, background: '#fff', boxShadow: '0 2px 5px rgba(0,0,0,0.25)' }} />
            </div>
          </div>
          <div style={{ position: 'absolute', left: 36, right: 30, top: 376, fontSize: 13, lineHeight: 1.35, color: '#8a8a8e' }}>
            Le site s'ouvrira en plein écran, comme une vraie app.
          </div>
          <div style={{ position: 'absolute', left: (W - 140) / 2, top: H - ADD_TOP - 13, width: 140, height: 5, borderRadius: 3, background: 'rgba(0,0,0,0.85)' }} />
        </div>
      )}
    </div>
  )
}
