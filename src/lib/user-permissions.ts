export const BOARD_COLUMNS = [
  'full_name',
  'group_id',
  'phone',
  'email',
  'sheet_datetime',
  'score_1_3',
  'source',
  'whatsapp_response',
  'employment_status',
  'lead_idea',
  'seller',
  'campaign',
  'ad_name',
  'total_contracts',
  'status',
  'lead_status',
] as const

export type BoardColumnKey = (typeof BOARD_COLUMNS)[number]
export type UserRole = 'admin' | 'project_manager'

const DEFAULT_USER_ROLE: UserRole = 'admin'

const USER_ROLE_BY_EMAIL: Record<string, UserRole> = {
  'adi@synergytech.co.il': 'admin',
  'yuval@synergytech.co.il': 'project_manager',
}

const RESTRICTED_BOARD_COLUMNS_BY_ROLE: Record<UserRole, readonly BoardColumnKey[]> = {
  admin: [],
  project_manager: ['source', 'employment_status', 'total_contracts'],
}

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
