import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import { HeaderMenu } from '@/components/header-menu'
import { canAccessDashboard } from '@/lib/dashboard-access'
import { canAccessProjectKanbanByEmail } from '@/lib/user-permissions'
import { KanbanClient } from './kanban-client'
import { Purchase } from '@/types/database'

export type PurchaseWithPerson = Purchase & { people: { full_name: string } | null }

const PAGE_SIZE = 1000

async function fetchAllPurchases(supabase: Awaited<ReturnType<typeof createClient>>) {
  const allPurchases: PurchaseWithPerson[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('purchases')
      .select('*, people(full_name)')
      .range(from, from + PAGE_SIZE - 1)
      .order('created_at', { ascending: false })

    if (error) {
      return { data: null, error }
    }

    if (!data || data.length === 0) {
      break
    }

    allPurchases.push(...(data as any as PurchaseWithPerson[]))

    if (data.length < PAGE_SIZE) {
      break
    }
  }

  return { data: allPurchases, error: null }
}

export default async function KanbanPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  if (!canAccessProjectKanbanByEmail(user.email)) {
    redirect('/board')
  }

  const { data: purchases, error } = await fetchAllPurchases(supabase)

  if (error) {
    console.error('Error fetching data:', error)
    return <div>Error loading kanban data</div>
  }

  const userCanAccessDashboard = canAccessDashboard(user.email)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white shadow-sm border-b px-6 py-4 flex justify-between items-center">
        <Image src="/monday.png" alt="Monday logo" width={170} height={40} priority />
        <HeaderMenu
          userEmail={user.email}
          canAccessDashboard={userCanAccessDashboard}
          currentPath="/kanban"
        />
      </header>
      
      <main className="flex-1 min-h-0 flex flex-col p-6 overflow-hidden">
        <KanbanClient
          initialPurchases={purchases || []}
          userEmail={user.email}
        />
      </main>
    </div>
  )
}
