import { useState } from 'react'
import { ClipboardPaste, Music } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { QrSvg } from '@/features/guest/GuestInvite'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { toastError } from './errors'
import { loose } from './hostTools'

/**
 * Musique de la soirée = une Spotify Jam lancée par l'hôte (supabase/features/musique.sql) : simple lien,
 * aucune API Spotify. Tous les joueurs du salon ouvrent la Jam pour ajouter leurs sons à la file.
 */
export const soireeMusicUrl = (soiree: unknown): string | null =>
  (soiree as { music_url?: string | null } | null)?.music_url ?? null

const setMusic = async (soireeId: string, url: string | null) => {
  const { error } = await loose.rpc('set_soiree_music', { p_soiree_id: soireeId, p_url: url })
  if (error) throw error
}

const openJam = (url: string) => window.open(url, '_blank', 'noopener')

/** Salon : bouton « Ajouter une musique » (tous) + réglage du lien (hôte). Rien pour un joueur si pas de Jam. */
export function SoireeMusicCard({ soireeId, url, isHost }: { soireeId: string; url: string | null; isHost: boolean }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  if (!url && !isHost) return null

  const save = async (value: string | null) => {
    setBusy(true)
    try {
      await setMusic(soireeId, value)
      if (value) {
        fx.success()
        toast.success('🎵 Musique branchée : tout le monde peut ajouter ses sons !')
      } else toast.success('Musique retirée.')
      setOpen(false)
      setDraft('')
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  const paste = async () => {
    try {
      const t = await navigator.clipboard.readText()
      if (t) setDraft(t)
    } catch {
      toast.error('Impossible de lire le presse-papier : appuie longuement dans la case puis « Coller ».')
    }
  }

  return (
    <>
      {url ? (
        <div className="flex flex-col gap-1.5">
          <Button size="lg" fullWidth icon={<Music className="size-6" />} onClick={() => openJam(url)}>
            Ajouter une musique
          </Button>
          <p className="text-center text-sm font-bold text-muted">
            Ouvre la Jam Spotify de la soirée : choisis un son, il passe dans la file 🎶
            {isHost && (
              <>
                {' · '}
                <button type="button" className="underline" onClick={() => setOpen(true)}>
                  Changer
                </button>
              </>
            )}
          </p>
        </div>
      ) : (
        <Button variant="secondary" fullWidth icon={<Music className="size-5" />} onClick={() => setOpen(true)}>
          Mettre la musique (Spotify)
        </Button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="🎵 La musique de la soirée">
        <div className="flex flex-col gap-3">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-left font-bold">
            <li>Dans Spotify (Premium), lance une musique sur ton téléphone ou ton enceinte.</li>
            <li>Ouvre la file d’attente et appuie sur « Démarrer une Jam ».</li>
            <li>Appuie sur « Inviter », puis « Partager le lien » et copie-le.</li>
            <li>Colle le lien ici 👇</li>
          </ol>
          <div className="flex gap-2">
            <input
              aria-label="Lien de la Jam Spotify"
              placeholder="https://spotify.link/…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="sticker-sm min-w-0 flex-1 rounded-card border-[3px] border-ink bg-surface px-3 py-2 font-bold text-text outline-none"
            />
            <Button variant="secondary" aria-label="Coller" icon={<ClipboardPaste className="size-5" />} onClick={() => void paste()} />
          </div>
          <p className="text-sm text-muted">Tout le monde, même avec Spotify gratuit, pourra ajouter ses sons. La télé affiche aussi un QR code.</p>
          <Button fullWidth size="lg" loading={busy} disabled={!draft.trim()} onClick={() => void save(draft)}>
            Brancher la musique
          </Button>
          {url && (
            <Button variant="ghost" fullWidth disabled={busy} onClick={() => void save(null)}>
              Retirer la musique
            </Button>
          )}
        </div>
      </Modal>
    </>
  )
}

/** Télé, entre deux parties : QR code de la Jam dans un coin. */
export function TvMusicQr({ url }: { url: string }) {
  return (
    <div className="sticker pointer-events-none absolute right-3 bottom-3 z-10 flex flex-col items-center gap-1 rounded-card bg-surface p-2">
      <QrSvg text={url} size={120} />
      <span className="font-display text-sm font-extrabold">🎵 Ajoute ta musique !</span>
    </div>
  )
}
