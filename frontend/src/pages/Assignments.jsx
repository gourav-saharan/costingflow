import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { db } from '../firebase'
import { LOCATION_OPTIONS, STATUS } from '../lib/constants'
import { formatDateTime, sortByTimestamp } from '../lib/format'
import { workflowApi } from '../services/workflow'

export default function Assignments() {
  const [costings, setCostings] = useState([])
  const [engineers, setEngineers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedCosting, setSelectedCosting] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({
    engineerUid: '',
    location: LOCATION_OPTIONS[0],
    deadline: '',
  })

  async function loadData() {
    setLoading(true)
    try {
      const [costingSnapshot, userSnapshot, assignmentSnapshot] = await Promise.all([
        getDocs(collection(db, 'costing')),
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'assignments')),
      ])

      setCostings(
        sortByTimestamp(costingSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))).filter(
          (item) => item.status === STATUS.COSTING_INITIATED && !item.locked,
        ),
      )
      setEngineers(
        userSnapshot.docs
          .map((item) => ({ id: item.id, ...item.data() }))
          .filter((item) => item.role === 'Engineer' && item.status === 'Active'),
      )
      setAssignments(sortByTimestamp(assignmentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!selectedCosting) {
      return
    }

    setSubmitting(true)
    try {
      await workflowApi.assignTest({
        costingId: selectedCosting.id,
        engineerUid: form.engineerUid,
        location: form.location,
        deadline: form.deadline,
      })
      toast.success('Engineer assigned successfully.')
      setSelectedCosting(null)
      setForm({ engineerUid: '', location: LOCATION_OPTIONS[0], deadline: '' })
      await loadData()
    } catch (error) {
      toast.error(error.message || 'Failed to assign task.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Assignments"
        description="Manager and chief manager can assign engineers, location and deadlines after costing."
      />

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Costings ready for assignment</h3>
              <p>Only costing-initiated records appear here.</p>
            </div>
          </div>

          <div className="summary-list">
            {loading ? (
              <div className="empty-state">Loading costings...</div>
            ) : costings.length === 0 ? (
              <div className="empty-state">No costings are waiting for assignment.</div>
            ) : (
              costings.map((costing) => (
                <button
                  type="button"
                  key={costing.id}
                  className={`summary-row summary-row-button ${selectedCosting?.id === costing.id ? 'selected' : ''}`}
                  onClick={() => setSelectedCosting(costing)}
                >
                  <div>
                    <strong>{costing.htacNumber}</strong>
                    <p>{costing.projectId} / {costing.testId}</p>
                    <small>{formatDateTime(costing.updatedAt)}</small>
                  </div>
                  <div className="summary-metric">
                    <StatusBadge status={costing.status} />
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Assign engineer</h3>
              <p>Set execution owner, location and deadline.</p>
            </div>
          </div>

          {selectedCosting ? (
            <form className="stack" onSubmit={handleSubmit}>
              <div className="info-card">
                <strong>{selectedCosting.htacNumber}</strong>
                <p>{selectedCosting.projectId} / {selectedCosting.testId}</p>
              </div>

              <label className="field">
                <span>Engineer</span>
                <select
                  value={form.engineerUid}
                  onChange={(event) => setForm((current) => ({ ...current, engineerUid: event.target.value }))}
                  required
                >
                  <option value="">Select engineer</option>
                  {engineers.map((engineer) => (
                    <option key={engineer.id} value={engineer.id}>
                      {engineer.name} ({engineer.email})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Location</span>
                <select
                  value={form.location}
                  onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
                >
                  {LOCATION_OPTIONS.map((location) => (
                    <option key={location} value={location}>{location}</option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Deadline</span>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(event) => setForm((current) => ({ ...current, deadline: event.target.value }))}
                  required
                />
              </label>

              <button type="submit" className="button button-primary" disabled={submitting}>
                {submitting ? 'Assigning...' : 'Confirm assignment'}
              </button>
            </form>
          ) : (
            <div className="empty-state">Select a costing record to assign.</div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Assignment register</h3>
            <p>Current execution ownership across teams.</p>
          </div>
        </div>

        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>HTAC</th>
                <th>Engineer</th>
                <th>Location</th>
                <th>Deadline</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {assignments.length === 0 ? (
                <tr>
                  <td colSpan="5">No assignments yet.</td>
                </tr>
              ) : (
                assignments.map((assignment) => (
                  <tr key={assignment.id}>
                    <td>{assignment.htacNumber}</td>
                    <td>{assignment.engineerName}</td>
                    <td>{assignment.location}</td>
                    <td>{assignment.deadline}</td>
                    <td><StatusBadge status={assignment.status} /></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
