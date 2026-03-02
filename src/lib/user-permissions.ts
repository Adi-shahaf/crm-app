export const BOARD_COLUMNS = [
  'full_name',
  'group_id',
  'phone',
  'email',
  'sheet_datetime',
  'follow_up_at',
  'score_1_3',
  'seller',
  'source',
  'whatsapp_response',
  'unanswered_calls_count',
  'employment_status',
  'lead_idea',
  'campaign',
  'ad_name',
  'total_contracts',
] as const

export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]
export type UserRole = 'admin' | 'project_manager' | 'sales'

const DEFAULT_USER_ROLE: UserRole = 'admin'

const USER_ROLE_BY_EMAIL: Record<string, UserRole> = {
  'adi@synergytech.co.il': 'admin',
  'elattiass@gmail.com': 'sales',
  'ido@synergytech.co.il': 'sales',
  'shai@synergytech.co.il': 'project_manager',
  'yuval@synergytech.co.il': 'admin',
}

export const USER_ROLE_LIST = Object.entries(USER_ROLE_BY_EMAIL)
  .map(([email, role]) => ({ email, role }))
  .sort((a, b) => a.email.localeCompare(b.email))

const RESTRICTED_BOARD_COLUMNS_BY_ROLE: Record<UserRole, readonly BoardColumnKey[]> = {
  admin: [],
  project_manager: [
    'score_1_3',
    'source',
    'whatsapp_response',
    'unanswered_calls_count',
    'follow_up_at',
    'employment_status',
    'lead_idea',
    'seller',
    'campaign',
    'ad_name',
    'total_contracts',
  ],
  sales: [],
}
const SALES_TAB_ACCESS_BY_ROLE: Record<UserRole, boolean> = {
  admin: true,
  project_manager: false,
  sales: true,
}
const PROJECT_KANBAN_ACCESS_BY_ROLE: Record<UserRole, boolean> = {
  admin: true,
  project_manager: true,
  sales: false,
}
const PROJECT_MANAGER_ALLOWED_GROUP_NAMES = new Set([
  'לקוחות',
  'לקוחות גדולים',
  'ארכיון לקוחות',
  'Contacted',
  'Meeting Scheduled',
  'Lost / Archive',
])

const normalizeEmail = (email: string | null | undefined) =>
  email?.trim().toLowerCase() ?? null

export const getUserRoleByEmail = (email: string | null | undefined): UserRole => {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return DEFAULT_USER_ROLE

  return USER_ROLE_BY_EMAIL[normalizedEmail] ?? DEFAULT_USER_ROLE
}

export const getBoardColumnAccessByRole = (
  role: UserRole
): Record<BoardColumnKey, boolean> => {
  const restrictedColumns = new Set(RESTRICTED_BOARD_COLUMNS_BY_ROLE[role])

  return BOARD_COLUMNS.reduce(
    (access, column) => {
      access[column] = !restrictedColumns.has(column)
      return access
    },
    {} as Record<BoardColumnKey, boolean>
  )
}

export const getBoardColumnAccessByEmail = (email: string | null | undefined) =>
  getBoardColumnAccessByRole(getUserRoleByEmail(email))

export const canAccessSalesTabByRole = (role: UserRole) => SALES_TAB_ACCESS_BY_ROLE[role]

export const canAccessSalesTabByEmail = (email: string | null | undefined) =>
  canAccessSalesTabByRole(getUserRoleByEmail(email))

export const canAccessProjectKanbanByRole = (role: UserRole) =>
  PROJECT_KANBAN_ACCESS_BY_ROLE[role]

export const canAccessProjectKanbanByEmail = (email: string | null | undefined) =>
  canAccessProjectKanbanByRole(getUserRoleByEmail(email))

export const filterPeopleByEmailAccess = <T extends { seller: string | null }>(
  people: T[],
  email: string | null | undefined
) => {
  const role = getUserRoleByEmail(email)
  if (role !== 'sales') return people

  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return []

  return people.filter((person) => normalizeEmail(person.seller) === normalizedEmail)
}

export const filterGroupsByEmailAccess = <T extends { name: string }>(
  groups: T[],
  email: string | null | undefined
) => {
  const role = getUserRoleByEmail(email)
  if (role !== 'project_manager') return groups

  return groups.filter((group) => PROJECT_MANAGER_ALLOWED_GROUP_NAMES.has(group.name))
}

export const filterPeopleByGroupAccess = <T extends { group_id: string | null }>(
  people: T[],
  allowedGroupIds: Set<string>
) => people.filter((person) => !!person.group_id && allowedGroupIds.has(person.group_id))
