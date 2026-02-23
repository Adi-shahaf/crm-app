'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Group, PersonWithGroup } from '@/types/database'
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
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Check, X, Maximize2, ShoppingCart, Trash2 } from 'lucide-react'
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

type SortField = 'full_name' | 'sheet_datetime' | 'score_1_3' | 'total_contracts'
type SortDirection = 'asc' | 'desc'
type SortConfig = { field: SortField; direction: SortDirection } | null
type ColumnKey =
  | 'full_name'
  | 'group_id'
  | 'phone'
  | 'email'
  | 'sheet_datetime'
  | 'score_1_3'
  | 'source'
  | 'whatsapp_response'
  | 'employment_status'
  | 'lead_idea'
  | 'seller'
  | 'campaign'
  | 'ad_name'
  | 'total_contracts'
  | 'status'
  | 'lead_status'

const GROUP_NAME_MAP: Record<string, string> = {
  'New Leads': 'לידים',
  Contacted: 'לקוחות',
  'Meeting Scheduled': 'לקוחות גדולים',
  Customers: 'לקוחות',
  'Lost / Archive': 'ארכיון לקוחות',
}

const getDisplayGroupName = (name: string) => GROUP_NAME_MAP[name] || name

const getPersonDateTime = (person: PersonWithGroup) => person.sheet_datetime || person.created_at
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
    person.lead_status,
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
  lead_status: 'מצב ליד',
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
  lead_status: true,
}
const SORT_FIELD_TO_COLUMN: Record<SortField, ColumnKey> = {
  full_name: 'full_name',
  sheet_datetime: 'sheet_datetime',
  score_1_3: 'score_1_3',
  total_contracts: 'total_contracts',
}

export function BoardClient({ 
  initialGroups, 
  initialPeople 
}: { 
  initialGroups: Group[], 
  initialPeople: PersonWithGroup[] 
}) {
  const groups = initialGroups
  const [people, setPeople] = useState(initialPeople)
  const [purchaseCounts, setPurchaseCounts] = useState<Record<string, number>>({})
  const [purchaseTotals, setPurchaseTotals] = useState<Record<string, number>>({})
  const [selectedPerson, setSelectedPerson] = useState<PersonWithGroup | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(() => ({ ...DEFAULT_VISIBLE_COLUMNS }))
  const [isColumnsMenuOpen, setIsColumnsMenuOpen] = useState(false)
  const columnsMenuRef = useRef<HTMLDivElement | null>(null)
  const supabase = createClient()

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
      console.error('Error updating person:', { id, updates, error })
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
    }
  }

  const handleDeletePeople = async (ids: string[]) => {
    if (!ids.length) return

    const previousPeople = people
    const previousCounts = purchaseCounts
    const previousTotals = purchaseTotals
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
      } else {
        setPeople(data)
      }
    }
  }

  const filteredPeople = useMemo(
    () => people.filter((person) => personMatchesSearch(person, searchTerm)),
    [people, searchTerm]
  )
  const visibleColumnCount = useMemo(
    () => Object.values(visibleColumns).filter(Boolean).length,
    [visibleColumns]
  )
  const visibleGroups = searchTerm.trim()
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
      const currentlyVisibleCount = Object.values(prev).filter(Boolean).length
      if (prev[column] && currentlyVisibleCount === 1) return prev
      return { ...prev, [column]: !prev[column] }
    })
  }

  const setAllColumnsVisible = (value: boolean) => {
    const next = value
      ? { ...DEFAULT_VISIBLE_COLUMNS }
      : { ...DEFAULT_VISIBLE_COLUMNS, full_name: true, group_id: false, phone: false, email: false, sheet_datetime: false, score_1_3: false, source: false, whatsapp_response: false, employment_status: false, lead_idea: false, seller: false, campaign: false, ad_name: false, total_contracts: false, status: false, lead_status: false }
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
                  className="text-blue-600 hover:text-blue-800"
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
                {(Object.keys(COLUMN_LABELS) as ColumnKey[]).map((column) => {
                  const checked = visibleColumns[column]
                  const isOnlyVisible = checked && visibleColumnCount === 1
                  return (
                    <label key={column} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isOnlyVisible}
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
          purchaseCounts={purchaseCounts}
          purchaseTotals={purchaseTotals}
          onUpdatePerson={handleUpdatePerson}
          onCreatePerson={handleCreatePerson}
          onDeletePeople={handleDeletePeople}
          visibleColumns={visibleColumns}
          onOpenDrawer={setSelectedPerson}
        />
      ))}
      <PersonDrawer 
        person={selectedPerson} 
        isOpen={!!selectedPerson} 
        onClose={() => setSelectedPerson(null)}
        onPurchaseCreated={(personId, price) => {
          setPurchaseCounts((prev) => ({ ...prev, [personId]: (prev[personId] || 0) + 1 }))
          setPurchaseTotals((prev) => ({ ...prev, [personId]: (prev[personId] || 0) + price }))
        }}
      />
    </div>
  )
}

function GroupSection({ 
  group, 
  groups,
  people, 
  purchaseCounts,
  purchaseTotals,
  onUpdatePerson,
  onCreatePerson,
  onDeletePeople,
  visibleColumns,
  onOpenDrawer
}: { 
  group: Group, 
  groups: Group[],
  people: PersonWithGroup[],
  purchaseCounts: Record<string, number>,
  purchaseTotals: Record<string, number>,
  onUpdatePerson: (id: string, updates: Partial<PersonWithGroup>) => void,
  onCreatePerson: (groupId: string, name: string) => void,
  onDeletePeople: (ids: string[]) => void,
  visibleColumns: Record<ColumnKey, boolean>,
  onOpenDrawer: (person: PersonWithGroup) => void
}) {
  const [isOpen, setIsOpen] = useState(true)
  const [newItemName, setNewItemName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sortConfig, setSortConfig] = useState<SortConfig>(null)

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
      onOpenChange={setIsOpen}
      className="bg-white rounded-lg border shadow-sm overflow-hidden"
    >
      <div className="flex items-center px-4 py-3 border-b bg-gray-50/50">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-6 h-6 p-0 mr-2">
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        </CollapsibleTrigger>
        <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
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
                {visibleColumns.seller && <TableHead className="min-w-[100px]">מוכר</TableHead>}
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
                {visibleColumns.lead_status && <TableHead className="min-w-[120px]">מצב ליד</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPeople.map((person) => (
                <EditableRow 
                  key={person.id} 
                  person={person} 
                  groups={groups}
                  purchaseCount={purchaseCounts[person.id] || 0}
                  purchaseTotal={purchaseTotals[person.id] || 0}
                  visibleColumns={visibleColumns}
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
                      className="text-sm text-gray-400 cursor-pointer hover:text-gray-600 flex items-center h-8"
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
  purchaseCount,
  purchaseTotal,
  visibleColumns,
  onUpdate,
  isSelected,
  onToggleSelect,
  onOpenDrawer
}: { 
  person: PersonWithGroup, 
  groups: Group[],
  purchaseCount: number,
  purchaseTotal: number,
  visibleColumns: Record<ColumnKey, boolean>,
  onUpdate: (id: string, updates: Partial<PersonWithGroup>) => void,
  isSelected: boolean,
  onToggleSelect: (checked: boolean) => void,
  onOpenDrawer: (person: PersonWithGroup) => void
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
    return (
      <TableCell 
        className="p-2 align-middle cursor-text"
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
            className="h-8 text-sm w-full min-w-[100px]"
          />
        ) : (
          <span className="text-gray-700 block truncate">{value || '-'}</span>
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
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 whitespace-nowrap">
            <ShoppingCart className="h-3 w-3" />
            <span>{purchaseCount}</span>
          </span>
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
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${
                    g.type === 'customer_segment' ? 'bg-green-500' : 
                    g.type === 'archive' ? 'bg-red-500' : 'bg-blue-500'
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
      {visibleColumns.seller && renderCell('seller', person.seller)}

      {/* 12. Campaign */}
      {visibleColumns.campaign && renderCell('campaign', person.campaign)}

      {/* 13. Ad name */}
      {visibleColumns.ad_name && renderCell('ad_name', person.ad_name)}

      {/* 14. Total contracts (computed from purchases, non-editable) */}
      {visibleColumns.total_contracts && (
      <TableCell className="p-2 align-middle text-gray-700">
        <span className="block truncate">₪{purchaseTotal.toFixed(2)}</span>
      </TableCell>
      )}

      {/* 15. Status */}
      {visibleColumns.status && renderCell('status', person.status)}

      {/* 16. Lead status */}
      {visibleColumns.lead_status && renderCell('lead_status', person.lead_status)}

    </TableRow>
  )
}
