// Vidéo d'annonce de l'événement « Noël chez Dédé » (composition `NoelIntro`, 720×1280, 30 FPS).
// Ici : uniquement les textes à l'écran et la durée de chaque temps. La mise en scène est dans NoelIntro.tsx.
// Pas de voix off : phrases très courtes (lisibles en 2 s), bruitages + petite boîte à musique.
// Les temps commencent à 0, 5, 11, 18, 25 et 32 s : pile sur les temps forts de la musique (120 à la noire).
// Rendu (comme les tutos, CRF 33 pour rester sous 3 Mo), puis copie dans ../public/videos/noel-2026.mp4 :
//   npx remotion render src/index.ts NoelIntro out/noel-2026.mp4 --codec=h264 --crf=33 --x264-preset=veryslow --pixel-format=yuv420p --audio-bitrate=48k

/** Volume de la boîte à musique (public/sfx/noel-music.mp3, `node scripts/make-noel-music.mjs`). 0 = bruitages seuls. */
export const MUSIC_VOLUME: number = 0.2

export const NOEL = {
  /** 1. Accroche : Kéké Père Noël surgit. */
  accroche: {
    seconds: 5,
    bulle: 'Ho ho ho !',
    titre: ['Noël', 'chez Dédé'],
    pastille: 'commence !',
    dates: ['📅 1er décembre', '→ 6 janvier'],
  },

  /** 2. Les missions du jour : 3 cases qui se cochent. */
  missions: {
    seconds: 6,
    titre: '✅ Les missions du jour',
    accroche: '3 missions par jour',
    liste: ['Finis le défi du jour', '3 sur 5 à la Hotte', 'Ouvre le calendrier'],
    gain: '+30 ❄️',
    bulle: ['2 minutes', 'et c’est plié !'],
    bonus: '🥳 En soirée : bonus +30 ❄️',
  },

  /** 3. La Hotte du jour : 5 manches, un seul essai. */
  hotte: {
    seconds: 7,
    titre: '🎁 La Hotte du jour',
    accroche: '5 manches de Noël',
    manches: [
      { emoji: '❓', nom: 'Quiz' },
      { emoji: '🎁', nom: 'Cadeau disparu' },
      { emoji: '🕵️', nom: 'L’intrus' },
      { emoji: '🔢', nom: 'Combien ?' },
      { emoji: '🎵', nom: 'Chanson' },
    ],
    regles: ['☝️ Un seul essai par jour', '✅ Bonne réponse = 6 ❄️', '🏆 Le classement de la bande'],
  },

  /** 4. Le Pass de Noël : 30 paliers, la tenue Père Noël au bout. */
  pass: {
    seconds: 7,
    titre: '🎟️ Le Pass de Noël',
    accroche: '30 paliers de cadeaux',
    cadeaux: ['🪙 Des pièces', '🎀 De la déco de Noël', '✨ Des effets spéciaux'],
    ruban: 'PALIER 30',
    tenue: '🎅 La tenue Père Noël !',
    tampon: 'Réservé aux acharnés ! 💪',
    serie: '🔥 Jours d’affilée = bonus ❄️',
  },

  /** 5. La Grande Hotte de la bande : jauge commune à 5 paliers → le Gros Lot. */
  grandeHotte: {
    seconds: 7,
    titre: '🛷 La Grande Hotte',
    accroche: 'Toute la bande la remplit !',
    paliers: ['🪙', '✨', '🌌', '🎄', '🎁'],
    grosLot: 'LE GROS LOT !',
    lots: ['🛌 La tenue Pyjama', '🎉 Une soirée secrète', '🏆 Un trophée unique'],
    condition: ['Pour en profiter :', 'apporte au moins 400 ❄️ !'],
  },

  /** 6. Fin : rendez-vous chaque jour. */
  fin: {
    seconds: 4,
    appel: ['Rendez-vous', 'chaque jour !'],
    titre: ['Noël', 'chez Dédé'],
    dates: '📅 Du 1er décembre au 6 janvier',
    signature: 'Les Soirées de Dédé',
  },
} as const

export type NoelPartId = keyof typeof NOEL
export const NOEL_ORDER: NoelPartId[] = ['accroche', 'missions', 'hotte', 'pass', 'grandeHotte', 'fin']
/** Durée totale en secondes (36 s). */
export const NOEL_SECONDS = NOEL_ORDER.reduce((n, id) => n + NOEL[id].seconds, 0)
