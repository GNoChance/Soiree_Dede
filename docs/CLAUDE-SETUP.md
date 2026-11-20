# Installer Claude Code sur un nouveau PC

Ce guide sert à retrouver sur un autre PC le même environnement Claude Code que sur le PC principal.

## 1. Ce qui revient tout seul (compte claude.ai)

Il suffit de se connecter avec **le même compte claude.ai** pour retrouver :

- **Les skills** : artifact-design, dataviz, docs, pdf, docx, xlsx, pptx, deep-research, skill-creator, morning, etc. Ce sont des skills intégrées à Claude Code ou synchronisées depuis le compte. Il n'y a **aucune skill perso à copier** : `~/.claude/skills` ne contient que la synchronisation automatique.
- **Les connecteurs** : Figma, Claude Docs, Gmail ou Agenda s'ils sont branchés. Ils sont liés au compte.
- **Les plugins** : seul le catalogue officiel `claude-plugins-official` est connu, et aucun plugin n'est activé. Rien à installer.

## 2. Installer les outils

1. **Node.js 24** (le PC actuel est en v24.20.0) et **Git**.
2. **Claude Code** :
   - en ligne de commande : `npm install -g @anthropic-ai/claude-code`,
   - ou l'extension VS Code « Claude Code ».

   Lancer `claude` une première fois, puis se connecter.
3. Réglages à reprendre avec `/config`, ou dans `~/.claude/settings.json` :

   ```json
   {
     "modelSettings": { "claude-opus-5-5": { "effortLevel": "high" } },
     "autoUpdatesChannel": "latest",
     "theme": "dark"
   }
   ```

## 3. Récupérer le projet

```sh
git clone https://github.com/GNoChance/Soiree_Dede.git soirees-dede
cd soirees-dede
npm ci
cd tools/slice-chibis && npm ci && cd ../..   # découpe des planches chibi (sharp)
cd tools/sql-tests   && npm ci && cd ../..    # tests SQL (PGlite)
cd promo-video       && npm ci && cd ..       # vidéos tuto (Remotion)
```

**Ne pas oublier** : `.env.local` n'est pas dans Git. Pour le recréer, copier `.env.example` en `.env.local`, puis remplir :

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

On trouve ces deux valeurs dans Supabase → Project Settings → API. On peut aussi recopier le fichier depuis l'ancien PC, sans jamais le commiter.

Les secrets du rappel push (VAPID, `PUSH_CRON_SECRET`) restent dans Vercel. Ils n'ont rien à faire sur le PC.

## 4. Mémoire de Claude (important)

La mémoire de Claude est stockée **sur le PC**, pas dans le compte. Une copie est rangée dans [docs/claude-memoire/](claude-memoire/). Sur le nouveau PC, la recopier dans le dossier mémoire du projet. Ce dossier porte le nom du chemin du projet : le nom ci-dessous vaut pour un projet cloné dans `C:\Users\<toi>\soirees-dede`.

```sh
# Git Bash, depuis la racine du projet
mkdir -p ~/.claude/projects/c--Users-$USERNAME-soirees-dede/memory
cp docs/claude-memoire/*.md ~/.claude/projects/c--Users-$USERNAME-soirees-dede/memory/
```

Si le projet est ailleurs, lancer `claude` une fois dans le projet. Le dossier `~/.claude/projects/<nom>` se crée alors tout seul, et il suffit d'y copier les fichiers dans `memory/`.

Les instructions du projet, elles, sont dans [CLAUDE.md](../CLAUDE.md), qui est versionné. Elles reviennent donc toutes seules avec Git.

## 5. Facultatif : Blender (MCP)

Uniquement pour piloter Blender depuis Claude. Ça n'est pas utilisé par le jeu.

1. Installer **uv** : https://docs.astral.sh/uv/
2. Ajouter le serveur :

   ```sh
   claude mcp add --scope user blender -- uvx mcp-for-blender
   ```

3. Dans Blender, installer et activer l'add-on « MCP for Blender ».

## 6. Vérifier que tout marche

```sh
npm run dev      # l'appli tourne sur http://localhost:5173
npm run build    # tsc + vite sans erreur
npm run sql      # régénère supabase/install.sql
```

Dans Claude, la commande `/memory` doit lister les 3 mémoires du projet.
