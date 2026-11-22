import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, LogIn, PartyPopper } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'
import { burst } from '@/components/ui/confetti'
import { GUEST_AVATARS, guestAvatarOf } from '@/data/guests'
import { fx } from '@/lib/feedback'
import { logout } from '@/lib/auth'
import { isSupabaseConfigured, supabase, SUPABASE_MISSING_MESSAGE } from '@/lib/supabase'
import { useSession } from '@/store/session'
import { errorMessage, toastError } from '@/features/soiree/errors'
import { refetchActiveSoirees, useActiveSoirees } from '@/features/soiree/activeSoirees'
import { guestInviteInfo, isGuestProfile, joinAsGuest, type GuestInviteInfo } from './api'

const inputCls =
  'sticker w-full rounded-card border-[3px] border-ink bg-surface px-4 py-3 text-center font-display text-3xl font-extrabold text-text outline-none focus:bg-sun focus:text-[#1f1b2e]'

/**
 * « Je suis de passage » : une personne sans profil rejoint une soirée (QR code /invite/<jeton>,
 * ou code à 4 lettres tapé à la main), avec un prénom et un avatar emoji. Sert aussi d'accueil
 * aux invités (retour à leur soirée, autre code, sortie du mode invité).
 */
export function GuestJoinPage() {
  const { token } = useParams()
  const navigate = useNavigate()
  const booted = useSession((s) => s.booted)
  const profile = useSession((s) => s.profile)
  const guest = isGuestProfile(profile)
  const { soirees } = useActiveSoirees(guest ? profile?.id : undefined)

  const [code, setCode] = useState('')
  const [info, setInfo] = useState<GuestInviteInfo | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [name, setName] = useState(() => (guest ? (profile?.nickname ?? '') : ''))
  const [avatar, setAvatar] = useState<string | null>(() => (guest ? (guestAvatarOf(profile?.slug)?.id ?? null) : null))
  const [joining, setJoining] = useState(false)

  const check = async (c: string) => {
    setChecking(true)
    setInfoError(null)
    try {
      setInfo(await guestInviteInfo(c))
      fx.pop()
    } catch (e) {
      fx.fail()
      setInfo(null)
      setInfoError(errorMessage(e))
    } finally {
      setChecking(false)
    }
  }

  // Lien du QR code : vérifie l'invitation dès que la session est prête.
  useEffect(() => {
    if (!booted || !token || !isSupabaseConfigured) return
    void check(token)
  }, [booted, token])

  const codeOrToken = token ?? info?.code ?? code

  const join = async () => {
    if (!avatar || !name.trim()) return
    setJoining(true)
    try {
      const sid = await joinAsGuest(codeOrToken, name.trim(), avatar)
      fx.fanfare()
      burst({ x: 0.5, y: 0.4 }, 80)
      void refetchActiveSoirees()
      navigate(`/soiree/${sid}`, { replace: true })
    } catch (e) {
      toastError(e)
    } finally {
      setJoining(false)
    }
  }

  /** Téléphone d'un membre de la bande : il rejoint avec son vrai profil. */
  const joinAsMember = async () => {
    if (!info) return
    setJoining(true)
    const { data, error } = await supabase.rpc('join_soiree_by_code', { p_code: info.code })
    setJoining(false)
    if (error) return toastError(error)
    fx.fanfare()
    void refetchActiveSoirees()
    navigate(`/soiree/${data.id}`, { replace: true })
  }

  const leaveGuestMode = async () => {
    await logout()
    navigate('/onboarding', { replace: true })
  }

  if (!isSupabaseConfigured) {
    return (
      <Shell>
        <p className="sticker rounded-card bg-surface p-4 font-bold text-tomato">{SUPABASE_MISSING_MESSAGE}</p>
      </Shell>
    )
  }
  if (!booted) {
    return (
      <Shell>
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </Shell>
    )
  }

  const mySoiree = info && guest && info.joined ? info.soiree_id : null
  const canJoin = Boolean(name.trim()) && Boolean(avatar) && !joining

  return (
    <Shell>
      <header className="text-center">
        <motion.h1
          initial={{ scale: 0.5, rotate: -8, opacity: 0 }}
          animate={{ scale: 1, rotate: -2, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 12 }}
          className="text-4xl text-tangerine [text-shadow:3px_3px_0_var(--ink)]"
        >
          Je suis de passage 👋
        </motion.h1>
        <p className="mt-2 text-lg font-bold text-muted">On joue sans compte, juste pour ce soir !</p>
      </header>

      {/* Invité déjà dans une soirée : retour direct. */}
      {guest && soirees.length > 0 && !info && (
        <div className="flex flex-col gap-3">
          {soirees.map((s) => (
            <Button key={s.id} size="lg" fullWidth icon={<PartyPopper className="size-6" />} onClick={() => navigate(`/soiree/${s.id}`)}>
              Retourner à la soirée de {s.host?.nickname ?? 'l’hôte'}
            </Button>
          ))}
        </div>
      )}

      {/* 1. Le code (si on n'est pas arrivé par le QR code). */}
      {!info && !token && (
        <div className="sticker flex flex-col gap-3 rounded-card bg-surface p-4">
          <label htmlFor="guest-code" className="text-center font-display text-xl font-extrabold">
            {guest && soirees.length ? 'Une autre soirée ? Tape son code' : 'Tape le code de la soirée'}
          </label>
          <input
            id="guest-code"
            value={code}
            maxLength={4}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="ABCD"
            onChange={(e) => {
              const v = e.target.value.toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '').slice(0, 4)
              setCode(v)
              setInfoError(null)
              if (v.length === 4) void check(v)
            }}
            className={`${inputCls} tracking-[0.4em]`}
          />
          <p className="text-center text-sm font-bold text-muted">Les 4 lettres sont sur le téléphone de l’hôte.</p>
        </div>
      )}

      {checking && <p className="text-center font-display text-lg font-extrabold text-muted">On toque à la porte…</p>}
      {infoError && (
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="sticker flex flex-col gap-3 rounded-card bg-surface p-4 text-center">
          <p className="font-display text-lg font-extrabold text-tomato">{infoError}</p>
          {token && (
            <Button variant="secondary" onClick={() => navigate('/invite', { replace: true })}>
              Taper un code à la place
            </Button>
          )}
        </motion.div>
      )}

      {/* 2. La soirée trouvée. */}
      <AnimatePresence>
        {info && (
          <motion.div
            initial={{ y: 30, opacity: 0, rotate: -3 }}
            animate={{ y: 0, opacity: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 16 }}
            className="sticker flex items-center gap-3 rounded-card bg-sun p-4 text-[#1f1b2e]"
          >
            <Avatar slug={info.host_slug} size={64} frame={null} />
            <div className="min-w-0 flex-1">
              <p className="font-display text-xl leading-tight font-extrabold">Soirée de {info.host_nickname}</p>
              <p className="font-bold">
                {info.players} {info.players > 1 ? 'personnes' : 'personne'} · code {info.code}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {info && info.me === 'member' && (
        <div className="flex flex-col gap-3 text-center">
          <p className="font-bold">
            Ce téléphone est déjà celui de <b>{profile?.nickname ?? 'quelqu’un de la bande'}</b> : pas besoin du mode invité !
          </p>
          <Button size="lg" fullWidth loading={joining} icon={<LogIn className="size-6" />} onClick={() => void joinAsMember()}>
            Rejoindre avec mon profil
          </Button>
        </div>
      )}

      {mySoiree && (
        <Button size="lg" fullWidth icon={<PartyPopper className="size-6" />} onClick={() => navigate(`/soiree/${mySoiree}`, { replace: true })}>
          Retourner à la soirée
        </Button>
      )}

      {/* 3. Prénom + avatar. */}
      {info && info.me !== 'member' && !mySoiree && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="guest-name" className="font-display text-xl font-extrabold">
              1. Ton prénom
            </label>
            <input
              id="guest-name"
              value={name}
              maxLength={20}
              autoComplete="given-name"
              enterKeyHint="done"
              placeholder="Prénom"
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-display text-xl font-extrabold">2. Ton avatar</p>
            <div className="grid grid-cols-4 gap-3" role="radiogroup" aria-label="Avatar">
              {GUEST_AVATARS.map((a) => {
                const on = avatar === a.id
                return (
                  <motion.button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={a.label}
                    whileTap={{ scale: 0.85, rotate: 8 }}
                    animate={on ? { scale: 1.12, rotate: -4 } : { scale: 1, rotate: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 12 }}
                    onClick={() => {
                      fx.pop()
                      setAvatar(a.id)
                    }}
                    className={`flex aspect-square items-center justify-center rounded-full border-[3px] border-ink text-4xl shadow-sticker ${on ? 'ring-4 ring-grape' : ''}`}
                    style={{ backgroundColor: a.color }}
                  >
                    <span aria-hidden>{a.emoji}</span>
                  </motion.button>
                )
              })}
            </div>
          </div>
          <Button size="lg" fullWidth disabled={!canJoin} loading={joining} icon={<ArrowRight className="size-6" />} onClick={() => void join()}>
            {canJoin ? 'C’est parti !' : !name.trim() ? 'Écris ton prénom' : 'Choisis ton avatar'}
          </Button>
          <p className="text-center text-sm font-bold text-muted">
            Tu joues avec tout le monde ; tes parties ne comptent pas dans les classements de la bande. Ton invité s’efface tout seul après 24 h.
          </p>
        </motion.div>
      )}

      <div className="mt-auto flex flex-col items-center gap-2 pt-6">
        {guest ? (
          <Button variant="ghost" size="sm" onClick={() => void leaveGuestMode()}>
            Je fais partie de la bande : me connecter
          </Button>
        ) : (
          !profile && (
            <Button variant="ghost" size="sm" onClick={() => navigate('/onboarding')}>
              Je fais partie de la bande : me connecter
            </Button>
          )
        )}
        {profile && !guest && (
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            Retour à l’accueil
          </Button>
        )}
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="pt-safe pb-safe mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-4 pt-6 pb-8">{children}</div>
}
