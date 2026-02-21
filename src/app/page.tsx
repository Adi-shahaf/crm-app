import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'

export default async function Page() {
  const supabase = await createClient()

  const { data, error } = await supabase.auth.getUser()
  if (data?.user) {
    redirect('/board')
  } else {
    redirect('/login')
  }

  return null
}
