import { getUserRoleByEmail } from '@/lib/user-permissions'

export const canAccessDashboard = (email: string | null | undefined) =>
  getUserRoleByEmail(email) === 'admin'
