import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { CheckCircle2, ChevronRight, Lock, Bell, Globe, LayoutTemplate, ShieldCheck, XCircle } from 'lucide-react'
import { db } from '../firebase'
import PageHeader from '../components/PageHeader'
import toast from 'react-hot-toast'

export default function Settings() {
  const [activeTab, setActiveTab] = useState('global')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [config, setConfig] = useState({
    global: {
      ipRange: '10.124.0.0/16',
      sessionTimeout: '30 Minutes (Recommended)',
      autoLogoutBlur: true
    },
    auth: {
      mfaRequired: true,
      minPasswordLength: '12',
      resetIntervalDays: '90',
      requireSpecialChars: true
    },
    notifications: {
      testRequests: { email: true, popup: true },
      budgetApprovals: { email: true, sms: false },
      digestFrequency: 'Daily'
    }
  })

  // We keep role templates statically defined for visual representation unless actual dynamic role mapping is needed.
  // The mockup implies a visual status chart for templates.
  const roleTemplates = [
    { name: 'VDD Engineer', dashboard: true, execution: true, approval: false },
    { name: 'Manager (R&D)', dashboard: true, execution: true, approval: true },
    { name: 'PDC Lead', dashboard: true, execution: false, approval: true },
    { name: 'HOD Precision', dashboard: true, execution: true, approval: true },
  ]

  useEffect(() => {
    async function fetchSettings() {
      try {
        const snap = await getDoc(doc(db, 'system', 'security_config'))
        if (snap.exists()) {
          setConfig(snap.data())
        }
      } catch (err) {
        console.error('Failed to load settings:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchSettings()
  }, [])

  function updateConfig(section, field, value) {
    setConfig(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [field]: value
      }
    }))
    setIsDirty(true)
  }

  function updateNestedConfig(section, subSection, field, value) {
    setConfig(prev => ({
      ...prev,
      [section]: {
        ...prev[section],
        [subSection]: {
          ...prev[section][subSection],
          [field]: value
        }
      }
    }))
    setIsDirty(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await setDoc(doc(db, 'system', 'security_config'), config)
      toast.success('Enterprise security protocols updated & enforced.')
      setIsDirty(false)
    } catch (err) {
      console.error(err)
      toast.error('Failed to enforce security policy.')
    } finally {
      setSaving(false)
    }
  }

  function discardChanges() {
    window.location.reload()
  }

  if (loading) {
    return <div className="page-shell">Loading securely...</div>
  }

  return (
    <div className="page-shell">
      <PageHeader 
        title="Access & Security Settings"
        description="Configure enterprise-grade security protocols, define organizational hierarchies, and manage internal JK Tyre network restrictions."
      />

      <div className="settings-layout" style={{ marginTop: '32px' }}>
        
        {/* LEFT NAV BAR */}
        <div>
          <nav className="settings-nav">
            <div 
              className={`settings-nav-item ${activeTab === 'global' ? 'active' : ''}`}
              onClick={() => setActiveTab('global')}
            >
              <Globe size={18} /> Global Access <ChevronRight size={16} style={{ marginLeft: 'auto', opacity: activeTab === 'global' ? 1 : 0 }}/>
            </div>
            <div 
              className={`settings-nav-item ${activeTab === 'templates' ? 'active' : ''}`}
              onClick={() => setActiveTab('templates')}
            >
              <LayoutTemplate size={18} /> Role Templates <ChevronRight size={16} style={{ marginLeft: 'auto', opacity: activeTab === 'templates' ? 1 : 0 }}/>
            </div>
            <div 
              className={`settings-nav-item ${activeTab === 'auth' ? 'active' : ''}`}
              onClick={() => setActiveTab('auth')}
            >
              <Lock size={18} /> Authentication <ChevronRight size={16} style={{ marginLeft: 'auto', opacity: activeTab === 'auth' ? 1 : 0 }}/>
            </div>
            <div 
              className={`settings-nav-item ${activeTab === 'alerts' ? 'active' : ''}`}
              onClick={() => setActiveTab('alerts')}
            >
              <Bell size={18} /> Notifications <ChevronRight size={16} style={{ marginLeft: 'auto', opacity: activeTab === 'alerts' ? 1 : 0 }}/>
            </div>
          </nav>

          <div style={{ marginTop: '32px', background: '#E6EFFF', padding: '20px', borderRadius: '8px' }}>
            <h4 style={{ color: '#004AC6', fontSize: '0.85rem', margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              System Status
            </h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.05em', color: '#006F67', marginBottom: '12px' }}>
              <span style={{ width: '8px', height: '8px', background: '#00A389', borderRadius: '50%' }}></span> ALL SHIELDS ACTIVE
            </div>
            <p style={{ fontSize: '0.75rem', color: '#434655', lineHeight: 1.5, margin: 0 }}>
              Last security audit completed 14 hours ago. No breaches detected within the JK Tyre internal network range.
            </p>
          </div>
        </div>

        {/* MAIN CONTENT AREA */}
        <div className="settings-content-grid">
          
          {/* GLOBAL ACCESS */}
          <section className="panel" style={{ border: 'none', boxShadow: 'var(--ambient-shadow)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', margin: '0 0 4px' }}>Global Access Settings</h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: 0 }}>Manage network-level entry and session persistence.</p>
              </div>
              <span className="badge-action" style={{ background: '#99EFE5', color: '#006F67' }}>ENFORCED</span>
            </div>

            <div className="grid-two">
              <div className="field">
                <label>Internal IP Range Restrictions (JK Tyre)</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input type="text" value={config.global.ipRange} onChange={e => updateConfig('global', 'ipRange', e.target.value)} />
                  <button className="button" style={{ background: '#E2E8F0', padding: '10px' }}><XCircle size={16} color="#4A5568" /></button>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
                  <input type="text" placeholder="Add new IP CIDR block..." style={{ background: 'var(--surface-low)', border: 'none' }} />
                  <button className="button button-primary" style={{ padding: '10px' }}>+</button>
                </div>
                <p style={{ fontSize: '0.65rem', color: 'var(--muted)', marginTop: '8px' }}>Only traffic originating from these ranges can access the Production Engine.</p>
              </div>

              <div className="field">
                <label>Session Timeout Management</label>
                <select value={config.global.sessionTimeout} onChange={e => updateConfig('global', 'sessionTimeout', e.target.value)}>
                  <option>15 Minutes</option>
                  <option>30 Minutes (Recommended)</option>
                  <option>1 Hour</option>
                  <option>12 Hours</option>
                </select>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '20px' }}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={config.global.autoLogoutBlur} onChange={e => updateConfig('global', 'autoLogoutBlur', e.target.checked)}/>
                    <span className="toggle-slider"></span>
                  </label>
                  <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Automatic logout on window blur</span>
                </div>
              </div>
            </div>
          </section>

          {/* ROLE TEMPLATES */}
          <section className="panel" style={{ border: 'none', boxShadow: 'var(--ambient-shadow)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
              <div>
                <h2 style={{ fontSize: '1.1rem', margin: '0 0 4px' }}>Role Permission Templates</h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--muted)', margin: 0 }}>Define functional access levels for testing workflows.</p>
              </div>
              <button className="button" style={{ color: 'var(--primary)', background: 'transparent', padding: 0 }}>+ Create Template</button>
            </div>

            <div className="table-card" style={{ boxShadow: 'none' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Role Name</th>
                    <th style={{ textAlign: 'center' }}>Dashboard Access</th>
                    <th style={{ textAlign: 'center' }}>Test Execution</th>
                    <th style={{ textAlign: 'center' }}>Approval Authority</th>
                  </tr>
                </thead>
                <tbody>
                  {roleTemplates.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.name}</td>
                      <td style={{ textAlign: 'center' }}>{r.dashboard ? <CheckCircle2 color="#00A389" size={20} /> : <XCircle color="#CBD5E1" size={20} />}</td>
                      <td style={{ textAlign: 'center' }}>{r.execution ? <CheckCircle2 color="#00A389" size={20} /> : <XCircle color="#CBD5E1" size={20} />}</td>
                      <td style={{ textAlign: 'center' }}>{r.approval ? <CheckCircle2 color="#00A389" size={20} /> : <XCircle color="#CBD5E1" size={20} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* TWO COL BOTTOM */}
          <div className="grid-two" style={{ alignItems: 'start' }}>
            
            {/* AUTH */}
            <section className="panel" style={{ border: 'none', boxShadow: 'var(--ambient-shadow)' }}>
              <h2 style={{ fontSize: '1.1rem', margin: '0 0 24px' }}>User Authentication</h2>
              
              <div style={{ background: 'var(--surface-low)', padding: '16px', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <div>
                  <strong style={{ display: 'block', fontSize: '0.85rem' }}>Multi-Factor Auth (MFA)</strong>
                  <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Require OTP via Microsoft Authenticator</span>
                </div>
                <label className="toggle-switch">
                  <input type="checkbox" checked={config.auth.mfaRequired} onChange={e => updateConfig('auth', 'mfaRequired', e.target.checked)}/>
                  <span className="toggle-slider"></span>
                </label>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em' }}>Password Policy</span>
              </div>
              <div className="grid-two" style={{ marginBottom: '16px' }}>
                <div className="field">
                  <label style={{ fontSize: '0.65rem', color: 'var(--text)' }}>Min. Characters</label>
                  <input type="number" style={{ background: 'var(--surface-low)', border: 'none' }} value={config.auth.minPasswordLength} onChange={e => updateConfig('auth', 'minPasswordLength', e.target.value)} />
                </div>
                <div className="field">
                  <label style={{ fontSize: '0.65rem', color: 'var(--text)' }}>Reset Interval (Days)</label>
                  <input type="number" style={{ background: 'var(--surface-low)', border: 'none' }} value={config.auth.resetIntervalDays} onChange={e => updateConfig('auth', 'resetIntervalDays', e.target.value)} />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={config.auth.requireSpecialChars} onChange={e => updateConfig('auth', 'requireSpecialChars', e.target.checked)} /> Require special characters & numerals
              </label>
            </section>

            {/* NOTIFICATIONS */}
            <section className="panel" style={{ border: 'none', boxShadow: 'var(--ambient-shadow)', borderLeft: '4px solid var(--primary-container)', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}>
              <h2 style={{ fontSize: '1.1rem', margin: '0 0 24px' }}>Notification Alerts</h2>
              
              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '0.9rem' }}>Test Requests</strong>
                  <span className="badge-action" style={{ background: 'var(--surface-dim)', color: 'var(--primary-container)' }}>CRITICAL</span>
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}><input type="checkbox" checked={config.notifications.testRequests.email} onChange={e => updateNestedConfig('notifications', 'testRequests', 'email', e.target.checked)} /> Email</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}><input type="checkbox" checked={config.notifications.testRequests.popup} onChange={e => updateNestedConfig('notifications', 'testRequests', 'popup', e.target.checked)}/> System Popup</label>
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <strong style={{ fontSize: '0.9rem' }}>Budget Approvals</strong>
                  <span className="badge-action" style={{ background: '#FEEBC8', color: '#DD6B20' }}>WORKFLOW</span>
                </div>
                <div style={{ display: 'flex', gap: '16px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}><input type="checkbox" checked={config.notifications.budgetApprovals.email} onChange={e => updateNestedConfig('notifications', 'budgetApprovals', 'email', e.target.checked)} /> Email</label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem' }}><input type="checkbox" checked={config.notifications.budgetApprovals.sms} onChange={e => updateNestedConfig('notifications', 'budgetApprovals', 'sms', e.target.checked)} /> SMS Alert</label>
                </div>
              </div>

              <div style={{ background: 'var(--surface-low)', padding: '16px', borderRadius: '8px' }}>
                <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em', display: 'block', marginBottom: '12px' }}>Digest Frequency</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="button" style={{ flex: 1, background: config.notifications.digestFrequency === 'Daily' ? '#fff' : 'transparent', color: 'var(--text)', boxShadow: config.notifications.digestFrequency === 'Daily' ? 'var(--ambient-shadow)' : 'none' }} onClick={() => updateConfig('notifications', 'digestFrequency', 'Daily')}>Daily</button>
                  <button className="button" style={{ flex: 1, background: config.notifications.digestFrequency === 'Weekly' ? '#fff' : 'transparent', color: 'var(--muted)', boxShadow: config.notifications.digestFrequency === 'Weekly' ? 'var(--ambient-shadow)' : 'none' }} onClick={() => updateConfig('notifications', 'digestFrequency', 'Weekly')}>Weekly</button>
                  <button className="button" style={{ flex: 1, background: config.notifications.digestFrequency === 'None' ? '#fff' : 'transparent', color: 'var(--muted)', boxShadow: config.notifications.digestFrequency === 'None' ? 'var(--ambient-shadow)' : 'none' }} onClick={() => updateConfig('notifications', 'digestFrequency', 'None')}>None</button>
                </div>
              </div>

            </section>

          </div>
        </div>
      </div>

      {/* FLOATING ACTION DOCK */}
      {isDirty && (
        <div className="floating-save-dock">
          <div className="dock-text">
            <ShieldCheck size={20} color="#00A389" />
            Any changes made will require a system-wide security token re-validation for all active engineers.
          </div>
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <button className="button" style={{ background: 'transparent', color: 'rgba(255,255,255,0.8)' }} onClick={discardChanges}>Discard</button>
            <button className="button button-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Enforcing...' : 'Save Security Config'}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
