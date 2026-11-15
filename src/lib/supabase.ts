import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/db'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

export const SUPABASE_MISSING_MESSAGE =
  'Supabase n\'est pas configuré : crée un fichier .env.local avec VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir .env.example), puis relance `npm run dev`.'

if (!isSupabaseConfigured) {
  console.error(`[supabase] ${SUPABASE_MISSING_MESSAGE}`)
}

/**
 * Client unique. Si les variables manquent, on cree quand meme un client factice
 * (pour ne pas casser l'app au chargement) : tout appel reseau echouera et
 * l'UI affiche une banniere via `isSupabaseConfigured`.
 */
export const supabase = createClient<Database>(
  url ?? 'http://localhost:54321',
  anonKey ?? 'missing-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true } },
)
