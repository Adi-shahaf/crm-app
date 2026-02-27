'use client'

import { useEffect, useMemo, useState } from 'react'
import { CheckSquare, User, Clock, ArrowRight } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { USER_ROLE_LIST } from '@/lib/user-permissions'
import { cn } from '@/lib/utils'
import { PersonWithGroup, ProjectActivityLog, ProjectStage, Purchase } from '@/types/database'
import { createClient } from '@/utils/supabase/client'

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
    dotClass: 'bg-[#7a869a]', // Grey
  },
  in_progress: {
    label: 'IN PROGRESS',
    emptyText: 'No active work',
    dotClass: 'bg-[#ffab00]', // Yellow/Amber
  },
  done: {
    label: 'DONE',
    emptyText: 'No completed projects',
    dotClass: 'bg-[#36b37e]', // Green
  },
}

const normalizeProjectStage = (value: Purchase['project_stage']): ProjectStage => {
  if (value === 'future' || value === 'in_progress' || value === 'done') return value
  return 'future'
}

const formatDateTime = (value: string) => new Date(value).toLocaleString('he-IL')
const toDateInputValue = (value: string | null) => (value ? value.slice(0, 10) : '')
const getEmailPrefix = (email: string) => email.split('@')[0] || email

export function ProjectKanbanDialog({
  person,
  isOpen,
  onClose,
}: {
  person: PersonWithGroup | null
  isOpen: boolean
  onClose: () => void
}) {
  const [projects, setProjects] = useState<Purchase[]>([])
  const [activityLogs, setActivityLogs] = useState<ProjectActivityLog[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<ProjectStage | null>(null)
  const [updatingProjectId, setUpdatingProjectId] = useState<string | null>(null)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null)
  const supabase = createClient()
  
  const projectManagerOptions = useMemo<ProjectManagerOption[]>(() => {
    const uniqueEmails = new Set(
      USER_ROLE_LIST.map((entry) => entry.email.trim().toLowerCase()).filter(Boolean)
    )

    if (currentUserEmail?.trim()) {
      uniqueEmails.add(currentUserEmail.trim().toLowerCase())
    }

    return Array.from(uniqueEmails)
      .sort((a, b) => a.localeCompare(b))
      .map((email) => ({ email, label: getEmailPrefix(email) }))
  }, [currentUserEmail])

  useEffect(() => {
    const loadCurrentUser = async () => {
      const { data } = await supabase.auth.getUser()
      setCurrentUserId(data.user?.id ?? null)
      setCurrentUserEmail(data.user?.email ?? null)
    }

    loadCurrentUser()
  }, [supabase])

  useEffect(() => {
    if (!person || !isOpen) return

    const loadProjectData = async () => {
      setIsLoading(true)
      setError('')

      const [projectsRes, logsRes] = await Promise.all([
        supabase
          .from('purchases')
          .select('*')
          .eq('person_id', person.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('project_activity_logs')
          .select('*')
          .eq('person_id', person.id)
          .order('moved_at', { ascending: false })
          .limit(100),
      ])

      if (projectsRes.error) {
        setError(`Failed to load projects: ${projectsRes.error.message}`)
        setProjects([])
      } else {
        setProjects(projectsRes.data || [])
      }

      if (logsRes.error) {
        const logErrorMessage = logsRes.error.message || 'Unknown error'
        if (logErrorMessage.includes('project_activity_logs')) {
          setError('Project logs table is missing. Please run the latest Supabase migration.')
        } else {
          setError((prev) => prev || `Failed to load project logs: ${logErrorMessage}`)
        }
        setActivityLogs([])
      } else {
        setActivityLogs((logsRes.data as ProjectActivityLog[]) || [])
      }

      setIsLoading(false)
    }

    loadProjectData()
  }, [isOpen, person, supabase])

  const projectsByStage = useMemo(() => {
    const grouped: Record<ProjectStage, Purchase[]> = {
      future: [],
      in_progress: [],
      done: [],
    }

    for (const project of projects) {
      grouped[normalizeProjectStage(project.project_stage)].push(project)
    }

    return grouped
  }, [projects])

  const moveProject = async (projectId: string, targetStage: ProjectStage) => {
    if (!person) return

    const existingProject = projects.find((project) => project.id === projectId)
    if (!existingProject) return

    const currentStage = normalizeProjectStage(existingProject.project_stage)
    if (currentStage === targetStage) return

    setError('')

    const previousProjects = projects
    const movedAt = new Date().toISOString()
    const movedDate = movedAt.slice(0, 10)
    const shouldSetStartedAt = targetStage === 'in_progress' && !existingProject.project_started_at
    const shouldSetStartDate = targetStage === 'in_progress' && !existingProject.project_start_date
    const shouldSetFinishDate = targetStage === 'done' && !existingProject.project_finish_date

    setProjects((prev) =>
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
      .select()
      .single()

    if (updateError) {
      setProjects(previousProjects)
      setUpdatingProjectId(null)
      setError(`Could not move project: ${updateError.message}`)
      return
    }

    if (updatedProject) {
      setProjects((prev) => prev.map((project) => (project.id === projectId ? updatedProject : project)))
    }

    const { data: insertedLog, error: logError } = await supabase
      .from('project_activity_logs')
      .insert([
        {
          person_id: person.id,
          purchase_id: projectId,
          from_stage: currentStage,
          to_stage: targetStage,
          moved_at: movedAt,
          created_by: currentUserId,
          created_by_name: currentUserEmail,
        },
      ])
      .select()
      .single()

    if (logError) {
      setError(`Project moved, but logging failed: ${logError.message}`)
    } else if (insertedLog) {
      setActivityLogs((prev) => [insertedLog as ProjectActivityLog, ...prev])
    }

    setUpdatingProjectId(null)
  }

  const updateProjectDateField = async (
    projectId: string,
    field: 'project_start_date' | 'project_finish_date',
    nextValue: string
  ) => {
    const previousProjects = projects
    const valueToSave = nextValue || null

    setProjects((prev) =>
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
      .select()
      .single()

    if (updateError) {
      setProjects(previousProjects)
      setError(`Could not update project dates: ${updateError.message}`)
      setUpdatingProjectId(null)
      return
    }

    if (data) {
      setProjects((prev) => prev.map((project) => (project.id === projectId ? data : project)))
    }

    setUpdatingProjectId(null)
  }

  const updateProjectManager = async (projectId: string, nextValue: string | null) => {
    const previousProjects = projects

    setProjects((prev) =>
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
      .select()
      .single()

    if (updateError) {
      setProjects(previousProjects)
      if ((updateError.message || '').includes('project_manager')) {
        setError('Project manager column is missing. Please run the latest Supabase migration.')
      } else {
        setError(`Could not update project manager: ${updateError.message}`)
      }
      setUpdatingProjectId(null)
      return
    }

    if (data) {
      setProjects((prev) => prev.map((project) => (project.id === projectId ? data : project)))
    }

    setUpdatingProjectId(null)
  }

  if (!person) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent 
        className="flex h-[90vh] flex-col gap-0 overflow-hidden rounded-md border border-gray-300 bg-white p-0 shadow-xl"
        style={{ maxWidth: '1200px', width: '95vw' }}
      >
        <DialogHeader className="border-b border-gray-200 bg-white px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-xl font-medium text-[#172b4d]">
            <span>{person.full_name}</span>
            <span className="text-gray-400 font-normal">/</span>
            <span>Board</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 bg-white overflow-hidden">
          <div className="grid h-full min-h-0 grid-cols-3 gap-4 p-6">
            {PROJECT_STAGES.map((stage) => {
              const columnProjects = projectsByStage[stage]
              const isActiveDropZone = dragOverStage === stage
              const stageMeta = STAGE_META[stage]

              return (
                <section
                  key={stage}
                  className={cn(
                    'flex flex-col max-h-full rounded-[3px] bg-[#f4f5f7] transition-colors',
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
                  <div className="flex items-center gap-2 px-3 pt-3 pb-2 sticky top-0 bg-[#f4f5f7] z-10 rounded-t-[3px]">
                    <div className={cn('h-2 w-2 rounded-full shrink-0', stageMeta.dotClass)} />
                    <h3 className="text-[12px] font-semibold text-[#5e6c84] uppercase tracking-wider">
                      {stageMeta.label}
                    </h3>
                    <span className="text-[12px] text-[#5e6c84]">{columnProjects.length}</span>
                  </div>

                  <ScrollArea className="flex-1 px-2 pb-2">
                    <div className="space-y-2 pb-2">
                      {columnProjects.length === 0 ? (
                        <div className="p-3 text-center text-[13px] text-[#5e6c84] border-2 border-dashed border-[#dfe1e6] rounded-[3px] mx-1">
                          {stageMeta.emptyText}
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
                              'group cursor-grab rounded-[3px] bg-white p-3 shadow-[0_1px_2px_rgba(9,30,66,0.25)] hover:bg-[#fafbfc] active:cursor-grabbing border-none',
                              updatingProjectId === project.id && 'opacity-60'
                            )}
                          >
                            <div className="text-[14px] text-[#172b4d] mb-3 leading-relaxed break-words">
                              {project.service_id?.trim() || 'Unnamed service'}
                            </div>

                            <div className="flex flex-col gap-2.5">
                              {/* Dates row */}
                              <div className="flex items-center gap-2 text-[12px] text-[#5e6c84]">
                                 <div className="flex items-center gap-1 bg-[#dfe1e6]/50 px-1.5 py-0.5 rounded-[3px]">
                                    <span className="font-medium">S:</span>
                                    <input
                                      type="date"
                                      className="bg-transparent border-none p-0 text-[12px] w-[85px] focus:ring-0 cursor-pointer text-[#172b4d] font-mono"
                                      value={toDateInputValue(project.project_start_date)}
                                      onChange={(event) => {
                                        void updateProjectDateField(project.id, 'project_start_date', event.target.value)
                                      }}
                                    />
                                 </div>
                                 <div className="flex items-center gap-1 bg-[#dfe1e6]/50 px-1.5 py-0.5 rounded-[3px]">
                                    <span className="font-medium">F:</span>
                                    <input
                                      type="date"
                                      className="bg-transparent border-none p-0 text-[12px] w-[85px] focus:ring-0 cursor-pointer text-[#172b4d] font-mono"
                                      value={toDateInputValue(project.project_finish_date)}
                                      onChange={(event) => {
                                        void updateProjectDateField(project.id, 'project_finish_date', event.target.value)
                                      }}
                                    />
                                 </div>
                              </div>

                              {/* Footer row */}
                              <div className="mt-1 flex items-center justify-between border-t border-[#dfe1e6]/50 pt-2">
                                <div className="flex items-center gap-1.5">
                                  <CheckSquare className="h-4 w-4 text-[#4bade8]" />
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
                                    <SelectTrigger className="h-6 border-none shadow-none bg-[#dfe1e6]/70 hover:bg-[#dfe1e6] px-2 py-0 text-[11px] text-[#172b4d] font-medium rounded-[3px] w-auto">
                                      <SelectValue placeholder="Unassigned" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value={NO_PROJECT_MANAGER_VALUE}>Unassigned</SelectItem>
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

        <div className="border-t border-gray-200 bg-white px-6 py-4 flex flex-col gap-2">
          <h4 className="text-[13px] font-semibold text-[#172b4d]">Activity Log</h4>
          <ScrollArea className="h-[100px]">
            {activityLogs.length === 0 ? (
              <p className="text-[12px] text-[#5e6c84]">No project moves logged yet.</p>
            ) : (
              <div className="space-y-1.5">
                {activityLogs.map((log) => (
                  <div key={log.id} className="text-[12px] text-[#172b4d]">
                    <span className="font-medium">{log.created_by_name || 'Unknown user'}</span>{' '}
                    moved a project from <span className="font-medium text-[#5e6c84]">{STAGE_META[log.from_stage].label}</span> to{' '}
                    <span className="font-medium text-[#5e6c84]">{STAGE_META[log.to_stage].label}</span> on {formatDateTime(log.moved_at)}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          {error ? <p className="text-[12px] text-red-600 font-medium">{error}</p> : null}
          {isLoading ? <p className="text-[12px] text-[#5e6c84]">Loading projects...</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
