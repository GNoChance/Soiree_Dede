import { useState } from 'react'
import { useNavigate } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft } from 'lucide-react'
import { CHARACTERS, type Character } from '@/data/characters'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { burst } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { useSession } from '@/store/session'

export function OnboardingPage() {
  const [chosen, setChosen] = useState<Character | null>(null)
  const setProfile = useSession((s) => s.setProfile)
  const navigate = useNavigate()

  // TODO phase 2 : signInAnonymously() puis RPC login_profile(slug, pin) ; erreur => return false
  const login = async (pin: string) => {
    if (!chosen) return false
    void pin
    setProfile({
      id: `local-${chosen.slug}`,
      slug: chosen.slug,
      first_name: chosen.firstName,
      nickname: chosen.nickname,
      is_admin: Boolean(chosen.isAdmin),
      equipped_expression: 'joie',
      xp: 0,
    })
    fx.fanfare()
    burst()
    navigate('/', { replace: true })
  }

  return (
    <div className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-6">
      <AnimatePresence mode="wait" initial={false}>
        {!chosen ? (
          <motion.div
            key="pick"
            exit={{ opacity: 0, x: -60, transition: { duration: 0.15 } }}
            className="flex flex-col gap-5"
          >
            <header className="text-center">
              <motion.h1
                initial={{ scale: 0.5, rotate: -8, opacity: 0 }}
                animate={{ scale: 1, rotate: -2, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 12 }}
                className="text-5xl text-tangerine [text-shadow:3px_3px_0_var(--ink)]"
              >
                Les Soirées de Dédé
              </motion.h1>
              <p className="mt-3 text-lg text-muted">Qui es-tu ?</p>
            </header>
            <StaggerList className="grid grid-cols-3 gap-3">
              {CHARACTERS.map((c) => (
                <StaggerItem key={c.slug}>
                  <motion.button
                    whileTap={{ scale: 0.9, rotate: 4 }}
                    whileHover={{ y: -4, rotate: -2 }}
                    onClick={() => {
                      fx.pop()
                      setChosen(c)
                    }}
                    className="flex w-full flex-col items-center gap-1 rounded-card border-[3px] border-ink bg-surface px-1 py-3 shadow-sticker"
                  >
                    <Avatar slug={c.slug} size={72} />
                    <span className="font-display text-lg font-extrabold text-text">{c.nickname}</span>
                  </motion.button>
                </StaggerItem>
              ))}
            </StaggerList>
          </motion.div>
        ) : (
          <motion.div
            key="pin"
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="flex flex-col items-center gap-5"
          >
            <Button variant="ghost" size="sm" className="self-start" icon={<ArrowLeft className="size-5" />} onClick={() => setChosen(null)}>
              Retour
            </Button>
            <Avatar slug={chosen.slug} size={120} bounce />
            <div className="text-center">
              <h2 className="text-3xl">Salut {chosen.nickname} !</h2>
              <p className="mt-1 text-muted">Entre ton code à 4 chiffres (il sera créé à la première connexion)</p>
            </div>
            <PinPad onComplete={login} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
