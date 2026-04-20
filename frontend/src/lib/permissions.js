import { ROLES } from './constants'

export function isManagementRole(role) {
  return [ROLES.HOD, ROLES.MANAGER, ROLES.CHIEF_MANAGER].includes(role)
}

export function hasPermission(profile, permissionKey) {
  return Boolean(profile && (profile.role === ROLES.HOD || profile.permissions?.[permissionKey]))
}

export function canManageUsers(profile) {
  return hasPermission(profile, 'manageUsers')
}

export function canCreateRequest(profile) {
  return hasPermission(profile, 'submitRequests')
}

export function canEditCosting(profile) {
  return hasPermission(profile, 'editCosting')
}

export function canViewCosting(profile) {
  return hasPermission(profile, 'viewCosting')
}

export function canManageAssignments(profile) {
  return hasPermission(profile, 'manageAssignments')
}

export function canApproveReports(profile) {
  return hasPermission(profile, 'approveReports')
}


export function canAccessAudits(profile) {
  return hasPermission(profile, 'manageAuditLogs')
}
