import { useEffect, useRef } from 'react'
import { ArrowLeft, Printer } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { rpcErrorMessage } from '@/lib/rpcError'
import { AlbumLeaf } from './AlbumLeaf'
import { AlbumCover } from './AlbumCover'
import { albumYearFrom, useAlbum } from './api'

// Impression toujours en clair, quel que soit le thème de l'app : on redéfinit les variables de couleur.
const LIGHT = {
  '--paper': '#ffffff',
  '--surface': '#ffffff',
  '--sunk': '#ffe9bf',
  '--ink': '#1f1b2e',
  '--text': '#1f1b2e',
  '--muted': '#6b6485',
} as React.CSSProperties

const PRINT_CSS = `
@page { size: A4 portrait; margin: 12mm; }
@media print {
  html, body { background: #fff !important; }
  body::before, body::after { display: none !important; }
  .no-print { display: none !important; }
  .album-print { padding: 0 !important; max-width: none !important; }
  .album-sheet { break-after: page; page-break-after: always; min-height: 250mm; }
  .album-sheet:last-child { break-after: auto; page-break-after: auto; }
  .album-leaf { box-shadow: none !important; break-inside: avoid; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`

/** /album/imprimer : une page par soirée (+ couverture), prête pour « Enregistrer au format PDF » du navigateur. */
export function AlbumPrintPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const year = albumYearFrom(params.toString())
  const { data, error, loading } = useAlbum(year)
  const asked = useRef(false)

  // Ouvre la fenêtre d'impression une fois le livre affiché (images chargées).
  useEffect(() => {
    if (!data || data.soirees.length === 0 || asked.current) return
    asked.current = true
    const t = window.setTimeout(() => window.print(), 1200)
    return () => window.clearTimeout(t)
  }, [data])

  return (
    <div style={LIGHT} className="album-print mx-auto min-h-dvh max-w-3xl bg-white p-4 text-[#1f1b2e]">
      <style>{PRINT_CSS}</style>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" aria-label="Retour" onClick={() => navigate(`/album?annee=${year}`)} icon={<ArrowLeft className="size-5" />} />
        <p className="min-w-0 flex-1 text-sm font-bold">Choisis « Enregistrer au format PDF » dans la fenêtre d’impression.</p>
        <Button onClick={() => window.print()} icon={<Printer className="size-5" />}>
          Imprimer / PDF
        </Button>
      </div>
      {loading && <p className="no-print font-bold">Chargement du livre…</p>}
      {error != null && !data && <p className="no-print font-bold">{rpcErrorMessage(error)}</p>}
      {data && (
        <>
          <div className="album-sheet flex items-center justify-center">
            <div className="w-full max-w-md">
              <AlbumCover year={year} soirees={data.soirees} />
            </div>
          </div>
          {data.soirees.map((s) => (
            <div key={s.soiree_id} className="album-sheet mx-auto max-w-md pt-2">
              <AlbumLeaf soiree={s} />
            </div>
          ))}
        </>
      )}
    </div>
  )
}
