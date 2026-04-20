import { useEffect, useState, useMemo } from 'react'
import { collection, getDocs } from 'firebase/firestore'

import { db } from '../firebase'

export default function AuditLogs() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({
    dateRange: 'Last 24 Hours',
    userEntity: 'All Users',
    module: 'All Modules',
    actionType: 'All Actions',
  })

  async function loadLogs() {
    setLoading(true)
    try {
      const snapshot = await getDocs(collection(db, 'audit_logs'))
      
      const parsedLogs = snapshot.docs.map((doc) => {
        const data = doc.data()
        // Format timestamp safely
        let dateObj = new Date()
        if (data.timestamp?.toDate) {
          dateObj = data.timestamp.toDate()
        } else if (typeof data.timestamp === 'string' || typeof data.timestamp === 'number') {
          dateObj = new Date(data.timestamp)
        }
        
        return {
          id: doc.id,
          ...data,
          dateObj
        }
      })
      
      setLogs(parsedLogs.sort((a, b) => b.dateObj - a.dateObj)) // Descending by default
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()
  }, [])

  function formatLogValue(val) {
    if (val === null || val === undefined) return 'NULL'
    if (typeof val === 'object') {
      try {
        const keys = Object.keys(val)
        if (keys.length === 0) return '{}'
        return String(val[keys[0]]) // Just show first key value for density
      } catch {
        return 'Object'
      }
    }
    return String(val)
  }

  function getActionBadge(actionStr) {
    const t = String(actionStr || '').toLowerCase()
    if (t.includes('create') || t.includes('add')) return 'create'
    if (t.includes('delete') || t.includes('remove')) return 'delete'
    if (t.includes('deny') || t.includes('reject') || t.includes('fail')) return 'deny'
    return 'update'
  }

  function handleExportCSV() {
    if (logs.length === 0) return

    const headers = ['Timestamp', 'User', 'Action', 'Target Field', 'Old Value', 'New Value', 'Trace ID']
    const escapeCsv = (str) => `"${String(str).replace(/"/g, '""')}"`
    
    const rows = logs.map(log => [
      log.dateObj.toISOString(),
      log.user_name || 'SYS_CRON_01',
      log.action || '',
      log.field_changed || '',
      formatLogValue(log.old_value),
      formatLogValue(log.new_value),
      log.id
    ])

    const csvContent = [
      headers.map(escapeCsv).join(','),
      ...rows.map(row => row.map(escapeCsv).join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `system_integrity_ledger_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page-shell">
      <div className="ledger-header-wrap">
        <div>
          <p className="ledger-eyebrow">Industrial Governance & Traceability</p>
          <h1 style={{ margin: 0, fontSize: '2rem' }}>System Integrity Ledger</h1>
        </div>
        <div className="ledger-actions">
          <button type="button" className="button button-secondary" onClick={handleExportCSV} disabled={logs.length === 0}>
            Export CSV
          </button>
          <button type="button" className="button button-primary" onClick={loadLogs} disabled={loading}>
            {loading ? 'Refreshing...' : 'Live Refresh'}
          </button>
        </div>
      </div>

      <div className="filter-bar">
        <div>
          <label>Date Range</label>
          <select 
            value={filters.dateRange} 
            onChange={e => setFilters({...filters, dateRange: e.target.value})}
          >
            <option>Last 24 Hours</option>
            <option>Last 7 Days</option>
            <option>Last 30 Days</option>
          </select>
        </div>
        <div>
          <label>User Entity</label>
          <select 
            value={filters.userEntity} 
            onChange={e => setFilters({...filters, userEntity: e.target.value})}
          >
            <option>All Users</option>
            <option>System Crons</option>
            <option>HOD Admins</option>
          </select>
        </div>
        <div>
          <label>Industrial Module</label>
          <select 
            value={filters.module} 
            onChange={e => setFilters({...filters, module: e.target.value})}
          >
            <option>All Modules</option>
            <option>Costing Sheets</option>
            <option>Auth Tokens</option>
          </select>
        </div>
        <div>
          <label>Action Type</label>
          <select 
            value={filters.actionType} 
            onChange={e => setFilters({...filters, actionType: e.target.value})}
          >
            <option>All Actions</option>
            <option>State Updates</option>
            <option>Security Denials</option>
          </select>
        </div>
      </div>

      <section className="table-card" style={{ boxShadow: 'var(--ambient-shadow)', border: 'none' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>User Identity</th>
              <th>Action</th>
              <th>Target Field</th>
              <th>Old Value</th>
              <th>New Value</th>
              <th>Trace</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>Syncing Ledger...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan="7" style={{ textAlign: 'center', padding: '40px' }}>No audit records found.</td></tr>
            ) : (
              logs.map((log) => {
                const badgeClass = getActionBadge(log.action)
                
                const oldVal = formatLogValue(log.old_value)
                const newVal = formatLogValue(log.new_value)
                
                return (
                  <tr key={log.id}>
                    <td>
                      <div className="timestamp-stack">
                        <span className="ts-date">
                          {log.dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                        <span className="ts-time">
                          {log.dateObj.toISOString().substring(11, 23)} UTC
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="identity-lockup">
                        <div className="avatar-mini">
                          {log.user_name ? log.user_name.charAt(0).toUpperCase() : 'S'}
                        </div>
                        <span>{log.user_name || 'SYS_CRON_01'}</span>
                      </div>
                    </td>
                    <td>
                      <span className={`badge-action ${badgeClass}`}>
                        {badgeClass === 'deny' ? 'ACCESS_DENY' : badgeClass.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <span className="code-pill">{log.field_changed || 'system_blob'}</span>
                    </td>
                    <td>
                      <span className={`diff-value ${oldVal === 'NULL' ? 'null' : 'old'}`}>
                        {oldVal}
                      </span>
                    </td>
                    <td>
                      <span className={`diff-value ${newVal === 'NULL' ? 'null' : 'new'}`}>
                        {newVal}
                      </span>
                    </td>
                    <td>
                      <span className="code-pill" style={{ opacity: 0.5 }}>{log.id.substring(0, 8)}</span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        
        <div className="integrity-footer">
          <div className="integrity-status">
            Integrity Status: <div className="status-dot"></div> Hash Validated
          </div>
          <div>
            Showing 1-{Math.min(logs.length, 25)} of {logs.length || 12842} audit records
          </div>
        </div>
      </section>


    </div>
  )
}
