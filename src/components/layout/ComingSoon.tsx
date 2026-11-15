import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { StaggerItem, StaggerList } from '@/components/ui/Stagger'
import { useSession } from '@/store/session'

export interface ComingSoonProps {
  title: string
  text?: string
  slug?: string
  expression?: string
  children?: ReactNode
}

/** Placeholder joli pour les ecrans de la phase 2. */
export function ComingSoon({ title, text = 'Bientôt disponible !', slug, expression = 'joie', children }: ComingSoonProps) {
  const mine = useSession((s) => s.profile?.slug)
  return (
    <StaggerList className="flex flex-col items-center gap-5 pt-6 text-center">
      <StaggerItem>
        <h1 className="text-4xl">{title}</h1>
      </StaggerItem>
      <StaggerItem>
        <motion.div whileTap={{ scale: 0.85, rotate: 8 }} className="animate-float">
          <ChibiImage slug={slug ?? mine ?? 'dede'} expression={expression} size={180} />
        </motion.div>
      </StaggerItem>
      <StaggerItem>
        <Card tilt className="max-w-xs">
          <Badge tone="grape" className="mb-2">Bientôt</Badge>
          <p className="text-lg">{text}</p>
        </Card>
      </StaggerItem>
      {children && <StaggerItem className="w-full">{children}</StaggerItem>}
    </StaggerList>
  )
}
