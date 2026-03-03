'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckSquare } from 'lucide-react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { USER_ROLE_LIST } from '@/lib/user-permissions'
import { cn } from '@/lib/utils'
import { ProjectStage } from '@/types/database'
import { createClient } from '@/utils/supabase/client'
import { PurchaseWithPerson } from './page'

const PROJECT_STAGES: ProjectStage[] = ['future', 'in_progress', 'done']
type ProjectManagerOption = { email: string; label: string }
const NO_PROJECT_MANAGER_VALUE = '__none__'

const STAGE_META: Record<
  ProjectStage,
  {
    label: string
    emptyText: string
    dotClass: string
  }
> = {
  future: {
    label: 'TO DO',
    emptyText: 'No projects',
    dotClass: 'bg-[#7a869a]',
  },
  in_progress: {
    label: 'IN PROGRESS',
    emptyText: 'No active work',
    dotClass: 'bg-[#ffab00]',
  },
  done: {
    label: 'DONE',
    emptyText: 'No completed projects',
    dotClass: 'bg-[#36b37e]',
  },
}

const normalizeProjectStage = (value: ProjectStage | null | undefined): ProjectStage => {
  if (value === 'future' || value === 'in_progress' || value === 'done') return value
  return 'future'
}

const toDateInputValue = (value: string | null) => (value ? value.slice(0, 10) : '')
const getEmailPrefix = (email: string) => email.split('@')[0] || email

export function KanbanClient({
  initialPurchases,
  userEmail,
}: {
  initialPurchases: PurchaseWithPerson[]
  userEmail: string | null | undefined
}) {
  const [purchases, setPurchases] = useState<PurchaseWithPerson[]>(initialPurchases)
  const [error, setError] = useState('')
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<ProjectStage | null>(null)
  const [updatingProjectId, setUpdatingProjectId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const supabase = createClient()
  
  // Filtering state
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set())
  const [selectedPMs, setSelectedPMs] = useState<Set<string>>(new Set())

  const uniqueServices = useMemo(() => {
    const services = new Set(initialPurchases.map(p => p.service_id).filter(Boolean) as string[])
    return Array.from(services).sort()
  }, [initialPurchases])

  const projectManagerOptions = useMemo<ProjectManagerOption[]>(() => {
    const uniqueEmails = new Set(
      USER_ROLE_LIST.map((entry) => entry.email.trim().toLowerCase()).filter(Boolean)
    )

    if (userEmail?.trim()) {
      uniqueEmails.add(userEmail.trim().toLowerCase())
    }

    initialPurchases.forEach(p => {
      if (p.project_manager?.trim()) {
        uniqueEmails.add(p.project_manager.trim().toLowerCase())
      }
    })

    return Array.from(uniqueEmails)
      .sort((a, b) => a.localeCompare(b))
      .map((email) => ({ email, label: getEmailPrefix(email) }))
  }, [userEmail, initialPurchases])

  useEffect(() => {
    const loadCurrentUser = async () => {
      const { data } = await supabase.auth.getUser()
      setCurrentUserId(data.user?.id ?? null)
    }

    loadCurrentUser()
  }, [supabase])

  const filteredPurchases = useMemo(() => {
    return purchases.filter(p => {
      if (selectedServices.size > 0) {
        if (!p.service_id || !selectedServices.has(p.service_id)) return false
      }
      if (selectedPMs.size > 0) {
        const pm = p.project_manager || NO_PROJECT_MANAGER_VALUE
        if (!selectedPMs.has(pm)) return false
      }
      return true
    })
  }, [purchases, selectedServices, selectedPMs])

  const projectsByStage = useMemo(() => {
    const grouped: Record<ProjectStage, PurchaseWithPerson[]> = {
      future: [],
      in_progress: [],
      done: [],
    }

    for (const project of filteredPurchases) {
      grouped[normalizeProjectStage(project.project_stage)].push(project)
    }

    return grouped
  }, [filteredPurchases])

  const toggleServiceFilter = (service: string) => {
    const next = new Set(selectedServices)
    if (next.has(service)) next.delete(service)
    else next.add(service)
    setSelectedServices(next)
  }

  const togglePMFilter = (pm: string) => {
    const next = new Set(selectedPMs)
    if (next.has(pm)) next.delete(pm)
    else next.add(pm)
    setSelectedPMs(next)
  }

  const moveProject = async (projectId: string, targetStage: ProjectStage) => {
    const existingProject = purchases.find((project) => project.id === projectId)
    if (!existingProject) return

    const currentStage = normalizeProjectStage(existingProject.project_stage)
    if (currentStage === targetStage) return

    setError('')

    const previousProjects = purchases
    const movedAt = new Date().toISOString()
    const movedDate = movedAt.slice(0, 10)
    const shouldSetStartedAt = targetStage === 'in_progress' && !existingProject.project_started_at
    const shouldSetStartDate = targetStage === 'in_progress' && !existingProject.project_start_date
    const shouldSetFinishDate = targetStage === 'done' && !existingProject.project_finish_date

    setPurchases((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              project_stage: targetStage,
              project_started_at: shouldSetStartedAt ? movedAt : project.project_started_at,
              project_start_date: shouldSetStartDate ? movedDate : project.project_start_date,
              project_finish_date: shouldSetFinishDate ? movedDate : project.project_finish_date,
            }
          : project
      )
    )
    setUpdatingProjectId(projectId)

    const updates: {
      project_stage: ProjectStage
      project_started_at?: string
      project_start_date?: string
      project_finish_date?: string
    } = {
      project_stage: targetStage,
    }
    if (shouldSetStartedAt) updates.project_started_at = movedAt
    if (shouldSetStartDate) updates.project_start_date = movedDate
    if (shouldSetFinishDate) updates.project_finish_date = movedDate

    const { data: updatedProject, error: updateError } = await supabase
      .from('purchases')
      .update(updates)
      .eq('id', projectId)
      .select('*, people(full_name)')
      .single()

    if (updateError) {
      setPurchases(previousProjects)
      setUpdatingProjectId(null)
      setError(`Could not move project: ${updateError.message}`)
      return
    }

    if (updatedProject) {
      setPurchases((prev) => prev.map((project) => (project.id === projectId ? (updatedProject as any as PurchaseWithPerson) : project)))
    }

    const { error: logError } = await supabase
      .from('project_activity_logs')
      .insert([
        {
          person_id: existingProject.person_id,
          purchase_id: projectId,
          from_stage: currentStage,
          to_stage: targetStage,
          moved_at: movedAt,
          created_by: currentUserId,
          created_by_name: userEmail,
        },
      ])

    if (logError) {
      setError(`Project moved, but logging failed: ${logError.message}`)
    }

    setUpdatingProjectId(null)
  }

  const updateProjectDateField = async (
    projectId: string,
    field: 'project_start_date' | 'project_finish_date',
    nextValue: string
  ) => {
    const previousProjects = purchases
    const valueToSave = nextValue || null

    setPurchases((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              [field]: valueToSave,
            }
          : project
      )
    )
    setUpdatingProjectId(projectId)
    setError('')

    const { data, error: updateError } = await supabase
      .from('purchases')
      .update({ [field]: valueToSave })
      .eq('id', projectId)
      .select('*, people(full_name)')
      .single()

    if (updateError) {
      setPurchases(previousProjects)
      setError(`Could not update project dates: ${updateError.message}`)
      setUpdatingProjectId(null)
      return
    }

    if (data) {
      setPurchases((prev) => prev.map((project) => (project.id === projectId ? (data as any as PurchaseWithPerson) : project)))
    }

    setUpdatingProjectId(null)
  }

  const updateProjectManager = async (projectId: string, nextValue: string | null) => {
    const previousProjects = purchases

    setPurchases((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              project_manager: nextValue,
            }
          : project
      )
    )
    setUpdatingProjectId(projectId)
    setError('')

    const { data, error: updateError } = await supabase
      .from('purchases')
      .update({ project_manager: nextValue })
      .eq('id', projectId)
      .select('*, people(full_name)')
      .single()

    if (updateError) {
      setPurchases(previousProjects)
      setError(`Could not update project manager: ${updateError.message}`)
      setUpdatingProjectId(null)
      return
    }

    if (data) {
      setPurchases((prev) => prev.map((project) => (project.id === projectId ? (data as any as PurchaseWithPerson) : project)))
    }

    setUpdatingProjectId(null)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" dir="rtl">
      <div className="flex flex-col gap-6 mb-6 shrink-0 bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <span className="w-1 h-4 bg-blue-500 rounded-full"></span>
              סינון לפי שירות
            </h2>
            {selectedServices.size > 0 && (
              <button 
                onClick={() => setSelectedServices(new Set())}
                className="text-xs text-blue-600 hover:underline"
              >
                נקה הכל
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {uniqueServices.map(service => (
              <Badge
                key={service}
                variant={selectedServices.has(service) ? "default" : "outline"}
                className={cn(
                  "cursor-pointer px-3 py-1.5 text-sm transition-all hover:scale-105 active:scale-95",
                  selectedServices.has(service) 
                    ? "bg-blue-600 hover:bg-blue-700 text-white border-transparent shadow-md" 
                    : "hover:bg-gray-100 text-gray-600 border-gray-300"
                )}
                onClick={() => toggleServiceFilter(service)}
              >
                {service}
              </Badge>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <span className="w-1 h-4 bg-purple-500 rounded-full"></span>
              סינון לפי מנהל פרויקט
            </h2>
            {selectedPMs.size > 0 && (
              <button 
                onClick={() => setSelectedPMs(new Set())}
                className="text-xs text-purple-600 hover:underline"
              >
                נקה הכל
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
                variant={selectedPMs.has(NO_PROJECT_MANAGER_VALUE) ? "default" : "outline"}
                className={cn(
                  "cursor-pointer px-3 py-1.5 text-sm transition-all hover:scale-105 active:scale-95",
                  selectedPMs.has(NO_PROJECT_MANAGER_VALUE)
                    ? "bg-purple-600 hover:bg-purple-700 text-white border-transparent shadow-md"
                    : "hover:bg-gray-100 text-gray-600 border-gray-300"
                )}
                onClick={() => togglePMFilter(NO_PROJECT_MANAGER_VALUE)}
              >
                לא שויך
            </Badge>
            {projectManagerOptions.map(pm => (
              <Badge
                key={pm.email}
                variant={selectedPMs.has(pm.email) ? "default" : "outline"}
                className={cn(
                  "cursor-pointer px-3 py-1.5 text-sm transition-all hover:scale-105 active:scale-95",
                  selectedPMs.has(pm.email)
                    ? "bg-purple-600 hover:bg-purple-700 text-white border-transparent shadow-md"
                    : "hover:bg-gray-100 text-gray-600 border-gray-300"
                )}
                onClick={() => togglePMFilter(pm.email)}
              >
                {pm.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {error ? <p className="text-[12px] text-red-600 font-medium mb-4 shrink-0">{error}</p> : null}

      <div className="flex-1 min-h-0 bg-white overflow-hidden rounded-md border border-gray-300">
        <div className="grid h-full min-h-0 grid-cols-3 gap-4 p-4" dir="ltr">
          {PROJECT_STAGES.map((stage) => {
            const columnProjects = projectsByStage[stage]
            const isActiveDropZone = dragOverStage === stage
            const stageMeta = STAGE_META[stage]

            return (
              <section
                key={stage}
                dir="rtl"
                className={cn(
                  'flex min-h-0 flex-col max-h-full rounded-lg bg-[#f4f5f7] transition-colors border border-gray-200',
                  isActiveDropZone && 'ring-2 ring-blue-400 bg-[#ebecf0]'
                )}
                onDragOver={(event) => event.preventDefault()}
                onDragEnter={(event) => {
                  event.preventDefault()
                  setDragOverStage(stage)
                }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={(event) => {
                  event.preventDefault()
                  setDragOverStage(null)
                  if (!draggedProjectId) return
                  const droppedProjectId = draggedProjectId
                  setDraggedProjectId(null)
                  void moveProject(droppedProjectId, stage)
                }}
              >
                <div className="flex items-center gap-2 px-4 py-3 sticky top-0 bg-[#f4f5f7] z-10 rounded-t-lg border-b border-gray-200">
                  <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', stageMeta.dotClass)} />
                  <h3 className="text-sm font-bold text-[#5e6c84] uppercase tracking-wider">
                    {stageMeta.label === 'TO DO' ? 'לביצוע' : stageMeta.label === 'IN PROGRESS' ? 'בתהליך' : 'בוצע'}
                  </h3>
                  <span className="mr-auto text-xs font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
                    {columnProjects.length}
                  </span>
                </div>

                <ScrollArea className="min-h-0 flex-1 px-2 py-3">
                  <div className="space-y-3 pb-2">
                    {columnProjects.length === 0 ? (
                      <div className="p-4 text-center text-sm text-[#5e6c84] border-2 border-dashed border-[#dfe1e6] rounded-lg mx-1">
                        {stageMeta.emptyText === 'No projects' ? 'אין פרויקטים' : stageMeta.emptyText === 'No active work' ? 'אין עבודה פעילה' : 'אין פרויקטים שהושלמו'}
                      </div>
                    ) : (
                      columnProjects.map((project) => (
                        <article
                          key={project.id}
                          draggable
                          onDragStart={() => setDraggedProjectId(project.id)}
                          onDragEnd={() => {
                            setDraggedProjectId(null)
                            setDragOverStage(null)
                          }}
                          className={cn(
                            'group cursor-grab rounded-lg bg-white p-3 shadow-sm hover:shadow-md transition-shadow active:cursor-grabbing border border-gray-200',
                            updatingProjectId === project.id && 'opacity-60'
                          )}
                        >
                          <div className="font-bold text-[#172b4d] text-base mb-1 leading-tight">
                            {project.people?.full_name || 'לקוח לא ידוע'}
                          </div>
                          <div className="text-sm text-[#44546f] mb-3 leading-relaxed break-words">
                            {project.service_id?.trim() || 'שירות ללא שם'}
                          </div>

                          <div className="flex flex-col gap-3">
                            {/* Dates row */}
                            <div className="flex items-center gap-2 text-[11px] text-[#5e6c84]">
                               <div className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-md border border-gray-200">
                                  <span className="font-bold">התחלה:</span>
                                  <input
                                    type="date"
                                    className="bg-transparent border-none p-0 text-[11px] w-[80px] focus:ring-0 cursor-pointer text-[#172b4d] font-medium"
                                    value={toDateInputValue(project.project_start_date)}
                                    onChange={(event) => {
                                      void updateProjectDateField(project.id, 'project_start_date', event.target.value)
                                    }}
                                  />
                               </div>
                               <div className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded-md border border-gray-200">
                                  <span className="font-bold">סיום:</span>
                                  <input
                                    type="date"
                                    className="bg-transparent border-none p-0 text-[11px] w-[80px] focus:ring-0 cursor-pointer text-[#172b4d] font-medium"
                                    value={toDateInputValue(project.project_finish_date)}
                                    onChange={(event) => {
                                      void updateProjectDateField(project.id, 'project_finish_date', event.target.value)
                                    }}
                                  />
                               </div>
                            </div>

                            {/* Footer row */}
                            <div className="mt-1 flex items-center justify-between border-t border-gray-100 pt-2">
                              <div className="flex items-center gap-1.5">
                                <CheckSquare className="h-3.5 w-3.5 text-blue-500" />
                              </div>

                              <Select
                                  value={
                                    project.project_manager &&
                                    projectManagerOptions.some((option) => option.email === project.project_manager)
                                      ? project.project_manager
                                      : NO_PROJECT_MANAGER_VALUE
                                  }
                                  onValueChange={(value) =>
                                    void updateProjectManager(
                                      project.id,
                                      value === NO_PROJECT_MANAGER_VALUE ? null : value
                                    )
                                  }
                                >
                                  <SelectTrigger className="h-7 border-none shadow-none bg-gray-100 hover:bg-gray-200 px-2 py-0 text-xs text-[#172b4d] font-bold rounded-md w-auto transition-colors">
                                    <SelectValue placeholder="לא שויך" />
                                  </SelectTrigger>
                                  <SelectContent dir="rtl">
                                    <SelectItem value={NO_PROJECT_MANAGER_VALUE}>לא שויך</SelectItem>
                                    {projectManagerOptions.map((option) => (
                                      <SelectItem key={option.email} value={option.email}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                            </div>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
