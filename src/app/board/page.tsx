import { createClient } from '@/utils/supabase/server'
import { redirect } from 'next/navigation'
import { BoardClient } from './board-client'

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

  let { data: people, error: peopleError } = await supabase
    .from('people')
    .select('*, groups(*)')
    .order('sheet_datetime', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  // Backward compatibility until the sheet_datetime migration is applied everywhere.
  if (peopleError && peopleError.message.includes('sheet_datetime')) {
    const fallback = await supabase
      .from('people')
      .select('*, groups(*)')
      .order('created_at', { ascending: false })

    people = fallback.data
    peopleError = fallback.error
  }

  if (groupsError || peopleError) {
    console.error('Error fetching data:', groupsError || peopleError)
    return <div>Error loading board data</div>
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800">CRM Board</h1>
        <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500">{user.email}</span>
            <form action="/auth/logout" method="post">
                <button type="submit" className="text-sm text-red-600 hover:text-red-800">Sign out</button>
            </form>
        </div>
      </header>
      
      <main className="p-6">
        <BoardClient initialGroups={groups || []} initialPeople={people || []} />
      </main>
    </div>
  )
}
