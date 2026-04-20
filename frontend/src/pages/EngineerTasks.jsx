import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import toast from 'react-hot-toast'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../firebase'
import { ROLES, STATUS } from '../lib/constants'
import { formatDateTime, sortByTimestamp } from '../lib/format'
import { uploadFiles, workflowApi } from '../services/workflow'

export default function EngineerTasks() {
  const { currentUser, profile } = useAuth()
  const [assignments, setAssignments] = useState([])
  const [selectedTask, setSelectedTask] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState(STATUS.IN_PROGRESS)
  const [executionNote, setExecutionNote] = useState('')
  const [rawFiles, setRawFiles] = useState([])
  const [finalFiles, setFinalFiles] = useState([])

  async function loadAssignments() {
    setLoading(true)
    try {
      const snapshot = await getDocs(collection(db, 'assignments'))
      const scoped = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter((assignment) => profile?.role === ROLES.HOD || assignment.engineerUid === currentUser?.uid)
      setAssignments(sortByTimestamp(scoped))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (currentUser?.uid) {
      loadAssignments()
    }
    // loadAssignments depends on current user scope and is re-created on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid, profile?.role])

  useEffect(() => {
    if (!selectedTask) {
      setStatus(STATUS.IN_PROGRESS)
      setExecutionNote('')
      setRawFiles([])
      setFinalFiles([])
    }
  }, [selectedTask])

  async function handleSubmit(event) {
    event.preventDefault()
    if (!selectedTask) {
      return
    }

    setSaving(true)
    try {
      const rawDataFiles = await uploadFiles(`reports/${selectedTask.id}/raw`, rawFiles)
      const finalReportFiles = await uploadFiles(`reports/${selectedTask.id}/final`, finalFiles)

      await workflowApi.submitExecutionUpdate({
        assignmentId: selectedTask.id,
        status,
        executionNote,
        rawDataFiles,
        finalReportFiles,
      })

      toast.success(status === STATUS.REVIEW_PENDING ? 'Submitted for review.' : 'Execution progress saved.')
      setSelectedTask(null)
      await loadAssignments()
    } catch (error) {
      toast.error(error.message || 'Failed to update task.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Engineer Tasks"
        description="Assigned tests, status updates, raw data upload and final report submission."
      />

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Assigned tasks</h3>
              <p>Visible task list for the logged-in engineer.</p>
            </div>
          </div>

          <div className="summary-list">
            {loading ? (
              <div className="empty-state">Loading assignments...</div>
            ) : assignments.length === 0 ? (
              <div className="empty-state">No assignments found.</div>
            ) : (
              assignments.map((assignment) => (
                <button
                  type="button"
                  key={assignment.id}
                  className={`summary-row summary-row-button ${selectedTask?.id === assignment.id ? 'selected' : ''}`}
                  onClick={() => setSelectedTask(assignment)}
                >
                  <div>
                    <strong>{assignment.htacNumber}</strong>
                    <p>{assignment.projectId} / {assignment.testId}</p>
                    <small>Due {assignment.deadline}</small>
                  </div>
                  <div className="summary-metric">
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
              <h3>Execution update</h3>
              <p>Upload raw data and final report before manager review.</p>
            </div>
          </div>

          {selectedTask ? (
            <form className="stack" onSubmit={handleSubmit}>
              <div className="info-card">
                <strong>{selectedTask.htacNumber}</strong>
                <p>{selectedTask.projectId} / {selectedTask.testId}</p>
                <div className="inline-meta">
                  <span>{selectedTask.location}</span>
                  <StatusBadge status={selectedTask.status} />
                </div>
              </div>

              <label className="field">
                <span>Status</span>
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value={STATUS.IN_PROGRESS}>{STATUS.IN_PROGRESS}</option>
                  <option value={STATUS.REVIEW_PENDING}>{STATUS.REVIEW_PENDING}</option>
                </select>
              </label>

              <label className="field">
                <span>Execution note</span>
                <textarea value={executionNote} onChange={(event) => setExecutionNote(event.target.value)} rows="4" />
              </label>

              <label className="field">
                <span>Raw data files</span>
                <input type="file" multiple onChange={(event) => setRawFiles(Array.from(event.target.files || []))} />
              </label>

              <label className="field">
                <span>Final report files</span>
                <input type="file" multiple onChange={(event) => setFinalFiles(Array.from(event.target.files || []))} />
              </label>

              <button type="submit" className="button button-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save execution update'}
              </button>
            </form>
          ) : (
            <div className="empty-state">Select an assignment to update.</div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h3>Task history</h3>
            <p>Recent task activity in your scope.</p>
          </div>
        </div>
        <div className="summary-list">
          {assignments.map((assignment) => (
            <div key={assignment.id} className="summary-row">
              <div>
                <strong>{assignment.htacNumber}</strong>
                <p>{assignment.engineerName}</p>
              </div>
              <div className="summary-metric">
                <small>{formatDateTime(assignment.updatedAt)}</small>
                <StatusBadge status={assignment.status} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
