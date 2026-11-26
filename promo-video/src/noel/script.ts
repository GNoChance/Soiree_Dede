// Vidéo d'annonce « Noël chez Dédé » v2 (composition `NoelIntro`, 720×1280, 30 FPS, 45 s = 1350 images).
// Référence : docs/NOEL-VIDEO-2026.md (le début est joué par un CHIBI, il n'y a pas de prise filmée).
// Ici : textes, repères de temps et réglages du chibi « hôte ». La mise en scène est dans NoelIntro.tsx (assemblage),
// take.tsx (salon, chibi qui parle, givre, glaçon), scenes*.tsx (les temps « pub »), fx.tsx (effets), sfx.tsx (bruitages).
// Musique à 120 à la noire (1 temps = 0,5 s = 15 images) : chaque coupe tombe sur un temps.
//
// Rendu (< 4 Mo), puis copie dans ../public/videos/noel-2026.mp4 :
//   npx remotion render src/index.ts NoelIntro out/noel-2026.mp4 --codec=h264 --crf=35 --x264-preset=veryslow --pixel-format=yuv420p --audio-bitrate=64k --image-format=png
// Contrôle visuel : node scripts/noel-stills.mjs 1.5 5 9.0 …  (secondes) → out/check-*.png

/** Le chibi qui annonce (0–12 s) : slug du perso. Sa tenue « chemise » est dans public/chibis/<HOST>/<HOST_OUTFIT>/<expression>.webp. */
export const HOST: string = 'kevin'
export const HOST_OUTFIT = 'chemise'

/** Ce que dit le chibi (secondes de la vidéo finale ; bulle sticker, texte en machine à écrire, 2 à 4 mots à la fois). */
export const HOST_LINES: { from: number; to: number; text: string; expr: string; expr2?: string; expr2At?: number }[] = [
  { from: 0.3, to: 1.5, text: 'Salut la bande.', expr: 'joie' },
  { from: 1.5, to: 2.6, text: 'Petit message :', expr: 'clin_oeil' },
  { from: 2.6, to: 4.0, text: 'cette année, pour Noël,', expr: 'reflexion' },
  { from: 4.0, to: 5.0, text: 'sur l’appli…', expr: 'reflexion' },
  { from: 5.0, to: 5.9, text: 'j’ai rien prévu.', expr: 'clin_oeil' },
  { from: 5.9, to: 6.5, text: 'Voilà.', expr: 'joie' },
  // sourire satisfait (cool) sur « tranquille »
  { from: 6.5, to: 7.7, text: 'Un mois de décembre tranquille,', expr: 'joie', expr2: 'cool', expr2At: 7.15 },
  { from: 7.7, to: 8.5, text: 'bien au ch—', expr: 'cool' },
]

// ── Repères de temps (secondes de la vidéo finale) ─────────────────────────────────────────────────────
export const T = {
  presage: 7.0, // flocon, givre, la chemise frémit, vent qui monte
  cut: 8.5, // rafale : le mot est coupé, le chibi est poussé
  glacon: 9.7, // arrêt sur image
  crack: [10.5, 11.0, 11.5], // crac, crac, CRAC (décompte de la musique)
  noel: 12.0, // éclat : Kéké en sort en Père Noël + musique
  missions: 16.0,
  hotte: 21.0,
  pass: 26.5,
  grandeHotte: 32.5,
  rdv: 39.5,
  chute: 42.5,
  end: 45.0,
} as const

/** Volume de la boîte à musique (public/sfx/noel-music.mp3, `node scripts/make-noel-music.mjs`). */
export const MUSIC_VOLUME = 0.34
/** La musique démarre pile sur l'éclat du glaçon. */
export const MUSIC_START_S = 12.0
/** « Silences d'un temps » : musique coupée [de, à] en secondes (24,0 / 30,0 / 35,5). */
export const MUSIC_SILENCES: [number, number][] = [
  [24.0, 24.5],
  [30.0, 30.5],
  [35.5, 36.0],
]

// ── Textes à l'écran (faits identiques à la v1) ───────────────────────────────────────────────────────
export const NOEL = {
  /** 5. Noël débarque : Kéké Père Noël en traîneau. */
  accroche: {
    bulle: ['Ho', 'ho', 'ho !'],
    titre: ['Noël', 'chez Dédé'] as const,
    dates: ['📅 1er décembre', '→ 6 janvier'],
  },

  /** 6. Les missions du jour : 3 cartes tamponnées. */
  missions: {
    nombre: '3',
    accroche: ['missions', 'par jour'],
    liste: [
      { emoji: '🎯', texte: 'Finis le défi du jour' },
      { emoji: '🎁', texte: '3 sur 5 à la Hotte' },
      { emoji: '📅', texte: 'Ouvre le calendrier' },
    ],
    gain: '+30 ❄️',
    bulle: ['2 minutes', 'et c’est plié !'],
    bonus: '🥳 En soirée : bonus +30 ❄️',
  },

  /** 7. La Hotte du jour : 5 manches, un seul essai. */
  hotte: {
    titre: '🎁 La Hotte du jour',
    accroche: '5 manches de Noël',
    manches: [
      { emoji: '❓', nom: 'Quiz' },
      { emoji: '🎁', nom: 'Cadeau disparu' },
      { emoji: '🕵️', nom: 'L’intrus' },
      { emoji: '🔢', nom: 'Combien ?' },
      { emoji: '🎵', nom: 'Chanson' },
    ],
    essai: '☝️ Un seul essai par jour',
    bonne: '✅ Bonne réponse = 6 ❄️',
    classement: '🏆 Le classement de la bande',
  },

  /** 8. Le Pass de Noël : 30 paliers, la tenue Père Noël au bout. */
  pass: {
    titre: '🎟️ Le Pass de Noël',
    accroche: '30 paliers de cadeaux',
    cadeaux: ['🪙 Des pièces', '🎀 De la déco de Noël', '✨ Des effets spéciaux'],
    palier: 'PALIER 30',
    tenue: '🎅 La tenue Père Noël !',
    tampon: 'Réservé aux acharnés ! 💪',
    serie: '🔥 Jours d’affilée = bonus ❄️',
  },

  /** 9. La Grande Hotte de la bande : jauge commune à 5 paliers → le Gros Lot. */
  grandeHotte: {
    titre: '🛷 La Grande Hotte',
    accroche: 'Toute la bande la remplit !',
    paliers: ['🪙', '✨', '🌌', '🎄', '🎁'],
    grosLot: 'LE GROS LOT !',
    lots: ['🛌 La tenue Pyjama', '🎉 Une soirée secrète', '🏆 Un trophée unique'],
    condition: ['Pour en profiter :', 'apporte au moins', '400 ❄️ !'],
  },

  /** 10. Le rendez-vous : calendrier, logo, flocon sur l'icône de l'appli. */
  fin: {
    appel: ['Rendez-vous', 'chaque jour !'],
    titre: ['Noël', 'chez Dédé'] as const,
    dates: '📅 Du 1er décembre au 6 janvier',
    signature: 'Les Soirées de Dédé',
  },

  /** 11. La chute : Kéké Père Noël revient en gros plan, clin d'œil. */
  chute: {
    bulle: ['Bon… j’avais peut-être', 'prévu un petit truc.'],
  },
} as const
