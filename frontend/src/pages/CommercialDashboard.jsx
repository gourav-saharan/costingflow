import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { db } from '../firebase'
import { BILLING_STATUS_OPTIONS, STATUS } from '../lib/constants'
import { formatCurrency, formatDateTime, sortByTimestamp } from '../lib/format'
import { workflowApi } from '../services/workflow'

export default function CommercialDashboard() {
  const [assignments, setAssignments] = useState([])
  const [selectedAssignment, setSelectedAssignment] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    billingStatus: BILLING_STATUS_OPTIONS[0],
    invoiceNumber: '',
    paymentReference: '',
    amount: 0,
    comment: '',
  })

  async function loadAssignments() {
    setLoading(true)
    try {
      const snapshot = await getDocs(collection(db, 'assignments'))
      const nextAssignments = sortByTimestamp(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))).filter(
        (assignment) => [STATUS.COMMERCIAL_PENDING, STATUS.CLOSED].includes(assignment.status),
      )
      setAssignments(nextAssignments)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAssignments()
  }, [])

  useEffect(() => {
    if (selectedAssignment) {
      setForm({
        billingStatus: selectedAssignment.billingStatus || BILLING_STATUS_OPTIONS[0],
        invoiceNumber: selectedAssignment.paymentDetails?.invoiceNumber || '',
        paymentReference: selectedAssignment.paymentDetails?.paymentReference || '',
        amount: selectedAssignment.paymentDetails?.amount || 0,
        comment: selectedAssignment.paymentDetails?.comment || '',
      })
    }
  }, [selectedAssignment])

  async function saveCommercial(markClosed) {
    if (!selectedAssignment) {
      return
    }

    setSaving(true)
    try {
      await workflowApi.updateCommercialRecord({
        assignmentId: selectedAssignment.id,
        ...form,
        markClosed,
      })
      toast.success(markClosed ? 'Workflow closed and costing locked.' : 'Commercial details updated.')
      await loadAssignments()
    } catch (error) {
      toast.error(error.message || 'Failed to update commercial record.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Commercial Processing"
        description="Billing, payment capture and final closure after manager approval."
      />

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Approved workflows</h3>
              <p>Commercial pending and recently closed records.</p>
            </div>
          </div>

          <div className="summary-list">
            {loading ? (
              <div className="empty-state">Loading commercial queue...</div>
            ) : assignments.length === 0 ? (
              <div className="empty-state">No records in commercial queue.</div>
            ) : (
              assignments.map((assignment) => (
                <button
                  type="button"
                  key={assignment.id}
                  className={`summary-row summary-row-button ${selectedAssignment?.id === assignment.id ? 'selected' : ''}`}
                  onClick={() => setSelectedAssignment(assignment)}
                >
                  <div>
                    <strong>{assignment.htacNumber}</strong>
                    <p>{assignment.projectId} / {assignment.testId}</p>
                    <small>{assignment.engineerName}</small>
                  </div>
                  <div className="summary-metric">
                    <small>{assignment.billingStatus || 'No billing update'}</small>
                    <StatusBadge status={assignment.status} />
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Billing details</h3>
              <p>Update payment details and close workflow when done.</p>
            </div>
          </div>

          {selectedAssignment ? (
            <div className="stack">
              <div className="info-card">
                <strong>{selectedAssignment.htacNumber}</strong>
                <p>{selectedAssignment.projectId} / {selectedAssignment.testId}</p>
                <p>Commercial amount: {formatCurrency(form.amount || 0)}</p>
                <small>Last update: {formatDateTime(selectedAssignment.updatedAt)}</small>
              </div>

              <label className="field">
                <span>Billing status</span>
                <select
                  value={form.billingStatus}
                  onChange={(event) => setForm((current) => ({ ...current, billingStatus: event.target.value }))}
                >
                  {BILLING_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
              </label>

              <div className="form-grid">
                <label className="field">
                  <span>Invoice number</span>
                  <input
                    value={form.invoiceNumber}
                    onChange={(event) => setForm((current) => ({ ...current, invoiceNumber: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>Payment reference</span>
                  <input
                    value={form.paymentReference}
                    onChange={(event) => setForm((current) => ({ ...current, paymentReference: event.target.value }))}
                  />
                </label>

                <label className="field">
                  <span>Amount</span>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(event) => setForm((current) => ({ ...current, amount: Number(event.target.value || 0) }))}
                  />
                </label>
              </div>

              <label className="field">
                <span>Commercial note</span>
                <textarea
                  value={form.comment}
                  onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))}
                  rows="4"
                />
              </label>

              <div className="button-row">
                <button type="button" className="button button-secondary" disabled={saving} onClick={() => saveCommercial(false)}>
                  Save billing
                </button>
                <button type="button" className="button button-primary" disabled={saving} onClick={() => saveCommercial(true)}>
                  Save and close
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a commercial record to update.</div>
          )}
        </section>
      </div>
    </div>
  )
}
