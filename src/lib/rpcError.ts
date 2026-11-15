import type { RpcErrorCode } from '@/types/db'
import { toast } from '@/store/toast'

export const RPC_ERROR_MESSAGES: Record<RpcErrorCode, string> = {
  not_authenticated: "Connexion perdue. Recharge l'app et réessaie.",
  not_logged_in: "Tu n'es plus connecté. Choisis ton personnage.",
  forbidden: "Tu n'as pas le droit de faire ça.",
  unknown_profile: "Ce joueur n'existe pas.",
  invalid_nickname: 'Le pseudo doit faire entre 1 et 20 caractères.',
  unknown_expression: "Cette expression n'existe pas.",
  expression_locked: "Cette expression n'est pas encore débloquée.",
  unknown_tenue: "Cette tenue n'existe pas.",
  tenue_locked: "Cette tenue n'est pas encore débloquée.",
  invalid_friend: 'Tu ne peux pas faire ça avec ce joueur.',
  no_pending_request: "Cette demande d'ami n'existe plus.",
  already_in_soiree: 'Tu es déjà dans une soirée.',
  player_busy: 'Un joueur est déjà dans une autre soirée.',
  soiree_not_found: 'Soirée introuvable.',
  soiree_ended: 'Cette soirée est terminée.',
  not_host: "Seul l'hôte peut faire ça.",
  match_in_progress: 'Une partie est déjà en cours.',
  player_not_in_soiree: "Ce joueur n'est pas dans la soirée.",
  unknown_game: 'Jeu inconnu.',
  not_enough_players: 'Pas assez de joueurs.',
  missing_questions: 'Il manque des questions.',
  invalid_questions: 'Questions invalides.',
  invalid_pair: 'Paire de mots invalide.',
  match_not_found: 'Partie introuvable.',
  match_not_playing: "La partie n'est plus en cours.",
  not_in_match: 'Tu ne fais pas partie de cette partie.',
  invalid_action: 'Action impossible.',
  unknown_action: 'Action inconnue.',
  wrong_phase: "Ce n'est pas le bon moment pour faire ça.",
  not_a_player: 'Tu ne joues pas cette partie.',
  not_alive: 'Tu as été éliminé.',
  invalid_target: 'Cible invalide.',
  cannot_vote_self: 'Tu ne peux pas voter pour toi-même.',
  not_your_guess: "Ce n'est pas à toi de deviner.",
  invalid_guess: 'Réponse invalide.',
  code_generation_failed: 'Impossible de créer le code, réessaie.',
}

const CODES = Object.keys(RPC_ERROR_MESSAGES) as RpcErrorCode[]

function rawMessage(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message)
  return ''
}

/** Extrait le code métier d'une erreur supabase / Error / string (ou null). */
export function rpcErrorCode(err: unknown): RpcErrorCode | null {
  const raw = rawMessage(err)
  const exact = CODES.find((c) => raw.trim() === c)
  if (exact) return exact
  return CODES.find((c) => new RegExp(`\\b${c}\\b`).test(raw)) ?? null
}

export function isNetworkError(err: unknown): boolean {
  return /failed to fetch|networkerror|network request|load failed/i.test(rawMessage(err) || String(err))
}

/** Message FR lisible pour n'importe quelle erreur de RPC. */
export function rpcErrorMessage(err: unknown): string {
  const code = rpcErrorCode(err)
  if (code) return RPC_ERROR_MESSAGES[code]
  if (isNetworkError(err)) return 'Pas de connexion au serveur. Vérifie ton réseau.'
  return "Oups, quelque chose s'est mal passé. Réessaie."
}

/** Affiche l'erreur en toast et renvoie le message. */
export function toastRpcError(err: unknown): string {
  const msg = rpcErrorMessage(err)
  toast.error(msg)
  return msg
}
