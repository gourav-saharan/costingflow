import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { db } from '../firebase'
import { STATUS } from '../lib/constants'
import { formatCurrency, formatDateTime, sortByTimestamp } from '../lib/format'
import { workflowApi } from '../services/workflow'

export default function ManagerReview() {
  const [reports, setReports] = useState([])
  const [costings, setCostings] = useState([])
  const [selectedReport, setSelectedReport] = useState(null)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function loadData() {
    setLoading(true)
    try {
      const [reportSnapshot, costingSnapshot] = await Promise.all([
        getDocs(collection(db, 'reports')),
        getDocs(collection(db, 'costing')),
      ])

      setReports(
        sortByTimestamp(reportSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))).filter(
          (item) => item.status === STATUS.REVIEW_PENDING,
        ),
      )
      setCostings(costingSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const costingMap = costings.reduce((accumulator, item) => {
    accumulator[item.id] = item
    return accumulator
  }, {})

  async function handleDecision(decision) {
    if (!selectedReport) {
      return
    }

    setSaving(true)
    try {
      await workflowApi.reviewReport({
        reportId: selectedReport.id,
        decision,
        comment,
      })
      toast.success(decision === 'Approve' ? 'Report approved.' : 'Report rejected back to engineer.')
      setSelectedReport(null)
      setComment('')
      await loadData()
    } catch (error) {
      toast.error(error.message || 'Failed to review report.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Manager Review"
        description="Approve or reject final reports before commercial handover."
      />

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Reports waiting for review</h3>
              <p>Review pending reports submitted by engineers.</p>
            </div>
          </div>

          <div className="summary-list">
            {loading ? (
              <div className="empty-state">Loading reports...</div>
            ) : reports.length === 0 ? (
              <div className="empty-state">No reports are waiting for review.</div>
            ) : (
              reports.map((report) => (
                <button
                  type="button"
                  key={report.id}
                  className={`summary-row summary-row-button ${selectedReport?.id === report.id ? 'selected' : ''}`}
                  onClick={() => setSelectedReport(report)}
                >
                  <div>
                    <strong>{report.htacNumber}</strong>
                    <p>{report.projectId} / {report.testId}</p>
                    <small>{report.engineerName}</small>
                  </div>
                  <div className="summary-metric">
                    <small>{formatDateTime(report.updatedAt)}</small>
                    <StatusBadge status={report.status} />
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Review decision</h3>
              <p>Approve to Commercial or reject to Engineer.</p>
            </div>
          </div>

          {selectedReport ? (
            <div className="stack">
              <div className="info-card">
                <strong>{selectedReport.htacNumber}</strong>
                <p>{selectedReport.projectId} / {selectedReport.testId}</p>
                <p>Costing value: {formatCurrency(costingMap[selectedReport.costingId]?.totalCost || 0)}</p>
              </div>

              <div className="attachments-list">
                {[...(selectedReport.rawDataFiles || []), ...(selectedReport.finalReportFiles || [])].map((file) => (
                  <a key={file.fullPath} className="attachment-link" href={file.url} target="_blank" rel="noreferrer">
                    {file.name}
                  </a>
                ))}
              </div>

              <label className="field">
                <span>Manager comment</span>
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows="5" />
              </label>

              <div className="button-row">
                <button type="button" className="button button-danger" disabled={saving} onClick={() => handleDecision('Reject')}>
                  Reject
                </button>
                <button type="button" className="button button-primary" disabled={saving} onClick={() => handleDecision('Approve')}>
                  Approve
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">Select a report to review.</div>
          )}
        </section>
      </div>
    </div>
  )
}
