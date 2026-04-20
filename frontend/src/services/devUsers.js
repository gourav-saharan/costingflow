const DEV_USERS_KEY = 'costingflow-dev-local-users'

function canUseDevUsers() {
  return typeof window !== 'undefined' && import.meta.env.DEV
}

function parseStoredUsers() {
  if (!canUseDevUsers()) {
    return []
  }

  const rawValue = localStorage.getItem(DEV_USERS_KEY)
  if (!rawValue) {
    return []
  }

  try {
    const parsed = JSON.parse(rawValue)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    localStorage.removeItem(DEV_USERS_KEY)
    return []
  }
}

function persistUsers(users) {
  localStorage.setItem(DEV_USERS_KEY, JSON.stringify(users))
}

function stripPassword(user) {
  const nextUser = { ...user }
  delete nextUser.password
  return nextUser
}

export function getDevUsers() {
  return parseStoredUsers()
}

export function getDevUsersForDisplay(bootstrapProfile) {
  const users = getDevUsers().map((user) => ({
    id: user.uid,
    ...stripPassword(user),
  }))

  if (!bootstrapProfile) {
    return users
  }

  return [
    {
      id: 'dev-hod-bootstrap',
      uid: 'dev-hod-bootstrap',
      name: bootstrapProfile.name,
      email: bootstrapProfile.email,
      department: bootstrapProfile.department,
      role: bootstrapProfile.role,
      status: bootstrapProfile.status,
      permissions: bootstrapProfile.permissions,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isBootstrap: true,
    },
    ...users,
  ]
}

export function findDevUserByCredentials(email, password) {
  return getDevUsers().find((user) => user.email === email && user.password === password && user.status === 'Active') || null
}

export function createDevUser(payload) {
  const users = getDevUsers()
  const normalizedEmail = payload.email.trim().toLowerCase()

  if (users.some((user) => user.email === normalizedEmail)) {
    throw new Error('A local development user with this email already exists.')
  }

  const timestamp = new Date().toISOString()
  const nextUser = {
    uid: `local-user-${Date.now()}`,
    name: payload.name.trim(),
    email: normalizedEmail,
    password: payload.password,
    department: payload.department,
    role: payload.role,
    status: payload.status,
    permissions: payload.permissions,
    createdAt: timestamp,
    updatedAt: timestamp,
    source: 'local-dev',
  }

  users.push(nextUser)
  persistUsers(users)

  return stripPassword(nextUser)
}

export function updateDevUser(payload) {
  const users = getDevUsers()
  const index = users.findIndex((user) => user.uid === payload.uid)

  if (index === -1) {
    throw new Error('Local development user not found.')
  }

  const normalizedEmail = payload.email.trim().toLowerCase()
  const duplicate = users.find((user) => user.uid !== payload.uid && user.email === normalizedEmail)
  if (duplicate) {
    throw new Error('Another local development user already uses this email.')
  }

  const updatedUser = {
    ...users[index],
    name: payload.name.trim(),
    email: normalizedEmail,
    department: payload.department,
    role: payload.role,
    status: payload.status,
    permissions: payload.permissions,
    updatedAt: new Date().toISOString(),
  }

  users[index] = updatedUser
  persistUsers(users)

  return stripPassword(updatedUser)
}
