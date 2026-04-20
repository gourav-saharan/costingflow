import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import TestRequests from './pages/TestRequests'
import Costing from './pages/Costing'
import Assignments from './pages/Assignments'
import EngineerTasks from './pages/EngineerTasks'
import ManagerReview from './pages/ManagerReview'
import UserManagement from './pages/UserManagement'
import SearchPage from './pages/Search'
import AuditLogs from './pages/AuditLogs'
import Settings from './pages/Settings'
import { ROLES, getRoleHome } from './lib/constants'
import './App.css'

function HomeRedirect() {
  const { profile } = useAuth()
  return <Navigate to={getRoleHome(profile?.role)} replace />
}

function Unauthorized() {
  return (
    <div className="center-screen">
      <div className="status-panel">
        <p className="eyebrow">Access Blocked</p>
        <h1>Unauthorized</h1>
        <p>Your current role does not allow this screen.</p>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/unauthorized" element={<Unauthorized />} />

          <Route
            element={(
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            )}
          >
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/requests" element={<TestRequests />} />
            <Route
              path="/costing"
              element={(
                <ProtectedRoute allowedRoles={[ROLES.HOD, ROLES.MANAGER, ROLES.CHIEF_MANAGER, ROLES.ENGINEER]}>
                  <Costing />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/assignments"
              element={(
                <ProtectedRoute allowedRoles={[ROLES.HOD, ROLES.MANAGER, ROLES.CHIEF_MANAGER]}>
                  <Assignments />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/tasks"
              element={(
                <ProtectedRoute allowedRoles={[ROLES.HOD, ROLES.ENGINEER]}>
                  <EngineerTasks />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/reviews"
              element={(
                <ProtectedRoute allowedRoles={[ROLES.HOD, ROLES.MANAGER, ROLES.CHIEF_MANAGER]}>
                  <ManagerReview />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/users"
              element={(
                <ProtectedRoute allowedRoles={[ROLES.HOD]}>
                  <UserManagement />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/audits"
              element={(
                <ProtectedRoute allowedRoles={[ROLES.HOD]}>
                  <AuditLogs />
                </ProtectedRoute>
              )}
            />
            <Route
              path="/settings"
              element={(
                <ProtectedRoute allowedRoles={[ROLES.HOD]}>
                  <Settings />
                </ProtectedRoute>
              )}
            />
            <Route path="/search" element={<SearchPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
