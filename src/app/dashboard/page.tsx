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

  const { data: purchases, error } = await supabase
    .from('purchases')
    .select('person_id, price, sale_date, service_id')

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
  // Note: Supabase has a default limit of 1000 rows. We use count: 'exact' to get the true total.
  // We fetch groups first to know which IDs to count.
  const { data: groupsRes } = await supabase.from('groups').select('id, name')
  const groups = groupsRes || []

  const clientGroupIds = groups
    .filter(g => {
      const name = g.name?.trim()
      return name === 'לקוחות' || name === 'לקוחות גדולים' || name === 'ארכיון לקוחות'
    })
    .map(g => g.id)

  // Use PostgREST's ability to count directly instead of fetching all rows
  const [totalPeopleRes, totalClientsRes] = await Promise.all([
    supabase.from('people').select('*', { count: 'exact', head: true }),
    supabase.from('people').select('*', { count: 'exact', head: true }).in('group_id', clientGroupIds)
  ])

  const totalPeople = totalPeopleRes.count || 0
  const totalClients = totalClientsRes.count || 0
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

  // --- Services funnel (per unique customer) ---
  const feasibilityService = 'בדיקת היתכנות'
  const softwareService = 'פיתוח תוכנה'
  const servicesByPerson = new Map<string, Set<string>>()
  const normalizeServiceName = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()
  const normalizedFeasibility = normalizeServiceName(feasibilityService)
  const normalizedSoftware = normalizeServiceName(softwareService)

  for (const purchase of purchases || []) {
    if (!purchase.person_id) continue
    const serviceName = purchase.service_id?.trim()
    if (!serviceName) continue

    if (!servicesByPerson.has(purchase.person_id)) {
      servicesByPerson.set(purchase.person_id, new Set<string>())
    }
    servicesByPerson.get(purchase.person_id)!.add(serviceName)
  }

  const step1People = new Set<string>()
  const step2People = new Set<string>()
  const step3People = new Set<string>()

  for (const [personId, services] of servicesByPerson.entries()) {
    const serviceList = [...services]
    const hasFeasibility = serviceList.some((name) => normalizeServiceName(name).includes(normalizedFeasibility))

    if (hasFeasibility) {
      step1People.add(personId)
    }
  }

  for (const personId of step1People) {
    const services = servicesByPerson.get(personId)
    if (!services) continue
    const serviceList = [...services].map((name) => normalizeServiceName(name))
    const hasAdditionalNonFeasibilityService = serviceList.some(
      (serviceName) => !serviceName.includes(normalizedFeasibility)
    )

    if (hasAdditionalNonFeasibilityService) {
      step2People.add(personId)
    }
  }

  for (const personId of step2People) {
    const services = servicesByPerson.get(personId)
    if (!services) continue
    const serviceList = [...services]
    const hasSoftware = serviceList.some((name) => normalizeServiceName(name).includes(normalizedSoftware))
    if (hasSoftware) {
      step3People.add(personId)
    }
  }

  const funnelSteps = [
    {
      title: '1 לקוחות שרכשו בדיקת היתכנות',
      count: step1People.size,
      tooltip: 'לקוחות שיש להם לפחות שירות אחד שמכיל "בדיקת היתכנות".',
    },
    {
      title: '2 לקוחות שהמשיכו לחבילת שירותים',
      count: step2People.size,
      tooltip: 'מתוך שלב 1 בלבד: לקוחות עם לפחות שירות נוסף שאינו "בדיקת היתכנות".',
    },
    {
      title: '3 לקוחות שהמשיכו לפיתוח תוכנה',
      count: step3People.size,
      tooltip: 'מתוך שלב 2 בלבד: לקוחות שיש להם גם שירות שמכיל "פיתוח תוכנה".',
    },
  ]
  const funnelMax = Math.max(...funnelSteps.map(step => step.count), 0)
  const step2FromStep1Pct = step1People.size > 0 ? (step2People.size / step1People.size) * 100 : 0
  const step3FromStep2Pct = step2People.size > 0 ? (step3People.size / step2People.size) * 100 : 0

  // --- Weekly Leads Chart (Past 10 Weeks, Sunday to Saturday in Israel) ---
  let peopleDates: { created_at: string; sheet_datetime: string | null }[] = []
  
  let { data: datesBatch, error: datesError } = await supabase
    .from('people')
    .select('created_at, sheet_datetime')
    .order('created_at', { ascending: false })
    .limit(3000)

  if (datesError && datesError.message.includes('sheet_datetime')) {
    const fallback = await supabase
      .from('people')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(3000)
    datesBatch = (fallback.data || []).map(d => ({ ...d, sheet_datetime: null }))
    datesError = fallback.error
  }

  peopleDates = (datesBatch as { created_at: string; sheet_datetime: string | null }[]) || []

  function getStartOfWeekIsrael(date: Date) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
    
    const parts = formatter.formatToParts(date)
    const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00'
    
    const ilYear = parseInt(getPart('year'), 10)
    const ilMonth = parseInt(getPart('month'), 10) - 1
    const ilDay = parseInt(getPart('day'), 10)
    
    const ilDate = new Date(Date.UTC(ilYear, ilMonth, ilDay))
    const day = ilDate.getUTCDay() // 0 = Sunday
    ilDate.setUTCDate(ilDate.getUTCDate() - day)
    
    return ilDate
  }

  const now = new Date()
  const currentWeekStart = getStartOfWeekIsrael(now)
  
  const weeklyLeads = new Map<string, number>()
  for (let i = 0; i < 10; i++) {
    const weekStart = new Date(currentWeekStart.getTime())
    weekStart.setUTCDate(weekStart.getUTCDate() - (i * 7))
    const weekKey = weekStart.toISOString().split('T')[0]
    weeklyLeads.set(weekKey, 0)
  }

  for (const person of peopleDates) {
    const dateStr = person.sheet_datetime || person.created_at
    if (!dateStr) continue
    const date = new Date(dateStr)
    const weekStart = getStartOfWeekIsrael(date)
    const weekKey = weekStart.toISOString().split('T')[0]
    if (weeklyLeads.has(weekKey)) {
      weeklyLeads.set(weekKey, weeklyLeads.get(weekKey)! + 1)
    }
  }

  const weeklyChartItems = Array.from(weeklyLeads.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, total]) => {
      const date = new Date(`${key}T00:00:00.000Z`)
      const month = date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
      const day = date.getUTCDate()
      const year = date.getUTCFullYear().toString().slice(2)
      return {
        key,
        label: `${month} ${day}, '${year}`,
        total
      }
    })

  const weeklyChartMax = weeklyChartItems.reduce((max, item) => Math.max(max, item.total), 0)

  // --- Formatting for the weekly chart (thin/small design) ---
  const weeklyChartWidth = weeklyChartItems.length * 24 // 12px bar + 12px gap approx

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
              <h2 className="text-sm font-medium text-gray-500">סה"כ חוזים שנמכרו</h2>
              <p className="mt-2 text-3xl font-bold text-gray-900">
                ₪{totalContractsSold.toLocaleString('en-US', { maximumFractionDigits: 0 })}
              </p>
            </section>

            <section className="rounded-lg border bg-white p-6 shadow-sm">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-medium text-gray-500">אחוז המרה</h2>
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
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">מכירות לפי שירות</h2>
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
                  <p className="text-[11px] text-gray-400">טרם נמכרו שירותים.</p>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-800">מכירות לפי חודש</h2>

              {chartItems.length === 0 ? (
                <p className="mt-4 text-sm text-gray-500">אין עדיין מכירות עם תאריך מכירה.</p>
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

            <div className="grid gap-6 lg:grid-cols-2 items-start">
              <section className="rounded-lg border bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-gray-800">לידים לשבוע</h2>
                </div>
                
                <div className="mt-4 relative h-[180px] w-full border-b border-gray-200">
                  {/* Y-axis grid lines */}
                  <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
                    {[100, 75, 50, 25, 0].map((val) => (
                      <div key={val} className="flex items-center gap-2 w-full">
                        <span className="text-[10px] text-gray-400 w-6 text-right">{val}</span>
                        <div className="flex-1 border-t border-gray-100" />
                      </div>
                    ))}
                  </div>

                  {/* Bars container */}
                  <div className="absolute inset-0 left-8 overflow-visible">
                    <div className="flex items-end gap-2 h-full pb-0 pt-8 px-2">
                      {weeklyChartItems.map((item) => {
                        const dynamicMax = Math.max(weeklyChartMax, 10)
                        const heightPercent = (item.total / dynamicMax) * 100

                        return (
                          <div key={item.key} className="flex flex-col items-center group relative w-6 h-full justify-end">
                            {/* Value on top of bar */}
                            <div 
                              className="absolute left-1/2 -translate-x-1/2 mb-1 z-10" 
                              style={{ bottom: `${Math.max(heightPercent, 5)}%` }}
                            >
                              <span className="text-[10px] font-bold text-gray-700 whitespace-nowrap">
                                {item.total}
                              </span>
                            </div>

                            {/* The Bar */}
                            <div className="w-[12px] rounded-t-sm bg-[#7C9DFF] transition-all hover:bg-[#5C7DFF] relative z-0" 
                                 style={{ height: `${Math.max(heightPercent, 5)}%`, minHeight: '4px' }} 
                            />
                            
                            {/* Label rotated */}
                            <div className="absolute top-full mt-2 -rotate-45 origin-top-left whitespace-nowrap">
                              <span className="text-[9px] text-gray-400">
                                {item.label}
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
                <div className="h-12" /> {/* Spacer for rotated labels */}
              </section>

              <section className="rounded-lg border bg-white p-4 shadow-sm" dir="rtl">
                <h2 className="text-lg font-semibold text-gray-800">פאנל מכירה</h2>
                <div className="mt-4 space-y-3">
                  {funnelSteps.map((step) => {
                    const widthPercent = funnelMax > 0 ? Math.max((step.count / funnelMax) * 100, 6) : 0

                    return (
                      <div key={step.title} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm text-gray-700 flex items-center gap-1.5">
                            {step.title}
                            <span className="group relative inline-flex items-center">
                              <Info className="h-3.5 w-3.5 text-gray-400 cursor-help" />
                              <span className="absolute bottom-full right-1/2 translate-x-1/2 mb-2 hidden w-56 rounded bg-gray-900 p-2 text-[10px] leading-snug text-white shadow-lg group-hover:block z-10">
                                {step.tooltip}
                                <span className="absolute top-full right-1/2 translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
                              </span>
                            </span>
                          </span>
                          <span className="text-sm font-semibold text-gray-900">
                            {step.count}
                            {step.title.startsWith('2 ') && (
                              <span className="ms-1 text-xs font-normal text-gray-500">
                                ({step2FromStep1Pct.toFixed(1)}%)
                              </span>
                            )}
                            {step.title.startsWith('3 ') && (
                              <span className="ms-1 text-xs font-normal text-gray-500">
                                ({step3FromStep2Pct.toFixed(1)}%)
                              </span>
                            )}
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-100">
                          <div
                            className="h-full rounded-full bg-indigo-500"
                            style={{ width: `${widthPercent}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>
            </div>
          </div>
        </div>

        <section className="mt-6 rounded-lg border bg-white p-3 shadow-sm max-w-md">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">משתמשים ותפקידים</h2>
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
