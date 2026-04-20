import { NavLink, useNavigate } from 'react-router-dom'
import {
  ClipboardList,
  DollarSign,
  FileCheck,
  FileText,
  LayoutDashboard,
  Search,
  Shield,
  Users,
  Wrench,
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  canAccessAudits,
  canApproveReports,
  canEditCosting,
  canManageAssignments,
  canManageUsers,
} from '../lib/permissions'

export default function Sidebar({ isCollapsed, setIsCollapsed }) {
  const navigate = useNavigate()
  const { logout, profile } = useAuth()

  const items = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, visible: true },
    { label: 'Search', path: '/search', icon: Search, visible: true },
    { label: 'Test Requests', path: '/requests', icon: FileText, visible: true },
    { label: 'Costing', path: '/costing', icon: DollarSign, visible: canEditCosting(profile) },
    { label: 'Assignments', path: '/assignments', icon: ClipboardList, visible: canManageAssignments(profile) },
    { label: 'Engineer Tasks', path: '/tasks', icon: Wrench, visible: profile?.role === 'Engineer' || profile?.role === 'HOD' },
    { label: 'Manager Review', path: '/reviews', icon: FileCheck, visible: canApproveReports(profile) },
    { label: 'Users', path: '/users', icon: Users, visible: canManageUsers(profile) },
    { label: 'Audit Logs', path: '/audits', icon: Shield, visible: canAccessAudits(profile) },
    { label: 'Settings', path: '/settings', icon: Settings, visible: profile?.role === 'HOD' },
  ]

  return (
    <aside className="sidebar" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1 }}>
        <div className="brand-block" style={{ display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '24px 0' : '24px 32px' }}>
          {isCollapsed ? (
            <h1 style={{ fontSize: '1.2rem', margin: 0 }}>TF</h1>
          ) : (
            <div>
              <h1>TyreFlow</h1>
              <p className="eyebrow">Industrial Testing</p>
            </div>
          )}
        </div>

        <nav className="nav-list">
          {items.filter((item) => item.visible).map((item) => {
            const Icon = item.icon

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                style={{ 
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  padding: isCollapsed ? '12px 0' : '10px 32px'
                }}
                title={isCollapsed ? item.label : undefined}
              >
                <Icon size={18} />
                {!isCollapsed && <span>{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>
      </div>

      <div>
        <div className="sidebar-footer" style={{ padding: isCollapsed ? '24px 12px' : '24px 32px' }}>
          <button 
            type="button" 
            className="button button-primary button-full" 
            onClick={() => navigate('/requests')}
            style={{ padding: isCollapsed ? '12px 0' : '14px', fontSize: '0.8rem', display: 'flex', justifyContent: 'center' }}
            title={isCollapsed ? 'New Test Request' : undefined}
          >
            {isCollapsed ? <Plus size={18} /> : 'NEW TEST REQUEST'}
          </button>
        </div>
        <div style={{ padding: '16px', display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-end', borderTop: '1px solid var(--line-strong)' }}>
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
             {isCollapsed ? <ChevronRight size={18} color="var(--muted)" /> : <ChevronLeft size={18} color="var(--muted)" />}
          </button>
        </div>
      </div>
    </aside>
  )
}
