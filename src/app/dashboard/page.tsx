import { redirect } from 'next/navigation'
import { HeaderMenu } from '@/components/header-menu'
import { canAccessDashboard } from '@/lib/dashboard-access'
import { USER_ROLE_LIST } from '@/lib/user-permissions'
import { createClient } from '@/utils/supabase/server'
import { Info } from 'lucide-react'

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

  const { data: purchases, error } = await supabase.from('purchases').select('price, sale_date, service_id')

  if (error) {
    console.error('Error loading dashboard data:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code,
    })
    return <div>Error loading dashboard data</div>
  }

  // Fetch people and groups for conversion rate
  // Note: Supabase has a default limit of 1000 rows. We fetch in batches if needed, 
  // but for the count we use a separate count-only query to be accurate.
  const [countRes, allPeopleRes, groupsRes] = await Promise.all([
    supabase.from('people').select('*', { count: 'exact', head: true }),
    supabase.from('people').select('group_id').limit(100000), // Increase limit significantly to capture ALL people
    supabase.from('groups').select('id, name')
  ])

  const totalPeople = countRes.count || 0
  const people = allPeopleRes.data || []
  const groups = groupsRes.data || []

  const clientGroupIds = new Set(
    groups
      .filter(g => {
        const name = g.name?.trim()
        return name === 'לקוחות' || name === 'לקוחות גדולים' || name === 'ארכיון לקוחות'
      })
      .map(g => g.id)
  )

  const totalClients = people.filter(p => p.group_id && clientGroupIds.has(p.group_id)).length
  const conversionRate = totalPeople > 0 ? (totalClients / totalPeople) * 100 : 0

  const totalContractsSold = (purchases || []).reduce(
    (sum, purchase: { price: number | string | null }) => {
      const amount = typeof purchase.price === 'number' ? purchase.price : Number(purchase.price || 0)

      return sum + (Number.isNaN(amount) ? 0 : amount)
    },
    0
  )

  // Service sales counter
  const serviceCounts = new Map<string, number>()
  for (const purchase of purchases || []) {
    const service = purchase.service_id?.trim() || 'No Service'
    serviceCounts.set(service, (serviceCounts.get(service) || 0) + 1)
  }

  const aggregatedServiceCounts: { name: string; count: number }[] = []
  let otherCount = 0

  for (const [name, count] of serviceCounts.entries()) {
    if (count <= 2) {
      otherCount += count
    } else {
      aggregatedServiceCounts.push({ name, count })
    }
  }

  if (otherCount > 0) {
    aggregatedServiceCounts.push({ name: 'אחר', count: otherCount })
  }

  aggregatedServiceCounts.sort((a, b) => b.count - a.count)

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
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <div className="space-y-6">
            <section className="rounded-lg border bg-white p-6 shadow-sm">
              <h2 className="text-sm font-medium text-gray-500">Total Contracts Sold</h2>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                ₪{totalContractsSold.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </section>

            <section className="rounded-lg border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-medium text-gray-500">Conversion Rate</h2>
                <div className="group relative flex items-center">
                  <Info className="h-3.5 w-3.5 text-gray-400 cursor-help" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-gray-900 text-white text-[10px] rounded shadow-lg z-10 text-center">
                    אחוז הלקוחות מכלל האנשים ב-CRM (קבוצות: לקוחות, לקוחות גדולים, ארכיון לקוחות)
                    <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <p className="text-3xl font-bold text-gray-900">
                  {conversionRate.toFixed(1)}%
                </p>
                <span className="text-xs text-gray-400 font-normal">
                  ({totalClients}/{totalPeople})
                </span>
              </div>
            </section>

            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Sales by Service</h2>
              <div className="space-y-2">
                {aggregatedServiceCounts.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-[11px]">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-gray-600 truncate" title={item.name}>
                        {item.name}
                      </span>
                      {item.name === 'אחר' && (
                        <div className="group relative flex items-center">
                          <Info className="h-3 w-3 text-gray-300 cursor-help" />
                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-40 p-1.5 bg-gray-900 text-white text-[9px] rounded shadow-lg z-10 text-center">
                            שירותים שנמכרו פעמיים או פחות מאוחדים כאן
                            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                          </div>
                        </div>
                      )}
                    </div>
                    <span className="font-medium text-gray-900 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100 shrink-0">
                      {item.count}
                    </span>
                  </div>
                ))}
                {aggregatedServiceCounts.length === 0 && (
                  <p className="text-[11px] text-gray-400">No services sold yet.</p>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800">Sales by Month</h2>

              {chartItems.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">No sales with sale date yet.</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <div className="flex min-w-[720px] items-end gap-4 pb-1">
                    {chartItems.map((item) => {
                      const heightPercent = chartMax > 0 ? Math.max((item.total / chartMax) * 100, 6) : 0

                      return (
                        <div key={item.key} className="flex w-[76px] flex-col items-center gap-1.5">
                          <span className="text-xs font-semibold text-gray-700">
                            {Math.round(item.total).toLocaleString('en-US')}
                          </span>
                          <div className="flex h-[150px] w-full items-end rounded bg-gray-100 px-1">
                            <div
                              className="w-full rounded-t bg-blue-500"
                              style={{ height: `${heightPercent}%` }}
                            />
                          </div>
                          <span className="text-center text-[10px] text-gray-600 leading-tight h-7 flex items-center">{item.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>

        <section className="mt-6 rounded-lg border bg-white p-3 shadow-sm max-w-md">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Users & Roles</h2>
          <div className="mt-2 divide-y divide-gray-100">
            {USER_ROLE_LIST.map((entry) => (
              <div key={entry.email} className="flex items-center justify-between py-1.5 text-[11px]">
                <span className="text-gray-600 font-medium">{entry.email}</span>
                <span className="text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100">{entry.role}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
