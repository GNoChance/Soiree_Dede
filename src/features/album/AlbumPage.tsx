import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { motion, AnimatePresence, type PanInfo } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Skeleton } from '@/components/ui/Skeleton'
import { rpcErrorMessage } from '@/lib/rpcError'
import { AlbumLeaf } from './AlbumLeaf'
import { AlbumCover } from './AlbumCover'
import { AlbumPlaque } from './AlbumPlaque'
import { useGrosLot } from '@/features/noel/grosLot'
import { albumYearFrom, useAlbum } from './api'

/** /album : le livre de l'année, feuilleté page par page (boutons, glissement ou flèches du clavier). */
export function AlbumPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const year = albumYearFrom(params.toString())
  const { data, error, loading } = useAlbum(year)
  const [page, setPage] = useState(0)
  const [dir, setDir] = useState(1)
  // Plaque souvenir du Gros Lot de Noël : juste après la couverture de l'année de l'édition.
  const lot = useGrosLot()
  const plaque = lot?.reached && lot.year === year ? lot : null
  const extra = plaque ? 1 : 0
  const total = (data?.soirees.length ?? 0) + 1 + extra // couverture (+ plaque) + une page par soirée

  const go = useCallback(
    (d: number) => {
      setPage((p) => {
        const n = Math.min(Math.max(p + d, 0), Math.max(total - 1, 0))
        if (n !== p) setDir(d)
        return n
      })
    },
    [total],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go])

  const changeYear = (y: number) => {
    setPage(0)
    setParams({ annee: String(y) }, { replace: true })
  }
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < -60) go(1)
    else if (info.offset.x > 60) go(-1)
  }
  const thisYear = albumYearFrom('')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" aria-label="Retour" onClick={() => navigate('/historique')} icon={<ArrowLeft className="size-5" />} />
        <h1 className="flex-1 text-3xl">📖 Album</h1>
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Année précédente" disabled={year <= 2024} onClick={() => changeYear(year - 1)} icon={<ChevronLeft className="size-5" />} />
          <span className="min-w-12 text-center text-lg font-extrabold">{year}</span>
          <Button variant="secondary" size="sm" aria-label="Année suivante" disabled={year >= thisYear} onClick={() => changeYear(year + 1)} icon={<ChevronRight className="size-5" />} />
        </div>
      </div>

      {loading && <Skeleton className="h-96 w-full" />}
      {error != null && !data && <Card className="font-bold">{rpcErrorMessage(error)}</Card>}

      {data && (
        <>
          <div className="overflow-hidden">
            <AnimatePresence mode="wait" custom={dir} initial={false}>
              <motion.div
                key={`${year}-${page}`}
                custom={dir}
                initial={{ opacity: 0, x: dir * 60 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: dir * -60 }}
                transition={{ duration: 0.18 }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.4}
                onDragEnd={onDragEnd}
                className="touch-pan-y pb-2 pr-1"
              >
                {page === 0 ? (
                  <AlbumCover year={year} soirees={data.soirees} />
                ) : plaque && page === 1 ? (
                  <AlbumPlaque lot={plaque} />
                ) : (
                  <AlbumLeaf soiree={data.soirees[page - 1 - extra]} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {total > 1 && (
            <div className="flex items-center gap-3">
              <Button size="lg" variant="secondary" aria-label="Page précédente" disabled={page === 0} onClick={() => go(-1)} icon={<ChevronLeft className="size-6" />} />
              <p className="flex-1 text-center font-extrabold text-muted">{page === 0 ? 'Couverture' : plaque && page === 1 ? '🎄 Plaque souvenir' : `Soirée ${page - extra} / ${total - 1 - extra}`}</p>
              <Button size="lg" aria-label="Page suivante" disabled={page >= total - 1} onClick={() => go(1)} icon={<ChevronRight className="size-6" />} />
            </div>
          )}

          <Button fullWidth variant="secondary" icon={<Printer className="size-6" />} onClick={() => navigate(`/album/imprimer?annee=${year}`)} disabled={data.soirees.length === 0}>
            Imprimer / PDF
          </Button>
        </>
      )}
    </div>
  )
}
