import { Link, useLocation } from 'react-router'
import { motion } from 'framer-motion'
import { Gamepad2, Package, Settings, Trophy, Users } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'

export const TABS = [
  { to: '/', label: 'Jeux', Icon: Gamepad2 },
  { to: '/inventaire', label: 'Inventaire', Icon: Package },
  { to: '/classement', label: 'Classement', Icon: Trophy },
  { to: '/amis', label: 'Amis', Icon: Users },
  { to: '/parametres', label: 'Réglages', Icon: Settings },
] as const

export const tabIndex = (pathname: string) =>
  TABS.findIndex((t) => (t.to === '/' ? pathname === '/' : pathname.startsWith(t.to)))

export function BottomNav() {
  const { pathname } = useLocation()
  const active = tabIndex(pathname)
  return (
    <nav
      aria-label="Navigation principale"
      className="pb-safe pl-safe pr-safe pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-3"
    >
      <div className="sticker pointer-events-auto mx-auto flex max-w-md items-stretch gap-1 rounded-bubble bg-surface p-1.5">
        {TABS.map(({ to, label, Icon }, i) => {
          const isActive = i === active
          return (
            <Link
              key={to}
              to={to}
              onClick={() => !isActive && fx.pop()}
              aria-current={isActive ? 'page' : undefined}
              className="relative flex flex-1 flex-col items-center gap-0.5 rounded-card px-1 py-1.5"
            >
              {isActive && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 rounded-card border-[3px] border-ink bg-sun shadow-sticker-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                />
              )}
              <motion.span
                key={isActive ? 'on' : 'off'}
                initial={isActive ? { scale: 0.5, rotate: -25 } : false}
                animate={{ scale: 1, rotate: 0, y: isActive ? -1 : 0 }}
                transition={{ type: 'spring', stiffness: 600, damping: 12 }}
                className={cn('relative z-10', isActive ? 'text-[#1f1b2e]' : 'text-muted')}
              >
                <Icon className="size-6" strokeWidth={isActive ? 3 : 2.5} />
              </motion.span>
              <span
                className={cn(
                  'relative z-10 font-display text-[0.7rem] leading-none font-extrabold',
                  isActive ? 'text-[#1f1b2e]' : 'text-muted',
                )}
              >
                {label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
