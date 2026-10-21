export const APP_ROLES = ['Owner', 'Operator', 'Viewer', 'User'] as const
export type AppRole = (typeof APP_ROLES)[number]

/** Application roles. public.users.role stores these strings. */
export function isAdminRole(role: string | null | undefined): boolean {
  return role === 'Admin' || role === 'Owner' || role === 'Operator' || role === 'Viewer'
}

export function asAppRole(role: string | null | undefined): AppRole {
  if (role === 'Admin') return 'Owner'
  return APP_ROLES.includes(role as AppRole) ? role as AppRole : 'User'
}

export function canOperate(role: AppRole) {
  return role === 'Owner' || role === 'Operator'
}

/** Reads the signed-in role. The browser never queries the table itself. */
export async function fetchOwnRole(): Promise<AppRole | null> {
  const response = await fetch('/api/account/role', { credentials: 'include', cache: 'no-store' })
  if (response.status === 401) return null
  if (!response.ok) return 'User'
  const body = await response.json() as { role?: string }
  return asAppRole(body.role)
}
