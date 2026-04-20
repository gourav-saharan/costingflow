import { useEffect, useRef, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import toast from 'react-hot-toast'
import { FileUp } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../firebase'
import { PRIORITY_OPTIONS, TEST_TYPE_OPTIONS } from '../lib/constants'
import { formatDateTime, sortByTimestamp } from '../lib/format'
import { canCreateRequest } from '../lib/permissions'
import { createDraftId, uploadFiles, workflowApi } from '../services/workflow'

const CONTRACT_REVIEW_OPTIONS = [
  'Applicable – Contract Reviewed & Approved',
  'Not Applicable – Internal Test',
  'Pending Review',
]

const LAB_OPTIONS = [
  'Physical Lab – Mysuru (RPSCOE)',
  'Physical Lab – Indore (NATRAX)',
  'Virtual Simulation Lab',
]

const emptyForm = {
  // Existing fields (untouched)
  projectId: '',
  testId: '',
  tyreDetails: '',
  testType: '',
  priority: 'Medium',
  // New fields from mockup
  htacNo: '',
  dateOfReceipt: '',
  referenceNo: '',
  sampleDetails: '',
  customerCode: '',
  customerIdName: '',
  customerGST: '',
  originatorReference: '',
  contractReview: '',
  physicalLabEnabled: false,
  physicalLab: '',
  description: '',
  remarks: '',
  paymentDetails: '',
  activeStatus: 'Active',
}

export default function TestRequests() {
  const { profile } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [files, setFiles] = useState([])
  const [fileDragOver, setFileDragOver] = useState(false)

  const fileInputRef = useRef(null)

  async function loadRequests() {
    setLoading(true)
    try {
      const snapshot = await getDocs(collection(db, 'test_requests'))
      setRequests(sortByTimestamp(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), 'requestedAt'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRequests()
  }, [])

  /* ─── Drag-Drop helpers ─── */
  function handleDrop(e, setter, maxMB = 10) {
    e.preventDefault()
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.size <= maxMB * 1024 * 1024)
    setter(prev => [...prev, ...dropped])
  }

  /* ─── Submit – existing logic untouched, new fields ride along ─── */
  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    try {
      const requestId = createDraftId('test_requests')
      const attachments = await uploadFiles(`test_requests/${requestId}`, files)
      await workflowApi.submitTestRequest({
        requestId,
        ...form,
        attachments,
      })
      toast.success('Test request submitted.')
      setIsModalOpen(false)
      setForm(emptyForm)
      setFiles([])
      await loadRequests()
    } catch (error) {
      toast.error(error.message || 'Failed to submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  function openModal() {
    setForm(emptyForm)
    setFiles([])
    setIsModalOpen(true)
  }

  function set(field) {
    return (e) => setForm(cur => ({ ...cur, [field]: e.target.value }))
  }

  function setCheck(field) {
    return (e) => setForm(cur => ({ ...cur, [field]: e.target.checked }))
  }

  /* ─── Row helper ─── */
  function Row({ label, required, children }) {
    return (
      <div className="form-row-label">
        <div className="frl-label">
          {label}{required && <span className="req"> *</span>}
          {required && <span> :</span>}
          {!required && ' :'}
        </div>
        <div className="frl-control">{children}</div>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="Test Requests"
        description="PDC request intake with attachments, project IDs and test IDs."
        actions={canCreateRequest(profile) ? (
          <button type="button" className="button button-primary" onClick={openModal}>
            New request
          </button>
        ) : null}
      />

      <section className="panel">
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th>HTAC No.</th>
                <th>Project ID</th>
                <th>Test ID</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Requested by</th>
                <th>Requested at</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="9">Loading requests...</td></tr>
              ) : requests.length === 0 ? (
                <tr><td colSpan="9">No test requests found.</td></tr>
              ) : (
                requests.map((request) => (
                  <tr key={request.id}>
                    <td>{request.htacNo || '—'}</td>
                    <td>{request.projectId}</td>
                    <td>{request.testId}</td>
                    <td>{request.testType}</td>
                    <td>{request.priority}</td>
                    <td><StatusBadge status={request.status} /></td>
                    <td>{request.createdByName}</td>
                    <td>{formatDateTime(request.requestedAt)}</td>
                    <td>{request.attachments?.length || 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ═══════════ MODAL ═══════════ */}
      {isModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card-wide">
            <div className="modal-title-bar">Create Task</div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">

                {/* ── Section 1: Core Details ── */}
                <Row label="HTAC No." required>
                  <input
                    placeholder="Enter HTAC number"
                    value={form.htacNo}
                    onChange={set('htacNo')}
                    required
                  />
                </Row>

                <Row label="Date of Receipt of Sample" required>
                  <input
                    type="date"
                    value={form.dateOfReceipt}
                    onChange={set('dateOfReceipt')}
                    required
                  />
                </Row>

                <Row label="Project No. / Reference No.">
                  <input
                    placeholder="Enter project no. / reference no."
                    value={form.referenceNo}
                    onChange={set('referenceNo')}
                  />
                </Row>

                <Row label="Project ID" required>
                  <input
                    placeholder="Internal project identifier"
                    value={form.projectId}
                    onChange={set('projectId')}
                    required
                  />
                </Row>

                <Row label="Test ID" required>
                  <input
                    placeholder="Test identifier"
                    value={form.testId}
                    onChange={set('testId')}
                    required
                  />
                </Row>

                <Row label="Sample Details" required>
                  <textarea
                    placeholder="Enter sample details"
                    rows={3}
                    value={form.sampleDetails}
                    onChange={set('sampleDetails')}
                    required
                  />
                </Row>

                <Row label="Customer Code" required>
                  <input
                    placeholder="Search customer code"
                    value={form.customerCode}
                    onChange={set('customerCode')}
                    required
                  />
                </Row>

                <Row label="Customer ID – Name" required>
                  <input
                    placeholder="Search customer id or name"
                    value={form.customerIdName}
                    onChange={set('customerIdName')}
                    required
                  />
                </Row>

                <Row label="Customer GST Number">
                  <input
                    placeholder="Enter GST number"
                    value={form.customerGST}
                    onChange={set('customerGST')}
                  />
                </Row>

                <Row label="Originator Reference" required>
                  <input
                    placeholder="Enter originator reference"
                    value={form.originatorReference}
                    onChange={set('originatorReference')}
                    required
                  />
                </Row>

                <Row label="Contract Review" required>
                  <select
                    value={form.contractReview}
                    onChange={set('contractReview')}
                    required
                  >
                    <option value="">— Select One Option —</option>
                    {CONTRACT_REVIEW_OPTIONS.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </Row>

                {/* ── Section 2: Test Config ── */}
                <div className="form-section-divider" style={{ marginTop: '16px' }}>
                  <h4>Test Configuration</h4>
                </div>

                <Row label="Test Type" required>
                  <select
                    value={form.testType}
                    onChange={set('testType')}
                    required
                  >
                    <option value="">Select test type</option>
                    {TEST_TYPE_OPTIONS.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </Row>

                <Row label="Priority" required>
                  <select value={form.priority} onChange={set('priority')}>
                    {PRIORITY_OPTIONS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </Row>

                <Row label="Tyre Details" required>
                  <textarea
                    placeholder="Enter tyre specification details"
                    rows={3}
                    value={form.tyreDetails}
                    onChange={set('tyreDetails')}
                    required
                  />
                </Row>

                {/* ── Section 3: Work Assignment ── */}
                <div className="form-section-divider" style={{ marginTop: '16px' }}>
                  <h4>Work Assigned To</h4>
                </div>



                <Row label="Description">
                  <textarea
                    placeholder="Enter description (Allowed between 2 to 5000 characters only.)"
                    rows={3}
                    maxLength={5000}
                    value={form.description}
                    onChange={set('description')}
                  />
                </Row>

                {/* ── Section 4: Uploads ── */}
                <div className="form-section-divider" style={{ marginTop: '16px' }}>
                  <h4>Attachments</h4>
                </div>

                <div style={{ padding: '12px 0' }}>
                  <span className="drop-zone-label">Upload Attachment – PDF or Image (Maximum size 10 MB):</span>
                  <div
                    className={`drop-zone ${fileDragOver ? 'drag-over' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setFileDragOver(true) }}
                    onDragLeave={() => setFileDragOver(false)}
                    onDrop={e => { setFileDragOver(false); handleDrop(e, setFiles) }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,image/*"
                      multiple
                      onChange={e => setFiles(Array.from(e.target.files || []))}
                    />
                    <FileUp size={28} style={{ marginBottom: '8px', opacity: 0.5 }} />
                    <div>
                      {files.length > 0
                        ? files.map(f => f.name).join(', ')
                        : 'Select or Drop PDF / Image files here'}
                    </div>
                  </div>
                </div>

                {/* ── Section 5: Final Details ── */}
                <div className="form-section-divider" style={{ marginTop: '8px' }}>
                  <h4>Additional Information</h4>
                </div>

                <Row label="Remarks">
                  <textarea
                    placeholder="Enter remarks (Allowed between 2 to 5000 characters only.)"
                    rows={3}
                    maxLength={5000}
                    value={form.remarks}
                    onChange={set('remarks')}
                  />
                </Row>

                <Row label="Payment Details">
                  <textarea
                    placeholder="Enter payment details (Allowed between 2 to 5000 characters only.)"
                    rows={3}
                    maxLength={5000}
                    value={form.paymentDetails}
                    onChange={set('paymentDetails')}
                  />
                </Row>

                <Row label="Active / Inactive">
                  <select value={form.activeStatus} onChange={set('activeStatus')}>
                    <option value="Active">Active</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </Row>

              </div>

              {/* ── Action Bar ── */}
              <div className="modal-action-bar">
                <button
                  type="submit"
                  name="action"
                  value="save"
                  className="button button-secondary"
                  disabled={submitting}
                >
                  Save
                </button>
                <button
                  type="submit"
                  name="action"
                  value="send"
                  className="button button-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Submitting...' : 'Send Request to Lab'}
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={() => setIsModalOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
              </div>
            </form>

          </div>
        </div>
      ) : null}
    </div>
  )
}
