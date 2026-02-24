import { redirect } from 'next/navigation'
import { HeaderMenu } from '@/components/header-menu'
import { canAccessDashboard } from '@/lib/dashboard-access'
import { createClient } from '@/utils/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  if (!canAccessDashboard(user.email)) {
    redirect('/board')
  }

  const { data: purchases, error } = await supabase.from('purchases').select('price')

  if (error) {
    console.error('Error loading dashboard data:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    })
    return <div>Error loading dashboard data</div>
  }

  const totalContractsSold = (purchases || []).reduce((sum, purchase: { price: number | string | null }) => {
    const amount = typeof purchase.price === 'number' ? purchase.price : Number(purchase.price || 0)

    return sum + (Number.isNaN(amount) ? 0 : amount)
  }, 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800">Dashboard</h1>
        <HeaderMenu userEmail={user.email} canAccessDashboard currentPath="/dashboard" />
      </header>

      <main className="p-6">
        <section className="max-w-sm rounded-lg border bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-gray-500">Total Contracts Sold</h2>
          <p className="mt-2 text-4xl font-bold text-gray-900">
            ₪{totalContractsSold.toFixed(2)}
          </p>
        </section>
      </main>
    </div>
  )
}
