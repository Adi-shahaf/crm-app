import { createClient } from '@/utils/supabase/server'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'

type ForgotPasswordPageProps = {
  searchParams: Promise<{
    error?: string
    success?: string
  }>
}

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const supabase = await createClient()
  const [{ error, success }, { data }] = await Promise.all([
    searchParams,
    supabase.auth.getUser(),
  ])

  if (data?.user) {
    redirect('/board')
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-lg border bg-white p-8 shadow-sm">
        <div className="mb-6 flex justify-center">
          <Image src="/synergylogo.png" alt="Synergy logo" width={180} height={52} priority />
        </div>

        <div className="mb-6 space-y-2 text-center">
          <h1 className="text-xl font-semibold text-gray-900">Reset your password</h1>
          <p className="text-sm text-gray-600">
            Enter your email and we&apos;ll send you a recovery link.
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {success}
          </p>
        ) : null}

        <form action="/auth/forgot-password" method="post" className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            Send reset link
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
