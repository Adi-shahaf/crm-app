'use client'

import { useEffect, useMemo, useState } from 'react'
import { GripVertical } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { PersonWithGroup, ProjectActivityLog, ProjectStage, Purchase } from '@/types/database'
import { createClient } from '@/utils/supabase/client'

const PROJECT_STAGES: ProjectStage[] = ['future', 'in_progress', 'done']

const STAGE_META: Record<
  ProjectStage,
  {
    label: string
    trackClass: string
    headerClass: string
    countClass: string
    emptyText: string
  }
> = {
  future: {
    label: 'Future',
    trackClass: 'border-slate-300 bg-white',
    headerClass: 'bg-slate-300 text-slate-900',
    countClass: 'bg-slate-200 text-slate-900',
    emptyText: 'Drop a project here',
  },
  in_progress: {
    label: 'In progress',
    trackClass: 'border-amber-200 bg-white',
    headerClass: 'bg-amber-200 text-slate-900',
    countClass: 'bg-amber-100 text-amber-900',
    emptyText: 'Drop active work here',
  },
  done: {
    label: 'Done',
    trackClass: 'border-emerald-300 bg-white',
    headerClass: 'bg-emerald-300 text-slate-900',
    countClass: 'bg-emerald-100 text-emerald-900',
    emptyText: 'Completed projects appear here',
  },
}

const normalizeProjectStage = (value: Purchase['project_stage']): ProjectStage => {
  if (value === 'future' || value === 'in_progress' || value === 'done') return value
  return 'future'
}

const formatDateTime = (value: string) => new Date(value).toLocaleString('he-IL')
const toDateInputValue = (value: string | null) => (value ? value.slice(0, 10) : '')

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

  if (!person) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[92vh] w-[99vw] max-w-[1620px] flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-[#0e8aa0] p-0">
        <DialogHeader className="px-6 pt-1 pb-1">
          <DialogTitle className="w-full text-center text-3xl font-bold tracking-tight text-white">
            {person.full_name} - Projects
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 px-4 pt-0 pb-1">
          <div className="grid h-full grid-cols-1 gap-4 md:grid-cols-3">
              {PROJECT_STAGES.map((stage) => {
                const columnProjects = projectsByStage[stage]
                const isActiveDropZone = dragOverStage === stage
                const stageMeta = STAGE_META[stage]

                return (
                  <section
                    key={stage}
                    className={cn(
                      'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border shadow-sm transition-all',
                      stageMeta.trackClass,
                      isActiveDropZone && 'ring-2 ring-blue-400/60 shadow-md'
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
                    <div className={cn('flex items-center justify-between px-4 py-2', stageMeta.headerClass)}>
                      <h3 className="text-xl font-bold">{stageMeta.label}</h3>
                      <Badge className={cn('rounded-full border-0 px-2 py-0.5 text-xs font-semibold', stageMeta.countClass)}>
                        {columnProjects.length} 
                      </Badge>
                    </div>

                    <ScrollArea className="flex-1 px-2 py-2">
                      <div className="space-y-2.5">
                        {columnProjects.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-gray-300 bg-slate-50 px-3 py-4 text-center text-xs text-gray-500">
                            {stageMeta.emptyText}
                          </p>
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
                                'cursor-grab rounded-lg border border-slate-200 bg-slate-100 p-3 shadow-sm transition-opacity active:cursor-grabbing',
                                updatingProjectId === project.id && 'opacity-60'
                              )}
                            >
                              <div className="mb-3 flex items-start justify-between gap-2">
                                <div className="line-clamp-2 text-lg font-bold leading-tight text-slate-900">
                                  {project.service_id?.trim() || 'Unnamed service'}
                                </div>
                                <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                              </div>

                              <div className="grid grid-cols-2 gap-2">
                                <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  Start
                                  <input
                                    type="date"
                                    className="mt-1 block h-7 w-full rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-700"
                                    value={toDateInputValue(project.project_start_date)}
                                    onChange={(event) => {
                                      void updateProjectDateField(project.id, 'project_start_date', event.target.value)
                                    }}
                                  />
                                </label>
                                <label className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                                  Finish
                                  <input
                                    type="date"
                                    className="mt-1 block h-7 w-full rounded border border-slate-300 bg-white px-1.5 text-[11px] text-slate-700"
                                    value={toDateInputValue(project.project_finish_date)}
                                    onChange={(event) => {
                                      void updateProjectDateField(project.id, 'project_finish_date', event.target.value)
                                    }}
                                  />
                                </label>
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

        <div className="border-t border-white/30 bg-white/95 p-2.5">
          <h4 className="mb-2 text-sm font-semibold text-slate-800">Activity Log</h4>
          <ScrollArea className="h-[240px] rounded-lg border border-gray-200 bg-gray-50 p-3">
            {activityLogs.length === 0 ? (
              <p className="text-xs text-gray-500">No project moves logged yet.</p>
            ) : (
              <div className="space-y-2">
                {activityLogs.map((log) => (
                  <div key={log.id} className="text-xs text-gray-700">
                    <span className="font-medium">{log.created_by_name || 'Unknown user'}</span>{' '}
                    moved a project from <span className="font-medium">{STAGE_META[log.from_stage].label}</span> to{' '}
                    <span className="font-medium">{STAGE_META[log.to_stage].label}</span> on {formatDateTime(log.moved_at)}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
          {error ? <p className="mt-2 text-xs text-red-600">{error}</p> : null}
          {isLoading ? <p className="mt-2 text-xs text-gray-500">Loading projects...</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
