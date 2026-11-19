import { toast } from '@/store/toast'

/** Messages FR des erreurs métier des RPC soirée / jeux (cf. supabase/README.md). */
const MESSAGES: Record<string, string> = {
  not_authenticated: 'Connexion perdue. Recharge l’app et réessaie.',
  not_logged_in: 'Tu n’es plus connecté·e. Choisis ton personnage.',
  unknown_profile: 'Ce joueur n’existe pas.',
  // Multi-soirées : 5 soirées non terminées au plus par joueur.
  too_many_soirees: 'Tu es déjà dans 5 soirées : quittes-en une d’abord !',
  already_in_soiree: 'Tu es déjà dans une soirée.', // ancien serveur (une seule soirée)
  player_busy: 'Déjà dans 5 soirées',
  soiree_not_found: 'Aucune soirée avec ce code…',
  soiree_ended: 'Cette soirée est terminée.',
  soiree_not_ended: 'Le récap sera disponible quand la soirée sera terminée.',
  profile_not_found: 'Ce joueur est introuvable.',
  not_in_soiree:'Tu n’es plus dans cette soirée.',
  invalid_message: 'Message vide ou trop long (200 caractères max).',
  chat_too_fast: 'Doucement ! Attends quelques secondes avant d’écrire encore.',
  not_host: 'Seul l’hôte peut faire ça.',
  soiree_banned: 'L’hôte t’a retiré de cette soirée. Demande-lui de te ré-inviter.',
  cannot_kick_self: 'Tu ne peux pas t’exclure toi-même.',
  invalid_wheel: 'Il faut au moins 2 jeux pour faire tourner la roue.',
  match_in_progress: 'Une partie est déjà en cours !',
  pronos_closed: 'Les pronostics sont terminés.',
  invalid_pick: 'Ce joueur ne fait pas partie de la manche.',
  invalid_pronos: 'Impossible d’ouvrir les pronostics avec ces joueurs.',
  player_not_in_soiree: 'Un joueur choisi n’est plus dans la soirée.',
  unknown_game: 'Jeu inconnu.',
  not_enough_players: 'Pas assez de joueurs pour ce jeu.',
  missing_questions: 'Il manque des questions.',
  invalid_questions: 'Questions invalides.',
  invalid_pair: 'Paire de mots invalide.',
  match_not_found: 'Partie introuvable.',
  match_not_playing: 'La partie est terminée.',
  match_already_finished: 'La partie est terminée.',
  not_in_match: 'Tu ne joues pas cette partie.',
  invalid_action: 'Action impossible.',
  unknown_action: 'Action inconnue.',
  wrong_phase: 'Trop tard (ou trop tôt) pour ça !',
  not_finished: 'Remplis toutes tes cases avant de crier STOP !',
  not_a_player: 'Tu ne joues pas cette partie.',
  not_alive: 'Tu as été éliminé·e : tu regardes la partie.',
  invalid_target: 'Ce joueur ne peut pas être choisi.',
  cannot_vote_self: 'Pas le droit de voter pour toi-même !',
  // Pas de bol !
  not_your_turn: 'Ce n’est pas ton tour !',
  card_not_in_hand: 'Tu n’as plus cette carte.',
  card_not_playable: 'Cette carte ne peut pas être posée maintenant.',
  invalid_color: 'Choisis une couleur.',
  too_many_players: 'Trop de joueurs pour ce jeu.',
  // Cerveau en fête
  wrong_mode: 'Cette question se joue autrement.',
  invalid_choice: 'Choix invalide.',
  // Petit bac
  invalid_categories: 'Catégories invalides.',
  // Dessine & devine
  not_drawer: 'Seul le dessinateur peut choisir le mot.',
  drawer_cannot_guess: 'Tu dessines : pas le droit de deviner !',
  already_found: 'Tu as déjà trouvé !',
  not_enough_words: 'Pas assez de mots pour cette partie.',
  // Tu préfères ?
  missing_dilemmas: 'Il manque des dilemmes.',
  invalid_dilemmas: 'Dilemmes invalides.',
  // Menteur
  invalid_bid: 'Enchère invalide.',
  bid_too_low: 'Il faut monter l’enchère !',
  paco_opening: 'On n’ouvre pas sur les 1 !',
  no_bid_yet: 'Personne n’a encore enchéri.',
  pile_disabled: 'La variante « Pile ! » n’est pas activée.',
  // Bombe à mots
  invalid_syllables: 'Syllabes invalides.',
  bomb_paused: 'Attends le top départ !',
  bomb_not_ready: 'La bombe n’a pas encore explosé.',
  too_late: 'Trop tard, la bombe a bougé !',
  invalid_word: 'Lettres uniquement (et tirets) !',
  word_missing_syllable: 'Ton mot ne contient pas la syllabe !',
  word_too_short: 'Trop court : il faut plus que la syllabe !',
  word_already_played: 'Déjà joué dans la partie !',
  // Loup-garou
  invalid_composition: 'Composition des rôles invalide.',
  already_acted: 'Tu as déjà agi cette nuit.',
  no_potion: 'Tu n’as plus cette potion.',
  // Bowling
  wrong_roll: 'Ce lancer ne correspond pas à ta feuille de score.',
  too_early: 'Attends le feu vert !',
  wrong_lap: 'Tour non reconnu : continue la course.',
  too_fast: 'Tour trop rapide pour être honnête 😏',
  invalid_roll: 'Lancer invalide : ces quilles sont déjà tombées.',
  already_done: 'Tu as déjà fini ta partie !',
  // Qui suis-je ?
  wrong_card: 'Carte déjà validée !',
  invalid_card: 'Carte invalide.',
  missing_cards: 'Il manque des cartes.',
  not_enough_cards: 'Pas assez de cartes pour ces réglages.',
  invalid_cards: 'Cartes invalides.',
  // Le plus proche
  invalid_number: 'Ce n’est pas un nombre valide.',
  number_out_of_range: 'Nombre beaucoup trop grand !',
  // Action ou vérité
  target_cannot_vote: 'C’est ton destin : pas le droit de voter !',
  // Devine en équipe / Dessine & devine
  invalid_teams: 'Chaque équipe doit avoir au moins 2 joueurs.',
  not_speaker: 'Ce n’est pas toi l’orateur !',
  missing_words: 'Aucun mot tiré pour la partie.',
  invalid_words: 'Liste de mots invalide.',
  not_your_guess: 'Ce n’est pas à toi de deviner.',
  invalid_guess: 'Écris un mot.',
  code_generation_failed: 'Impossible de créer le code, réessaie.',
  // Jeux en duel (socle commun supabase/features/duel.sql + plateaux)
  not_duelist: 'Tu ne joues pas ce duel : tu regardes !',
  duelist_cannot_bet: 'Tu joues ce duel : pas le droit de parier !',
  invalid_bet: 'Pari invalide.',
  bets_closed: 'Trop tard, les paris sont fermés !',
  already_ready: 'Tu es déjà prêt·e !',
  invalid_move: 'Coup impossible.',
  column_full: 'Cette colonne est pleine !',
  invalid_mode: 'Format de session inconnu.',
  invalid_duel_players: 'Choisis deux joueurs différents de la partie.',
  invalid_board: 'Erreur du plateau, réessaie.',
  no_next_duel: 'Plus de duel à jouer.',
  setup_incomplete: 'Termine ta préparation avant de valider !',
  // Morpion
  cell_taken: 'Cette case est déjà prise !',
  wrong_board: 'Tu dois jouer dans le petit morpion en surbrillance !',
  board_closed: 'Ce petit morpion est déjà terminé !',
  invalid_variant: 'Variante de morpion inconnue.',
  // Bataille navale (invalid_fleet / fleet_overlap levés via raise exception '%')
  invalid_fleet: 'Flotte invalide : place tes 5 bateaux dans la grille !',
  fleet_overlap: 'Deux bateaux se chevauchent !',
  already_shot: 'Tu as déjà tiré sur cette case !',
  // Le Tour des Potes
  not_enough_cash: 'Pas assez d’argent !',
  invalid_cell: 'Case invalide.',
  not_buildable: 'On ne construit pas sur cette case.',
  not_owner: 'Ce lieu ne t’appartient pas.',
  group_incomplete: 'Il te faut tout le quartier pour construire !',
  build_uneven: 'Construis d’abord sur les autres lieux du quartier (pas plus d’une maison d’écart).',
  max_buildings: 'Il y a déjà un hôtel ici !',
  no_buildings: 'Aucun bâtiment à vendre ici.',
  sell_uneven: 'Vends d’abord sur les lieux les plus construits du quartier.',
  no_jail_card: 'Tu n’as pas de carte « Sortie du violon ».',
  // Défi du jour
  daily_already_started: 'Tu as déjà tenté le défi d’aujourd’hui. À demain !',
  daily_not_started: 'Le défi n’a pas été démarré.',
  daily_already_done: 'Défi déjà terminé aujourd’hui.',
  invalid_answers: 'Réponses invalides.',
  // Rappels push (src/features/push)
  invalid_subscription: 'Ce téléphone n’a pas pu s’abonner aux rappels. Réessaie.',
  push_denied: 'Les notifications sont bloquées pour l’app.',
  push_dismissed: 'Il faut toucher « Autoriser » pour recevoir le rappel.',
  push_no_sw: 'L’app n’est pas encore prête : recharge-la puis réessaie.',
  push_failed: 'Impossible d’activer les rappels sur cet appareil. Réessaie plus tard.',
}

function raw(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message ?? '')
  return ''
}

/** Code métier (ex. `player_busy`) ou null. */
export function errorCode(err: unknown): string | null {
  const m = raw(err).trim()
  if (MESSAGES[m]) return m
  return Object.keys(MESSAGES).find((c) => new RegExp(`\\b${c}\\b`).test(m)) ?? null
}

/** Détails de l'erreur Postgres (ex. pseudos pour player_busy). */
export function errorDetails(err: unknown): string | null {
  if (err && typeof err === 'object' && 'details' in err) {
    const d = (err as { details: unknown }).details
    return typeof d === 'string' && d ? d : null
  }
  return null
}

export function errorMessage(err: unknown): string {
  const code = errorCode(err)
  if (code === 'player_busy') {
    const who = errorDetails(err)
    return who ? `Déjà dans 5 soirées : ${who}` : 'Un joueur est déjà dans 5 soirées.'
  }
  if (code) return MESSAGES[code]
  if (/failed to fetch|networkerror|network request|load failed/i.test(raw(err))) {
    return 'Pas de connexion au serveur. Vérifie ton réseau.'
  }
  return 'Oups, quelque chose s’est mal passé. Réessaie.'
}

/** Toast d'erreur (le toast joue déjà le son d'échec). */
export function toastError(err: unknown) {
  console.warn('[soiree]', err)
  toast.error(errorMessage(err))
}
