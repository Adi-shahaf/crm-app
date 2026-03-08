import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const formData = await request.formData()
  const email = String(formData.get('email') ?? '').trim()

  if (!email) {
    return NextResponse.redirect(
      `${requestUrl.origin}/forgot-password?error=Please enter your email`,
      { status: 302 }
    )
  }

  const supabase = await createClient()
  const redirectTo = requestUrl.origin

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  })

  if (error) {
    return NextResponse.redirect(
      `${requestUrl.origin}/forgot-password?error=${encodeURIComponent(error.message)}`,
      { status: 302 }
    )
  }

  return NextResponse.redirect(
    `${requestUrl.origin}/forgot-password?success=If that email exists, we sent a reset link`,
    { status: 302 }
  )
}
