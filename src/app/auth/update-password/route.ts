import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const requestUrl = new URL(request.url)
  const formData = await request.formData()
  const password = String(formData.get('password') ?? '')
  const confirmPassword = String(formData.get('confirmPassword') ?? '')

  if (password.length < 8) {
    return NextResponse.redirect(
      `${requestUrl.origin}/reset-password?error=Password must be at least 8 characters`,
      { status: 302 }
    )
  }

  if (password !== confirmPassword) {
    return NextResponse.redirect(
      `${requestUrl.origin}/reset-password?error=Passwords do not match`,
      { status: 302 }
    )
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(
      `${requestUrl.origin}/login?error=Your recovery session expired. Request a new reset link.`,
      { status: 302 }
    )
  }

  const { error } = await supabase.auth.updateUser({
    password,
  })

  if (error) {
    return NextResponse.redirect(
      `${requestUrl.origin}/reset-password?error=${encodeURIComponent(error.message)}`,
      { status: 302 }
    )
  }

  return NextResponse.redirect(
    `${requestUrl.origin}/login?success=Password updated successfully. You can sign in now.`,
    { status: 302 }
  )
}
