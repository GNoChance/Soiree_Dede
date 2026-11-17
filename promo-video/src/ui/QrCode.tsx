// QR code en SVG, généré de façon synchrone (lib `qrcode`).
// Modules dessinés en <rect> dans un viewBox exprimé en modules.
import { useMemo } from 'react'
import * as QRCode from 'qrcode'
import { Img } from 'remotion'

/** Zone calme (quiet zone) en modules, de chaque côté. */
const QUIET = 2
/** Taille maximale du logo, en fraction de la taille totale du QR. */
const LOGO_RATIO = 0.22

export type QrCodeProps = {
  value: string
  /** Côté du QR en px (carré). */
  size: number
  fg?: string
  bg?: string
  /** Arrondi des coins de chaque module, en fraction de module (0 à 0.5). 0 = carrés. */
  radius?: number
  /** Logo centré sur fond blanc arrondi. Passe la correction d'erreur de 'M' à 'H'. */
  logoSrc?: string
}

export const QrCode = ({
  value,
  size,
  fg = '#1f1b2e',
  bg = '#ffffff',
  radius = 0,
  logoSrc,
}: QrCodeProps) => {
  const qr = useMemo(
    () => QRCode.create(value, { errorCorrectionLevel: logoSrc ? 'H' : 'M' }),
    [value, logoSrc],
  )

  const count = qr.modules.size
  const total = count + QUIET * 2
  const dark: [number, number][] = []
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.modules.get(r, c)) dark.push([r, c])
    }
  }

  const plate = LOGO_RATIO * size

  return (
    <div style={{ position: 'relative', width: size, height: size, lineHeight: 0 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${total} ${total}`}
        shapeRendering={radius > 0 ? undefined : 'crispEdges'}
        style={{ display: 'block' }}
      >
        <rect width={total} height={total} fill={bg} />
        {dark.map(([r, c]) => (
          <rect key={`${r}-${c}`} x={c + QUIET} y={r + QUIET} width={1} height={1} rx={radius} fill={fg} />
        ))}
      </svg>
      {logoSrc ? (
        <div
          style={{
            position: 'absolute',
            left: (size - plate) / 2,
            top: (size - plate) / 2,
            width: plate,
            height: plate,
            boxSizing: 'border-box',
            padding: plate * 0.12,
            background: '#ffffff',
            borderRadius: plate * 0.22,
          }}
        >
          <Img src={logoSrc} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      ) : null}
    </div>
  )
}
