import { createBrowserClient } from '@supabase/ssr'
import { getSupabasePublicEnv } from '@/utils/supabase/env'

export function createClient() {
  const { url, key } = getSupabasePublicEnv()

  return createBrowserClient(
    url,
    key
  )
}
