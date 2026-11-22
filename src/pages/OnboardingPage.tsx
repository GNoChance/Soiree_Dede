import { useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { LayoutGroup, motion } from 'framer-motion'
import { ArrowLeft, Lock } from 'lucide-react'
import { getCharacter } from '@/data/characters'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { PinPad } from '@/components/ui/PinPad'
import { Skeleton } from '@/components/ui/Skeleton'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { burst, victoryConfetti } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { loginWithPin } from '@/lib/auth'
import { isSupabaseConfigured, supabase, SUPABASE_MISSING_MESSAGE } from '@/lib/supabase'
import { rpcErrorMessage, toastRpcError } from '@/lib/rpcError'
import { useSession } from '@/store/session'
import { toast } from '@/store/toast'
import type { ExpressionId, PublicProfile } from '@/types/db'

type PinStep = 'enter' | 'create' | 'confirm'

/** Première expression souhaitée que le perso possède, sinon 'joie'. */
const pick = (p: PublicProfile, ...wanted: ExpressionId[]): ExpressionId =>
  wanted.find((e) => p.expressions.includes(e)) ?? 'joie'

function formatCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function OnboardingPage() {
  const profile = useSession((s) => s.profile)
  const navigate = useNavigate()
  const booted = useSession((s) => s.booted)
  const [profiles, setProfiles] = useState<PublicProfile[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<PublicProfile | null>(null)
  const [step, setStep] = useState<PinStep>('enter')
  const [firstPin, setFirstPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [mood, setMood] = useState<ExpressionId | null>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [welcome, setWelcome] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let cancelled = false
    supabase.rpc('list_profiles_public').then(({ data, error }) => {
      if (cancelled) return
      if (error) setLoadError(rpcErrorMessage(error))
      else {
        setLoadError(null)
        setProfiles(data ?? [])
      }
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    if (!lockedUntil) return
    const t = setInterval(() => {
      const n = Date.now()
      setNow(n)
      if (n >= lockedUntil) {
        setLockedUntil(null)
        setMessage(null)
      }
    }, 1000)
    return () => clearInterval(t)
  }, [lockedUntil])

  if (booted && profile && !welcome) return <Navigate to="/" replace />

  const locked = lockedUntil !== null && lockedUntil > now

  const choose = (p: PublicProfile) => {
    fx.pop()
    setChosen(p)
    setStep(p.has_pin ? 'enter' : 'create')
    setFirstPin('')
    setMessage(null)
    setMood(pick(p, 'surprise', 'joie'))
    setLockedUntil(null)
  }

  const back = () => {
    setChosen(null)
    setLockedUntil(null)
    setMessage(null)
  }

  const submit = async (pin: string): Promise<boolean | void> => {
    if (!chosen) return false
    if (step === 'create') {
      setFirstPin(pin)
      setStep('confirm')
      setMessage(null)
      setMood(pick(chosen, 'reflexion', 'joie'))
      fx.success()
      return
    }
    if (step === 'confirm' && pin !== firstPin) {
      setStep('create')
      setFirstPin('')
      setMessage('Les deux codes sont différents, recommence.')
      setMood(pick(chosen, 'boude', 'joie'))
      return false
    }
    try {
      const res = await loginWithPin(chosen.slug, pin)
      if (res.ok) {
        setMood(pick(chosen, 'joie'))
        fx.fanfare()
        if (res.first_login) {
          setWelcome(true)
          victoryConfetti()
        } else {
          burst()
        }
        return
      }
      if (res.error === 'wrong_pin') {
        setMessage(res.attempts_left <= 1 ? 'Dernier essai !' : `Plus que ${res.attempts_left} essais`)
        setMood(pick(chosen, 'pleurs', 'boude', 'joie'))
      } else if (res.error === 'locked') {
        setLockedUntil(new Date(res.locked_until).getTime())
        setNow(Date.now())
        setMood(pick(chosen, 'dodo', 'boude', 'joie'))
      } else if (res.error === 'invalid_pin_format') {
        setMessage('Le code doit faire exactement 4 chiffres.')
      } else {
        setMessage('Joueur inconnu.')
      }
      return false
    } catch (e) {
      setMessage(rpcErrorMessage(e))
      return false
    }
  }

  const title =
    step === 'create' ? 'Choisis ton code secret'
    : step === 'confirm' ? 'Confirme ton code'
    : 'Ton code'
  const subtitle =
    step === 'create' ? '4 chiffres à retenir : il te servira à te reconnecter.'
    : step === 'confirm' ? 'saisis-le une deuxième fois.'
    : 'entre ton code à 4 chiffres.'

  return (
    <div className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-6">
      <LayoutGroup>
        {welcome && chosen && profile ? (
          <Welcome slug={chosen.slug} />
        ) : !chosen ? (
          <div className="flex flex-col gap-5">
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
            {!isSupabaseConfigured ? (
              <p className="sticker rounded-card bg-surface p-4 font-bold text-tomato">{SUPABASE_MISSING_MESSAGE}</p>
            ) : loadError ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-center font-bold text-tomato">{loadError}</p>
                <Button onClick={() => setReloadKey((k) => k + 1)}>Réessayer</Button>
              </div>
            ) : !profiles ? (
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <Skeleton key={i} className="h-[136px] rounded-card" />
                ))}
              </div>
            ) : (
              <StaggerList className="grid grid-cols-3 gap-3">
                {profiles.map((p) => (
                  <StaggerItem key={p.id}>
                    <motion.button
                      whileTap={{ scale: 0.9, rotate: 4 }}
                      whileHover={{ y: -4, rotate: -2 }}
                      onClick={() => choose(p)}
                      className="flex w-full flex-col items-center gap-0.5 rounded-card border-[3px] border-ink bg-surface px-1 py-3 shadow-sticker"
                    >
                      <motion.div layoutId={`pick-${p.slug}`}>
                        <Avatar slug={p.slug} expression={p.equipped_expression} tenue={p.equipped_tenue} size={72} />
                      </motion.div>
                      <span className="max-w-full truncate font-display text-lg font-extrabold text-text">{p.nickname}</span>
                      <span className="max-w-full truncate text-xs font-bold text-muted">{p.first_name}</span>
                    </motion.button>
                  </StaggerItem>
                ))}
              </StaggerList>
            )}
            {/* Mode invité : une personne de passage rejoint une soirée sans profil. */}
            {isSupabaseConfigured && (
              <Button variant="secondary" size="lg" fullWidth onClick={() => navigate('/invite')}>
                👋 Je suis de passage (sans compte)
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-5">
            <Button variant="ghost" size="sm" className="self-start" icon={<ArrowLeft className="size-5" />} onClick={back}>
              Retour
            </Button>
            <motion.div layoutId={`pick-${chosen.slug}`} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
              <motion.div
                key={mood ?? 'x'}
                initial={{ scale: 0.8, rotate: -6 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 10 }}
              >
                <Avatar slug={chosen.slug} expression={mood ?? chosen.equipped_expression} tenue={chosen.equipped_tenue} size={140} bounce />
              </motion.div>
            </motion.div>
            <motion.div key={step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="text-center">
              <h2 className="text-3xl">{title}</h2>
              <p className="mt-1 text-muted">
                {chosen.nickname}, {subtitle}
              </p>
            </motion.div>
            {locked && lockedUntil ? (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="sticker flex flex-col items-center gap-1 rounded-card bg-surface p-4 text-center"
              >
                <Lock className="size-8 text-tomato" />
                <p className="font-display text-lg font-extrabold">Trop d'essais ratés</p>
                <p className="text-muted">Réessaie dans</p>
                <p className="font-display text-4xl font-extrabold text-tomato">{formatCountdown(lockedUntil - now)}</p>
              </motion.div>
            ) : (
              <>
                {message && (
                  <motion.p
                    key={message}
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-center font-display text-lg font-bold text-tomato"
                  >
                    {message}
                  </motion.p>
                )}
                <PinPad key={step} onComplete={submit} />
              </>
            )}
          </div>
        )}
      </LayoutGroup>
    </div>
  )
}

/** Première connexion : bienvenue + pseudo modifiable. */
function Welcome({ slug }: { slug: string }) {
  const profile = useSession((s) => s.profile)
  const patchProfile = useSession((s) => s.patchProfile)
  const navigate = useNavigate()
  const [nick, setNick] = useState(profile?.nickname ?? '')
  const [busy, setBusy] = useState(false)
  const char = getCharacter(slug)

  const go = async () => {
    const clean = nick.trim().replace(/\s+/g, ' ')
    setBusy(true)
    try {
      if (profile && clean && clean !== profile.nickname) {
        const { data, error } = await supabase.rpc('update_nickname', { p_nickname: clean })
        if (error) throw error
        patchProfile(data)
      }
      toast.success("C'est parti !")
      navigate('/', { replace: true })
    } catch (e) {
      toastRpcError(e)
      setBusy(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
      className="flex flex-col items-center gap-5 pt-4 text-center"
    >
      <motion.div layoutId={`pick-${slug}`}>
        <Avatar slug={slug} expression="joie" size={160} bounce />
      </motion.div>
      <h1 className="text-4xl text-tangerine [text-shadow:2px_2px_0_var(--ink)]">
        Bienvenue {char?.firstName ?? ''} !
      </h1>
      <p className="text-muted">Ton code est enregistré. Tu peux personnaliser ton pseudo, il sera visible par tous.</p>
      <label className="w-full text-left">
        <span className="mb-1 block font-display font-extrabold">Ton pseudo</span>
        <input
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          maxLength={20}
          className="sticker-sm w-full rounded-card border-[3px] border-ink bg-surface px-4 py-3 font-display text-xl font-extrabold text-text outline-none"
        />
      </label>
      <Button size="lg" fullWidth loading={busy} disabled={!nick.trim()} onClick={() => void go()}>
        C'est parti !
      </Button>
    </motion.div>
  )
}
