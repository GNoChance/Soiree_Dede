// Résolution des imports TS sans extension (src/…/holes) pour node --experimental-strip-types.
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return next(specifier + '.ts', context)
      } catch {
        /* pas un .ts : résolution normale */
      }
    }
    return next(specifier, context)
  },
})
