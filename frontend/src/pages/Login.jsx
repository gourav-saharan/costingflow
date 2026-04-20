import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, LockKeyhole, ShieldCheck } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getRoleHome } from '../lib/constants'

export default function Login() {
  const navigate = useNavigate()
  const { currentUser, profile, login } = useAuth()
  const [form, setForm] = useState({ email: '', password: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (currentUser && profile) {
      navigate(getRoleHome(profile.role), { replace: true })
    }
  }, [currentUser, navigate, profile])

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      await login(form.email, form.password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message || 'Login failed. Use a HOD-created account.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-hero">
          <span className="badge info">JK Tyre Internal Application</span>
          <h1>Secure tyre testing workflow</h1>
          <p>
            This system replaces Excel, email circulation and LNM follow-up with controlled role-based workflow.
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="brand-line">
            <div className="brand-icon">
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2>Sign in</h2>
              <p>Only pre-created users can access the portal.</p>
            </div>
          </div>

          {error ? (
            <div className="alert danger">
              <AlertTriangle size={18} />
              <span>{error}</span>
            </div>
          ) : null}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              placeholder="employee@jktyre.com"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="Enter password"
              required
            />
          </label>

          <button type="submit" className="button button-primary button-full" disabled={submitting}>
            <LockKeyhole size={16} />
            {submitting ? 'Signing in...' : 'Login'}
          </button>

          <div className="auth-note">
            <p>Public registration is disabled.</p>
            <p>Only HOD can create or enable user accounts.</p>
            <p>All workflow actions are audited and role controlled.</p>
          </div>
        </form>
      </div>
    </div>
  )
}
