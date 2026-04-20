import { useState } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useAuth } from '../contexts/AuthContext'
import { Search, Bell, HelpCircle, LogOut } from 'lucide-react'

export default function Layout() {
  const { profile, logout } = useAuth()
  const navigate = useNavigate()
  const [isCollapsed, setIsCollapsed] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <div className={`app-shell ${isCollapsed ? 'collapsed' : ''}`}>
      <Sidebar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />
      <div className="content-shell">
        <header className="topbar">
          <div className="topbar-search">
            <Search size={16} />
            <input type="text" placeholder="Global system search..." />
          </div>
          <div className="topbar-meta">
            <div className="topbar-icon">
              <Bell size={20} />
            </div>
            <div className="topbar-icon">
              <HelpCircle size={20} />
            </div>
            <div className="user-snippet">
              <div className="profile-avatar" style={{ width: 32, height: 32 }}>
                {profile?.name?.slice(0, 1) || 'U'}
              </div>
              <div className="topbar-icon" onClick={handleLogout} title="Logout" style={{ marginLeft: '4px' }}>
                <LogOut size={18} />
              </div>
            </div>
          </div>
        </header>
        <main className="page-shell">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
