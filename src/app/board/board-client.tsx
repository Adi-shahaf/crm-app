'use client'

import { useMemo, useState } from 'react'
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
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Check, X, Maximize2, Trash2 } from 'lucide-react'
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

const GROUP_NAME_MAP: Record<string, string> = {
  'New Leads': 'לידים',
  Contacted: 'לקוחות',
  'Meeting Scheduled': 'לקוחות גדולים',
  Customers: 'לקוחות',
  'Lost / Archive': 'ארכיון לקוחות',
}

const getDisplayGroupName = (name: string) => GROUP_NAME_MAP[name] || name

const getPersonDateTime = (person: PersonWithGroup) => person.sheet_datetime || person.created_at

export function BoardClient({ 
  initialGroups, 
  initialPeople 
}: { 
  initialGroups: Group[], 
  initialPeople: PersonWithGroup[] 
}) {
  const groups = initialGroups
  const [people, setPeople] = useState(initialPeople)
  const [selectedPerson, setSelectedPerson] = useState<PersonWithGroup | null>(null)
  const supabase = createClient()

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
    }
  }

  const handleDeletePeople = async (ids: string[]) => {
    if (!ids.length) return

    const previousPeople = people
    setPeople((prev) => prev.filter((person) => !ids.includes(person.id)))
    setSelectedPerson((prev) => (prev && ids.includes(prev.id) ? null : prev))

    const { error } = await supabase
      .from('people')
      .delete()
      .in('id', ids)

    if (error) {
      console.error('Error deleting people:', error)
      setPeople(previousPeople)
    }
  }

  return (
    <div className="space-y-6">
      {groups.map(group => (
        <GroupSection 
          key={group.id} 
          group={group} 
          groups={groups}
          people={people.filter(p => p.group_id === group.id)} 
          onUpdatePerson={handleUpdatePerson}
          onCreatePerson={handleCreatePerson}
          onDeletePeople={handleDeletePeople}
          onOpenDrawer={setSelectedPerson}
        />
      ))}
      <PersonDrawer 
        person={selectedPerson} 
        isOpen={!!selectedPerson} 
        onClose={() => setSelectedPerson(null)} 
      />
    </div>
  )
}

function GroupSection({ 
  group, 
  groups,
  people, 
  onUpdatePerson,
  onCreatePerson,
  onDeletePeople,
  onOpenDrawer
}: { 
  group: Group, 
  groups: Group[],
  people: PersonWithGroup[],
  onUpdatePerson: (id: string, updates: Partial<PersonWithGroup>) => void,
  onCreatePerson: (groupId: string, name: string) => void,
  onDeletePeople: (ids: string[]) => void,
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

  const sortedPeople = useMemo(() => {
    if (!sortConfig) return people

    const getValue = (person: PersonWithGroup): string | number | null => {
      if (sortConfig.field === 'sheet_datetime') return Date.parse(getPersonDateTime(person))
      if (sortConfig.field === 'score_1_3') return person.score_1_3
      if (sortConfig.field === 'total_contracts') return person.total_contracts
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

      return sortConfig.direction === 'asc' ? comparison : -comparison
    })
  }, [people, sortConfig])

  const toggleSort = (field: SortField) => {
    setSortConfig((prev) => {
      if (!prev || prev.field !== field) return { field, direction: 'asc' }
      if (prev.direction === 'asc') return { field, direction: 'desc' }
      return null
    })
  }

  const renderSortChevron = (field: SortField) => {
    const isActive = sortConfig?.field === field

    return (
      <button
        type="button"
        aria-label={`Sort by ${field}`}
        onClick={() => toggleSort(field)}
        className="inline-flex h-5 w-5 items-center justify-center text-gray-400 hover:text-gray-700"
      >
        {isActive ? (
          sortConfig.direction === 'asc' ? (
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
        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasSelection}
            onClick={() => {
              if (!hasSelection) return
              if (!window.confirm(`Delete ${validSelectedIds.length} selected row(s)?`)) return
              onDeletePeople(validSelectedIds)
              setSelectedIds([])
            }}
            className="h-8"
          >
            <Trash2 className="h-4 w-4" />
            Delete selected {hasSelection ? `(${validSelectedIds.length})` : ''}
          </Button>
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
                <TableHead className="min-w-[150px]">
                  <div className="flex items-center gap-1">
                    <span>שם</span>
                    {renderSortChevron('full_name')}
                  </div>
                </TableHead>
                <TableHead className="min-w-[150px]">קבוצה</TableHead>
                <TableHead className="min-w-[120px]">מספר טלפון</TableHead>
                <TableHead className="min-w-[150px]">כתובת מייל</TableHead>
                <TableHead className="min-w-[120px]">
                  <div className="flex items-center gap-1">
                    <span>תאריך ושעה</span>
                    {renderSortChevron('sheet_datetime')}
                  </div>
                </TableHead>
                <TableHead className="min-w-[80px]">
                  <div className="flex items-center gap-1">
                    <span>ציון 1-3</span>
                    {renderSortChevron('score_1_3')}
                  </div>
                </TableHead>
                <TableHead className="min-w-[120px]">מקור</TableHead>
                <TableHead className="min-w-[150px]">תגובה להודעת ווטסאפ</TableHead>
                <TableHead className="min-w-[120px]">שכיר / עצמאי</TableHead>
                <TableHead className="min-w-[150px]">רעיון (טופס לידים)</TableHead>
                <TableHead className="min-w-[100px]">מוכר</TableHead>
                <TableHead className="min-w-[120px]">קמפיין</TableHead>
                <TableHead className="min-w-[120px]">שם המודעה</TableHead>
                <TableHead className="min-w-[100px]">
                  <div className="flex items-center gap-1">
                    <span>סה&quot;כ חוזים</span>
                    {renderSortChevron('total_contracts')}
                  </div>
                </TableHead>
                <TableHead className="min-w-[120px]">סטטוס</TableHead>
                <TableHead className="min-w-[120px]">מצב ליד</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPeople.map((person) => (
                <EditableRow 
                  key={person.id} 
                  person={person} 
                  groups={groups}
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
                <TableCell colSpan={16}>
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
  onUpdate,
  isSelected,
  onToggleSelect,
  onOpenDrawer
}: { 
  person: PersonWithGroup, 
  groups: Group[],
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
        </div>
      </TableCell>
      
      {/* 1. Name */}
      {renderCell('full_name', person.full_name)}
      
      {/* 2. Group */}
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
      
      {/* 3. Phone */}
      {renderCell('phone', person.phone)}
      
      {/* 4. Email */}
      {renderCell('email', person.email)}
      
      {/* 5. Date */}
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

      {/* 6. Score */}
      {renderCell('score_1_3', person.score_1_3, true)}

      {/* 7. Source */}
      {renderCell('source', person.source)}

      {/* 8. WhatsApp response */}
      {renderCell('whatsapp_response', person.whatsapp_response)}

      {/* 9. Employment status */}
      {renderCell('employment_status', person.employment_status)}

      {/* 10. Lead idea */}
      {renderCell('lead_idea', person.lead_idea)}

      {/* 11. Seller */}
      {renderCell('seller', person.seller)}

      {/* 12. Campaign */}
      {renderCell('campaign', person.campaign)}

      {/* 13. Ad name */}
      {renderCell('ad_name', person.ad_name)}

      {/* 14. Total contracts */}
      {renderCell('total_contracts', person.total_contracts, true)}

      {/* 15. Status */}
      {renderCell('status', person.status)}

      {/* 16. Lead status */}
      {renderCell('lead_status', person.lead_status)}

    </TableRow>
  )
}
