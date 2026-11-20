---
name: nouveaux-jeux-22-25
description: "4 nouveaux jeux (Échecs, Kems, Mini-golf, Dédé Party) : tous livrés le 2026-11-19 avec tuto ; reste les tenues de Manon, Karo, Cycy"
metadata:
  type: project
---

Chantier lancé le 2026-11-19 et terminé le même jour : Échecs (n°22, tenue `grandmaitre`/art `chess`), Kems (n°23, `cowboy`), Mini-golf (n°24, `golfer`), Dédé Party (n°25, `host`). Chacun : spec Fable (`docs/superpowers/specs/2026-11-19-<id>-design.md`), code Opus, vidéo tuto (script Fable dans docs/VIDEOS-JEUX.md, rendu Sonnet), commit + push.

Restes ouverts :
- Planches + portraits chess/golfer/host/cowboy de Manon et Karo à intégrer (renvoi dans un nouveau message ; Karo : portrait cowboy jamais reçu). Cycy : 4 planches intégrées le 2026-11-19, ses 4 portraits manquent (dont vrai chess, host à régénérer).
- Dédé Party pas testé en vraie partie multi-téléphones ; ~1 joueur sur 4 sans étoile à 6-8 joueurs (constantes `_dp_const()` en tête de supabase/games/dede-party.sql).
- 2026-11-20 : Dédé Party passé en plateau 3D 47 cases (2 dés, Triple dé, multi-étoiles) et Dédé Kart à 6 circuits + 4 objets (par Fable), tutos refaits, tout poussé ; à tester en vrai (fluidité 3D téléphone, conduite au doigt) ; trophées « Constellation » (party) et « Tour du monde » (kart, encore 3 circuits) non recalés.
- Mini-golf : difficulté (trous en un fréquents) et lisibilité du looping à juger en vrai.

**Why:** suivi des retours de playtest et des assets manquants.
**How to apply:** voir [[autonomie-jeux-22-25]] (carte blanche limitée à ce chantier) et [[roadmap-meta-soiree]].
