import { useCallback, useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../firebase'
import {
  DEPARTMENT_OPTIONS,
  PERMISSION_OPTIONS,
  ROLE_OPTIONS,
  getDefaultPermissions,
} from '../lib/constants'
import { formatDateTime, sortByTimestamp } from '../lib/format'
import { createDevUser, getDevUsersForDisplay, updateDevUser } from '../services/devUsers'
import { workflowApi } from '../services/workflow'

const ENABLE_LOCAL_DEV_AUTH = import.meta.env.VITE_ENABLE_LOCAL_DEV_AUTH === 'true'

function buildForm(user) {
  if (user) {
    return {
      uid: user.id,
      name: user.name || '',
      email: user.email || '',
      password: '',
      department: user.department || 'VDD',
      role: user.role || 'Engineer',
      status: user.status || 'Active',
      permissions: {
        ...getDefaultPermissions(user.role || 'Engineer', user.department || 'VDD'),
        ...(user.permissions || {}),
      },
    }
  }

  return {
    uid: '',
    name: '',
    email: '',
    password: '',
    department: 'VDD',
    role: 'Engineer',
    status: 'Active',
    permissions: getDefaultPermissions('Engineer', 'VDD'),
  }
}

export default function UserManagement() {
  const { currentUser, profile } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [form, setForm] = useState(buildForm())
  const isLocalDevMode = ENABLE_LOCAL_DEV_AUTH && Boolean(currentUser?.isBootstrap || currentUser?.isLocalUser)

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      if (isLocalDevMode) {
        setUsers(sortByTimestamp(getDevUsersForDisplay(profile), 'updatedAt'))
        return
      }

      const snapshot = await getDocs(collection(db, 'users'))
      setUsers(sortByTimestamp(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), 'updatedAt'))
    } finally {
      setLoading(false)
    }
  }, [isLocalDevMode, profile])

  useEffect(() => {
    loadUsers()
  }, [loadUsers, currentUser?.uid])

  function openCreateModal() {
    setEditingUser(null)
    setForm(buildForm())
    setIsModalOpen(true)
  }

  function openEditModal(user) {
    setEditingUser(user)
    setForm(buildForm(user))
    setIsModalOpen(true)
  }

  function updatePermission(key, value) {
    setForm((current) => ({
      ...current,
      permissions: {
        ...current.permissions,
        [key]: value,
      },
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)

    try {
      if (isLocalDevMode) {
        if (editingUser) {
          updateDevUser({
            uid: form.uid,
            name: form.name,
            email: form.email,
            department: form.department,
            role: form.role,
            status: form.status,
            permissions: form.permissions,
          })
          toast.success('Local development user updated.')
        } else {
          createDevUser({
            name: form.name,
            email: form.email,
            password: form.password,
            department: form.department,
            role: form.role,
            status: form.status,
            permissions: form.permissions,
          })
          toast.success('Local development user created.')
        }
      } else if (editingUser) {
        await workflowApi.updateUserAccess({
          uid: form.uid,
          name: form.name,
          email: form.email,
          department: form.department,
          role: form.role,
          status: form.status,
          permissions: form.permissions,
        })
        toast.success('User access updated.')
      } else {
        await workflowApi.createUser({
          name: form.name,
          email: form.email,
          password: form.password,
          department: form.department,
          role: form.role,
          status: form.status,
          permissions: form.permissions,
        })
        toast.success('User created successfully.')
      }

      setIsModalOpen(false)
      await loadUsers()
    } catch (error) {
      toast.error(error.message || 'Failed to save user.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="User Management"
        description={isLocalDevMode
          ? 'Local development mode. Users created here are stored only in this browser for testing.'
          : 'Only HOD can create, enable, disable and permission users.'}
        actions={(
          <button type="button" className="button button-primary" onClick={openCreateModal}>
            Create user
          </button>
        )}
      />

      <section className="panel">
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Department</th>
                <th>Role</th>
                <th>Status</th>
                <th>Updated</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="7">Loading users...</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan="7">No users found.</td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>{user.department}</td>
                    <td>{user.role}</td>
                    <td><StatusBadge status={user.status} /></td>
                    <td>{formatDateTime(user.updatedAt || user.createdAt)}</td>
                    <td>
                      {user.isBootstrap ? (
                        <span className="text-muted">Bootstrap</span>
                      ) : (
                        <button type="button" className="button button-secondary" onClick={() => openEditModal(user)}>
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card">
            <div className="panel-header">
              <div>
                <h3>{editingUser ? 'Edit user access' : 'Create new user'}</h3>
                <p>Role-based access and permission toggles are applied here.</p>
              </div>
            </div>

            <form className="stack" onSubmit={handleSubmit}>
              <div className="form-grid">
                <label className="field">
                  <span>Name</span>
                  <input
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    required
                  />
                </label>

                <label className="field">
                  <span>Email</span>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    required
                  />
                </label>

                {!editingUser ? (
                  <label className="field">
                    <span>Temporary password</span>
                    <input
                      type="password"
                      value={form.password}
                      onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                      required
                    />
                  </label>
                ) : null}

                <label className="field">
                  <span>Department</span>
                  <select
                    value={form.department}
                    onChange={(event) => {
                      const department = event.target.value
                      setForm((current) => ({
                        ...current,
                        department,
                        permissions: getDefaultPermissions(current.role, department),
                      }))
                    }}
                  >
                    {DEPARTMENT_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Role</span>
                  <select
                    value={form.role}
                    onChange={(event) => {
                      const role = event.target.value
                      setForm((current) => ({
                        ...current,
                        role,
                        permissions: getDefaultPermissions(role, current.department),
                      }))
                    }}
                  >
                    {ROLE_OPTIONS.map((item) => (
                      <option key={item.value} value={item.value}>{item.label}</option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Status</span>
                  <select
                    value={form.status}
                    onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}
                  >
                    <option value="Active">Active</option>
                    <option value="Disabled">Disabled</option>
                  </select>
                </label>
              </div>

              <div className="checkbox-grid">
                {PERMISSION_OPTIONS.map((permission) => (
                  <label key={permission.key} className="checkbox-card">
                    <input
                      type="checkbox"
                      checked={Boolean(form.permissions[permission.key])}
                      onChange={(event) => updatePermission(permission.key, event.target.checked)}
                    />
                    <span>{permission.label}</span>
                  </label>
                ))}
              </div>

              <div className="button-row">
                <button type="button" className="button button-secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="button button-primary" disabled={submitting}>
                  {submitting ? 'Saving...' : editingUser ? 'Update user' : 'Create user'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
