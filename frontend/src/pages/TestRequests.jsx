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
  'Applicable - Contract Reviewed & Approved',
  'Not Applicable - Internal Test',
  'Pending Review',
]

const LAB_OPTIONS = [
  'Physical Lab - Mysuru (RPSCOE)',
  'Physical Lab - Indore (NATRAX)',
  'Virtual Simulation Lab',
]

const MAX_ATTACHMENT_SIZE_MB = 10

const emptyForm = {
  projectId: '',
  testId: '',
  tyreDetails: '',
  testType: '',
  priority: 'Medium',
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

const emptyOcrState = {
  loading: false,
  error: '',
  sourceName: '',
  detectedFieldCount: 0,
  pagesProcessed: 0,
  warnings: [],
}

function mergeOcrSuggestions(current, suggestions) {
  const next = { ...current }

  for (const [field, value] of Object.entries(suggestions || {})) {
    if (typeof value === 'boolean') {
      if (current[field] === emptyForm[field]) {
        next[field] = value
      }
      continue
    }

    if (!value) {
      continue
    }

    const currentValue = current[field]
    const shouldApply =
      currentValue === '' ||
      currentValue === null ||
      currentValue === undefined ||
      currentValue === emptyForm[field]

    if (shouldApply) {
      next[field] = value
    }
  }

  if (next.physicalLab && current.physicalLabEnabled === emptyForm.physicalLabEnabled) {
    next.physicalLabEnabled = next.physicalLab !== 'Virtual Simulation Lab'
  }

  return next
}

export default function TestRequests() {
  const { profile } = useAuth()
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [draftRequestId, setDraftRequestId] = useState(() => createDraftId('test_requests'))
  const [form, setForm] = useState(emptyForm)
  const [files, setFiles] = useState([])
  const [uploadedAttachments, setUploadedAttachments] = useState([])
  const [uploadingAttachments, setUploadingAttachments] = useState(false)
  const [fileDragOver, setFileDragOver] = useState(false)
  const [ocrState, setOcrState] = useState(emptyOcrState)

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

  async function runOcrForAttachment(attachment) {
    if (!attachment) {
      return
    }

    setOcrState((current) => ({
      ...current,
      loading: true,
      error: '',
      sourceName: attachment.name,
    }))

    try {
      const result = await workflowApi.extractTestRequestFromDocument({
        name: attachment.name,
        bucket: attachment.bucket,
        fullPath: attachment.fullPath,
        contentType: attachment.contentType,
      })

      const suggestions = result.suggestions || {}
      const detectedFieldCount = Object.values(suggestions).filter((value) => value !== '' && value !== false && value !== null && value !== undefined).length

      setForm((current) => mergeOcrSuggestions(current, suggestions))
      setOcrState({
        loading: false,
        error: '',
        sourceName: result.name || attachment.name,
        detectedFieldCount,
        pagesProcessed: result.pagesProcessed || 0,
        warnings: result.warnings || [],
      })

      if (detectedFieldCount > 0) {
        toast.success(`OCR imported ${detectedFieldCount} field${detectedFieldCount === 1 ? '' : 's'}. Review before submitting.`)
      } else {
        toast('OCR finished, but no form fields were mapped confidently.')
      }
    } catch (error) {
      setOcrState({
        loading: false,
        error: error.message || 'OCR extraction failed.',
        sourceName: attachment.name,
        detectedFieldCount: 0,
        pagesProcessed: 0,
        warnings: [],
      })
      toast.error(error.message || 'OCR extraction failed.')
    }
  }

  async function handleIncomingFiles(selectedFiles, mode = 'replace') {
    const previousFiles = mode === 'append' ? files : []
    const previousAttachments = mode === 'append' ? uploadedAttachments : []
    const acceptedFiles = selectedFiles.filter((file) => file.size <= MAX_ATTACHMENT_SIZE_MB * 1024 * 1024)
    const rejectedFiles = selectedFiles.filter((file) => file.size > MAX_ATTACHMENT_SIZE_MB * 1024 * 1024)

    if (rejectedFiles.length > 0) {
      toast.error(`Skipped ${rejectedFiles.length} file${rejectedFiles.length === 1 ? '' : 's'} larger than ${MAX_ATTACHMENT_SIZE_MB} MB.`)
    }

    if (acceptedFiles.length === 0) {
      return
    }

    const nextFiles = mode === 'append' ? [...files, ...acceptedFiles] : acceptedFiles
    setFiles(nextFiles)
    setUploadingAttachments(true)
    setOcrState(emptyOcrState)

    try {
      const uploaded = await uploadFiles(`test_requests/${draftRequestId}`, acceptedFiles)
      const nextAttachments = mode === 'append' ? [...uploadedAttachments, ...uploaded] : uploaded

      setUploadedAttachments(nextAttachments)

      const ocrCandidate = [...uploaded].reverse().find((attachment) =>
        attachment.contentType === 'application/pdf' || attachment.contentType.startsWith('image/'),
      )

      if (ocrCandidate) {
        await runOcrForAttachment(ocrCandidate)
      }
    } catch (error) {
      setFiles(previousFiles)
      setUploadedAttachments(previousAttachments)
      setOcrState({
        ...emptyOcrState,
        error: error.message || 'Attachment upload failed.',
      })
      toast.error(error.message || 'Attachment upload failed.')
    } finally {
      setUploadingAttachments(false)
    }
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)

    try {
      if (uploadingAttachments || ocrState.loading) {
        throw new Error('Please wait for attachment processing to finish.')
      }

      if (files.length !== uploadedAttachments.length) {
        throw new Error('One or more attachments are not uploaded yet. Please reselect the files.')
      }

      await workflowApi.submitTestRequest({
        requestId: draftRequestId,
        ...form,
        attachments: uploadedAttachments,
      })

      toast.success('Test request submitted.')
      closeModal()
      await loadRequests()
    } catch (error) {
      toast.error(error.message || 'Failed to submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  function openModal() {
    setDraftRequestId(createDraftId('test_requests'))
    setForm(emptyForm)
    setFiles([])
    setUploadedAttachments([])
    setUploadingAttachments(false)
    setFileDragOver(false)
    setOcrState(emptyOcrState)
    setIsModalOpen(true)
  }

  function closeModal() {
    setIsModalOpen(false)
    setForm(emptyForm)
    setFiles([])
    setUploadedAttachments([])
    setUploadingAttachments(false)
    setFileDragOver(false)
    setOcrState(emptyOcrState)
    setDraftRequestId(createDraftId('test_requests'))
  }

  function set(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  }

  function setCheck(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.checked }))
  }

  function handleFileInputChange(event) {
    const selectedFiles = Array.from(event.target.files || [])
    event.target.value = ''
    handleIncomingFiles(selectedFiles, 'replace')
  }

  function handleDrop(event) {
    event.preventDefault()
    setFileDragOver(false)
    handleIncomingFiles(Array.from(event.dataTransfer.files || []), 'append')
  }

  function Row({ label, required, children }) {
    return (
      <div className="form-row-label">
        <div className="frl-label">
          {label}
          {required && <span className="req"> *</span>}
          <span> :</span>
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
                    <td>{request.htacNo || '-'}</td>
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

      {isModalOpen ? (
        <div className="modal-backdrop">
          <div className="modal-card-wide">
            <div className="modal-title-bar">Create Task</div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">
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

                <Row label="Customer ID - Name" required>
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
                    <option value="">- Select One Option -</option>
                    {CONTRACT_REVIEW_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Row>

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
                    {TEST_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </Row>

                <Row label="Priority" required>
                  <select value={form.priority} onChange={set('priority')}>
                    {PRIORITY_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
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

                <Row label="Physical Lab Required">
                  <label className="ocr-inline-checkbox">
                    <input
                      type="checkbox"
                      checked={form.physicalLabEnabled}
                      onChange={setCheck('physicalLabEnabled')}
                    />
                    <span>Enable physical lab assignment</span>
                  </label>
                </Row>

                {form.physicalLabEnabled ? (
                  <Row label="Physical Lab">
                    <select value={form.physicalLab} onChange={set('physicalLab')}>
                      <option value="">Select lab</option>
                      {LAB_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </Row>
                ) : null}

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

                <div className="form-section-divider" style={{ marginTop: '16px' }}>
                  <h4>Attachments</h4>
                </div>

                {(ocrState.loading || ocrState.error || ocrState.sourceName) ? (
                  <div className={`ocr-summary ${ocrState.error ? 'error' : ''}`}>
                    <div className="ocr-summary-copy">
                      <strong>{ocrState.loading ? 'Reading document with OCR...' : `OCR source: ${ocrState.sourceName}`}</strong>
                      <span>
                        {ocrState.loading
                          ? 'The uploaded PDF/image is being analyzed and matched against the request form.'
                          : `Detected ${ocrState.detectedFieldCount} mapped field${ocrState.detectedFieldCount === 1 ? '' : 's'}${ocrState.pagesProcessed ? ` across ${ocrState.pagesProcessed} page${ocrState.pagesProcessed === 1 ? '' : 's'}` : ''}.`}
                      </span>
                      {ocrState.error ? <span>{ocrState.error}</span> : null}
                      {!ocrState.error && ocrState.warnings.length > 0 ? (
                        <span>{ocrState.warnings.join(' ')}</span>
                      ) : null}
                    </div>
                    {uploadedAttachments.length > 0 ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => runOcrForAttachment(uploadedAttachments[uploadedAttachments.length - 1])}
                        disabled={ocrState.loading || uploadingAttachments}
                      >
                        Run OCR Again
                      </button>
                    ) : null}
                  </div>
                ) : null}

                <div style={{ padding: '12px 0' }}>
                  <span className="drop-zone-label">Upload Attachment - PDF or Image (Maximum size 10 MB):</span>
                  <div
                    className={`drop-zone ${fileDragOver ? 'drag-over' : ''}`}
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(event) => { event.preventDefault(); setFileDragOver(true) }}
                    onDragLeave={() => setFileDragOver(false)}
                    onDrop={handleDrop}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,image/*"
                      multiple
                      onChange={handleFileInputChange}
                    />
                    <FileUp size={28} style={{ marginBottom: '8px', opacity: 0.5 }} />
                    <div>
                      {uploadingAttachments
                        ? 'Uploading attachments and running OCR...'
                        : files.length > 0
                          ? files.map((file) => file.name).join(', ')
                          : 'Select or drop PDF / image files here'}
                    </div>
                  </div>
                  {uploadedAttachments.length > 0 ? (
                    <div className="ocr-attachments-meta">
                      Stored {uploadedAttachments.length} attachment{uploadedAttachments.length === 1 ? '' : 's'} for this draft request.
                    </div>
                  ) : null}
                </div>

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

              <div className="modal-action-bar">
                <button
                  type="submit"
                  name="action"
                  value="save"
                  className="button button-secondary"
                  disabled={submitting || uploadingAttachments || ocrState.loading}
                >
                  Save
                </button>
                <button
                  type="submit"
                  name="action"
                  value="send"
                  className="button button-primary"
                  disabled={submitting || uploadingAttachments || ocrState.loading}
                >
                  {submitting ? 'Submitting...' : 'Send Request to Lab'}
                </button>
                <button
                  type="button"
                  className="button button-danger"
                  onClick={closeModal}
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
