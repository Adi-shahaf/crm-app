import { createClient } from '@/utils/supabase/server'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

type ResetPasswordPageProps = {
  searchParams: Promise<{
    error?: string
  }>
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const supabase = await createClient()
  const [{ error }, { data }] = await Promise.all([searchParams, supabase.auth.getUser()])

  if (!data?.user) {
    redirect('/login?error=Your recovery session expired. Request a new reset link.')
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg border bg-white p-8 shadow-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/synergylogo.png" alt="Synergy logo" width={180} height={52} priority />
        </div>

        <div className="mb-6 space-y-2 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Choose a new password</h1>
          <p className="text-sm text-gray-600">
            Set a new password for {data.user.email ?? 'your account'}.
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <form action="/auth/update-password" method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="password">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              minLength={8}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="confirmPassword">
              Confirm new password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              minLength={8}
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Update password
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-600">
          <Link href="/login" className="font-medium text-blue-600 hover:text-blue-500">
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
