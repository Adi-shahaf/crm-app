'use client'

import Link from 'next/link'
import { Menu, RotateCw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { getUserRoleByEmail } from '@/lib/user-permissions'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

type HeaderMenuProps = {
  userEmail: string | null | undefined
  canAccessDashboard: boolean
  currentPath: '/board' | '/dashboard'
}

export function HeaderMenu({ userEmail, canAccessDashboard, currentPath }: HeaderMenuProps) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const userRole = getUserRoleByEmail(userEmail)
  const roleLabel =
    userRole === 'project_manager' ? 'Project manager' : userRole === 'sales' ? 'Sales' : 'Admin'
  const userDescription = userEmail ? `${userEmail} (${roleLabel})` : 'Signed in user'

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Refresh data"
        onClick={() => startRefresh(() => router.refresh())}
        disabled={isRefreshing}
      >
        <RotateCw className={`size-5 ${isRefreshing ? 'animate-spin' : ''}`} />
      </Button>

      <Sheet>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Open menu">
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>{userDescription}</SheetDescription>
          </SheetHeader>

          <div className="flex h-full flex-col justify-between p-4 pt-0">
            <nav className="flex flex-col gap-2">
              {currentPath !== '/board' ? (
                <Link
                  href="/board"
                  className="rounded-md border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Board
                </Link>
              ) : null}

              {canAccessDashboard && currentPath !== '/dashboard' ? (
                <Link
                  href="/dashboard"
                  className="rounded-md border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
                >
                  Dashboard
                </Link>
              ) : null}
            </nav>

            <form action="/auth/logout" method="post">
              <button
                type="submit"
                className="w-full rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
