export const ROLES = {
  HOD: 'HOD',
  MANAGER: 'Manager',
  CHIEF_MANAGER: 'Chief Manager',
  ENGINEER: 'Engineer',
  PDC: 'PDC',
}

export const DEPARTMENTS = {
  VDD: 'VDD',
  PDC: 'PDC',
}

export const STATUS = {
  PENDING: 'Pending',
  COSTING_INITIATED: 'Costing Initiated',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  REVIEW_PENDING: 'Review Pending',
  REJECTED: 'Rejected',
  COMMERCIAL_PENDING: 'Commercial Pending',
  CLOSED: 'Closed',
}

export const ROLE_OPTIONS = [
  { value: ROLES.HOD, label: 'HOD' },
  { value: ROLES.MANAGER, label: 'Manager' },
  { value: ROLES.CHIEF_MANAGER, label: 'Chief Manager' },
  { value: ROLES.ENGINEER, label: 'VDD Engineer' },
  { value: ROLES.PDC, label: 'PDC Team' },
]

export const DEPARTMENT_OPTIONS = [
  { value: DEPARTMENTS.VDD, label: 'VDD' },
  { value: DEPARTMENTS.PDC, label: 'PDC' },
]

export const LOCATION_OPTIONS = [
  'Mysuru (RPSCOE)',
  'Indore (NATRAX)',
]

export const PRIORITY_OPTIONS = ['Low', 'Medium', 'High', 'Critical']

export const TEST_TYPE_OPTIONS = [
  'Durability',
  'Rolling Resistance',
  'Traction / Braking',
  'NVH',
  'Endurance',
  'Wet Handling',
]

export const BILLING_STATUS_OPTIONS = [
  'Pending Billing',
  'Invoice Raised',
  'Payment Received',
]

export const PERMISSION_OPTIONS = [
  { key: 'viewCosting', label: 'View costing' },
  { key: 'editCosting', label: 'Edit costing' },
  { key: 'approveReports', label: 'Approve reports' },
  { key: 'accessAllDepartments', label: 'Access all departments' },
  { key: 'manageUsers', label: 'Manage users' },
  { key: 'manageAssignments', label: 'Manage assignments' },
  { key: 'manageAuditLogs', label: 'View audit logs' },
  { key: 'submitRequests', label: 'Create test requests' },
]

export const DEFAULT_LINE_ITEMS = [
  { id: 'materials', category: 'Materials', description: 'Tyre and consumables', cost: 0 },
  { id: 'labour', category: 'Labor', description: 'Engineering effort', cost: 0 },
  { id: 'facility', category: 'Equipment', description: 'Track and rig usage', cost: 0 },
]

export function getDefaultPermissions(role, department) {
  const management = [ROLES.HOD, ROLES.MANAGER, ROLES.CHIEF_MANAGER].includes(role)

  return {
    viewCosting: true,
    editCosting: role === ROLES.HOD || role === ROLES.ENGINEER || management,
    approveReports: role === ROLES.HOD || management,
    accessAllDepartments: role === ROLES.HOD || management,
    manageUsers: role === ROLES.HOD,
    manageAssignments: role === ROLES.HOD || management,
    manageAuditLogs: role === ROLES.HOD,
    submitRequests: role === ROLES.HOD || role === ROLES.PDC || department === DEPARTMENTS.PDC,
  }
}

export function getRoleHome(role) {
  switch (role) {
    case ROLES.PDC:
      return '/requests'
    case ROLES.ENGINEER:
      return '/tasks'
    default:
      return '/dashboard'
  }
}
