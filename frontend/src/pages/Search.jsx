import { useDeferredValue, useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { db } from '../firebase'
import { STATUS } from '../lib/constants'
import { formatCurrency, formatDateTime, sortByTimestamp, toDate } from '../lib/format'

export default function SearchPage() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [filters, setFilters] = useState({
    search: '',
    engineer: '',
    status: '',
    startDate: '',
    endDate: '',
  })

  const deferredSearch = useDeferredValue(filters.search)

  useEffect(() => {
    async function loadRecords() {
      setLoading(true)
      try {
        const snapshot = await getDocs(collection(db, 'costing'))
        setRecords(sortByTimestamp(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
      } finally {
        setLoading(false)
      }
    }

    loadRecords()
  }, [])

  const filteredRecords = records.filter((record) => {
    const searchText = deferredSearch.toLowerCase()
    const matchesSearch = !searchText
      || record.htacNumber?.toLowerCase().includes(searchText)
      || record.projectId?.toLowerCase().includes(searchText)
      || record.testId?.toLowerCase().includes(searchText)

    const matchesEngineer = !filters.engineer || (record.engineerName || '').toLowerCase().includes(filters.engineer.toLowerCase())
    const matchesStatus = !filters.status || record.status === filters.status

    const recordDate = toDate(record.updatedAt || record.createdAt)
    const matchesStartDate = !filters.startDate || (recordDate && recordDate >= new Date(filters.startDate))
    const matchesEndDate = !filters.endDate || (recordDate && recordDate <= new Date(`${filters.endDate}T23:59:59`))

    return matchesSearch && matchesEngineer && matchesStatus && matchesStartDate && matchesEndDate
  })

  return (
    <div className="page">
      <PageHeader
        title="Search and Reports"
        description="Search workflow history by HTAC, project, test, engineer, date and status."
      />

      <section className="panel">
        <div className="search-grid">
          <label className="field">
            <span>Search</span>
            <input
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="HTAC, Project ID, Test ID"
            />
          </label>

          <label className="field">
            <span>Engineer</span>
            <input
              value={filters.engineer}
              onChange={(event) => setFilters((current) => ({ ...current, engineer: event.target.value }))}
              placeholder="Engineer name"
            />
          </label>

          <label className="field">
            <span>Status</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="">All statuses</option>
              {Object.values(STATUS).map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Start date</span>
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
            />
          </label>

          <label className="field">
            <span>End date</span>
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
            />
          </label>
        </div>
      </section>

      <div className="grid-two">
        <section className="panel">
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th>HTAC</th>
                  <th>Project ID</th>
                  <th>Test ID</th>
                  <th>Engineer</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="5">Loading records...</td>
                  </tr>
                ) : filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan="5">No matching records.</td>
                  </tr>
                ) : (
                  filteredRecords.map((record) => (
                    <tr key={record.id} onClick={() => setSelectedRecord(record)} className="table-row-clickable">
                      <td>{record.htacNumber}</td>
                      <td>{record.projectId}</td>
                      <td>{record.testId}</td>
                      <td>{record.engineerName || 'Unassigned'}</td>
                      <td><StatusBadge status={record.status} /></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Detailed view</h3>
              <p>Selected record summary.</p>
            </div>
          </div>

          {selectedRecord ? (
            <div className="details-grid">
              <div><strong>HTAC</strong><span>{selectedRecord.htacNumber}</span></div>
              <div><strong>Project ID</strong><span>{selectedRecord.projectId}</span></div>
              <div><strong>Test ID</strong><span>{selectedRecord.testId}</span></div>
              <div><strong>Status</strong><span><StatusBadge status={selectedRecord.status} /></span></div>
              <div><strong>Engineer</strong><span>{selectedRecord.engineerName || 'Unassigned'}</span></div>
              <div><strong>Location</strong><span>{selectedRecord.location || 'NA'}</span></div>
              <div><strong>Total cost</strong><span>{formatCurrency(selectedRecord.totalCost)}</span></div>
              <div><strong>Version</strong><span>{selectedRecord.currentVersion}</span></div>
              <div><strong>Updated</strong><span>{formatDateTime(selectedRecord.updatedAt)}</span></div>
              <div><strong>Billing status</strong><span>{selectedRecord.billingStatus || 'NA'}</span></div>
            </div>
          ) : (
            <div className="empty-state">Select a record from the list.</div>
          )}
        </section>
      </div>
    </div>
  )
}
