import { useState } from 'react'
import { useNavigate } from 'react-router'
import { Repeat } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { useIsGuest } from '@/features/guest/api'
import { readScenario } from '@/features/reveillon/api'
import type { GameDefinition } from '@/games/types'
import type { GameId, GameOptions } from '@/types/db'
import { errorCode, toastError } from './errors'
import { refetchActiveSoirees, type SoireeData } from './hooks'
import { loadLaunch, saveLaunch, type LauncherPreset } from './rematch'

/**
 * « Revanche ! » de l'écran de résultats : l'hôte relance le même jeu, mêmes joueurs, mêmes
 * réglages (le contenu est retiré à neuf par `prepareStart`). Les autres suivent seuls : MatchPage
 * enchaîne dès qu'une nouvelle partie `playing` apparaît dans la soirée.
 * Impossible (joueur parti, trop peu de joueurs, réglages perdus) -> lanceur du salon pré-rempli.
 */
export function RematchButton({ matchId, game, meId, soireeData, resultIds, onStarted }: { matchId: string; game: GameDefinition | undefined; meId: string; soireeData: SoireeData | null; resultIds: string[]; onStarted: (matchId: string, game: string) => void }) {
  const navigate = useNavigate()
  const isGuest = useIsGuest()
  const [busy, setBusy] = useState(false)
  if (!game || !soireeData || isGuest) return null
  const { soiree, playerIds: present } = soireeData
  // Soirée finie ou scénarisée (Réveillon) : pas de revanche.
  if (soiree.status === 'ended' || readScenario(soiree)) return null

  if (soiree.host_id !== meId) {
    return <p className="text-center font-bold text-muted">L’hôte peut lancer la revanche 🔁</p>
  }

  const memo = loadLaunch(matchId)
  const wanted = memo?.gameId === game.id ? memo.playerIds : resultIds
  const playing = wanted.filter((id) => present.includes(id))

  const toLauncher = () => {
    const preset: LauncherPreset = { gameId: game.id, options: memo?.gameId === game.id ? memo.options : undefined }
    toast.success('Vérifie les réglages, puis lance la partie !')
    navigate(`/soiree/${soiree.id}`, { replace: true, state: { preset } })
  }

  const go = async () => {
    // Joueur parti, trop peu / trop de joueurs, ou réglages inconnus : on passe par le lanceur.
    if (!memo || memo.gameId !== game.id || playing.length !== wanted.length || playing.length < game.minPlayers || playing.length > game.maxPlayers) return toLauncher()
    setBusy(true)
    try {
      const prepared = game.prepareStart ? await game.prepareStart(memo.options, { playerIds: playing }) : { ...memo.options }
      const p_options = present.some((id) => !playing.includes(id)) ? { ...prepared, player_ids: playing } : prepared
      const { data, error } = await supabase.rpc('start_match', {
        p_soiree_id: soiree.id,
        p_game_id: game.id as GameId,
        p_options: p_options as unknown as GameOptions,
      })
      if (error) {
        if (errorCode(error) === 'match_in_progress') toast.error('Une partie est déjà en cours !')
        else toastError(error)
        if (errorCode(error) === 'soiree_ended') void refetchActiveSoirees()
        return
      }
      const newId = data as string
      saveLaunch(newId, { gameId: game.id, options: memo.options, playerIds: playing })
      fx.fanfare()
      onStarted(newId, game.id)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size="lg" fullWidth loading={busy} icon={<Repeat className="size-6" />} onClick={() => void go()}>
      🔁 Revanche !
    </Button>
  )
}
