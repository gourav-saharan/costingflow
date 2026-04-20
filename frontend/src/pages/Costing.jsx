import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { collection, getDocs, doc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import {
  Download, Filter, Search, Plus, X, ChevronDown, ChevronUp,
  RefreshCw, Save, FileSpreadsheet, Eye, EyeOff, AlertCircle,
  CheckCircle, Clock, Loader, TrendingUp, IndianRupee, Activity,
  Maximize2, Info, Calendar, User, Tag
} from 'lucide-react'
import { db } from '../firebase'
import { formatCurrency } from '../lib/format'
import { canEditCosting } from '../lib/permissions'
import { useAuth } from '../contexts/AuthContext'

// ─── SHEET DEFINITIONS (mirroring the actual Excel file) ────────────────────

const SHEET_CONFIG = {
  'VD Outdoor': {
    label: 'VD Outdoor',
    color: '#1d4ed8',
    bgLight: '#eff6ff',
    columns: [
      { key: 'sno',         label: 'S. No.',              width: 60,  type: 'number',   readOnly: true },
      { key: 'month',       label: 'Month',               width: 110, type: 'date' },
      { key: 'tmgRef',      label: 'TMG Ref. No.',        width: 140, type: 'text' },
      { key: 'projectNo',   label: 'Project No.',         width: 150, type: 'text' },
      { key: 'tyreSize',    label: 'Tyre Size',           width: 200, type: 'text' },
      { key: 'vehicle',     label: 'Vehicle',             width: 130, type: 'text' },
      { key: 'tests',       label: 'Tests',               width: 280, type: 'textarea' },
      { key: 'type',        label: 'Type',                width: 80,  type: 'select', options: ['PCR', 'TBR', 'OTR', '2W', 'LCV'] },
      { key: 'variants',    label: 'No. of Variants',     width: 100, type: 'number' },
      { key: 'costing',     label: 'Costing (Rs.)',       width: 130, type: 'currency' },
      { key: 'testRequest', label: 'Test Request',        width: 110, type: 'select', options: ['Received', 'Pending', 'Not Received'] },
      { key: 'originator',  label: 'Test Request Originator', width: 240, type: 'text' },
      { key: 'reqDate',     label: 'Test Rqst Date',      width: 120, type: 'date' },
      { key: 'compDate',    label: 'Test Completion Date',width: 130, type: 'date' },
      { key: 'testStatus',  label: 'Testing Status',      width: 110, type: 'status' },
      { key: 'results',     label: 'Results',             width: 100, type: 'status' },
      { key: 'taskAssigned',label: 'Task Assigned',       width: 100, type: 'status' },
      { key: 'testReqNo',   label: 'Test Request No.',    width: 160, type: 'text' },
      { key: 'htac',        label: 'HTAC',                width: 100, type: 'text' },
      { key: 'reportCosting',label:'Report & Costing',    width: 120, type: 'status' },
      { key: 'costingInit', label: 'Costing Initiated',   width: 120, type: 'date' },
      { key: 'costingDone', label: 'Costing Finished',    width: 120, type: 'date' },
      { key: 'resultServer',label: 'Result in Server',    width: 110, type: 'select', options: ['Yes', 'No', 'Done', ''] },
      { key: 'ulrNo',       label: 'ULR No.',             width: 170, type: 'text' },
      { key: 'comments',    label: 'Comments',            width: 200, type: 'text' },
      { key: 'initiatedBy', label: 'Initiated by / Completed by', width: 160, type: 'text' },
    ]
  },
  'Anechoic Chamber': {
    label: 'Anechoic Chamber',
    color: '#7c3aed',
    bgLight: '#f5f3ff',
    columns: [
      { key: 'sno',         label: 'S. No.',              width: 60,  type: 'number',   readOnly: true },
      { key: 'month',       label: 'Month',               width: 110, type: 'date' },
      { key: 'tmgRef',      label: 'TMG Ref. No.',        width: 140, type: 'text' },
      { key: 'projectNo',   label: 'Project No.',         width: 150, type: 'text' },
      { key: 'tyreSize',    label: 'Tyre Size',           width: 200, type: 'text' },
      { key: 'testCompleted',label:'Test Completed',      width: 180, type: 'text' },
      { key: 'testCode',    label: 'Test Code Used',      width: 120, type: 'text' },
      { key: 'type',        label: 'Type',                width: 80,  type: 'select', options: ['PCR', 'TBR', 'OTR', '2W', 'LCV'] },
      { key: 'variants',    label: 'No. of Variants',     width: 100, type: 'number' },
      { key: 'costing',     label: 'Costing (Rs.)',       width: 130, type: 'currency' },
      { key: 'testRequest', label: 'Test Request',        width: 110, type: 'select', options: ['Received', 'Recived', 'Pending', 'Not Received'] },
      { key: 'reqDate',     label: 'Test Rqst Date',      width: 120, type: 'date' },
      { key: 'testReqNo',   label: 'Test Request No.',    width: 160, type: 'text' },
      { key: 'compDate',    label: 'Test Completion Date',width: 130, type: 'date' },
      { key: 'testStatus',  label: 'Testing Status',      width: 110, type: 'status' },
      { key: 'results',     label: 'Results',             width: 100, type: 'status' },
      { key: 'taskAssigned',label: 'Task Assigned',       width: 100, type: 'status' },
      { key: 'htac',        label: 'HTAC',                width: 100, type: 'text' },
      { key: 'reportCosting',label:'Report & Costing',    width: 120, type: 'status' },
      { key: 'costingInit', label: 'Costing Initiated',   width: 120, type: 'date' },
      { key: 'costingDone', label: 'Costing Finished',    width: 120, type: 'date' },
      { key: 'resultServer',label: 'Result in Server',    width: 110, type: 'select', options: ['Yes', 'No', 'Done', ''] },
      { key: 'comments',    label: 'Comments',            width: 200, type: 'text' },
      { key: 'initiatedBy', label: 'Initiated by / Completed by', width: 160, type: 'text' },
      { key: 'mon',         label: 'Monday',              width: 90,  type: 'text' },
      { key: 'tue',         label: 'Tuesday',             width: 90,  type: 'text' },
      { key: 'wed',         label: 'Wednesday',           width: 90,  type: 'text' },
      { key: 'thu',         label: 'Thursday',            width: 90,  type: 'text' },
      { key: 'fri',         label: 'Friday',              width: 90,  type: 'text' },
      { key: 'sat',         label: 'Saturday',            width: 90,  type: 'text' },
      { key: 'finalStatus', label: 'Final Status',        width: 110, type: 'status' },
      { key: 'report',      label: 'Report',              width: 100, type: 'text' },
    ]
  },
  'ONLEVEL / FTCT+': {
    label: 'ONLEVEL / FTCT+',
    color: '#0891b2',
    bgLight: '#ecfeff',
    columns: [
      { key: 'sno',         label: 'S. No.',              width: 60,  type: 'number',   readOnly: true },
      { key: 'date',        label: 'Date',                width: 110, type: 'date' },
      { key: 'tmgRef',      label: 'TMG Ref. No.',        width: 155, type: 'text' },
      { key: 'projectNo',   label: 'Project No.',         width: 150, type: 'text' },
      { key: 'testReqNo',   label: 'Test Request Number', width: 160, type: 'text' },
      { key: 'machine',     label: 'Machine (FTCT+/Onlevel)', width: 140, type: 'select', options: ['FTCT+', 'Onlevel', ''] },
      { key: 'tyreSize',    label: 'Tyre Size',           width: 200, type: 'text' },
      { key: 'project',     label: 'Project / Brand',     width: 150, type: 'text' },
      { key: 'testCompleted',label:'Test Completed',      width: 200, type: 'text' },
      { key: 'lmsCode',     label: 'LMS Code Used',       width: 100, type: 'text' },
      { key: 'noTyres',     label: 'No of Tyres',         width: 90,  type: 'number' },
      { key: 'noTests',     label: 'No. of Tests',        width: 90,  type: 'number' },
      { key: 'costing',     label: 'Costing (Rs)',        width: 130, type: 'currency' },
      { key: 'compDate',    label: 'Test Completion Date',width: 130, type: 'date' },
      { key: 'testStatus',  label: 'Testing Status',      width: 110, type: 'status' },
      { key: 'taskAssigned',label: 'Task Assigned',       width: 100, type: 'status' },
      { key: 'reportStatus',label: 'Status of Report',    width: 130, type: 'status' },
      { key: 'costingLms',  label: 'Costing in LMS',      width: 120, type: 'text' },
      { key: 'htac',        label: 'HTAC No.',            width: 100, type: 'text' },
      { key: 'resultServer',label: 'Result in Server',    width: 110, type: 'select', options: ['Yes', 'No', 'Done', ''] },
      { key: 'comments',    label: 'Comments',            width: 200, type: 'text' },
      { key: 'initiatedBy', label: 'Initiated by / Completed by', width: 160, type: 'text' },
      { key: 'mon',         label: 'Monday',              width: 90,  type: 'text' },
      { key: 'tue',         label: 'Tuesday',             width: 90,  type: 'text' },
      { key: 'wed',         label: 'Wednesday',           width: 90,  type: 'text' },
      { key: 'thu',         label: 'Thursday',            width: 90,  type: 'text' },
      { key: 'fri',         label: 'Friday',              width: 90,  type: 'text' },
      { key: 'sat',         label: 'Saturday',            width: 90,  type: 'text' },
      { key: 'finalStatus', label: 'Final Status',        width: 110, type: 'status' },
      { key: 'report',      label: 'Report',              width: 100, type: 'text' },
    ]
  },
  'TNM': {
    label: 'TNM',
    color: '#059669',
    bgLight: '#ecfdf5',
    columns: [
      { key: 'sno',         label: 'S. No.',              width: 60,  type: 'number',   readOnly: true },
      { key: 'tmgRef',      label: 'TMG Ref. No.',        width: 150, type: 'text' },
      { key: 'projectNo',   label: 'Project No.',         width: 150, type: 'text' },
      { key: 'tyreSize',    label: 'Tyre Size',           width: 200, type: 'text' },
      { key: 'testCompleted',label:'Test Completed',      width: 180, type: 'text' },
      { key: 'type',        label: 'Type',                width: 80,  type: 'select', options: ['PCR', 'TBR', 'OTR', '2W', 'LCV'] },
      { key: 'variants',    label: 'No. of Variants',     width: 100, type: 'number' },
      { key: 'costing',     label: 'Costing (Rs.)',       width: 130, type: 'currency' },
      { key: 'htac',        label: 'HTAC',                width: 100, type: 'text' },
      { key: 'doneBy',      label: 'Done by',             width: 120, type: 'text' },
      { key: 'status',      label: 'Status',              width: 110, type: 'status' },
      { key: 'testReqNo',   label: 'Test Request No',     width: 160, type: 'text' },
      { key: 'remarks',     label: 'Remarks',             width: 200, type: 'text' },
      { key: 'compDate',    label: 'Test Completion Date',width: 130, type: 'date' },
      { key: 'mon',         label: 'Monday',              width: 90,  type: 'text' },
      { key: 'tue',         label: 'Tuesday',             width: 90,  type: 'text' },
      { key: 'wed',         label: 'Wednesday',           width: 90,  type: 'text' },
      { key: 'thu',         label: 'Thursday',            width: 90,  type: 'text' },
      { key: 'fri',         label: 'Friday',              width: 90,  type: 'text' },
      { key: 'sat',         label: 'Saturday',            width: 90,  type: 'text' },
      { key: 'finalStatus', label: 'Final Status',        width: 110, type: 'status' },
      { key: 'report',      label: 'Report',              width: 100, type: 'text' },
    ]
  },
  'Internal VDD': {
    label: 'Internal VDD',
    color: '#dc2626',
    bgLight: '#fff1f2',
    columns: [
      { key: 'sno',          label: 'S. No.',              width: 60,  type: 'number',   readOnly: true },
      { key: 'tmgRef',       label: 'TMG Ref. No.',        width: 150, type: 'text' },
      { key: 'projectNo',    label: 'Project No.',         width: 150, type: 'text' },
      { key: 'tyreSize',     label: 'Tyre Size',           width: 200, type: 'text' },
      { key: 'workArea',     label: 'Test Completed / Work Area', width: 200, type: 'text' },
      { key: 'type',         label: 'Type',                width: 80,  type: 'select', options: ['PCR', 'TBR', 'OTR', '2W', 'LCV'] },
      { key: 'variants',     label: 'No. of Variants',     width: 100, type: 'number' },
      { key: 'costing',      label: 'Costing (Rs.)',       width: 130, type: 'currency' },
      { key: 'testRequest',  label: 'Test Request',        width: 110, type: 'select', options: ['Received', 'Pending', 'Not Received'] },
      { key: 'reqDate',      label: 'Test Rqst Date',      width: 120, type: 'date' },
      { key: 'testStatus',   label: 'Testing Status',      width: 110, type: 'status' },
      { key: 'results',      label: 'Results',             width: 100, type: 'status' },
      { key: 'taskAssigned', label: 'Task Assigned',       width: 100, type: 'status' },
      { key: 'testReqNo',    label: 'Test Request No.',    width: 160, type: 'text' },
      { key: 'htac',         label: 'HTAC',                width: 100, type: 'text' },
      { key: 'reportCosting',label: 'Report & Costing',    width: 120, type: 'status' },
      { key: 'costingInit',  label: 'Costing Initiated',   width: 120, type: 'date' },
      { key: 'costingDone',  label: 'Costing Finished',    width: 120, type: 'date' },
      { key: 'resultServer', label: 'Result in Server',    width: 110, type: 'select', options: ['Yes', 'No', 'Done', ''] },
      { key: 'comments',     label: 'Comments',            width: 200, type: 'text' },
      { key: 'initiatedBy',  label: 'Initiated by / Completed by', width: 160, type: 'text' },
      { key: 'compDate',     label: 'Test Completion Date',width: 130, type: 'date' },
      { key: 'mon',          label: 'Monday',              width: 90,  type: 'text' },
      { key: 'tue',          label: 'Tuesday',             width: 90,  type: 'text' },
      { key: 'wed',          label: 'Wednesday',           width: 90,  type: 'text' },
      { key: 'thu',          label: 'Thursday',            width: 90,  type: 'text' },
      { key: 'fri',          label: 'Friday',              width: 90,  type: 'text' },
      { key: 'sat',          label: 'Saturday',            width: 90,  type: 'text' },
      { key: 'finalStatus',  label: 'Final Status',        width: 110, type: 'status' },
      { key: 'report',       label: 'Report',              width: 100, type: 'text' },
    ]
  }
}

const SHEET_KEYS = Object.keys(SHEET_CONFIG)

const STATUS_OPTIONS = ['Done', 'In Progress', 'Pending', 'Not Started', '']
const STATUS_STYLES = {
  'Done':        { bg: '#dcfce7', color: '#15803d', label: '✓ Done' },
  'In Progress': { bg: '#fef9c3', color: '#a16207', label: '⟳ In Progress' },
  'Pending':     { bg: '#fee2e2', color: '#b91c1c', label: '⚠ Pending' },
  'on going abhishek': { bg: '#fef9c3', color: '#a16207', label: '⟳ Ongoing' },
  'Not Started': { bg: '#f1f5f9', color: '#64748b', label: '○ Not Started' },
  '':            { bg: 'transparent', color: '#94a3b8', label: '—' },
}

function getStatusStyle(val) {
  if (!val || val === '') return STATUS_STYLES['']
  const lower = String(val).toLowerCase()
  if (lower === 'done') return STATUS_STYLES['Done']
  if (lower.includes('progress') || lower.includes('ongoing') || lower.includes('on going'))
    return STATUS_STYLES['In Progress']
  if (lower === 'pending') return STATUS_STYLES['Pending']
  return { bg: '#f1f5f9', color: '#475569', label: val }
}

function fmt(val) {
  if (!val || val === '') return ''
  // Only parse proper ISO date strings (e.g. "2024-04-16T..." or "2024-04-16")
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    const d = new Date(val)
    if (!isNaN(d)) return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  return String(val)
}

// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────

export default function Costing() {
  const { profile } = useAuth()
  const canEdit = canEditCosting(profile)

  const [activeSheet, setActiveSheet] = useState(SHEET_KEYS[0])
  const [sheetData, setSheetData] = useState(() => {
    const init = {}
    SHEET_KEYS.forEach(k => { init[k] = [] })
    return init
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  // Filters & search
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [hiddenCols, setHiddenCols] = useState({})
  const [showColManager, setShowColManager] = useState(false)
  const [editingCell, setEditingCell] = useState(null) // {row, col}
  const [selectedDetailRow, setSelectedDetailRow] = useState(null)

  const fileInputRef = useRef(null)
  const tableWrapperRef = useRef(null)

  const currentCols = SHEET_CONFIG[activeSheet].columns
  const sheetColor  = SHEET_CONFIG[activeSheet].color
  const sheetBgLight = SHEET_CONFIG[activeSheet].bgLight

  // ── Load from Firestore ────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    const unsub = onSnapshot(doc(db, 'costing_master', 'v1'), (snap) => {
      if (snap.exists()) {
        const data = snap.data()
        setSheetData(prev => {
          const next = { ...prev }
          SHEET_KEYS.forEach(k => {
            if (data[k]) next[k] = data[k]
          })
          return next
        })
      }
      setLoading(false)
    }, () => setLoading(false))
    return () => unsub()
  }, [])

  // ── Save to Firestore ──────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await setDoc(doc(db, 'costing_master', 'v1'), {
        ...sheetData,
        _updatedAt: serverTimestamp(),
        _updatedBy: profile?.email || 'unknown',
      })
      setDirty(false)
      toast.success('Costing data saved successfully!')
    } catch (e) {
      toast.error('Failed to save: ' + e.message)
    } finally {
      setSaving(false)
    }
  }, [sheetData, profile])

  // ── Cell Update ───────────────────────────────────────────────────────────
  const updateCell = useCallback((sheetKey, rowIdx, colKey, value) => {
    setSheetData(prev => {
      const rows = [...prev[sheetKey]]
      rows[rowIdx] = { ...rows[rowIdx], [colKey]: value }
      return { ...prev, [sheetKey]: rows }
    })
    setDirty(true)
  }, [])

  // ── Add Row ───────────────────────────────────────────────────────────────
  const addRow = useCallback(() => {
    setSheetData(prev => {
      const rows = prev[activeSheet]
      const newRow = { sno: rows.length + 1 }
      return { ...prev, [activeSheet]: [...rows, newRow] }
    })
    setDirty(true)
  }, [activeSheet])

  // ── Delete Row ────────────────────────────────────────────────────────────
  const deleteRow = useCallback((rowIdx) => {
    setSheetData(prev => {
      const rows = prev[activeSheet].filter((_, i) => i !== rowIdx)
        .map((r, i) => ({ ...r, sno: i + 1 }))
      return { ...prev, [activeSheet]: rows }
    })
    setDirty(true)
  }, [activeSheet])

  // ── Import Excel ──────────────────────────────────────────────────────────
  const handleImport = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary', cellDates: true })
        const newData = {}
        const sheetMap = {
          'VD Outdoor':        ['VD Outdoor', 'VDD Outdoor', 'VD_Outdoor'],
          'Anechoic Chamber':  ['Anechoic chamber', 'Anechoic Chamber'],
          'ONLEVEL / FTCT+':   ['ONLEVEL FTCT+', 'OnLevel FTCT+', 'ONLEVEL / FTCT+'],
          'TNM':               ['TNM'],
          'Internal VDD':      ['Internal VDD', 'Internal_VDD'],
        }
        wb.SheetNames.forEach(wsName => {
          const targetKey = SHEET_KEYS.find(k =>
            (sheetMap[k] || [k]).some(alias =>
              alias.toLowerCase() === wsName.toLowerCase()
            )
          )
          if (!targetKey) return
          const ws = wb.Sheets[wsName]
          const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
          if (raw.length < 2) return
          const hdrs = raw[0].map(h => String(h || '').trim())
          const cols = SHEET_CONFIG[targetKey].columns
          const rows = raw.slice(1).map((rowArr, i) => {
            const obj = { sno: i + 1 }
            cols.forEach((col, ci) => {
              const val = rowArr[ci] !== undefined ? rowArr[ci] : ''
              obj[col.key] = val instanceof Date
                ? val.toISOString().split('T')[0]
                : String(val)
            })
            return obj
          }).filter(r => Object.values(r).some(v => v !== '' && v !== String(r.sno)))
          newData[targetKey] = rows
        })
        setSheetData(prev => ({ ...prev, ...newData }))
        setDirty(true)
        toast.success(`Imported ${Object.keys(newData).length} sheet(s) from Excel!`)
      } catch (err) {
        console.error(err)
        toast.error('Failed to import Excel: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
    e.target.value = ''
  }

  // ── Export Excel ──────────────────────────────────────────────────────────
  const handleExport = () => {
    const wb = XLSX.utils.book_new()
    SHEET_KEYS.forEach(sheetKey => {
      const cols = SHEET_CONFIG[sheetKey].columns
      const rows = sheetData[sheetKey]
      const header = cols.map(c => c.label)
      const body = rows.map(row => cols.map(c => row[c.key] || ''))
      const ws = XLSX.utils.aoa_to_sheet([header, ...body])
      // Column widths
      ws['!cols'] = cols.map(c => ({ wch: Math.round(c.width / 7) }))
      XLSX.utils.book_append_sheet(wb, ws, SHEET_CONFIG[sheetKey].label)
    })
    XLSX.writeFile(wb, `Costing_${new Date().toISOString().split('T')[0]}.xlsx`)
    toast.success('Exported to Excel!')
  }

  // ── Filtered Rows ─────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    let rows = sheetData[activeSheet] || []
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      rows = rows.filter(r =>
        Object.values(r).some(v => String(v).toLowerCase().includes(q))
      )
    }
    if (filterStatus) {
      rows = rows.filter(r => {
        const s = getStatusStyle(r.finalStatus || r.testStatus || r.status || '')
        return s.label.toLowerCase().includes(filterStatus.toLowerCase())
      })
    }
    if (filterType) {
      rows = rows.filter(r => r.type === filterType)
    }
    return rows
  }, [sheetData, activeSheet, searchTerm, filterStatus, filterType])

  // ── Summary Stats ────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const rows = sheetData[activeSheet] || []
    const totalCost = rows.reduce((s, r) => s + (Number(r.costing) || 0), 0)
    const doneCount = rows.filter(r => {
      const v = r.finalStatus || r.testStatus || r.status || ''
      return String(v).toLowerCase() === 'done'
    }).length
    const pendingCount = rows.filter(r => {
      const v = r.finalStatus || r.testStatus || r.status || ''
      return String(v).toLowerCase() === 'pending'
    }).length
    return { total: rows.length, totalCost, doneCount, pendingCount }
  }, [sheetData, activeSheet])

  // ── Visible Columns ───────────────────────────────────────────────────────
  const visibleCols = useMemo(() =>
    currentCols.filter(c => !hiddenCols[`${activeSheet}:${c.key}`]),
    [currentCols, hiddenCols, activeSheet]
  )

  const toggleCol = (key) => {
    setHiddenCols(prev => ({
      ...prev,
      [`${activeSheet}:${key}`]: !prev[`${activeSheet}:${key}`]
    }))
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 16 }}>
        <Loader size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
        <p style={{ color: 'var(--muted)', fontWeight: 600 }}>Loading costing data…</p>
      </div>
    )
  }

  return (
    <div className="page" style={{ height: 'calc(100vh - 90px)', display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden' }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
        <div className="page-header" style={{ marginBottom: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <FileSpreadsheet size={22} color={sheetColor} />
              <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700 }}>Costing Register</h1>
              <span style={{
                background: sheetBgLight, color: sheetColor,
                fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.08em',
                padding: '3px 10px', borderRadius: 20,
                border: `1px solid ${sheetColor}33`
              }}>
                MASTER SHEET · APRIL 2026
              </span>
              {dirty && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#d97706', fontSize: '0.72rem', fontWeight: 700 }}>
                  <AlertCircle size={13} /> Unsaved changes
                </span>
              )}
            </div>
            <p style={{ color: 'var(--muted)', marginTop: 6, fontSize: '0.82rem' }}>
              Track and manage all test costings across VD Outdoor, Anechoic Chamber, FTCT+, TNM &amp; Internal VDD.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} />
            <button className="button button-secondary" onClick={() => fileInputRef.current.click()}
              style={{ gap: 7, fontSize: '0.75rem' }}>
              <Plus size={14} /> Import Excel
            </button>
            <button className="button button-secondary" onClick={handleExport}
              style={{ gap: 7, fontSize: '0.75rem' }}>
              <Download size={14} /> Export
            </button>
            <button
              className={`button ${dirty ? 'button-primary' : 'button-secondary'}`}
              onClick={handleSave}
              disabled={saving}
              style={{ gap: 7, fontSize: '0.75rem' }}
            >
              {saving ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* ── SUMMARY CARDS ────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Total Entries', value: stats.total, icon: <Activity size={16} />, color: sheetColor, bgLight: sheetBgLight },
            { label: 'Total Costing', value: `₹${(stats.totalCost / 1e5).toFixed(1)}L`, icon: <IndianRupee size={16} />, color: '#0ea5e9', bgLight: '#f0f9ff' },
            { label: 'Completed', value: stats.doneCount, icon: <CheckCircle size={16} />, color: '#16a34a', bgLight: '#f0fdf4' },
            { label: 'Pending', value: stats.pendingCount, icon: <Clock size={16} />, color: '#d97706', bgLight: '#fffbeb' },
          ].map(card => (
            <div key={card.label} style={{
              background: '#fff', borderRadius: 8, padding: '14px 18px',
              border: `1px solid ${card.color}22`,
              display: 'flex', alignItems: 'center', gap: 12,
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: card.bgLight, color: card.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0
              }}>
                {card.icon}
              </div>
              <div>
                <p style={{ margin: 0, fontSize: '0.65rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{card.label}</p>
                <p style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: card.color }}>{card.value}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── SHEET CONTAINER ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid var(--ghost-border)', borderRadius: 8, margin: '0 24px 16px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>

        {/* ── SHEET TABS ──────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', borderBottom: '2px solid var(--ghost-border)', background: '#f8fafc', flexShrink: 0 }}>
          <div style={{ display: 'flex', overflow: 'auto' }}>
            {SHEET_KEYS.map(key => {
              const cfg = SHEET_CONFIG[key]
              const isActive = activeSheet === key
              const cnt = sheetData[key]?.length || 0
              return (
                <button key={key} onClick={() => setActiveSheet(key)} style={{
                  padding: '12px 20px',
                  border: 'none',
                  borderBottom: isActive ? `3px solid ${cfg.color}` : '3px solid transparent',
                  background: isActive ? '#fff' : 'transparent',
                  color: isActive ? cfg.color : 'var(--muted)',
                  fontWeight: isActive ? 800 : 600,
                  fontSize: '0.72rem',
                  letterSpacing: '0.04em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'all 0.15s ease',
                }}>
                  <span>{cfg.label.toUpperCase()}</span>
                  <span style={{
                    background: isActive ? cfg.color : '#e2e8f0',
                    color: isActive ? '#fff' : 'var(--muted)',
                    fontSize: '0.6rem', fontWeight: 800,
                    padding: '1px 7px', borderRadius: 20, minWidth: 22, textAlign: 'center'
                  }}>{cnt}</span>
                </button>
              )
            })}
          </div>

          {/* ── TOOLBAR RIGHT ─────────────────────────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', flexShrink: 0 }}>
            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', borderRadius: 6, padding: '6px 12px', gap: 8, minWidth: 200 }}>
              <Search size={13} color="var(--muted)" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search…"
                style={{ border: 'none', background: 'transparent', fontSize: '0.8rem', color: 'var(--text)', width: '100%' }}
              />
              {searchTerm && <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', padding: 0, display: 'flex' }}><X size={12} color="var(--muted)" /></button>}
            </div>

            {/* Filter toggle */}
            <button onClick={() => setShowFilters(f => !f)} style={{
              background: showFilters ? sheetBgLight : '#f1f5f9',
              color: showFilters ? sheetColor : 'var(--muted)',
              border: showFilters ? `1px solid ${sheetColor}44` : '1px solid transparent',
              borderRadius: 6, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer'
            }}>
              <Filter size={13} /> Filters
            </button>

            {/* Column manager */}
            <button onClick={() => setShowColManager(c => !c)} style={{
              background: '#f1f5f9', color: 'var(--muted)', border: '1px solid transparent',
              borderRadius: 6, padding: '7px 12px', display: 'flex', alignItems: 'center', gap: 6,
              fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer'
            }}>
              <Eye size={13} /> Columns
            </button>

            {/* Add Row */}
            {canEdit && (
              <button onClick={addRow} style={{
                background: sheetColor, color: '#fff', border: 'none',
                borderRadius: 6, padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 6,
                fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer'
              }}>
                <Plus size={13} /> Add Row
              </button>
            )}
          </div>
        </div>

        {/* ── FILTER BAR ────────────────────────────────────────────────── */}
        {showFilters && (
          <div style={{ display: 'flex', gap: 16, padding: '12px 20px', background: sheetBgLight, borderBottom: '1px solid var(--ghost-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.62rem', fontWeight: 800, color: sheetColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 5, border: '1px solid var(--ghost-border)', background: '#fff', fontSize: '0.8rem', cursor: 'pointer' }}>
                <option value="">All Statuses</option>
                {STATUS_OPTIONS.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.62rem', fontWeight: 800, color: sheetColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Type</label>
              <select value={filterType} onChange={e => setFilterType(e.target.value)}
                style={{ padding: '6px 10px', borderRadius: 5, border: '1px solid var(--ghost-border)', background: '#fff', fontSize: '0.8rem', cursor: 'pointer' }}>
                <option value="">All Types</option>
                {['PCR', 'TBR', 'OTR', '2W', 'LCV'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={() => { setFilterStatus(''); setFilterType(''); setSearchTerm('') }}
                style={{ background: 'none', border: '1px solid var(--ghost-border)', borderRadius: 5, padding: '6px 14px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' }}>
                Clear All
              </button>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', color: 'var(--muted)', fontSize: '0.75rem' }}>
              {filteredRows.length} of {sheetData[activeSheet]?.length || 0} rows
            </div>
          </div>
        )}

        {/* ── COLUMN MANAGER PANEL ──────────────────────────────────────── */}
        {showColManager && (
          <div style={{ padding: '12px 20px', background: '#f8fafc', borderBottom: '1px solid var(--ghost-border)', flexShrink: 0 }}>
            <p style={{ margin: '0 0 10px', fontSize: '0.7rem', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Toggle Columns — {SHEET_CONFIG[activeSheet].label}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {currentCols.map(col => {
                const hidden = !!hiddenCols[`${activeSheet}:${col.key}`]
                return (
                  <button key={col.key} onClick={() => toggleCol(col.key)} style={{
                    padding: '4px 12px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700,
                    border: `1px solid ${hidden ? '#e2e8f0' : sheetColor}`,
                    background: hidden ? '#f1f5f9' : sheetBgLight,
                    color: hidden ? '#94a3b8' : sheetColor,
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 5
                  }}>
                    {hidden ? <EyeOff size={11} /> : <Eye size={11} />} {col.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── SPREADSHEET TABLE ─────────────────────────────────────────── */}
        <div ref={tableWrapperRef} style={{ flex: 1, overflow: 'auto' }}>
          {filteredRows.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 280, gap: 12, color: 'var(--muted)' }}>
              <FileSpreadsheet size={40} color={sheetColor} style={{ opacity: 0.35 }} />
              <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>No records{searchTerm || filterStatus || filterType ? ' matching filters' : ' yet'}</p>
              {canEdit && !searchTerm && !filterStatus && !filterType && (
                <button onClick={addRow} style={{
                  background: sheetColor, color: '#fff', border: 'none', borderRadius: 6,
                  padding: '9px 20px', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 7
                }}>
                  <Plus size={14} /> Add First Row
                </button>
              )}
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                  {/* Row number */}
                  <th style={{
                    width: 42, minWidth: 42, maxWidth: 42,
                    background: '#f1f5f9',
                    color: 'var(--muted)', fontWeight: 800,
                    fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.06em',
                    borderRight: '2px solid var(--ghost-border)', borderBottom: `2px solid ${sheetColor}33`,
                    textAlign: 'center', padding: '10px 4px',
                    position: 'sticky', left: 0, zIndex: 20
                  }}>#</th>
                  {visibleCols.map(col => (
                    <th key={col.key} style={{
                      width: col.width, minWidth: col.width, maxWidth: col.width,
                      background: '#f1f5f9',
                      color: sheetColor, fontWeight: 800,
                      fontSize: '0.65rem', letterSpacing: '0.04em', textTransform: 'uppercase',
                      borderRight: '1px solid var(--ghost-border)',
                      borderBottom: `2px solid ${sheetColor}33`,
                      padding: '10px 10px',
                      textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                    }} title={col.label}>
                      {col.label}
                    </th>
                  ))}
                  {canEdit && (
                    <th style={{
                      width: 50, minWidth: 50, background: '#f1f5f9',
                      borderBottom: `2px solid ${sheetColor}33`,
                    }}></th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, rowIdx) => {
                  const isEven = rowIdx % 2 === 0
                  return (
                    <tr key={rowIdx} style={{ background: isEven ? '#fff' : '#fafbfc' }}
                      onMouseEnter={e => e.currentTarget.style.background = `${sheetColor}0a`}
                      onMouseLeave={e => e.currentTarget.style.background = isEven ? '#fff' : '#fafbfc'}
                    >
                      {/* Row number */}
                        <td style={{
                          width: 42, minWidth: 42, textAlign: 'center',
                          color: 'var(--muted)', fontSize: '0.7rem', fontWeight: 600,
                          borderRight: '2px solid var(--ghost-border)',
                          borderBottom: '1px solid #f1f5f9',
                          padding: '0 4px',
                          position: 'sticky', left: 0,
                          background: isEven ? '#f8fafc' : '#f3f4f6',
                          zIndex: 5,
                          cursor: 'pointer'
                        }} onClick={() => setSelectedDetailRow(row)} className="sno-trigger">
                          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="sno-text">{row.sno || rowIdx + 1}</span>
                            <Maximize2 size={10} className="sno-icon" style={{ position: 'absolute', opacity: 0 }} />
                          </div>
                        </td>

                      {visibleCols.map(col => (
                        <CostingCell
                          key={col.key}
                          col={col}
                          value={row[col.key] || ''}
                          canEdit={canEdit}
                          sheetColor={sheetColor}
                          isEditing={editingCell?.row === rowIdx && editingCell?.col === col.key}
                          onStartEdit={() => setEditingCell({ row: rowIdx, col: col.key })}
                          onEndEdit={() => setEditingCell(null)}
                          onChange={(val) => updateCell(activeSheet, rowIdx, col.key, val)}
                        />
                      ))}

                      {canEdit && (
                        <td style={{ borderBottom: '1px solid #f1f5f9', textAlign: 'center', padding: '0 4px' }}>
                          <button onClick={() => deleteRow(rowIdx)} title="Delete row" style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#fca5a5', padding: '4px 6px', borderRadius: 4,
                            fontSize: '0.7rem', fontWeight: 700, opacity: 0.6
                          }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1}
                            onMouseLeave={e => e.currentTarget.style.opacity = 0.6}
                          >✕</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {/* Empty rows for new entry */}
                {canEdit && (
                  <tr onClick={addRow} style={{ cursor: 'pointer', opacity: 0.4 }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = `${sheetColor}08` }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = 0.4; e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ textAlign: 'center', padding: '10px 4px', borderTop: '1px dashed var(--ghost-border)', color: sheetColor, fontWeight: 700, position: 'sticky', left: 0, background: 'inherit', zIndex: 5 }}>+</td>
                    <td colSpan={visibleCols.length + 1} style={{ padding: '10px 14px', borderTop: '1px dashed var(--ghost-border)', color: sheetColor, fontWeight: 700, fontSize: '0.75rem' }}>
                      Click to add new row
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* ── FOOTER ────────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 20px', background: '#f8fafc',
          borderTop: '1px solid var(--ghost-border)', flexShrink: 0,
          fontSize: '0.75rem', color: 'var(--muted)'
        }}>
          <div style={{ display: 'flex', gap: 24 }}>
            <span><strong style={{ color: 'var(--text)' }}>{filteredRows.length}</strong> rows shown</span>
            <span>Sheet: <strong style={{ color: sheetColor }}>{SHEET_CONFIG[activeSheet].label}</strong></span>
            <span><strong style={{ color: 'var(--text)' }}>{visibleCols.length}</strong> of <strong style={{ color: 'var(--text)' }}>{currentCols.length}</strong> columns visible</span>
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
            <span>Total Costing: <strong style={{ color: sheetColor, fontSize: '0.9rem' }}>
              ₹{stats.totalCost.toLocaleString('en-IN')}
            </strong></span>
            {dirty && (
              <button onClick={handleSave} disabled={saving} style={{
                background: sheetColor, color: '#fff',
                border: 'none', borderRadius: 5, padding: '6px 14px',
                fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6
              }}>
                <Save size={12} /> Save Changes
              </button>
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        table { min-width: max-content; }
        .sno-trigger:hover .sno-text { opacity: 0; }
        .sno-trigger:hover .sno-icon { opacity: 1 !important; color: ${sheetColor}; }
        .detail-field { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9; }
        .detail-field:last-child { border-bottom: none; }
        .detail-label { font-size: 0.72rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .detail-value { font-size: 0.88rem; font-weight: 600; color: var(--text); text-align: right; }
      `}</style>

      {selectedDetailRow && (
        <div className="modal-backdrop" onClick={() => setSelectedDetailRow(null)}>
          <div className="modal-card-wide" onClick={e => e.stopPropagation()} style={{ borderTop: `6px solid ${sheetColor}` }}>
            <div className="modal-title-bar" style={{ background: sheetColor, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Maximize2 size={20} />
                <span>ENTRY DETAILS - S.NO {selectedDetailRow.sno}</span>
              </div>
              <button onClick={() => setSelectedDetailRow(null)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>✕</button>
            </div>
            
            <div className="modal-body" style={{ padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
              {/* Left Column */}
              <div>
                <div className="form-section-divider" style={{ borderBottomColor: `${sheetColor}22` }}>
                  <h4 style={{ color: sheetColor }}>General Information</h4>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {currentCols.slice(0, Math.ceil(currentCols.length / 2)).map(col => (
                    <div key={col.key} className="detail-field">
                      <span className="detail-label">{col.label}</span>
                      <span className="detail-value">
                        {col.type === 'currency' ? (selectedDetailRow[col.key] ? `₹${Number(selectedDetailRow[col.key]).toLocaleString('en-IN')}` : '—') :
                         col.type === 'date' ? (selectedDetailRow[col.key] ? new Date(selectedDetailRow[col.key]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—') :
                         selectedDetailRow[col.key] || '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column */}
              <div>
                <div className="form-section-divider" style={{ borderBottomColor: `${sheetColor}22` }}>
                  <h4 style={{ color: sheetColor }}>Additional Data & Status</h4>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {currentCols.slice(Math.ceil(currentCols.length / 2)).map(col => (
                    <div key={col.key} className="detail-field">
                      <span className="detail-label">{col.label}</span>
                      <span className="detail-value">
                        {col.type === 'status' ? (
                          <span style={{ 
                            background: getStatusStyle(selectedDetailRow[col.key]).bg, 
                            color: getStatusStyle(selectedDetailRow[col.key]).color,
                            fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 10
                          }}>
                            {getStatusStyle(selectedDetailRow[col.key]).label}
                          </span>
                        ) : col.type === 'currency' ? (selectedDetailRow[col.key] ? `₹${Number(selectedDetailRow[col.key]).toLocaleString('en-IN')}` : '—') :
                           col.type === 'date' ? (selectedDetailRow[col.key] ? new Date(selectedDetailRow[col.key]).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—') :
                           selectedDetailRow[col.key] || '—'}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="form-section-divider" style={{ marginTop: '24px', borderBottomColor: `${sheetColor}22` }}>
                  <h4 style={{ color: sheetColor }}>System Metadata</h4>
                </div>
                <div className="detail-field">
                  <span className="detail-label">Last Updated</span>
                  <span className="detail-value">{selectedDetailRow._updatedAt ? new Date(selectedDetailRow._updatedAt.seconds * 1000).toLocaleString() : '—'}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-label">Updated By</span>
                  <span className="detail-value">{selectedDetailRow._updatedBy || '—'}</span>
                </div>
              </div>
            </div>

            <div className="modal-action-bar">
              <button className="button button-primary" onClick={() => setSelectedDetailRow(null)} style={{ background: sheetColor }}>
                Close Window
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CELL COMPONENT ──────────────────────────────────────────────────────────

function CostingCell({ col, value, canEdit, sheetColor, isEditing, onStartEdit, onEndEdit, onChange }) {
  const [localVal, setLocalVal] = useState(value)

  useEffect(() => { setLocalVal(value) }, [value])

  const commit = () => {
    if (localVal !== value) onChange(localVal)
    onEndEdit()
  }

  const tdStyle = {
    borderRight: '1px solid #f1f5f9',
    borderBottom: '1px solid #f1f5f9',
    padding: 0,
    verticalAlign: 'middle',
    minWidth: col.width,
    maxWidth: col.width,
    width: col.width,
    position: 'relative',
    overflow: 'hidden',
  }

  // READ-ONLY (auto/display) cell
  if (col.readOnly || !canEdit) {
    return (
      <td style={{ ...tdStyle, padding: '8px 10px', color: 'var(--muted)', fontSize: '0.75rem', textAlign: 'center' }}>
        {value}
      </td>
    )
  }

  // STATUS cell
  if (col.type === 'status') {
    const style = getStatusStyle(value)
    if (!isEditing) {
      return (
        <td style={tdStyle} onClick={onStartEdit}>
          <div style={{
            padding: '5px 8px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 36
          }}>
            {value ? (
              <span style={{
                background: style.bg, color: style.color,
                fontSize: '0.65rem', fontWeight: 800,
                padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap'
              }}>{style.label}</span>
            ) : (
              <span style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>—</span>
            )}
          </div>
        </td>
      )
    }
    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <select autoFocus value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={() => { onChange(localVal); onEndEdit() }}
          style={{ width: '100%', height: '100%', border: 'none', padding: '6px 8px', fontSize: '0.78rem', background: '#fff', cursor: 'pointer' }}>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s || '—'}</option>)}
        </select>
      </td>
    )
  }

  // SELECT cell
  if (col.type === 'select' && col.options) {
    if (!isEditing) {
      return (
        <td style={{ ...tdStyle, padding: '8px 10px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={onStartEdit}>
          <span style={{ fontSize: '0.78rem', color: value ? 'var(--text)' : '#cbd5e1' }}>{value || '—'}</span>
        </td>
      )
    }
    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <select autoFocus value={localVal} onChange={e => setLocalVal(e.target.value)} onBlur={() => { onChange(localVal); onEndEdit() }}
          style={{ width: '100%', height: '100%', border: 'none', padding: '6px 8px', fontSize: '0.78rem', background: '#fff', cursor: 'pointer' }}>
          {(col.options || []).map(o => <option key={o} value={o}>{o || '—'}</option>)}
        </select>
      </td>
    )
  }

  // CURRENCY cell
  if (col.type === 'currency') {
    if (!isEditing) {
      return (
        <td style={{ ...tdStyle, padding: '8px 10px', cursor: 'text', textAlign: 'right' }} onClick={onStartEdit}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: value ? '#0f766e' : '#cbd5e1', fontFamily: 'monospace' }}>
            {value ? `₹${Number(value).toLocaleString('en-IN')}` : '—'}
          </span>
        </td>
      )
    }
    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <input autoFocus type="number" value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commit() }}
          style={{ width: '100%', height: '100%', border: 'none', padding: '6px 10px', fontSize: '0.78rem', textAlign: 'right' }}
        />
      </td>
    )
  }

  // DATE cell
  if (col.type === 'date') {
    const displayVal = value ? (() => {
      const d = new Date(value)
      return isNaN(d) ? value : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    })() : ''
    if (!isEditing) {
      return (
        <td style={{ ...tdStyle, padding: '8px 10px', cursor: 'text', whiteSpace: 'nowrap' }} onClick={onStartEdit}>
          <span style={{ fontSize: '0.75rem', color: value ? 'var(--text)' : '#cbd5e1' }}>{displayVal || '—'}</span>
        </td>
      )
    }
    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <input autoFocus type="date" value={localVal?.split('T')[0] || localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={commit}
          style={{ width: '100%', height: '100%', border: 'none', padding: '6px 10px', fontSize: '0.78rem' }}
        />
      </td>
    )
  }

  // DEFAULT TEXT/NUMBER cell
  if (!isEditing) {
    return (
      <td style={{ ...tdStyle, padding: '8px 10px', cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} onClick={onStartEdit} title={String(value)}>
        <span style={{ fontSize: '0.78rem', color: value ? 'var(--text)' : '#cbd5e1' }}>{fmt(value) || ''}</span>
      </td>
    )
  }
  return (
    <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
      <input autoFocus value={localVal}
        onChange={e => setLocalVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Tab') commit() }}
        style={{ width: '100%', height: 36, border: 'none', padding: '6px 10px', fontSize: '0.78rem', background: '#fff' }}
      />
    </td>
  )
}
