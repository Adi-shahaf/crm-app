const DASHBOARD_ALLOWED_EMAIL = 'adi@synergytech.co.il'

export const canAccessDashboard = (email: string | null | undefined) =>
  email?.toLowerCase() === DASHBOARD_ALLOWED_EMAIL

