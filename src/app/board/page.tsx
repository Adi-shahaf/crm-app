import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import { BoardClient } from './board-client'
import { HeaderMenu } from '@/components/header-menu'
import { canAccessDashboard } from '@/lib/dashboard-access'
import {
  filterGroupsByEmailAccess,
  filterPeopleByEmailAccess,
  filterPeopleByGroupAccess,
} from '@/lib/user-permissions'

const PAGE_SIZE = 1000

async function fetchAllPeople(
  supabase: Awaited<ReturnType<typeof createClient>>,
  useSheetDatetimeOrder: boolean
) {
  const allPeople: Record<string, unknown>[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('people')
      .select('*, groups(*)')
      .range(from, from + PAGE_SIZE - 1)

    if (useSheetDatetimeOrder) {
      query = query.order('sheet_datetime', { ascending: false, nullsFirst: false })
    }

    query = query.order('created_at', { ascending: false })

    const { data, error } = await query
    if (error) {
      return { data: null, error }
    }

    if (!data || data.length === 0) {
      break
    }

    allPeople.push(...data)

    if (data.length < PAGE_SIZE) {
      break
    }
  }

  return { data: allPeople, error: null }
}

export default async function BoardPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch groups and people
  const { data: groups, error: groupsError } = await supabase
    .from('groups')
    .select('*')
    .order('sort_order', { ascending: true })

  let { data: people, error: peopleError } = await fetchAllPeople(supabase, true)

  // Backward compatibility until the sheet_datetime migration is applied everywhere.
  if (peopleError && peopleError.message.includes('sheet_datetime')) {
    const fallback = await fetchAllPeople(supabase, false)
    people = fallback.data
    peopleError = fallback.error
  }

  if (groupsError || peopleError) {
    console.error('Error fetching data:', groupsError || peopleError)
    return <div>Error loading board data</div>
  }

  const userCanAccessDashboard = canAccessDashboard(user.email)
  const visibleGroups = filterGroupsByEmailAccess(groups || [], user.email)
  const visibleGroupIds = new Set(visibleGroups.map((group) => group.id))
  const roleFilteredPeople = filterPeopleByEmailAccess(people || [], user.email)
  const visiblePeople = filterPeopleByGroupAccess(roleFilteredPeople, visibleGroupIds)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b px-6 py-4 flex justify-between items-center">
        <Image src="/monday.png" alt="Monday logo" width={170} height={40} priority />
        <HeaderMenu
          userEmail={user.email}
          canAccessDashboard={userCanAccessDashboard}
          currentPath="/board"
        />
      </header>
      
      <main className="p-6">
        <BoardClient
          initialGroups={visibleGroups}
          initialPeople={visiblePeople}
          userEmail={user.email}
        />
      </main>
    </div>
  )
}
