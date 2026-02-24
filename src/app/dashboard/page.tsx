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

  const { data: purchases, error } = await supabase.from('purchases').select('price, sale_date')

  if (error) {
    console.error('Error loading dashboard data:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    })
    return <div>Error loading dashboard data</div>
  }

  const totalContractsSold = (purchases || []).reduce(
    (sum, purchase: { price: number | string | null }) => {
      const amount = typeof purchase.price === 'number' ? purchase.price : Number(purchase.price || 0)

      return sum + (Number.isNaN(amount) ? 0 : amount)
    },
    0
  )

  // Monthly chart is based on purchases.sale_date only (not lead/created dates).
  const monthlySales = new Map<string, number>()
  for (const purchase of purchases || []) {
    if (!purchase.sale_date) continue
    const monthKey = purchase.sale_date.slice(0, 7)
    const amount = typeof purchase.price === 'number' ? purchase.price : Number(purchase.price || 0)
    if (Number.isNaN(amount)) continue

    monthlySales.set(monthKey, (monthlySales.get(monthKey) || 0) + amount)
  }

  const formatter = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const chartItems = [...monthlySales.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-9)
    .map(([monthKey, total]) => {
      const date = new Date(`${monthKey}-01T00:00:00.000Z`)
      return {
        key: monthKey,
        label: formatter.format(date),
        total,
      }
    })

  const chartMax = chartItems.reduce((max, item) => Math.max(max, item.total), 0)

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-gray-800">Dashboard</h1>
        <HeaderMenu userEmail={user.email} canAccessDashboard currentPath="/dashboard" />
      </header>

      <main className="p-6">
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <section className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="text-sm font-medium text-gray-500">Total Contracts Sold</h2>
            <p className="mt-2 text-4xl font-bold text-gray-900">
              ₪{totalContractsSold.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </p>
          </section>

          <section className="rounded-lg border bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800">Sales by Month</h2>
            <p className="text-xs text-gray-500">Based on sale date (`sale_date`)</p>

            {chartItems.length === 0 ? (
              <p className="mt-6 text-sm text-gray-500">No sales with sale date yet.</p>
            ) : (
              <div className="mt-6 overflow-x-auto">
                <div className="flex min-w-[720px] items-end gap-4 pb-1">
                  {chartItems.map((item) => {
                    const heightPercent = chartMax > 0 ? Math.max((item.total / chartMax) * 100, 6) : 0

                    return (
                      <div key={item.key} className="flex w-[76px] flex-col items-center gap-2">
                        <span className="text-sm font-semibold text-gray-700">
                          {Math.round(item.total).toLocaleString('en-US')}
                        </span>
                        <div className="flex h-[180px] w-full items-end rounded bg-gray-100 px-1">
                          <div
                            className="w-full rounded-t bg-blue-500"
                            style={{ height: `${heightPercent}%` }}
                          />
                        </div>
                        <span className="text-center text-xs text-gray-600">{item.label}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
