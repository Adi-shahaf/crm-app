import { createClient } from '@/utils/supabase/server'
import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') || '/board'

  const redirectTo = request.nextUrl.clone()
  redirectTo.pathname = next
  redirectTo.searchParams.delete('token_hash')
  redirectTo.searchParams.delete('type')
  redirectTo.searchParams.delete('next')

  if (!tokenHash || !type) {
    redirectTo.pathname = '/login'
    redirectTo.search = ''
    redirectTo.searchParams.set('error', 'Invalid or expired recovery link')
    return NextResponse.redirect(redirectTo, { status: 302 })
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  })

  if (error) {
    redirectTo.pathname = '/login'
    redirectTo.search = ''
    redirectTo.searchParams.set('error', 'Invalid or expired recovery link')
    return NextResponse.redirect(redirectTo, { status: 302 })
  }

  return NextResponse.redirect(redirectTo, { status: 302 })
}
