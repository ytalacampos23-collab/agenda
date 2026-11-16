import { createClient } from '@supabase/supabase-js'

// Use the public Supabase Publishable key. Never place a secret/service_role key here.
const url = (import.meta.env.VITE_SUPABASE_URL || 'https://ricjeqgfzsthsutdeyah.supabase.co') as string | undefined
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY
) as string | undefined

export const hasSupabaseConfig = Boolean(url && publishableKey)
export const supabase = hasSupabaseConfig ? createClient(url!, publishableKey!) : null
