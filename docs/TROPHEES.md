# Trophées — conception

Document de conception. Complète `docs/ARCHITECTURE.md` (« Expressions », « Tenues », « Trophées »).

**Avancement (phase 1 faite)** : socle serveur + front livrés (`supabase/features/trophees.sql`, `src/features/trophees/`).
Dans les tableaux, **✅ = branché et obtenable** (règles OK et FIN : stats recopiées dans `results[].stats` par le `_finish` du jeu),
**⏳ = au catalogue mais `active = false`** (compteur NEW à brancher en phase 2, non obtenable pour l'instant).
Le catalogue complet (230 trophées) est seedé ; passer un trophée NEW en actif = ajouter son compteur dans le jeu,
puis mettre sa `rule` + `active = true` dans le seed (`on conflict do update`).

Écarts à la conception initiale (décidés à l'implémentation) :
- **Slot = position dans la palette commune** `COSTUME_EXPRESSIONS` (joie=1 … déterminé=12), pas dans la liste filtrée des stickers « ratés » : un sticker raté (`TENUE_ART_BAD`) laisse son trophée en « badge seul », les autres slots ne bougent pas. `extraN` = slot 12+N, offert avec la tenue.
- `equip_expression(p_expression, p_slot)` et `send_soiree_message(…, p_slot)` reçoivent le **slot** du sticker (le client le calcule, `stickerSlot()`) ; sans `p_slot` : règles historiques de la planche de base.
- `finish_match` pose dans `match_players.stats` deux clés génériques : `last` (1 = dernier d'une partie non nulle) et `nplayers`.
- Changer de tenue (`equip_tenue`) remet le sticker porté sur `joie`.
- Évaluation : `sum` / `max` / `count` / `streak` / `all` / `special` (cf. en-tête de `trophees.sql`), progression lisible via la RPC `my_trophy_progress`.
- Aucun rattrapage à l'installation : un trophée « cumul » compte tout l'historique du jeu dès la prochaine partie de ce jeu (les compteurs FIN/NEW n'existent que pour les parties jouées après la mise à jour).

## 1. Principe

- Débloquer une tenue (10 victoires / 10 duels gagnés dans son jeu) ne donne plus que **le sticker n°1 de sa planche (`joie`)**.
- Les **11 autres stickers** de la planche se gagnent chacun avec **un trophée dédié, lié au jeu de la tenue** (tenue Bowler → trophées de bowling).
- La tenue `default` n'a pas de trophées : elle garde les conditions actuelles (tableau « Conditions de déblocage » d'ARCHITECTURE.md).

### 1.1 Mapping trophée → sticker : par position (slot 1..12)

Un trophée ne référence **jamais un id d'expression** : il porte `(tenue, slot)`, slot de 2 à 12.

> Le slot *k* d'une tenue débloque **le k-ième sticker de la planche de ce perso pour cette tenue**.

Liste ordonnée des stickers d'un perso pour une tenue (déjà calculable côté front, `src/components/ui/tenueArt.ts`) :

```
stickers(slug, tenue) = [...tenuePalette(slug, tenue), ...tenueExtras(slug, tenue)]   // joie toujours en 1
```

- slot 1 = `joie`, offert avec la tenue ;
- slot *k* (2..12) = `stickers[k-1]`, utilisable si le trophée `(tenue, k)` est gagné **et** la tenue débloquée.

Pourquoi c'est la solution la plus simple :

- **Aucune table de correspondance par perso.** Les différences de planches sont absorbées par la position : listes propres à Carole / Nini, stickers ratés au découpage (`TENUE_ART_BAD`), stickers bonus `extraN` (Dédé, Marius, Kevin croupier…).
- Le serveur ne connaît que `(profil, trophée)` ; c'est le front qui traduit slot → image.
- Planche de **moins de 12** stickers : les trophées en trop restent de simples trophées (badge + XP). Planche de **plus de 12** : les stickers au-delà du 12e sont offerts avec la tenue (comme les bonus aujourd'hui).

Constat utile fait en lisant le code : les planches de **tenues** utilisent déjà une palette commune à tous les persos (`COSTUME_EXPRESSIONS` : `joie, colere, pleurs, boude, reflexion, dodo, bisou, clin_oeil, surprise, pouces, timide, determine`). Les listes différentes de Carole et Nini (`pouces`, `timide`, `charmee`) ne concernent que la planche `default`, hors périmètre. Le mapping par position reste valable dans les deux cas.

Thème indicatif des slots (palette commune), utilisé pour donner une couleur aux trophées :

| Slot | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Expression | colère | pleurs | boude | réflexion | dodo | bisou | clin d'œil | surprise | pouces | timide | déterminé |
| Esprit | raté rigolo | raté rigolo | raté rigolo | cumul facile | cumul / patience | moment sympa | coup malin | coup d'éclat | belle perf | difficile | très difficile |

Les slots 2-4 sont donc des trophées « de consolation » (on les gagne en perdant : tout le monde en a vite), 5-9 se gagnent en quelques soirées, 10-11 demandent une vraie performance, 12 est le trophée dur de la tenue.

### 1.2 Modèle de données proposé

- `trophies` (catalogue, miroir `src/data/trophees.ts`) : `id`, `tenue_id` (null = trophée général), `slot` (2..12, null si général), `game_id`, `stat`, `agg` (`sum` | `max`), `threshold`.
- `trophy_unlocks (profile_id, trophy_id, unlocked_at)`.
- Évaluation dans le hook de fin de partie (`_after_finish_match`, comme les tenues), avec **une seule requête générique** sur `match_players` :
  - `agg = sum` → cumul : `sum((stats->>stat)::int)` sur toutes les parties du jeu ≥ seuil ;
  - `agg = max` → exploit en une partie : `max((stats->>stat)::int)` ≥ seuil.
- Chaque jeu remplit donc `results[].stats` (colonne `match_players.stats`, **déjà existante**) dans son `_finish`. Les conditions composées (« gagner sans perdre de vie ») sont calculées par le jeu sous forme de drapeau 0/1.
- Le state final reçoit `new_trophies` (comme `new_tenues`) pour l'animation de fin de partie.
- Vérification serveur à l'équipement / envoi d'un sticker : le client envoie le `slot` ; le serveur vérifie `(tenue équipée, slot)` dans `trophy_unlocks`. La cohérence id d'image ↔ slot reste côté front (cosmétique, jeu de famille).

Colonne « Donnée » des tableaux :

- **OK** : déjà disponible (`match_players.placement / points / won` ou clé déjà présente dans `stats`).
- **FIN** : calculable depuis le **state final** ; il suffit de le recopier dans `results[].stats` au moment du `_finish` (pas de suivi pendant la partie).
- **NEW** : **nouveau compteur** à incrémenter pendant la partie (l'information n'est plus dans le state à la fin).

« cumul » = sur toutes les parties ; « en une partie » = dans un seul match (une session de duels = un match).

### 1.3 Règles communes

- Les parties abandonnées (`aborted`) ne comptent pas (pas de `finish_match`).
- La progression compte **dès la première partie**, même sans la tenue ; le sticker devient utilisable quand la tenue est débloquée.
- Pas de rétroactivité pour les compteurs FIN / NEW (les anciennes parties n'ont pas de `stats`) ; les trophées OK peuvent être rattrapés à l'installation.
- Les seuils chiffrés (scores de bowling, montants du Tour des Potes, temps) sont des propositions à ajuster après deux ou trois soirées.

---

## 2. Trophées par tenue

### Star 🌟 — Qui de nous ? (`qui-de-nous`)

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `qdn_incompris` | L'incompris | Voter 5 fois hors de la majorité en une partie | FIN (`total_rounds − points`) ✅ |
| 3 | `qdn_tete_de_turc` | Tête de Turc | Être désigné par tous les autres joueurs sur une manche | FIN (`history[].counts`) ✅ |
| 4 | `qdn_a_cote_de_la_plaque` | À côté de la plaque | Finir dernier d'une partie | OK (placement) ✅ |
| 5 | `qdn_bon_public` | Bon public | 60 points en cumul | OK (points) ✅ |
| 6 | `qdn_invisible` | L'invisible | Finir une partie (8 manches min.) sans recevoir un seul vote | OK (`stats.designated` = 0) + FIN (nb de manches) ✅ |
| 7 | `qdn_chouchou` | Le chouchou | Recevoir 30 votes en cumul | OK (`stats.designated`) ✅ |
| 8 | `qdn_flair` | Le flair | Voter avec la majorité 5 manches d'affilée | PHASE 2 (`best_streak`, mis à jour à chaque révélation) ✅ |
| 9 | `qdn_plebiscite` | Plébiscite | Être le plus désigné sur 5 manches d'une même partie | FIN (`history[].majority`) ✅ |
| 10 | `qdn_star_de_la_soiree` | Star de la soirée | Être le joueur le plus désigné de la partie, 3 fois (cumul) | FIN (`designated`) ✅ |
| 11 | `qdn_telepathe` | Télépathe | 8 points ou plus sur une partie de 10 manches | OK (points) + FIN (nb de manches) ✅ |
| 12 | `qdn_voix_du_peuple` | La voix du peuple | Voter avec la majorité à toutes les manches d'une partie (10 manches min.) | FIN (`points = total_rounds`) ✅ |

### Espion 🕵️ — Undercover (`undercover`)

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `uc_grille` | Grillé ! | Être éliminé en premier | OK (`stats.undercover_first_out`) ✅ |
| 3 | `uc_erreur_judiciaire` | Erreur judiciaire | Être éliminé en étant civil, 3 fois (cumul) | FIN (`roles`, `eliminated`) ✅ |
| 4 | `uc_bavure` | La bavure | En civil, voter contre un autre civil 5 fois (cumul) | PHASE 2 (`wrong_votes`, à chaque dépouillement) ✅ |
| 5 | `uc_fin_limier` | Fin limier | Voter contre un infiltré 5 fois (cumul) | PHASE 2 (`good_votes`) ✅ |
| 6 | `uc_planque` | La planque | Être encore en vie à la fin de 5 parties (cumul) | FIN (`eliminated`) ✅ |
| 7 | `uc_bon_citoyen` | Bon citoyen | Gagner 5 parties en civil (cumul) | FIN (`role` déjà dans `results`, à mettre dans `stats`) ✅ |
| 8 | `uc_taupe` | La taupe | Gagner 2 parties en undercover (cumul) | OK (`stats.undercover_won_as_undercover`) ✅ |
| 9 | `uc_page_blanche` | Page blanche | Gagner une partie en Mister White | FIN (`roles`, `winner`) ✅ |
| 10 | `uc_sherlock` | Sherlock | En une partie, voter contre un infiltré à chaque vote (2 votes min.) | PHASE 2 (`good_votes` = `votes_cast`) ✅ |
| 11 | `uc_insoupconnable` | Insoupçonnable | Gagner en undercover sans recevoir un seul vote de la partie | PHASE 2 (`votes_received`) ✅ |
| 12 | `uc_agent_double` | Agent double | Gagner 5 parties en infiltré, undercover ou Mister White (cumul) | FIN (`roles`, `winner`) ✅ |

### Croupier 🃏 — Pas de bol ! (`pas-de-bol`)

Le journal public (`log`) ne garde que les 12 dernières entrées : presque tout demande un compteur.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `pdb_pas_de_bol` | Vraiment pas de bol | Finir dernier (le dernier avec des cartes) | OK (placement / `loser`) ✅ |
| 3 | `pdb_addition_salee` | L'addition salée | Piocher 6 cartes ou plus d'un coup (cumul de +2 / +4) | PHASE 2 (`max_draw`) ✅ |
| 4 | `pdb_etourdi` | L'étourdi | Se faire dénoncer pour un « Dernière carte ! » oublié | PHASE 2 (`denounced`) ✅ |
| 5 | `pdb_beau_jeu` | Beau jeu | Poser 5 cartes spéciales en une partie (+2, +4, joker, sens, passe, perso) | PHASE 2 (`specials`) ✅ |
| 6 | `pdb_main_pleine` | Les mains pleines | Avoir 12 cartes ou plus en main | PHASE 2 (`max_hand`) ✅ |
| 7 | `pdb_genereux` | Trop généreux | Faire piocher 20 cartes aux autres (cumul) | PHASE 2 (`cards_given`) ✅ |
| 8 | `pdb_balance` | La balance | Dénoncer 3 oublis de « Dernière carte ! » (cumul) | PHASE 2 (`denounces`) ✅ |
| 9 | `pdb_retour_envoyeur` | Retour à l'envoyeur | Renvoyer un +2 / +4 en cumulant dessus, 5 fois (cumul) | PHASE 2 (`stacks`) ✅ |
| 10 | `pdb_main_propre` | Main propre | Sortir premier en ayant pioché 2 cartes au plus de toute la partie | PHASE 2 (`drawn`) + OK (placement) ✅ |
| 11 | `pdb_remontada` | Remontada | Sortir premier après avoir eu 10 cartes ou plus en main | PHASE 2 (`max_hand`) + OK (placement) ✅ |
| 12 | `pdb_main_chaude` | Main chaude | Sortir premier 3 parties de suite | OK (historique `match_players` du jeu, par date) ✅ |

### Prof 🎓 — Cerveau en fête (`cerveau-en-fete`)

`history[].found` (rang, temps, points) est complet : tout se calcule à la fin.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `cef_bonnet_d_ane` | Bonnet d'âne | Finir dernier d'une partie | OK (placement) ✅ |
| 3 | `cef_copie_blanche` | Copie blanche | Rater 3 questions de suite | FIN (`history`) ✅ |
| 4 | `cef_a_la_bourre` | À la bourre | Trouver la bonne réponse en dernier (3 trouveurs min.), 5 fois (cumul) | FIN (`found[].rank`) ✅ |
| 5 | `cef_bon_eleve` | Bon élève | 50 bonnes réponses (cumul) | FIN (`correct`) ✅ |
| 6 | `cef_sur_le_fil` | Sur le fil | Trouver dans les 3 dernières secondes, 3 fois (cumul) | FIN (`found[].ms`, `duration`) ✅ |
| 7 | `cef_doigt_leve` | Le doigt levé | Être le premier à trouver 20 fois (cumul) | FIN (`firsts`) ✅ |
| 8 | `cef_eclair` | Éclair de génie | Trouver une réponse tapée en moins de 3 s | FIN (`ms`, `mode`) ✅ |
| 9 | `cef_as_du_qcm` | As du QCM | Réussir tous les QCM d'une partie (5 QCM min.) | FIN (`history[].mode`) ✅ |
| 10 | `cef_serie` | En série | 5 bonnes réponses d'affilée | FIN (`history`) ✅ |
| 11 | `cef_tete_de_classe` | Tête de classe | Être le premier à trouver sur 5 questions d'une même partie | FIN (`firsts`) ✅ |
| 12 | `cef_sans_faute` | 20 sur 20 | Trouver toutes les questions d'une partie (10 questions min.) | FIN (`history`) ✅ |

### Écolier 🎒 — Petit bac (`petit-bac`)

Le détail des réponses n'existe que pour la dernière manche (`last_round`) : les compteurs se mettent à jour à chaque décompte de manche.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `pb_recale` | Recalé ! | Se faire refuser 3 réponses par le vote des autres (cumul) | PHASE 2 (`refused`) ✅ |
| 3 | `pb_page_blanche` | Page blanche | Marquer 0 point sur une manche | FIN (`history[].points`) ✅ |
| 4 | `pb_copieur` | Le copieur | 10 réponses partagées avec un autre joueur (cumul) | PHASE 2 (`shared`) ✅ |
| 5 | `pb_original` | L'original | 20 réponses uniques (cumul) | FIN (`uniques`) ✅ |
| 6 | `pb_panne_seche` | Panne sèche | Laisser 3 cases vides sur une même manche | PHASE 2 (`max_empty`) ✅ |
| 7 | `pb_grille_pleine` | Grille pleine | Remplir toutes les cases d'une manche avec des réponses acceptées | PHASE 2 (`full_rounds`) ✅ |
| 8 | `pb_avocat` | L'avocat | Contester 5 réponses qui finissent refusées (cumul) | PHASE 2 (`contests_ok`) ✅ |
| 9 | `pb_carton_plein` | Carton plein | Une manche avec uniquement des réponses uniques (2 pts partout) | FIN (points de la manche = 2 × nb de catégories) ✅ |
| 10 | `pb_meilleure_copie` | Meilleure copie | Avoir le meilleur score de la manche 10 fois (cumul) | FIN (`history[].points`) ✅ |
| 11 | `pb_regulier` | Élève régulier | Marquer au moins 8 points à chaque manche d'une partie (3 manches min.) | FIN (`history[].points`) ✅ |
| 12 | `pb_grand_chelem` | Major de promo | Avoir le meilleur score à toutes les manches d'une partie (4 manches min., ex æquo acceptés) | FIN (`history[].points`) ✅ |

### Artiste 🎨 — Dessine & devine (`dessine-devine`)

`history[]` garde par tour : dessinateur, mot, trouveurs (dans l'ordre), points. Les temps et les « Presque ! » ne sont pas conservés.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `dd_gribouillis` | Gribouillis | Dessiner un mot que personne ne trouve | FIN (`history[].found` vide) ✅ |
| 3 | `dd_dans_le_flou` | Dans le flou | Ne pas trouver 3 dessins de suite | FIN (`history`) ✅ |
| 4 | `dd_presque` | Presque ! | Recevoir 5 « Presque ! » (cumul) | PHASE 2 (`close`) ✅ |
| 5 | `dd_oeil_de_lynx` | Œil de lynx | Trouver 25 mots (cumul) | FIN (`found_count`) ✅ |
| 6 | `dd_in_extremis` | In extremis | Trouver un mot dans les 5 dernières secondes | PHASE 2 (`late_finds`) ✅ |
| 7 | `dd_limpide` | Limpide | Tout le monde trouve ton dessin, 3 fois (cumul) | FIN (`history`) ✅ |
| 8 | `dd_premier_servi` | Premier servi | Être le premier à trouver 10 fois (cumul) | FIN (`history[].found[0]`) ✅ |
| 9 | `dd_eclair` | Coup d'œil | Trouver un mot en moins de 10 s | PHASE 2 (`fast_finds`) ✅ |
| 10 | `dd_sans_indice` | Sans indice | Trouver avant la première lettre révélée, 5 fois (cumul) | PHASE 2 (`no_hint_finds`) ✅ |
| 11 | `dd_defi_releve` | Défi relevé | Faire deviner un mot difficile (niveau 3) à tous les joueurs | PHASE 2 (difficulté du mot à ajouter au résumé du tour) ✅ |
| 12 | `dd_chef_d_oeuvre` | Chef-d'œuvre | En une partie (4 joueurs min.) : tout le monde trouve tous tes dessins et tu trouves tous ceux des autres | FIN (`history`) ✅ |

### Loup 🐺 — Loup-garou (`loup-garou`)

Le state final est très riche (`roles`, `dead`, `history` des votes, `chronicle` des nuits, `lovers`, `winner`) : tout est FIN.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `lg_petit_dejeuner` | Petit déjeuner | Être dévoré dès la première nuit | FIN (`dead` : cause `night`, nuit 1) ✅ |
| 3 | `lg_bucher` | Au bûcher ! | Être éliminé par le vote sans être loup, 3 fois (cumul) | FIN (`dead`, `roles`) ✅ |
| 4 | `lg_cimetiere` | Abonné au cimetière | Mourir avant la fin dans 5 parties (cumul) | FIN (`dead`) ✅ |
| 5 | `lg_flair` | Flair de chasseur | Voter contre un loup au vote du jour, 5 fois (cumul) | FIN (`history[].votes`, `roles`) ✅ |
| 6 | `lg_marmotte` | La marmotte | Être encore en vie à la fin de 5 parties (cumul) | FIN (`alive`) ✅ |
| 7 | `lg_bon_voisin` | Bon voisin | Gagner 5 parties dans le camp du village (cumul) | FIN (`roles`, `winner`) ✅ |
| 8 | `lg_meute` | La meute | Gagner 3 parties en loup (cumul) | FIN (`roles`, `winner`) ✅ |
| 9 | `lg_coup_de_maitre` | Coup de maître | Réussir un pouvoir 3 fois (cumul) : voyante qui voit un loup, sorcière qui sauve, protecteur qui protège la cible des loups, chasseur qui abat un loup | FIN (`chronicle`, `history` du chasseur, `roles`) ✅ |
| 10 | `lg_simple_villageois` | Simple villageois | Gagner en simple villageois en étant encore en vie | FIN ✅ |
| 11 | `lg_agneau` | Doux comme un agneau | Gagner en loup sans recevoir un seul vote du village de toute la partie | FIN (`history[].votes`) ✅ |
| 12 | `lg_loup_solitaire` | Loup solitaire | Gagner en étant le dernier loup en vie (2 loups min. au départ) | FIN (`roles`, `dead`, `composition`) ✅ |

### Artificier 💣 — Bombe à mots (`bombe-a-mots`)

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `bam_boum` | BOUM ! | Exploser 10 fois (cumul) | FIN (`explosions`) ✅ |
| 3 | `bam_coup_double` | Coup double | Subir 2 explosions de suite | FIN (`explosions`) ✅ |
| 4 | `bam_premier_saute` | Premier sauté | Être éliminé en premier, 3 fois (cumul) | FIN (`eliminated[0]`) ✅ |
| 5 | `bam_dico` | Le dico | 100 mots validés (cumul) | FIN (`word_counts`, non plafonné contrairement aux points) ✅ |
| 6 | `bam_mot_a_rallonge` | Mot à rallonge | Valider un mot de 12 lettres ou plus | FIN (`words`) ✅ |
| 7 | `bam_abecedaire` | L'abécédaire | Compléter l'alphabet bonus | FIN (`bonuses`) ✅ |
| 8 | `bam_patate_chaude` | Patate chaude | Valider un mot en moins de 2 s, 10 fois (cumul) | PHASE 2 (`fast_words`, via `turn_started_at`) ✅ |
| 9 | `bam_sueurs_froides` | Sueurs froides | Valider un mot à moins d'1 s de l'explosion | PHASE 2 (`close_calls`, l'heure d'explosion est côté serveur) ✅ |
| 10 | `bam_survivant` | Sur un fil | Gagner avec une seule vie restante | FIN (`lives`, `winner`) ✅ |
| 11 | `bam_intouchable` | Intouchable | Gagner sans perdre une seule vie (3 joueurs min.) | FIN (`explosions`, `winner`) ✅ |
| 12 | `bam_marathon` | Moulin à paroles | 20 mots validés en une partie | FIN (`word_counts`) ✅ |

### Pirate 🏴‍☠️ — Menteur (`menteur`)

`history[]` garde chaque vérification (type, crieur, enchère, compte, perdant) ; les dés eux-mêmes ne sont visibles qu'au moment de la révélation.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `mtr_a_la_planche` | À la planche | Être le premier éliminé | FIN (`eliminated[0]`) ✅ |
| 3 | `mtr_mauvaise_langue` | Mauvaise langue | Crier « Menteur ! » à tort 5 fois (cumul) | FIN (`history` : crieur = perdant) ✅ |
| 4 | `mtr_pris_la_main_dans_le_sac` | La main dans le sac | Se faire démasquer 5 fois (cumul) | FIN (`history` : enchérisseur = perdant) ✅ |
| 5 | `mtr_detecteur` | Détecteur de mensonges | Crier « Menteur ! » à raison 10 fois (cumul) | FIN (`history`) ✅ |
| 6 | `mtr_dernier_de` | Le dernier dé | Gagner la partie avec un seul dé restant | FIN (`dice_count`, `winner`) ✅ |
| 7 | `mtr_pile` | Pile ! | Réussir un « Pile ! » exact (option activée) | FIN (`history` : `kind = pile`, pas de perdant) ✅ |
| 8 | `mtr_bluff` | Coup de bluff | Ton enchère est contestée, elle est vraie, et tu n'avais aucun dé de cette valeur ni joker | PHASE 2 (`pure_bluffs`, calculé à la révélation) ✅ |
| 9 | `mtr_pile_poil` | Pile-poil | Ton enchère contestée tombe exactement juste, 3 fois (cumul) | FIN (`count = bid.qty`) ✅ |
| 10 | `mtr_grosse_voix` | Grosse voix | Une enchère de 8 dés ou plus, contestée, qui s'avère vraie | FIN (`history[].bid`) ✅ |
| 11 | `mtr_revenant` | Le revenant | Gagner après être tombé à un seul dé alors qu'il restait 3 joueurs ou plus | FIN (rejouer `history` : perdant / gagnant / éliminé) ✅ |
| 12 | `mtr_capitaine` | Capitaine | Gagner sans perdre un seul dé (3 joueurs min.) | FIN (`dice_count`) ✅ |

### Bowler 🎳 — Bowling (`bowling`)

Les feuilles de score complètes (`sheets`) sont dans le state final : tout est FIN. Les trophées de score exigent une partie de 10 frames.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `bwl_rigole` | Abonné à la rigole | 3 gouttières (lancer à 0 quille) en une partie | FIN (`sheets`) ✅ |
| 3 | `bwl_quille_tetue` | La quille têtue | Finir une frame avec une seule quille debout, 5 fois (cumul) | FIN (`sheets`) ✅ |
| 4 | `bwl_lanterne_rouge` | Lanterne rouge | Finir dernier d'une partie | OK (placement) ✅ |
| 5 | `bwl_strikes` | Ça tombe ! | 10 strikes (cumul) | FIN (`strikes`) ✅ |
| 6 | `bwl_spares` | Le rattrapeur | 10 spares (cumul) | FIN (`spares`) ✅ |
| 7 | `bwl_double` | Le doublé | 2 strikes d'affilée | FIN (`sheets`) ✅ |
| 8 | `bwl_sauvetage` | Sauvetage | Faire un spare après une gouttière au premier lancer | FIN (`sheets`) ✅ |
| 9 | `bwl_dinde` | La dinde | 3 strikes d'affilée | FIN (`sheets`) ✅ |
| 10 | `bwl_cent_cinquante` | 150 au compteur | 150 points ou plus sur 10 frames | FIN (`scores`, `frames`) ✅ |
| 11 | `bwl_partie_propre` | Partie propre | Strike ou spare à chaque frame (5 frames min.) | FIN (`sheets`) ✅ |
| 12 | `bwl_deux_cents` | Le club des 200 | 200 points ou plus sur 10 frames | FIN (`scores`, `frames`) ✅ |

### Philosophe 🤔 — Tu préfères ? (`tu-preferes`)

`results[].stats` contient déjà `bets_ok`, `rebel`, `norm`, `answered` : presque tout est OK.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `tp_a_contre_courant` | À contre-courant | Perdre 5 paris en une partie | OK (`answered − bets_ok`) ✅ |
| 3 | `tp_seul_au_monde` | Seul au monde | Être le seul de son avis une fois | OK (`rebel`) ✅ |
| 4 | `tp_dernier_de_la_classe` | Perdu dans ses pensées | Finir dernier d'une partie | OK (placement) ✅ |
| 5 | `tp_sondeur` | Le sondeur | 30 paris justes (cumul) | OK (`bets_ok`) ✅ |
| 6 | `tp_mouton` | Le mouton | Choisir comme la majorité 30 fois (cumul) | OK (`norm`) ✅ |
| 7 | `tp_tous_d_accord` | Tous d'accord | Une manche à l'unanimité (3 joueurs min.), 3 fois (cumul) | FIN (`history[].counts`) ✅ |
| 8 | `tp_rebelle_lucide` | Rebelle lucide | Être seul de son avis et gagner son pari sur la même manche | PHASE 2 (`rebel_right`, calculé à la révélation) ✅ |
| 9 | `tp_rebelle_en_serie` | Rebelle en série | Être seul de son avis 3 fois en une partie | OK (`rebel`) ✅ |
| 10 | `tp_devin` | Le devin | 8 paris justes en une partie (10 manches min.) | OK (`bets_ok`) + FIN (nb de manches) ✅ |
| 11 | `tp_anticonformiste` | Anticonformiste | Gagner une partie en ayant été minoritaire plus d'une manche sur deux | OK (`won`, `norm`, `answered`) ✅ |
| 12 | `tp_oracle` | L'oracle | Tous les paris justes sur une partie de 10 manches min. | OK (`bets_ok`) + FIN (nb de manches) ✅ |

### Star de cinéma 🎬 — Qui suis-je ? (`qui-suis-je`)

`history[]` garde chaque tour (trouvées, passées, détail des cartes).

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `qsj_trou_de_memoire` | Trou de mémoire | Finir un tour sans trouver une seule carte | FIN (`history[].found`) ✅ |
| 3 | `qsj_je_passe` | Je passe ! | Passer 5 cartes dans un même tour | FIN (`history[].passed`) ✅ |
| 4 | `qsj_figurant` | Le figurant | Finir dernier d'une partie | OK (placement) ✅ |
| 5 | `qsj_culture` | Culture générale | 50 cartes trouvées (cumul) | OK (`stats.found`) ✅ |
| 6 | `qsj_sans_joker` | Sans joker | Un tour sans passer, avec 3 cartes trouvées ou plus | FIN (`history`) ✅ |
| 7 | `qsj_tete_connue` | Une tête connue | Deviner 3 persos de la bande (thème « Les Soirées de Dédé », cumul) | FIN (`history[].log[].s`) ✅ |
| 8 | `qsj_tac_tac` | Tac tac tac | 5 cartes trouvées d'affilée sans passer | FIN (`history[].log`) ✅ |
| 9 | `qsj_rafale` | En rafale | 8 cartes trouvées en un seul tour | FIN (`history[].found`) ✅ |
| 10 | `qsj_valeur_sure` | Valeur sûre | Au moins 5 cartes à chacun de ses tours (2 tours min.) | FIN (`history`) ✅ |
| 11 | `qsj_cinephile` | Le cinéphile | Trouver 10 cartes difficiles (niveau 3, cumul) | PHASE 2 (`hard_found` : la difficulté n'est pas dans le résumé du tour) ✅ |
| 12 | `qsj_tapis_rouge` | Tapis rouge | 12 cartes trouvées en un seul tour | FIN (`history[].found`) ✅ |

### Archer 🏹 — Le plus proche (`le-plus-proche`)

`history[].ranking` (écart, rang, exact, points) est complet.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `lpp_a_cote` | À côté de la cible | Être le plus loin de la réponse 5 fois (3 joueurs min., cumul) | FIN (`ranking`) ✅ |
| 3 | `lpp_hors_cible` | Dans le décor | Se tromper d'un facteur 10 ou plus | FIN (`ranking[].value`, `answer`) ✅ |
| 4 | `lpp_bredouille` | Bredouille | 3 manches de suite sans marquer | FIN (`ranking[].points`) ✅ |
| 5 | `lpp_dans_le_jaune` | Dans le jaune | Être le plus proche 15 fois (cumul) | FIN (`ranking[].rank`) ✅ |
| 6 | `lpp_poulidor` | Éternel second | Finir 2e d'une manche 10 fois (cumul) | FIN (`ranking[].rank`) ✅ |
| 7 | `lpp_ames_soeurs` | Âmes sœurs | Être le plus proche à égalité avec un autre joueur | FIN (`ranking`) ✅ |
| 8 | `lpp_a_un_cheveu` | À un cheveu | Être le plus proche à moins de 1 % de la réponse, sans être exact | FIN (`ranking[].gap`, `answer`) ✅ |
| 9 | `lpp_dans_le_mille` | Dans le mille | Donner une réponse exacte | OK (`stats.exacts`) ✅ |
| 10 | `lpp_regulier` | Tir groupé | Marquer des points à toutes les manches d'une partie (8 manches min.) | FIN (`ranking`) ✅ |
| 11 | `lpp_triple` | Trois flèches | Être le plus proche 3 manches d'affilée | FIN (`ranking`) ✅ |
| 12 | `lpp_robin_des_bois` | Robin des Bois | 2 réponses exactes en une partie | OK (`stats.exacts`) ✅ |

### Comédien 🎭 — Action ou vérité (`action-ou-verite`)

`results[].stats` contient déjà `turns`, `actions`, `verites`, `success`, `fails`, `refusals`, `thumbs_up`, `thumbs_down`.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `aov_four` | Le four | Rater un défi (majorité de 👎) | OK (`fails`) ✅ |
| 3 | `aov_gage` | Gage ! | Recevoir 3 gages (refus, cumul) | OK (`refusals`) ✅ |
| 4 | `aov_siffle` | Sifflé | Recevoir 10 👎 (cumul) | OK (`thumbs_down`) ✅ |
| 5 | `aov_franc_jeu` | Franc-jeu | Choisir « Vérité » 10 fois (cumul) | OK (`verites`) ✅ |
| 6 | `aov_chouchou_de_la_roue` | Chouchou de la roue | Être désigné 5 fois par la roue en une partie | OK (`turns`) ✅ |
| 7 | `aov_ovation` | Ovation | Réussir un défi à l'unanimité (3 votants min.) | PHASE 2 (`unanimous`, calculé au verdict) ✅ |
| 8 | `aov_casse_cou` | Casse-cou | Choisir « Action » 15 fois (cumul) | OK (`actions`) ✅ |
| 9 | `aov_niveau_3` | Même pas peur | Réussir une carte de niveau 3 | PHASE 2 (`hard_success` : le niveau n'est pas dans l'historique) ✅ |
| 10 | `aov_applaudi` | Applaudimètre | Recevoir 50 👍 (cumul) | OK (`thumbs_up`) ✅ |
| 11 | `aov_jamais_degonfle` | Jamais dégonflé | 3 parties sans aucun refus (2 tours min. par partie, cumul) | OK (`refusals`, `turns`) ✅ |
| 12 | `aov_standing_ovation` | Standing ovation | En une partie : 5 tours ou plus, tous réussis | OK (`success = turns`) ✅ |

### Coach 📣 — Devine en équipe (`devine-en-equipe`)

Le détail des passages n'est pas conservé (seul `last_turn` l'est) : compteurs par passage à ajouter.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `dee_sur_le_banc` | Sur le banc | Perdre 3 parties avec son équipe (cumul) | OK (`won`) ✅ |
| 3 | `dee_bredouille` | Bredouille | Finir un passage d'orateur sans aucun mot trouvé | PHASE 2 (`empty_turns`) ✅ |
| 4 | `dee_suivant` | Suivant ! | Passer 3 mots dans un même passage | PHASE 2 (`max_passed`) ✅ |
| 5 | `dee_orateur` | Belle éloquence | Faire deviner 30 mots (cumul) | OK (`stats.found`) ✅ |
| 6 | `dee_mime` | Roi du mime | Faire deviner 5 mots en manche Mime (cumul) | PHASE 2 (`found_r3`) ✅ |
| 7 | `dee_pilier` | Pilier de l'équipe | Être le meilleur orateur de son équipe 3 fois (cumul) | FIN (`speaker_points`, `teams`) ✅ |
| 8 | `dee_un_seul_mot` | En un mot | 4 mots trouvés dans un passage de la manche « Un seul mot » | PHASE 2 (`best_r2`) ✅ |
| 9 | `dee_du_rab` | Du rab | Vider la pioche et garder du temps pour la manche suivante | PHASE 2 (`carries`) ✅ |
| 10 | `dee_rafale` | La rafale | 6 mots trouvés en un seul passage | PHASE 2 (`best_turn`) ✅ |
| 11 | `dee_trois_manches` | Carton plein | Son équipe gagne les 3 manches d'une partie | FIN (`round_scores`) ✅ |
| 12 | `dee_mvp` | MVP | Gagner en étant le meilleur orateur des deux équipes avec 10 mots ou plus | FIN (`speaker_points`) + OK (`won`) ✅ |

### Jeux en duel — données communes

Une session = un match. `session.stats` (`played`, `wins`, `draws`, `losses`, `bets`, `bets_won`) et `session.history` (un élément par duel, avec `games[]` : `starter`, `winner`, `moves`) sont dans le state final : à recopier dans `results[].stats` par `_duel_finish` (aujourd'hui seul `duel_wins` y est). Ce qui dépend du **plateau** doit être noté à la fin de chaque manche (le plateau est remplacé à la manche suivante) : compteur NEW via `_duel_stat`, alimenté par un champ optionnel renvoyé par `board_move` (par exemple `stats: {clé: n}`) — une seule évolution du socle pour les trois jeux.

### Stratège 🧠 — 4 à la suite (`quatre-a-la-suite`)

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `q4_tete_en_l_air` | Tête en l'air | Perdre une manche en 10 jetons ou moins (au total) | FIN (`games[].moves`) ✅ |
| 3 | `q4_serie_noire` | Série noire | Perdre 3 duels d'affilée dans une session | FIN (`history`) ✅ |
| 4 | `q4_grille_pleine` | Grille pleine | Faire match nul (grille pleine) | FIN (`draws`) ✅ |
| 5 | `q4_parieur` | Le parieur | Gagner 10 paris en spectateur (cumul) | FIN (`bets_won`) ✅ |
| 6 | `q4_marathon` | Guerre des nerfs | Gagner une manche de 36 jetons ou plus | FIN (`games[].moves`) ✅ |
| 7 | `q4_diagonale` | En diagonale | Gagner 3 manches par une diagonale (cumul) | PHASE 2 (`diag_wins`, lu sur `board.line`) ✅ |
| 8 | `q4_double_menace` | Double menace | Gagner avec deux alignements à la fois, ou 5 jetons alignés | PHASE 2 (`double_wins`, lu sur `board.line`) ✅ |
| 9 | `q4_express` | Express | Gagner une manche en 12 jetons ou moins (au total) | FIN (`games[].moves`) ✅ |
| 10 | `q4_trois_a_la_suite` | 3 à la suite | Gagner 3 duels d'affilée dans une session | FIN (`history`) ✅ |
| 11 | `q4_champion` | Champion de la table | Finir premier d'une session de 4 joueurs ou plus, 2 fois (cumul) | OK (`won`) + FIN (nb de joueurs) ✅ |
| 12 | `q4_invaincu` | Invaincu | Une session de 4 duels joués ou plus, sans défaite ni nul | FIN (`played`, `wins`) ✅ |

### Ninja 🥷 — Morpion (`morpion`)

La variante (`classic` / `giant` / `ultimate`) est dans `session.board_options`.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `mor_etourdi` | L'étourdi | Perdre une manche en classique en 7 coups ou moins | FIN (`games[].moves`, variante) ✅ |
| 3 | `mor_serie_noire` | Série noire | Perdre 3 duels d'affilée dans une session | FIN (`history`) ✅ |
| 4 | `mor_match_nul` | Match nul | 5 nuls (cumul) | FIN (`draws`) ✅ |
| 5 | `mor_parieur` | Le parieur | Gagner 10 paris en spectateur (cumul) | FIN (`bets_won`) ✅ |
| 6 | `mor_geant` | Vu en grand | Gagner 3 manches en Géant (cumul) | FIN (`games[].winner`, variante) ✅ |
| 7 | `mor_touche_a_tout` | Touche-à-tout | Gagner un duel dans chacune des 3 variantes (cumul) | FIN (3 drapeaux `win_classic`, `win_giant`, `win_ultimate`) ✅ |
| 8 | `mor_contre_attaque` | Contre-attaque | Gagner une manche en classique en jouant ⭕ (en second) | FIN (`games[].starter ≠ winner`) ✅ |
| 9 | `mor_eclair` | L'éclair | Gagner une manche en Géant en 13 coups ou moins (au total) | FIN (`games[].moves`) ✅ |
| 10 | `mor_ultime` | Maître de l'Ultime | Gagner 3 duels en Ultime (cumul) | FIN (`history`, variante) ✅ |
| 11 | `mor_ombre` | L'ombre | Gagner une manche en Ultime sans perdre un seul petit morpion | PHASE 2 (`clean_ultimate`, lu sur `board.boards`) ✅ |
| 12 | `mor_ninja` | Insaisissable | Gagner 4 duels d'affilée dans une session | FIN (`history`) ✅ |

### Amiral ⚓ — Bataille navale (`bataille-navale`)

`board.stats` (tirs, touchés, meilleure série) et `board.waters` (bateaux restants) existent à la fin de chaque **manche** : à reporter dans les compteurs de session à ce moment-là.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `bn_plouf` | Plouf plouf | 10 tirs à l'eau d'affilée | PHASE 2 (`miss_streak`, seule la série de touchés est suivie) ✅ |
| 3 | `bn_naufrage` | Naufrage total | Perdre une manche sans couler un seul bateau adverse | PHASE 2 (report de `waters[adversaire].left`) ✅ |
| 4 | `bn_si_pres` | Si près du but | Perdre alors qu'il ne restait qu'un bateau adverse | PHASE 2 (report de `waters[adversaire].left`) ✅ |
| 5 | `bn_canonnier` | Le canonnier | 100 tirs touchés (cumul) | PHASE 2 (report de `board.stats.hits`) ✅ |
| 6 | `bn_guerre_d_usure` | Guerre d'usure | Gagner une manche de 120 tirs ou plus (au total) | PHASE 2 (report de `board.count`) ✅ |
| 7 | `bn_parieur` | Le parieur | Gagner 10 paris en spectateur (cumul) | FIN (`bets_won`) ✅ |
| 8 | `bn_premier_tir` | Du premier coup | Toucher dès son premier tir d'une manche, 3 fois (cumul) | PHASE 2 (`first_shot_hits` : son propre premier tir de la manche, pas seulement le tout premier de la manche) ✅ |
| 9 | `bn_rafale` | En rafale | 5 touchés d'affilée | PHASE 2 (report de `board.stats.best`) ✅ |
| 10 | `bn_precision` | Tireur d'élite | Gagner une manche avec 40 % de tirs touchés ou plus | PHASE 2 (report de `hits / shots`) ✅ |
| 11 | `bn_eclair` | Guerre éclair | Gagner une manche en 40 tirs ou moins | PHASE 2 (report de `board.stats.shots`) ✅ |
| 12 | `bn_flotte_intacte` | Flotte intacte | Gagner une manche sans perdre un seul bateau | PHASE 2 (report de `waters[moi].left` = 5) ✅ |

### Magnat 🎩 — Le Tour des Potes (`tour-des-potes`)

`state.stats` (`laps`, `rent_paid`, `rent_received`, `pot`, `bought`, `built`, `jail`, `cards`), `bankrupt`, `ranking` et les propriétés sont dans le state final, mais `results[].stats` est vide : tout est FIN. Montants à ajuster (départ : 1 500).

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `tdp_au_violon` | Habitué du violon | Aller 3 fois au violon en une partie | FIN (`stats.jail`) ✅ |
| 3 | `tdp_faillite` | Sur la paille | Faire faillite | FIN (`bankrupt`) ✅ |
| 4 | `tdp_pigeon` | Le pigeon | Payer 1 000 de loyers en une partie | FIN (`stats.rent_paid`) ✅ |
| 5 | `tdp_acheteur` | Fièvre acheteuse | Acheter 30 lieux (cumul) | FIN (`stats.bought`) ✅ |
| 6 | `tdp_globe_trotteur` | Globe-trotteur | Passer 30 fois par le Départ (cumul) | FIN (`stats.laps`) ✅ |
| 7 | `tdp_tournee` | Ma tournée ! | Ramasser 500 de cagnotte à la Pause apéro (cumul) | FIN (`stats.pot`) ✅ |
| 8 | `tdp_rentier` | Le rentier | Encaisser 2 000 de loyers en une partie | FIN (`stats.rent_received`) ✅ |
| 9 | `tdp_pioche` | Carte sur table | Piocher 5 cartes en une partie | FIN (`stats.cards`) ✅ |
| 10 | `tdp_hotelier` | L'hôtelier | Posséder un hôtel à la fin d'une partie | FIN (niveaux des propriétés) ✅ |
| 11 | `tdp_monopole` | Chasse gardée | Posséder 2 quartiers complets à la fin d'une partie | FIN (propriétaires des lieux) ✅ |
| 12 | `tdp_tycoon` | Le tycoon | Gagner avec une fortune au moins 2 fois supérieure à celle du 2e (3 joueurs min.) | FIN (`ranking`) ✅ |

### Pilote 🏎️ — Dédé Kart (`dede-kart`)

`standings[]` (place, temps, points par course) et `hits` (touches réussies par lanceur) sont dans le state final. Les objets locaux (turbo, bulle, bouclier) ne passent pas par le serveur : aucun trophée ne s'appuie dessus. « Kart » = joueur ou bot.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `dk_tete_a_queue` | Tête-à-queue | Se faire toucher 5 fois par une boule ou une glue (cumul) | PHASE 2 (`hits_taken`, sur l'action `hit` de la victime) ✅ |
| 3 | `dk_lanterne_rouge` | Lanterne rouge | Finir dernier d'une course (4 karts min.) | FIN (`standings`) ✅ |
| 4 | `dk_panne` | En panne | Ne pas franchir la ligne avant la fin d'une course | FIN (`places[].time` nul) ✅ |
| 5 | `dk_podium` | Sur le podium | 10 podiums (4 karts min., cumul) | FIN (`standings`) ✅ |
| 6 | `dk_tireur` | Fine gâchette | Toucher 10 karts avec une boule ou une glue (cumul) | FIN (`hits`) ✅ |
| 7 | `dk_touriste` | Tour du monde | Gagner une course sur chacun des 6 circuits (cumul) | FIN (6 drapeaux `win_track_1..6`) ✅ |
| 8 | `dk_coup_bas` | Coups bas | Utiliser au moins une fois le nuage, les confettis et le demi-tour (cumul) | PHASE 2 (`used_cloud`, `used_confetti`, `used_reverse`, sur l'action `use`) ✅ |
| 9 | `dk_remontada` | Remontada | En coupe, gagner une course après avoir fini hors du podium à la précédente | FIN (`standings`) ✅ |
| 10 | `dk_sniper` | Sniper | 5 touches réussies en une coupe | FIN (`hits`) ✅ |
| 11 | `dk_echappee` | L'échappée | Gagner une course avec 5 s d'avance ou plus sur le 2e | FIN (`places[].time`) ✅ |
| 12 | `dk_grand_chelem` | Grand chelem | Gagner les 3 courses d'une coupe (4 karts min.) | FIN (`standings`) ✅ |

---

### Hacker 💻 — Nom de Code (`nom-de-code`)

Tous les compteurs sont posés par le moteur (`server.stats` → `results[].stats`).

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `ndc_kaboum` | Kaboum ! | Avoir voté pour la bombe | `bomb_votes` (somme ≥ 1) ✅ |
| 3 | `ndc_page_blanche` | Page blanche | En espion, laisser filer le chrono sans donner d'indice | `idle_clue` (somme ≥ 1) ✅ |
| 4 | `ndc_taupe` | Taupe malgré toi | Faire dévoiler 3 mots d'une autre équipe (cumul) | `enemy_reveals` (somme ≥ 3) ✅ |
| 5 | `ndc_bon_flair` | Bon flair | Être le premier à poser sa tête sur 10 mots de son équipe (cumul) | `first_good` (somme ≥ 10) ✅ |
| 6 | `ndc_agent_terrain` | Agent de terrain | Jouer 10 parties (cumul) | nombre de parties ≥ 10 ✅ |
| 7 | `ndc_coup_double` | Coup double | En espion, faire trouver 3 mots avec un seul indice | `best_clue` (max ≥ 3) ✅ |
| 8 | `ndc_maitre_espion` | Maître espion | Gagner 3 manches en espion (cumul) | `spy_wins` (somme ≥ 3) ✅ |
| 9 | `ndc_sans_faute` | Sans faute | Gagner une manche sans aucune erreur de son équipe | `flawless` (somme ≥ 1) ✅ |
| 10 | `ndc_remontada` | Remontada | Gagner une manche après avoir eu 3 mots de retard ou plus | `comeback` (somme ≥ 1) ✅ |
| 11 | `ndc_telepathie` | Télépathie | En espion, faire trouver 4 mots ou plus avec un seul indice | `best_clue` (max ≥ 4) ✅ |
| 12 | `ndc_legende` | Légende du code | Gagner 15 parties (cumul) | `won` (somme ≥ 15) ✅ |

---

### Grand Maître ♟️ — Échecs (`echecs`)

Compteurs de manche renvoyés par `board_move` (`game`, rangés par le socle dans `duel.games[].x`), agrégés par `game_echecs_trophy_stats` ; `duel_wins` vient du socle duel. « Coup » = coup d'un joueur (pas un demi-coup). Seuils à calibrer après deux ou trois soirées.

| Slot | id | Nom | Condition | Donnée |
|---|---|---|---|---|
| 2 | `ech_berger` | Le coup du berger | Se faire mater en 10 coups ou moins | `fast_mated` (somme ≥ 1) ✅ |
| 3 | `ech_adieu_ma_dame` | Adieu ma dame | Se faire prendre sa dame 5 fois (cumul) | `queens_lost` (somme ≥ 5) ✅ |
| 4 | `ech_pat_zut` | Pat… zut ! | Mettre l'adversaire pat alors qu'on avait 5 points de matériel d'avance ou plus | `stalemate_blunders` (somme ≥ 1) ✅ |
| 5 | `ech_gourmand` | Le gourmand | Prendre 50 pièces (cumul) | `captures` (somme ≥ 50) ✅ |
| 6 | `ech_partie_fleuve` | Partie fleuve | Finir une manche de 40 coups ou plus | `max_moves` (max ≥ 40) ✅ |
| 7 | `ech_au_chaud` | Bien au chaud | Roquer 10 fois (cumul) | `castles` (somme ≥ 10) ✅ |
| 8 | `ech_en_passant` | En passant | Réussir une prise en passant | `en_passants` (somme ≥ 1) ✅ |
| 9 | `ech_nouvelle_reine` | Nouvelle reine | Promouvoir 3 pions (cumul) | `promotions` (somme ≥ 3) ✅ |
| 10 | `ech_et_mat` | Échec et mat ! | Gagner 5 manches par échec et mat (cumul) | `mates` (somme ≥ 5) ✅ |
| 11 | `ech_mat_eclair` | Mat éclair | Mater en 15 coups ou moins | `fast_mates` (somme ≥ 1) ✅ |
| 12 | `ech_grand_maitre` | Grand Maître | Gagner 25 duels (cumul) | `duel_wins` (somme ≥ 25) ✅ |

---

### Cow-boy 🤠 — Kems (`kems`)

Compteurs posés par le moteur (`server.pstats` → `results[].stats`). « Contre » = Contre-Kems réussi contre l'équipe ; `clean_win` = victoire sans erreur (Kems ou Contre-Kems raté) de l'équipe et sans Contre-Kems réussi contre elle. Les compteurs d'équipe (`team_kems`, `fast_kems`, `double_kems`, `countered`) sont crédités aux deux coéquipiers.

| Slot | id | Nom | Condition | Compteur |
|---|---|---|---|---|
| 2 | `kems_faux_kems` | Faux Kems ! | Crier « Kems ! » alors que ton partenaire n'a pas de carré | `false_kems` (somme ≥ 1) ✅ |
| 3 | `kems_grille` | Grillé ! | Ton équipe subit 3 Contre-Kems réussis (cumul) | `countered` (somme ≥ 3) ✅ |
| 4 | `kems_parano` | Parano | Crier « Contre-Kems ! » à tort 3 fois (cumul) | `false_counters` (somme ≥ 3) ✅ |
| 5 | `kems_collectionneur` | Collectionneur | Réunir 10 carrés (cumul, un par manche au plus) | `squares` (somme ≥ 10) ✅ |
| 6 | `kems_pilier_de_saloon` | Pilier de saloon | Jouer 10 parties (cumul) | nombre de parties ≥ 10 ✅ |
| 7 | `kems_complices` | Complices | Réussir 10 Kems avec son équipe (cumul) | `team_kems` (somme ≥ 10) ✅ |
| 8 | `kems_oeil_de_lynx` | Œil de lynx | Réussir 3 Contre-Kems en étant celui qui crie (cumul) | `counters_ok` (somme ≥ 3) ✅ |
| 9 | `kems_eclair` | Kems éclair | Réussir un Kems moins de 20 s après le début de la manche | `fast_kems` (somme ≥ 1) ✅ |
| 10 | `kems_poker_face` | Poker face | Gagner une partie sans erreur de son équipe et sans se faire contrer | `clean_win` (somme ≥ 1) ✅ |
| 11 | `kems_double` | Double Kems | Réussir un Double Kems (les deux coéquipiers ont un carré) | `double_kems` (somme ≥ 1) ✅ |
| 12 | `kems_legende` | Légende du saloon | Gagner 15 parties (cumul) | `won` (somme ≥ 15) ✅ |

---

### Golfeur ⛳ — Mini-golf (`mini-golf`)

Compteurs dans `results[].stats` (`_mg_tstats`). Calculés par le serveur depuis la carte : `pars` (trous ≤ par), `birdies` (trous sous le par), `aces` (trous en 1), `under_par` / `clean_card` (parcours de **9 trous** uniquement : aléatoire ou La Kermesse, pas l'express). `picked_up` = trous déclarés « non rentrée en 6 coups » (le ramassage par le chrono ou la fin forcée ne compte pas). Déclarés par le client et bornés par le serveur (`server.tstats`) : `water` (≤ coups du trou), `mill_hits` (coups touchés par une pale, ≤ coups du trou), `bank_shot` (balle rentrée après 3 rebonds ou plus dans le même coup).

| Slot | id | Nom | Condition | Compteur |
|---|---|---|---|---|
| 2 | `mg_plouf` | Plouf ! | 3 balles à l'eau en une partie | `water` (max ≥ 3) ✅ |
| 3 | `mg_don_quichotte` | Don Quichotte | Se faire renvoyer la balle par le moulin 5 fois (cumul) | `mill_hits` (somme ≥ 5) ✅ |
| 4 | `mg_ramassee` | Balle ramassée | Ne pas rentrer la balle en 6 coups sur un trou | `picked_up` (somme ≥ 1) ✅ |
| 5 | `mg_habitue` | Habitué du parcours | Jouer 10 parties (cumul) | nombre de parties ≥ 10 ✅ |
| 6 | `mg_regulier` | Régulier | 50 trous finis dans le par ou mieux (cumul) | `pars` (somme ≥ 50) ✅ |
| 7 | `mg_petit_oiseau` | Petit oiseau | 10 trous finis en un coup de moins que le par (cumul) | `birdies` (somme ≥ 10) ✅ |
| 8 | `mg_par_la_bande` | Par la bande | Rentrer la balle après 3 rebonds ou plus dans le même coup | `bank_shot` (max ≥ 1) ✅ |
| 9 | `mg_trou_en_un` | Trou en un ! | Rentrer la balle du premier coup | `aces` (max ≥ 1) ✅ |
| 10 | `mg_sous_le_par` | Sous le par | Finir un parcours de 9 trous sous le par | `under_par` (max ≥ 1) ✅ |
| 11 | `mg_sans_bavure` | Sans bavure | 9 trous sans jamais dépasser le par | `clean_card` (max ≥ 1) ✅ |
| 12 | `mg_legende` | Légende du green | Gagner 15 parties (cumul) | `won` (somme ≥ 15) ✅ |

### Animateur Télé 🎤 — Dédé Party (`dede-party`)

Tenue débloquée à **5 victoires** (partie longue). Compteurs posés par le serveur dans `state.stats` puis recopiés dans `results[].stats` (`_dp_tstats`) : `pubs` (arrêts sur une Page de pub), `broke` (1 si le joueur est tombé à 0 pièce sur une perte : pub, carte, pickpocket, Téléthon — pas sur un achat d'étoile), `no_star` (0 étoile à la fin, étoiles bonus comprises), `coins_earned` (pièces gagnées, pertes non déduites), `envelopes` (cartes tirées), `star_exact` (étoile achetée sur la dernière case d'un déplacement), `mg_streak` (plus longue série de mini-jeux gagnés, 1re place ex aequo comprise), `stars`, `win_mvp` (vainqueur ET Roi des mini-jeux). Aussi posés : `coins`, `mg_wins`, `rounds`.

| Slot | id | Nom | Condition | Compteur |
|---|---|---|---|---|
| 2 | `party_coupure_pub` | Coupure pub | S'arrêter sur 3 Pages de pub en une partie | `pubs` (max ≥ 3) ✅ |
| 3 | `party_fauche` | Fauché | Tomber à 0 pièce | `broke` (somme ≥ 1) ✅ |
| 4 | `party_ciel_couvert` | Ciel couvert | Finir une partie sans aucune étoile | `no_star` (somme ≥ 1) ✅ |
| 5 | `party_fidele` | Fidèle au poste | Jouer 5 parties (cumul) | nombre de parties ≥ 5 ✅ |
| 6 | `party_tirelire` | Tirelire | Gagner 300 pièces (cumul) | `coins_earned` (somme ≥ 300) ✅ |
| 7 | `party_chouchou` | Chouchou de Dédé | Ouvrir 10 enveloppes surprise (cumul) | `envelopes` (somme ≥ 10) ✅ |
| 8 | `party_pile_dessus` | Pile dessus | Acheter une étoile en s'arrêtant exactement sur sa case | `star_exact` (somme ≥ 1) ✅ |
| 9 | `party_triple` | Le triplé | Gagner 3 mini-jeux d'affilée | `mg_streak` (max ≥ 3) ✅ |
| 10 | `party_constellation` | Constellation | Finir avec plein d’étoiles : 3 ★ en 6 tours, 4 ★ en 9, 5 ★ en 12 (à 5 joueurs et plus : 3, 3 et 4 ★) | `constellation` (seuil selon durée et table, ~10-25 % des joueurs) ✅ |
| 11 | `party_carton_plein` | Carton plein | Gagner la partie en étant aussi Roi des mini-jeux | `win_mvp` (somme ≥ 1) ✅ |
| 12 | `party_star_ecran` | Star du petit écran | Gagner 10 parties (cumul) | `won` (somme ≥ 10) ✅ |

## 3. Trophées généraux (facultatifs)

Transverses, sans sticker de planche : récompense proposée = badge sur le profil + XP. `tenue_id` et `slot` nuls dans le catalogue.

| id | Nom | Condition | Donnée |
|---|---|---|---|
| `gen_touche_a_tout` | Touche-à-tout | Jouer à 10 jeux différents | OK (`match_players.game_id` distincts) ✅ |
| `gen_polyvalent` | Polyvalent | Gagner dans 5 jeux différents | OK (`match_players.won`) ✅ |
| `gen_pilier` | Pilier de soirée | Participer à 20 soirées | OK (`player_stats.soirees_count`) ✅ |
| `gen_noctambule` | Noctambule | Finir 3 soirées après 2 h du matin | OK (`player_stats.late_soirees_count`) ✅ |
| `gen_marathon` | Marathonien | Jouer 8 parties dans une même soirée | OK (`matches.soiree_id` + `match_players`) ✅ |
| `gen_hote` | Hôte de la maison | Organiser 5 soirées menées à leur terme | OK (`soirees.host_id`) ✅ |
| `gen_grande_tablee` | Grande tablée | Participer à une soirée de 6 joueurs ou plus | OK (`soiree_players`) ✅ |
| `gen_pipelette` | Pipelette | Envoyer 50 stickers dans le chat | PHASE 2 (`player_stats.stickers_sent` : les messages sont purgés en fin de soirée) ✅ |
| `gen_garde_robe` | Garde-robe | Débloquer 5 tenues | OK (`tenue_unlocks`) ✅ |
| `gen_collectionneur` | Collectionneur | Compléter une planche de tenue (les 11 trophées) | OK (`trophy_unlocks`) ✅ |
| `gen_madame_irma` | Madame Irma | 3 bons pronostics d'affilée (tenue secrète `irma`) | OK (`_prono_resolved`) ✅ |
| `gen_esprit_noel` | Esprit de Noël | Ouvrir 12 cases du calendrier de l'Avent (tenue secrète `lutin`, dossier d'art `elf`) | OK (`advent_opens`, règle `special` `advent`) ✅ |

---

## 4. Récapitulatif des évolutions serveur

Socle :

- Tables `trophies` + `trophy_unlocks`, évaluation générique (`sum` / `max` sur `match_players.stats`) dans `_after_finish_match`, `new_trophies` dans le state final.
- `equip_expression` et `send_soiree_message` : vérifier `(tenue équipée, slot)` au lieu de l'id d'expression pour les tenues autres que `default`.
- La palette commune `_costume_expressions()` et la condition `determine` ne servent plus au déblocage des stickers de tenue.
- Socle duel : `_duel_finish` recopie `session.stats` et les exploits tirés de `session.history` dans `results[].stats` ; `board_move` peut renvoyer des compteurs de fin de manche.

Recopie du state final dans `results[].stats` (FIN, aucun suivi en cours de partie) : à faire dans le `_finish` de chaque jeu. Cinq jeux n'ont besoin de rien d'autre (liste sous le tableau) ; `tu-preferes`, `action-ou-verite`, `menteur`, `qui-suis-je`, `qui-de-nous` et `morpion` n'ont qu'un ou deux compteurs à ajouter.

Nouveaux compteurs à incrémenter en cours de partie (NEW) :

| Jeu | Compteurs |
|---|---|
| `qui-de-nous` | `best_streak` |
| `undercover` | `good_votes`, `wrong_votes`, `votes_cast`, `votes_received` |
| `pas-de-bol` | `max_draw`, `denounced`, `denounces`, `specials`, `max_hand`, `cards_given`, `stacks`, `drawn` |
| `petit-bac` | `refused`, `shared`, `max_empty`, `full_rounds`, `contests_ok` |
| `dessine-devine` | `close`, `late_finds`, `fast_finds`, `no_hint_finds`, difficulté du mot dans le résumé du tour |
| `bombe-a-mots` | `fast_words`, `close_calls` |
| `menteur` | `pure_bluffs` |
| `tu-preferes` | `rebel_right` |
| `qui-suis-je` | `hard_found` |
| `action-ou-verite` | `unanimous`, `hard_success` |
| `devine-en-equipe` | `empty_turns`, `max_passed`, `found_r3`, `best_r2`, `carries`, `best_turn` |
| `quatre-a-la-suite` | `diag_wins`, `double_wins` |
| `morpion` | `clean_ultimate` |
| `bataille-navale` | `miss_streak`, `first_shot_hits`, et report en fin de manche de `hits`, `shots`, `best`, `count`, bateaux restants des deux camps |
| `dede-kart` | `hits_taken`, `used_cloud`, `used_confetti`, `used_reverse` |
| général | `player_stats.stickers_sent` |

Sans nouveau compteur : `cerveau-en-fete`, `loup-garou`, `bowling`, `le-plus-proche`, `tour-des-potes`.

### Phase 2 : réalisé (53 trophées branchés, 230/230 actifs)

Les noms de compteurs réellement implémentés diffèrent parfois de la liste ci-dessus (cf. les règles dans `features/trophees.sql`). Principes :

- Compteurs simples accumulés dans `state.stats` / `state.tstat` (tu-preferes, action-ou-verite, devine-en-equipe, dede-kart) ou calculés à la fin depuis `history` (qui-de-nous, petit-bac, dessine-devine, menteur, qui-suis-je).
- Infos secrètes (rôles et votes d'Undercover ; mains de Pas de bol ; heure d'explosion de la bombe) : accumulées dans `server` (`vote_log`, `pstats`, `fast_words`, `close_calls`), recopiées seulement dans `results[].stats` à la fin.
- Duels : `board_move` peut renvoyer `game` (bilan de manche), rangé par le socle dans `duel.games[].x` puis relu par les hooks `game_<id>_trophy_stats` via `_duel_games_x`. Bataille navale : bilan par joueur et par manche (tirs, touchés, séries, bateaux restants).
- Pipelette : colonne persistante `player_stats.stickers_sent` incrémentée par `send_soiree_message` (sticker), règle `special` nommée `stickers`, évaluée à l'envoi (`evaluate_trophy`, un seul trophée).
- Reformulation : `bn_premier_tir` devient « Toucher dès son premier tir d'une manche » (le premier tir de chaque joueur compte, pas seulement le tout premier de la manche).

## 5. Points tranchés (validés par l'utilisateur)

- Planche < 12 stickers : le trophée du slot manquant donne juste le badge ; stickers bonus `extraN` au-delà : restent offerts avec la tenue.
- La progression des trophées compte dès maintenant, même sans la tenue : à son déblocage, les stickers déjà mérités sont débloqués d'un coup. Une tenue débloquée ne donne que `joie`.
- Trophées dépendant d'une option ou du nombre de joueurs (`uc_page_blanche`, `mtr_pile`, `qsj_tete_connue`, `mor_*`, seuils « 3 / 4 joueurs min. ») : conservés. Pas de rétroactivité.
- Seuils chiffrés à calibrer en jeu : bowling (150 / 200), Tour des Potes (loyers), Qui suis-je (8 / 12 cartes), bataille navale (40 tirs, 40 %).
