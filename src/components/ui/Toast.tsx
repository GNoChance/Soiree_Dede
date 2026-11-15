import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useToasts, type ToastItem } from '@/store/toast'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'

const KIND = {
  info: { bg: 'bg-sky', Icon: Info },
  success: { bg: 'bg-mint', Icon: CheckCircle2 },
  error: { bg: 'bg-tomato text-white', Icon: XCircle },
} as const

function ToastView({ t }: { t: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss)
  const { bg, Icon } = KIND[t.kind]

  useEffect(() => {
    if (t.kind === 'success') fx.success()
    else if (t.kind === 'error') fx.fail()
    else fx.pop()
    if (!t.duration) return
    const id = setTimeout(() => dismiss(t.id), t.duration)
    return () => clearTimeout(id)
  }, [t.id, t.kind, t.duration, dismiss])

  return (
    <motion.div
      layout
      initial={{ y: -80, scale: 0.8, rotate: -4, opacity: 0 }}
      animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
      exit={{ x: 200, opacity: 0, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
      className={cn('sticker pointer-events-auto flex items-center gap-3 px-4 py-3 text-[#1f1b2e]', bg)}
      onClick={() => !t.action && dismiss(t.id)}
    >
      <Icon className="size-6 shrink-0" strokeWidth={2.5} />
      <span className="flex-1 font-display text-base leading-tight font-bold">{t.message}</span>
      {t.action && (
        <button
          className="rounded-chip border-2 border-ink bg-surface px-3 py-1 text-sm font-extrabold text-text shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
          onClick={() => {
            t.action?.onClick()
            dismiss(t.id)
          }}
        >
          {t.action.label}
        </button>
      )}
    </motion.div>
  )
}

/** A monter une seule fois (dans Root). */
export function ToastHost() {
  const toasts = useToasts((s) => s.toasts)
  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col gap-2 px-4 pt-3">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastView key={t.id} t={t} />
        ))}
      </AnimatePresence>
    </div>
  )
}
