import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { hasPermission } from '../lib/permissions'

export default function ProtectedRoute({ children, allowedRoles, permission }) {
  const { currentUser, profile, loading } = useAuth()

  if (loading) {
    return <div className="center-screen">Loading secure workspace...</div>
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  if (!profile) {
    return <Navigate to="/unauthorized" replace />
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/unauthorized" replace />
  }

  if (permission && !hasPermission(profile, permission)) {
    return <Navigate to="/unauthorized" replace />
  }

  return children
}
