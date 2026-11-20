---
name: roadmap-meta-soiree
description: "Roadmap des features \"méta-soirée\" décidée le 2026-11-17 (lots A-G, choix produit validés)"
metadata:
  node_type: memory
  type: project
  originSessionId: f73474be-08d0-4c4b-8064-0a12cb02ed42
  modified: 2026-11-17T20:50:53.588Z
---

Roadmap validée le 2026-11-17 (pas de nouveaux jeux pour l'instant) :
- A (Sonnet) : exclure un joueur (hôte seul, interdit pendant une partie, retour seulement sur ré-invitation) + roue des jeux.
- B (Sonnet) : classement de soirée (points cumulés + podium), historique des soirées, profil (meilleur jeu = plus fort, jeu préféré = plus joué).
- C (Sonnet) : récap « Wrapped » de fin de soirée.
- D (Fable design + Sonnet) : trophées ; une tenue débloquée ne donne que `joie`, chaque autre sticker de la tenue se gagne via un trophée lié au jeu de la tenue.
- E (Fable + Sonnet) : défi du jour solo + classement hebdo.
- F (Opus) : mode télé (vue spectateur) pour les duels + tournoi à élimination avec grosses têtes chibi.
- G (Fable scripts + Sonnet) : vidéos d'explication Remotion (mp4 30-45 s par jeu, bouton « Comment on joue ? »), réutiliser `promo-video/`.

Décisions du 2026-11-17 : podium = titre neutre « Star de la soirée » (pas de genre) ; barème soirée 3/2/1 + perdant de duel 1 ; trophées de tenue comptés même avant d'avoir la tenue ; trophées dépendant d'une option de jeu conservés. Design trophées : docs/TROPHEES.md.

**Why:** l'utilisateur veut valoriser l'existant (20 jeux) plutôt qu'ajouter des jeux ; il accepte que Claude délègue aux modèles adaptés.
**How to apply:** reprendre les lots dans cet ordre ; agents ne commitent pas, Claude commite et rappelle `npm run sql`.
