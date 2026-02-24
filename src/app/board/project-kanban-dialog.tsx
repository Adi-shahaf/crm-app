'use client'

import { useEffect, useMemo, useState } from 'react'
import { Clock3, GripVertical } from 'lucide-react'

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
    columnClass: string
    headerClass: string
    countClass: string
    emptyText: string
  }
> = {
  future: {
    label: 'Future',
    columnClass: 'border-sky-200 bg-sky-50/70',
    headerClass: 'text-sky-800',
    countClass: 'bg-sky-200 text-sky-800',
    emptyText: 'Drop a project here',
  },
  in_progress: {
    label: 'In progress',
    columnClass: 'border-amber-200 bg-amber-50/80',
    headerClass: 'text-amber-800',
    countClass: 'bg-amber-200 text-amber-900',
    emptyText: 'Drop active work here',
  },
  done: {
    label: 'Done',
    columnClass: 'border-emerald-200 bg-emerald-50/80',
    headerClass: 'text-emerald-800',
    countClass: 'bg-emerald-200 text-emerald-900',
    emptyText: 'Completed projects appear here',
  },
}

const normalizeProjectStage = (value: Purchase['project_stage']): ProjectStage => {
  if (value === 'future' || value === 'in_progress' || value === 'done') return value
  return 'future'
}

const formatDateTime = (value: string) => new Date(value).toLocaleString('he-IL')

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
    const shouldSetStartedAt = targetStage === 'in_progress' && !existingProject.project_started_at

    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              project_stage: targetStage,
              project_started_at: shouldSetStartedAt ? movedAt : project.project_started_at,
            }
          : project
      )
    )
    setUpdatingProjectId(projectId)

    const updates: { project_stage: ProjectStage; project_started_at?: string } = {
      project_stage: targetStage,
    }
    if (shouldSetStartedAt) {
      updates.project_started_at = movedAt
    }

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

  if (!person) return null

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b bg-gray-50 px-6 py-4">
          <DialogTitle>{person.full_name} - Projects</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 p-4 md:grid-cols-3">
          {PROJECT_STAGES.map((stage) => {
            const columnProjects = projectsByStage[stage]
            const isActiveDropZone = dragOverStage === stage
            const stageMeta = STAGE_META[stage]

            return (
              <div
                key={stage}
                className={cn(
                  'flex min-h-[340px] flex-col rounded-xl border p-3 transition-colors',
                  stageMeta.columnClass,
                  isActiveDropZone && 'ring-2 ring-blue-400/60'
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
                <div className="mb-3 flex items-center justify-between">
                  <h3 className={cn('text-sm font-semibold tracking-wide', stageMeta.headerClass)}>
                    {stageMeta.label}
                  </h3>
                  <Badge className={cn('font-medium', stageMeta.countClass)}>{columnProjects.length}</Badge>
                </div>

                <ScrollArea className="h-[360px] pr-1">
                  <div className="space-y-2">
                    {columnProjects.length === 0 ? (
                      <p className="rounded-md border border-dashed border-gray-300 bg-white/60 p-3 text-xs text-gray-500">
                        {stageMeta.emptyText}
                      </p>
                    ) : (
                      columnProjects.map((project) => (
                        <div
                          key={project.id}
                          draggable
                          onDragStart={() => setDraggedProjectId(project.id)}
                          onDragEnd={() => {
                            setDraggedProjectId(null)
                            setDragOverStage(null)
                          }}
                          className={cn(
                            'cursor-grab rounded-lg border bg-white p-3 shadow-sm transition-opacity active:cursor-grabbing',
                            updatingProjectId === project.id && 'opacity-60'
                          )}
                        >
                          <div className="mb-2 flex items-start justify-between gap-2">
                            <div className="text-sm font-medium text-gray-900">
                              {project.service_id?.trim() || 'Unnamed service'}
                            </div>
                            <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                          </div>

                          <div className="space-y-1 text-xs text-gray-600">
                            {project.project_started_at ? (
                              <div className="inline-flex items-center gap-1 text-gray-700">
                                <Clock3 className="h-3 w-3" />
                                Started: {formatDateTime(project.project_started_at)}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
            )
          })}
        </div>

        <div className="border-t bg-gray-50/60 p-4">
          <h4 className="mb-2 text-sm font-semibold text-gray-800">Activity Log</h4>
          <ScrollArea className="h-[160px] rounded-md border bg-white p-3">
            {activityLogs.length === 0 ? (
              <p className="text-xs text-gray-500">No project moves logged yet.</p>
            ) : (
              <div className="space-y-2">
                {activityLogs.map((log) => (
                  <div key={log.id} className="text-xs text-gray-700">
                    <span className="font-medium">{log.created_by_name || 'Unknown user'}</span>{' '}
                    moved a project from{' '}
                    <span className="font-medium">{STAGE_META[log.from_stage].label}</span> to{' '}
                    <span className="font-medium">{STAGE_META[log.to_stage].label}</span>{' '}
                    on {formatDateTime(log.moved_at)}
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
