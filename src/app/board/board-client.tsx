'use client'

import { useEffect, useMemo, useRef, useState, useDeferredValue } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Group, PersonWithGroup } from '@/types/database'
import {
  BOARD_COLUMNS,
  type BoardColumnKey,
  getBoardColumnAccessByEmail,
  canAccessSalesTabByEmail,
  canAccessProjectKanbanByEmail,
  filterGroupsByEmailAccess,
  filterPeopleByEmailAccess,
  filterPeopleByGroupAccess,
  USER_ROLE_LIST,
} from '@/lib/user-permissions'
import { 
  Collapsible, 
  CollapsibleContent, 
  CollapsibleTrigger 
} from "@/components/ui/collapsible"
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table"
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Check, X, Maximize2, ShoppingCart, Trash2, MessageSquare, KanbanSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select"
import { PersonDrawer } from './person-drawer'
import { ProjectKanbanDialog } from './project-kanban-dialog'
import { cn } from '@/lib/utils'

type SortField = 'full_name' | 'sheet_datetime' | 'score_1_3' | 'total_contracts'
type SortDirection = 'asc' | 'desc'
type SortConfig = { field: SortField; direction: SortDirection } | null
type DrawerTab = 'notes' | 'purchases'
type ColumnKey = BoardColumnKey
type SellerOption = { email: string; label: string }
const NO_SELLER_VALUE = '__none__'

const GROUP_NAME_MAP: Record<string, string> = {
  'New Leads': 'לידים',
  Contacted: 'לקוחות',
  'Meeting Scheduled': 'לקוחות גדולים',
  Customers: 'לקוחות',
  'Lost / Archive': 'ארכיון לקוחות',
}

const getDisplayGroupName = (name: string) => GROUP_NAME_MAP[name] || name
const GROUP_DOT_COLOR_CLASS: Record<string, string> = {
  לידים: 'bg-blue-600',
  'לידים ישנים': 'bg-blue-600',
  לקוחות: 'bg-purple-600',
  'לקוחות גדולים': 'bg-purple-600',
  'ארכיון לקוחות': 'bg-gray-500',
  'לא רלוונטי': 'bg-red-600',
}

const getGroupDotColorClass = (groupName: string) =>
  GROUP_DOT_COLOR_CLASS[getDisplayGroupName(groupName)] || 'bg-blue-500'

const getPersonDateTime = (person: PersonWithGroup) => person.sheet_datetime || person.created_at
const getEmailPrefix = (email: string) => email.split('@')[0] || email
const DELETE_BATCH_SIZE = 100
const personMatchesSearch = (person: PersonWithGroup, search: string) => {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  if (!normalizedSearch) return true

  const searchableValues = [
    person.full_name,
    person.phone,
    person.email,
    person.source,
    person.whatsapp_response,
    person.employment_status,
    person.lead_idea,
    person.seller,
    person.campaign,
    person.ad_name,
    person.status,
    person.score_1_3,
    person.total_contracts,
    person.sheet_datetime,
    person.created_at,
    person.groups?.name,
    person.groups?.name ? getDisplayGroupName(person.groups.name) : null,
  ]

  return searchableValues
    .filter((value) => value !== null && value !== undefined)
    .some((value) => String(value).toLocaleLowerCase().includes(normalizedSearch))
}
const COLUMN_LABELS: Record<ColumnKey, string> = {
  full_name: 'שם',
  group_id: 'קבוצה',
  phone: 'מספר טלפון',
  email: 'כתובת מייל',
  sheet_datetime: 'תאריך ושעה',
  score_1_3: 'ציון 1-3',
  source: 'מקור',
  whatsapp_response: 'תגובה להודעת ווטסאפ',
  employment_status: 'שכיר / עצמאי',
  lead_idea: 'רעיון (טופס לידים)',
  seller: 'מוכר',
  campaign: 'קמפיין',
  ad_name: 'שם המודעה',
  total_contracts: 'סה"כ חוזים',
  status: 'סטטוס',
}
const DEFAULT_VISIBLE_COLUMNS: Record<ColumnKey, boolean> = {
  full_name: true,
  group_id: true,
  phone: true,
  email: true,
  sheet_datetime: true,
  score_1_3: true,
  source: true,
  whatsapp_response: true,
  employment_status: true,
  lead_idea: true,
  seller: true,
  campaign: true,
  ad_name: true,
  total_contracts: true,
  status: true,
}
const SORT_FIELD_TO_COLUMN: Record<SortField, ColumnKey> = {
  full_name: 'full_name',
  sheet_datetime: 'sheet_datetime',
  score_1_3: 'score_1_3',
  total_contracts: 'total_contracts',
}

const applyColumnAccess = (
  columns: Record<ColumnKey, boolean>,
  access: Record<ColumnKey, boolean>
) =>
  BOARD_COLUMNS.reduce(
    (next, column) => {
      next[column] = access[column] ? columns[column] : false
      return next
    },
    {} as Record<ColumnKey, boolean>
  )

const buildMinimalVisibleColumns = (access: Record<ColumnKey, boolean>) => {
  const next = BOARD_COLUMNS.reduce(
    (columns, column) => {
      columns[column] = false
      return columns
    },
    {} as Record<ColumnKey, boolean>
  )

  if (access.full_name) {
    next.full_name = true
    return next
  }

  const firstVisibleColumn = BOARD_COLUMNS.find((column) => access[column])
  if (firstVisibleColumn) next[firstVisibleColumn] = true

  return next
}

export function BoardClient({ 
  initialGroups, 
  initialPeople,
  userEmail,
}: { 
  initialGroups: Group[], 
  initialPeople: PersonWithGroup[],
  userEmail: string | null | undefined,
}) {
  const groups = useMemo(
    () => filterGroupsByEmailAccess(initialGroups, userEmail),
    [initialGroups, userEmail]
  )
  const columnAccess = useMemo(() => getBoardColumnAccessByEmail(userEmail), [userEmail])
  const canAccessSalesTab = useMemo(() => canAccessSalesTabByEmail(userEmail), [userEmail])
  const canAccessProjectKanban = useMemo(
    () => canAccessProjectKanbanByEmail(userEmail),
    [userEmail]
  )
  const [people, setPeople] = useState(initialPeople)
  const [purchaseCounts, setPurchaseCounts] = useState<Record<string, number>>({})
  const [purchaseTotals, setPurchaseTotals] = useState<Record<string, number>>({})
  const [noteCounts, setNoteCounts] = useState<Record<string, number>>({})
  const [selectedPerson, setSelectedPerson] = useState<PersonWithGroup | null>(null)
  const [selectedProjectsPerson, setSelectedProjectsPerson] = useState<PersonWithGroup | null>(null)
  const [selectedDrawerTab, setSelectedDrawerTab] = useState<DrawerTab>('notes')
  const [searchTerm, setSearchTerm] = useState('')
  const deferredSearchTerm = useDeferredValue(searchTerm)
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() =>
    applyColumnAccess(DEFAULT_VISIBLE_COLUMNS, columnAccess)
  )
  const [isColumnsMenuOpen, setIsColumnsMenuOpen] = useState(false)
  const columnsMenuRef = useRef<HTMLDivElement | null>(null)
  const supabase = createClient()
  const sellerOptions = useMemo(() => {
    const uniqueEmails = new Set(
      USER_ROLE_LIST.map((entry) => entry.email.trim().toLowerCase()).filter(Boolean)
    )

    const normalizedCurrentUserEmail = userEmail?.trim().toLowerCase()
    if (normalizedCurrentUserEmail) {
      uniqueEmails.add(normalizedCurrentUserEmail)
    }

    return Array.from(uniqueEmails)
      .sort((a, b) => a.localeCompare(b))
      .map((email) => ({ email, label: getEmailPrefix(email) }))
  }, [userEmail])

  useEffect(() => {
    const loadPurchaseStats = async () => {
      const { data, error } = await supabase.from('purchases').select('person_id, price')
      if (error || !data) return

      const counts: Record<string, number> = {}
      const totals: Record<string, number> = {}
      for (const purchase of data) {
        const personId = purchase.person_id
        const price = typeof purchase.price === 'number' ? purchase.price : Number(purchase.price || 0)
        counts[personId] = (counts[personId] || 0) + 1
        totals[personId] = (totals[personId] || 0) + (Number.isNaN(price) ? 0 : price)
      }
      setPurchaseCounts(counts)
      setPurchaseTotals(totals)
    }

    loadPurchaseStats()
  }, [supabase])

  useEffect(() => {
    const loadNoteStats = async () => {
      const counts: Record<string, number> = {}
      const pageSize = 1000
      let from = 0

      while (true) {
        const { data, error } = await supabase
          .from('notes')
          .select('person_id')
          .range(from, from + pageSize - 1)

        if (error || !data) return

        for (const note of data) {
          if (!note.person_id) continue
          counts[note.person_id] = (counts[note.person_id] || 0) + 1
        }

        if (data.length < pageSize) break
        from += pageSize
      }

      setNoteCounts(counts)
    }

    loadNoteStats()
  }, [supabase])

  const handleUpdatePerson = async (id: string, updates: Partial<PersonWithGroup>) => {
    const previousPerson = people.find((person) => person.id === id)
    if (!previousPerson) return

    // Optimistic update
    setPeople(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p))

    const { error } = await supabase
      .from('people')
      .update(updates)
      .eq('id', id)

    if (error) {
      console.error('Error updating person:', {
        id,
        updates,
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
      })
      // Revert only this person to avoid overwriting unrelated UI changes (like deletions).
      setPeople((prev) => prev.map((person) => (person.id === id ? previousPerson : person)))
    }
  }

  const handleCreatePerson = async (groupId: string, name: string) => {
    const { data, error } = await supabase
      .from('people')
      .insert([{ full_name: name, group_id: groupId }])
      .select('*, groups(*)')
      .single()

    if (error) {
      console.error('Error creating person:', error)
    } else if (data) {
      setPeople(prev => [data, ...prev])
      setPurchaseCounts((prev) => ({ ...prev, [data.id]: 0 }))
      setPurchaseTotals((prev) => ({ ...prev, [data.id]: 0 }))
      setNoteCounts((prev) => ({ ...prev, [data.id]: 0 }))
    }
  }

  const handleDeletePeople = async (ids: string[]) => {
    if (!ids.length) return

    const previousPeople = people
    const previousCounts = purchaseCounts
    const previousTotals = purchaseTotals
    const previousNoteCounts = noteCounts
    setPeople((prev) => prev.filter((person) => !ids.includes(person.id)))
    setPurchaseCounts((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        delete next[id]
      }
      return next
    })
    setPurchaseTotals((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        delete next[id]
      }
      return next
    })
    setNoteCounts((prev) => {
      const next = { ...prev }
      for (const id of ids) {
        delete next[id]
      }
      return next
    })
    setSelectedPerson((prev) => (prev && ids.includes(prev.id) ? null : prev))

    let deleteError: unknown = null

    for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
      const batchIds = ids.slice(i, i + DELETE_BATCH_SIZE)
      const { error } = await supabase
        .from('people')
        .delete()
        .in('id', batchIds)

      if (error) {
        deleteError = error
        break
      }
    }

    if (deleteError) {
      console.error('Error deleting people:', {
        count: ids.length,
        batchSize: DELETE_BATCH_SIZE,
        error: deleteError,
      })

      // Some batches may have succeeded before a failure. Refresh from DB to avoid stale UI state.
      const { data, error: refreshError } = await supabase
        .from('people')
        .select('*, groups(*)')
        .order('created_at', { ascending: false })

      if (refreshError || !data) {
        setPeople(previousPeople)
        setPurchaseCounts(previousCounts)
        setPurchaseTotals(previousTotals)
        setNoteCounts(previousNoteCounts)
      } else {
        setPeople(data)
      }
    }
  }

  const accessiblePeople = useMemo(() => {
    const byRole = filterPeopleByEmailAccess(people, userEmail)
    const allowedGroupIds = new Set(groups.map((group) => group.id))
    return filterPeopleByGroupAccess(byRole, allowedGroupIds)
  }, [groups, people, userEmail])
  const filteredPeople = useMemo(
    () => accessiblePeople.filter((person) => personMatchesSearch(person, deferredSearchTerm)),
    [accessiblePeople, deferredSearchTerm]
  )
  const visibleColumnCount = useMemo(
    () => BOARD_COLUMNS.filter((column) => visibleColumns[column]).length,
    [visibleColumns]
  )
  const visibleAllowedColumnCount = useMemo(
    () =>
      BOARD_COLUMNS.filter((column) => columnAccess[column] && visibleColumns[column]).length,
    [columnAccess, visibleColumns]
  )
  const visibleGroups = deferredSearchTerm.trim()
    ? groups.filter((group) => filteredPeople.some((person) => person.group_id === group.id))
    : groups

  useEffect(() => {
    if (!isColumnsMenuOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (!columnsMenuRef.current?.contains(event.target as Node)) {
        setIsColumnsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isColumnsMenuOpen])

  const toggleColumnVisibility = (column: ColumnKey) => {
    setVisibleColumns((prev) => {
      if (!columnAccess[column]) return prev

      const currentlyVisibleAllowedCount = BOARD_COLUMNS.reduce(
        (count, key) => count + (columnAccess[key] && prev[key] ? 1 : 0),
        0
      )

      if (prev[column] && currentlyVisibleAllowedCount === 1) return prev
      return applyColumnAccess({ ...prev, [column]: !prev[column] }, columnAccess)
    })
  }

  const setAllColumnsVisible = (value: boolean) => {
    const next = value
      ? applyColumnAccess(DEFAULT_VISIBLE_COLUMNS, columnAccess)
      : buildMinimalVisibleColumns(columnAccess)
    setVisibleColumns(next)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search anything..."
          className="max-w-md bg-white"
        />
        <div className="relative" ref={columnsMenuRef}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsColumnsMenuOpen((prev) => !prev)}
            className="h-10 bg-white"
          >
            View columns ({visibleColumnCount})
          </Button>
          {isColumnsMenuOpen && (
            <div className="absolute left-0 z-20 mt-2 w-64 rounded-md border bg-white p-3 shadow-lg">
              <div className="mb-2 flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-gray-700 hover:text-gray-900"
                  onClick={() => setAllColumnsVisible(true)}
                >
                  Show all
                </button>
                <button
                  type="button"
                  className="text-gray-600 hover:text-gray-800"
                  onClick={() => setAllColumnsVisible(false)}
                >
                  Minimal view
                </button>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
                {BOARD_COLUMNS.map((column) => {
                  const checked = visibleColumns[column]
                  const canAccessColumn = columnAccess[column]
                  const isOnlyVisible = canAccessColumn && checked && visibleAllowedColumnCount === 1
                  return (
                    <label
                      key={column}
                      className={`flex items-center gap-2 text-sm ${canAccessColumn ? 'text-gray-700' : 'text-gray-400'}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canAccessColumn || isOnlyVisible}
                        onChange={() => toggleColumnVisibility(column)}
                      />
                      <span>{COLUMN_LABELS[column]}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {visibleGroups.map(group => (
        <GroupSection 
          key={group.id} 
          group={group} 
          groups={groups}
          people={filteredPeople.filter((p) => p.group_id === group.id)} 
          shouldAutoExpand={deferredSearchTerm.trim().length > 0}
          purchaseCounts={purchaseCounts}
          purchaseTotals={purchaseTotals}
          noteCounts={noteCounts}
          onUpdatePerson={handleUpdatePerson}
          onCreatePerson={handleCreatePerson}
          onDeletePeople={handleDeletePeople}
          visibleColumns={visibleColumns}
          sellerOptions={sellerOptions}
          onOpenDrawer={(person, tab = 'notes') => {
            setSelectedPerson(person)
            setSelectedDrawerTab(tab === 'purchases' && !canAccessSalesTab ? 'notes' : tab)
          }}
          onOpenProjects={(person) => {
            if (!canAccessProjectKanban) return
            setSelectedProjectsPerson(person)
          }}
          canAccessSalesTab={canAccessSalesTab}
          canAccessProjectKanban={canAccessProjectKanban}
        />
      ))}
      <PersonDrawer 
        person={selectedPerson} 
        isOpen={!!selectedPerson} 
        onClose={() => setSelectedPerson(null)}
        initialTab={selectedDrawerTab}
        canAccessSalesTab={canAccessSalesTab}
        onPurchaseCreated={(personId, price) => {
          setPurchaseCounts((prev) => ({ ...prev, [personId]: (prev[personId] || 0) + 1 }))
          setPurchaseTotals((prev) => ({ ...prev, [personId]: (prev[personId] || 0) + price }))
        }}
        onPurchaseUpdated={(personId, previousPrice, nextPrice) => {
          setPurchaseTotals((prev) => ({
            ...prev,
            [personId]: (prev[personId] || 0) - previousPrice + nextPrice,
          }))
        }}
        onPurchaseDeleted={(personId, price) => {
          setPurchaseCounts((prev) => ({
            ...prev,
            [personId]: Math.max(0, (prev[personId] || 0) - 1),
          }))
          setPurchaseTotals((prev) => ({
            ...prev,
            [personId]: Math.max(0, (prev[personId] || 0) - price),
          }))
        }}
        onNotesChanged={(personId, delta) => {
          setNoteCounts((prev) => ({
            ...prev,
            [personId]: Math.max(0, (prev[personId] || 0) + delta),
          }))
        }}
      />
      {canAccessProjectKanban ? (
        <ProjectKanbanDialog
          person={selectedProjectsPerson}
          isOpen={!!selectedProjectsPerson}
          onClose={() => setSelectedProjectsPerson(null)}
        />
      ) : null}
    </div>
  )
}

function GroupSection({ 
  group, 
  groups,
  people, 
  shouldAutoExpand,
  purchaseCounts,
  purchaseTotals,
  noteCounts,
  onUpdatePerson,
  onCreatePerson,
  onDeletePeople,
  visibleColumns,
  sellerOptions,
  onOpenDrawer,
  onOpenProjects,
  canAccessSalesTab,
  canAccessProjectKanban,
}: { 
  group: Group, 
  groups: Group[],
  people: PersonWithGroup[],
  shouldAutoExpand: boolean,
  purchaseCounts: Record<string, number>,
  purchaseTotals: Record<string, number>,
  noteCounts: Record<string, number>,
  onUpdatePerson: (id: string, updates: Partial<PersonWithGroup>) => void,
  onCreatePerson: (groupId: string, name: string) => void,
  onDeletePeople: (ids: string[]) => void,
  visibleColumns: Record<ColumnKey, boolean>,
  sellerOptions: SellerOption[],
  onOpenDrawer: (person: PersonWithGroup, tab?: DrawerTab) => void,
  onOpenProjects: (person: PersonWithGroup) => void,
  canAccessSalesTab: boolean,
  canAccessProjectKanban: boolean
}) {
  const [manuallyOpen, setManuallyOpen] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sortConfig, setSortConfig] = useState<SortConfig>(null)
  const isOpen = shouldAutoExpand && people.length > 0 ? true : manuallyOpen

  const validSelectedIds = selectedIds.filter((id) => people.some((person) => person.id === id))
  const allSelected = people.length > 0 && validSelectedIds.length === people.length
  const hasSelection = validSelectedIds.length > 0
  const activeSortConfig =
    sortConfig && visibleColumns[SORT_FIELD_TO_COLUMN[sortConfig.field]]
      ? sortConfig
      : null
  const visibleColumnCount = useMemo(
    () => Object.values(visibleColumns).filter(Boolean).length,
    [visibleColumns]
  )

  const sortedPeople = useMemo(() => {
    if (!activeSortConfig) return people

    const getValue = (person: PersonWithGroup): string | number | null => {
      if (activeSortConfig.field === 'sheet_datetime') return Date.parse(getPersonDateTime(person))
      if (activeSortConfig.field === 'score_1_3') return person.score_1_3
      if (activeSortConfig.field === 'total_contracts') return purchaseTotals[person.id] || 0
      return person.full_name
    }

    return [...people].sort((a, b) => {
      const valueA = getValue(a)
      const valueB = getValue(b)

      if (valueA === null && valueB === null) return 0
      if (valueA === null) return 1
      if (valueB === null) return -1

      let comparison = 0
      if (typeof valueA === 'number' && typeof valueB === 'number') {
        comparison = valueA - valueB
      } else {
        comparison = String(valueA).localeCompare(String(valueB), 'he', { sensitivity: 'base' })
      }

      return activeSortConfig.direction === 'asc' ? comparison : -comparison
    })
  }, [activeSortConfig, people, purchaseTotals])

  const toggleSort = (field: SortField) => {
    setSortConfig((prev) => {
      if (!prev || prev.field !== field) return { field, direction: 'asc' }
      if (prev.direction === 'asc') return { field, direction: 'desc' }
      return null
    })
  }

  const renderSortChevron = (field: SortField) => {
    const isActive = activeSortConfig?.field === field

    return (
      <button
        type="button"
        aria-label={`Sort by ${field}`}
        onClick={() => toggleSort(field)}
        className="inline-flex h-5 w-5 items-center justify-center text-gray-400 hover:text-gray-700"
      >
        {isActive ? (
          activeSortConfig.direction === 'asc' ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5" />
        )}
      </button>
    )
  }

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newItemName.trim()) return
    onCreatePerson(group.id, newItemName.trim())
    setNewItemName('')
    setIsCreating(false)
  }

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setManuallyOpen}
      className="relative overflow-hidden rounded-md border border-gray-200 bg-white"
    >
      <div
        className={`pointer-events-none absolute inset-y-0 left-0 w-1 ${getGroupDotColorClass(group.name)}`}
        aria-hidden="true"
      />
      <div className="flex items-center border-b border-gray-200 bg-white px-3 py-2.5">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-6 h-6 p-0 mr-2">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900">
          <span
            className={`h-2.5 w-2.5 rounded-full ${getGroupDotColorClass(group.name)}`}
            aria-hidden="true"
          />
          {getDisplayGroupName(group.name)}
          <Badge variant="secondary" className="font-normal text-xs">{people.length}</Badge>
        </h2>
        <div className="ml-auto flex items-center gap-2">
          {hasSelection && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!window.confirm(`Delete ${validSelectedIds.length} selected row(s)?`)) return
                onDeletePeople(validSelectedIds)
                setSelectedIds([])
              }}
              className="h-8"
            >
              <Trash2 className="h-4 w-4" />
              Delete selected ({validSelectedIds.length})
            </Button>
          )}
        </div>
      </div>

      <CollapsibleContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead className="w-[120px]">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(people.map((person) => person.id))
                        return
                      }
                      setSelectedIds([])
                    }}
                  />
                </TableHead>
                {visibleColumns.full_name && (
                <TableHead className="min-w-[150px]">
                  <div className="flex items-center gap-1">
                    <span>שם</span>
                    {renderSortChevron('full_name')}
                  </div>
                </TableHead>
                )}
                {visibleColumns.group_id && <TableHead className="min-w-[150px]">קבוצה</TableHead>}
                {visibleColumns.phone && <TableHead className="min-w-[120px]">מספר טלפון</TableHead>}
                {visibleColumns.email && <TableHead className="min-w-[150px]">כתובת מייל</TableHead>}
                {visibleColumns.sheet_datetime && (
                <TableHead className="min-w-[120px]">
                  <div className="flex items-center gap-1">
                    <span>תאריך ושעה</span>
                    {renderSortChevron('sheet_datetime')}
                  </div>
                </TableHead>
                )}
                {visibleColumns.score_1_3 && (
                <TableHead className="min-w-[80px]">
                  <div className="flex items-center gap-1">
                    <span>ציון 1-3</span>
                    {renderSortChevron('score_1_3')}
                  </div>
                </TableHead>
                )}
                {visibleColumns.source && <TableHead className="min-w-[120px]">מקור</TableHead>}
                {visibleColumns.whatsapp_response && <TableHead className="min-w-[150px]">תגובה להודעת ווטסאפ</TableHead>}
                {visibleColumns.employment_status && <TableHead className="min-w-[120px]">שכיר / עצמאי</TableHead>}
                {visibleColumns.lead_idea && <TableHead className="min-w-[150px]">רעיון (טופס לידים)</TableHead>}
                {visibleColumns.seller && <TableHead className="min-w-[86px]">מוכר</TableHead>}
                {visibleColumns.campaign && <TableHead className="min-w-[120px]">קמפיין</TableHead>}
                {visibleColumns.ad_name && <TableHead className="min-w-[120px]">שם המודעה</TableHead>}
                {visibleColumns.total_contracts && (
                <TableHead className="min-w-[100px]">
                  <div className="flex items-center gap-1">
                    <span>סה&quot;כ חוזים</span>
                    {renderSortChevron('total_contracts')}
                  </div>
                </TableHead>
                )}
                {visibleColumns.status && <TableHead className="min-w-[120px]">סטטוס</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPeople.map((person) => (
                <EditableRow 
                  key={person.id} 
                  person={person} 
                  groups={groups}
                  projectCount={purchaseCounts[person.id] || 0}
                  purchaseCount={purchaseCounts[person.id] || 0}
                  purchaseTotal={purchaseTotals[person.id] || 0}
                  noteCount={noteCounts[person.id] || 0}
                  visibleColumns={visibleColumns}
                  sellerOptions={sellerOptions}
                  onUpdate={onUpdatePerson} 
                  isSelected={validSelectedIds.includes(person.id)}
                  onToggleSelect={(checked) => {
                    setSelectedIds((prev) =>
                      checked
                        ? [...new Set([...prev, person.id])]
                        : prev.filter((id) => id !== person.id)
                    )
                  }}
                  onOpenDrawer={onOpenDrawer}
                  onOpenProjects={onOpenProjects}
                  canAccessSalesTab={canAccessSalesTab}
                  canAccessProjectKanban={canAccessProjectKanban}
                />
              ))}
              
              {/* Add New Row */}
              <TableRow className="hover:bg-gray-50/50">
                <TableCell></TableCell>
                <TableCell colSpan={visibleColumnCount}>
                  {isCreating ? (
                    <form onSubmit={handleCreateSubmit} className="flex items-center gap-2">
                      <Input
                        autoFocus
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="הכנס שם ליד חדש"
                        className="h-8 w-[230px]"
                      />
                      <Button type="submit" size="sm" variant="ghost" className="h-8 w-8 p-0">
                        <Check className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button 
                        type="button" 
                        size="sm" 
                        variant="ghost" 
                        className="h-8 w-8 p-0"
                        onClick={() => {
                          setIsCreating(false)
                          setNewItemName('')
                        }}
                      >
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                    </form>
                  ) : (
                    <div 
                      className="flex h-8 cursor-pointer items-center text-sm text-gray-500 hover:text-gray-700"
                      onClick={() => setIsCreating(true)}
                    >
                      + הוסף שורה
                    </div>
                  )}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function EditableRow({ 
  person, 
  groups,
  projectCount,
  purchaseCount,
  purchaseTotal,
  noteCount,
  visibleColumns,
  sellerOptions,
  onUpdate,
  isSelected,
  onToggleSelect,
  onOpenDrawer,
  onOpenProjects,
  canAccessSalesTab,
  canAccessProjectKanban,
}: { 
  person: PersonWithGroup, 
  groups: Group[],
  projectCount: number,
  purchaseCount: number,
  purchaseTotal: number,
  noteCount: number,
  visibleColumns: Record<ColumnKey, boolean>,
  sellerOptions: SellerOption[],
  onUpdate: (id: string, updates: Partial<PersonWithGroup>) => void,
  isSelected: boolean,
  onToggleSelect: (checked: boolean) => void,
  onOpenDrawer: (person: PersonWithGroup, tab?: DrawerTab) => void,
  onOpenProjects: (person: PersonWithGroup) => void,
  canAccessSalesTab: boolean,
  canAccessProjectKanban: boolean
}) {
  const [editingField, setEditingField] = useState<keyof PersonWithGroup | null>(null)
  const [editValue, setEditValue] = useState('')

  const startEdit = (field: keyof PersonWithGroup, value: string | number | null) => {
    setEditingField(field)
    setEditValue(value?.toString() || '')
  }

  const toLocalDateTimeInputValue = (isoDate: string) => {
    const date = new Date(isoDate)
    const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000
    return new Date(date.getTime() - tzOffsetMs).toISOString().slice(0, 16)
  }

  const startDateTimeEdit = (value: string) => {
    setEditingField('sheet_datetime')
    setEditValue(toLocalDateTimeInputValue(value))
  }

  const commitEdit = () => {
    if (editingField) {
      let finalValue: string | number | null = editValue || null
      if (editingField === 'score_1_3' || editingField === 'total_contracts') {
        finalValue = editValue ? parseInt(editValue, 10) : null
      }
      if (editingField === 'sheet_datetime') {
        finalValue = editValue ? new Date(editValue).toISOString() : person.sheet_datetime
      }
      
      if (person[editingField] !== finalValue) {
        const updates = { [editingField]: finalValue } as Partial<PersonWithGroup>
        onUpdate(person.id, updates)
      }
    }
    setEditingField(null)
  }

  const renderCell = (field: keyof PersonWithGroup, value: string | number | null, isNumber = false) => {
    const isWhatsappResponseField = field === 'whatsapp_response'

    return (
      <TableCell 
        className={cn(
          'p-2 align-middle cursor-text',
          isWhatsappResponseField && 'w-[180px] max-w-[180px]'
        )}
        onClick={() => editingField !== field && startEdit(field, value)}
      >
        {editingField === field ? (
          <Input 
            autoFocus
            type={isNumber ? "number" : "text"}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
            className={cn(
              'h-8 text-sm w-full min-w-[100px]',
              isWhatsappResponseField && 'min-w-0'
            )}
          />
        ) : (
          <span className={cn('text-gray-700 block truncate', isWhatsappResponseField && 'max-w-[180px]')}>{value || '-'}</span>
        )}
      </TableCell>
    )
  }

  return (
    <TableRow className="group/row hover:bg-gray-50/80">
      <TableCell className="p-2 align-middle">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onToggleSelect(e.target.checked)}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 opacity-0 group-hover/row:opacity-100 flex items-center gap-1 text-gray-500 hover:text-gray-900"
            onClick={() => onOpenDrawer(person)}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            <span className="text-xs">פתח</span>
          </Button>
          {canAccessProjectKanban ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-gray-700 hover:text-gray-900"
              onClick={() => onOpenProjects(person)}
              title="Projects"
            >
              <KanbanSquare className="h-4 w-4" />
              <span>{projectCount}</span>
            </button>
          ) : null}
          {canAccessSalesTab ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-gray-700 hover:text-gray-900"
              onClick={() => onOpenDrawer(person, 'purchases')}
            >
              <ShoppingCart className="h-4 w-4" />
              <span>{purchaseCount}</span>
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center whitespace-nowrap text-sm font-semibold"
            onClick={() => onOpenDrawer(person, 'notes')}
            title={noteCount > 0 ? `${noteCount} comments` : 'No comments'}
          >
            <span className="relative inline-flex h-5 w-5 items-center justify-center">
              <MessageSquare
                className={cn(
                  'h-4 w-4 transition-colors',
                  noteCount > 0 ? 'text-blue-500' : 'text-gray-400'
                )}
              />
              {noteCount > 0 ? (
                <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] leading-none text-white">
                  {noteCount}
                </span>
              ) : null}
            </span>
          </button>
        </div>
      </TableCell>
      
      {/* 1. Name */}
      {visibleColumns.full_name && renderCell('full_name', person.full_name)}
      
      {/* 2. Group */}
      {visibleColumns.group_id && (
      <TableCell className="p-2 align-middle">
        <Select 
          value={person.group_id || ''} 
          onValueChange={(val) => onUpdate(person.id, { group_id: val })}
        >
          <SelectTrigger className="h-8 border-none shadow-none focus:ring-0 w-full hover:bg-gray-100 min-w-[130px]">
            <SelectValue placeholder="בחר קבוצה" />
          </SelectTrigger>
          <SelectContent>
            {groups.map(g => (
              <SelectItem key={g.id} value={g.id}>
                <div
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-gray-700 transition-colors"
                >
                  <div className={`w-2 h-2 rounded-full ${
                    getGroupDotColorClass(g.name)
                  }`} />
                  {getDisplayGroupName(g.name)}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      )}
      
      {/* 3. Phone */}
      {visibleColumns.phone && renderCell('phone', person.phone)}
      
      {/* 4. Email */}
      {visibleColumns.email && renderCell('email', person.email)}
      
      {/* 5. Date */}
      {visibleColumns.sheet_datetime && (
      <TableCell
        className="text-gray-500 p-2 align-middle text-sm cursor-pointer"
        onClick={() => editingField !== 'sheet_datetime' && startDateTimeEdit(getPersonDateTime(person))}
      >
        {editingField === 'sheet_datetime' ? (
          <Input
            autoFocus
            type="datetime-local"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => e.key === 'Enter' && commitEdit()}
            className="h-8 text-sm w-full min-w-[160px]"
          />
        ) : (
          <span className="block truncate">{new Date(getPersonDateTime(person)).toLocaleString('he-IL')}</span>
        )}
      </TableCell>
      )}

      {/* 6. Score */}
      {visibleColumns.score_1_3 && renderCell('score_1_3', person.score_1_3, true)}

      {/* 7. Source */}
      {visibleColumns.source && renderCell('source', person.source)}

      {/* 8. WhatsApp response */}
      {visibleColumns.whatsapp_response && renderCell('whatsapp_response', person.whatsapp_response)}

      {/* 9. Employment status */}
      {visibleColumns.employment_status && renderCell('employment_status', person.employment_status)}

      {/* 10. Lead idea */}
      {visibleColumns.lead_idea && renderCell('lead_idea', person.lead_idea)}

      {/* 11. Seller */}
      {visibleColumns.seller && (
      <TableCell className="p-2 align-middle">
        <Select
          value={person.seller && sellerOptions.some((option) => option.email === person.seller) ? person.seller : NO_SELLER_VALUE}
          onValueChange={(value) =>
            onUpdate(person.id, { seller: value === NO_SELLER_VALUE ? null : value })
          }
        >
          <SelectTrigger className="h-8 border-none shadow-none focus:ring-0 hover:bg-gray-100 w-[110px] min-w-[110px] gap-1 pr-2">
            <SelectValue placeholder="בחר מוכר" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_SELLER_VALUE}>ללא</SelectItem>
            {sellerOptions.map((option) => (
              <SelectItem key={option.email} value={option.email}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      )}

      {/* 12. Campaign */}
      {visibleColumns.campaign && renderCell('campaign', person.campaign)}

      {/* 13. Ad name */}
      {visibleColumns.ad_name && renderCell('ad_name', person.ad_name)}

      {/* 14. Total contracts (computed from purchases, non-editable) */}
      {visibleColumns.total_contracts && (
      <TableCell className="p-2 align-middle text-gray-700">
        <span className="block truncate">₪{purchaseTotal.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
      </TableCell>
      )}

      {/* 15. Status */}
      {visibleColumns.status && renderCell('status', person.status)}

    </TableRow>
  )
}
