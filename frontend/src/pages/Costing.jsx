import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import {
  AlertCircle,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Filter,
  Loader,
  Maximize2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Upload,
  X,
} from 'lucide-react'
import { db } from '../firebase'
import { formatCurrency, formatDateTime } from '../lib/format'
import { ROLES } from '../lib/constants'
import { canEditCosting } from '../lib/permissions'
import { useAuth } from '../contexts/AuthContext'
import {
  PAGE_SIZE_OPTIONS,
  SHEET_CONFIG,
  SHEET_KEYS,
  STATUS_FILTER_OPTIONS,
  buildEmptyWorkbook,
  buildSheetSummaryEntry,
  calculateSheetTotal,
  chunkSheetRows,
  getSheetDocId,
  normalizeStoredRows,
  parseCostingWorkbook,
} from '../lib/costingWorkbook'

const BATCH_LIMIT = 450
const STATUS_OPTIONS = ['Done', 'In Progress', 'Pending', 'Not Started', '']

const STATUS_STYLES = {
  Done: { bg: '#dcfce7', color: '#15803d', label: 'Done' },
  'In Progress': { bg: '#fef3c7', color: '#a16207', label: 'In Progress' },
  Pending: { bg: '#fee2e2', color: '#b91c1c', label: 'Pending' },
  'Not Started': { bg: '#f1f5f9', color: '#64748b', label: 'Not Started' },
  '': { bg: 'transparent', color: '#94a3b8', label: '—' },
}

function getChunkId(index) {
  return `chunk-${String(index + 1).padStart(4, '0')}`
}

function getStatusStyle(value) {
  if (!value || value === '') {
    return STATUS_STYLES['']
  }

  const lower = String(value).toLowerCase()

  if (lower === 'done') {
    return STATUS_STYLES.Done
  }

  if (lower.includes('progress') || lower.includes('ongoing') || lower.includes('on going')) {
    return STATUS_STYLES['In Progress']
  }

  if (lower === 'pending') {
    return STATUS_STYLES.Pending
  }

  if (lower === 'not started') {
    return STATUS_STYLES['Not Started']
  }

  return {
    bg: '#f1f5f9',
    color: '#475569',
    label: String(value),
  }
}

function fmt(value) {
  if (!value && value !== 0) {
    return ''
  }

  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }
  }

  return String(value)
}

function buildActor(profile, currentUser) {
  return {
    name: profile?.name || 'Unknown User',
    email: currentUser?.email || profile?.email || 'unknown@local',
  }
}

async function commitOperations(operations) {
  for (let index = 0; index < operations.length; index += BATCH_LIMIT) {
    const batch = writeBatch(db)
    const slice = operations.slice(index, index + BATCH_LIMIT)

    slice.forEach((operation) => {
      if (operation.type === 'delete') {
        batch.delete(operation.ref)
        return
      }

      batch.set(operation.ref, operation.data)
    })

    await batch.commit()
  }
}

function buildWorkbookOperations(sheetData, previousSummary, actor) {
  const operations = []

  SHEET_KEYS.forEach((sheetKey) => {
    const sheetDocId = getSheetDocId(sheetKey)
    const rows = normalizeStoredRows(sheetKey, sheetData[sheetKey] || [])
    const chunks = chunkSheetRows(rows)
    const summary = buildSheetSummaryEntry(sheetKey, rows)
    const previousChunkCount = previousSummary[sheetKey]?.chunkCount || 0
    const targetChunkCount = Math.max(previousChunkCount, chunks.length)

    operations.push({
      type: 'set',
      ref: doc(db, 'costing_master', 'v1', 'sheets', sheetDocId),
      data: {
        sheetKey,
        label: SHEET_CONFIG[sheetKey].label,
        rowCount: summary.rowCount,
        totalCost: summary.totalCost,
        chunkCount: summary.chunkCount,
        updatedAt: serverTimestamp(),
        updatedBy: actor.name,
        updatedByEmail: actor.email,
      },
    })

    for (let chunkIndex = 0; chunkIndex < targetChunkCount; chunkIndex += 1) {
      const chunkRef = doc(db, 'costing_master', 'v1', 'sheets', sheetDocId, 'chunks', getChunkId(chunkIndex))

      if (chunkIndex < chunks.length) {
        operations.push({
          type: 'set',
          ref: chunkRef,
          data: {
            chunkIndex,
            rowCount: chunks[chunkIndex].length,
            rows: chunks[chunkIndex],
            updatedAt: serverTimestamp(),
            updatedBy: actor.name,
          },
        })
      } else {
        operations.push({
          type: 'delete',
          ref: chunkRef,
        })
      }
    }
  })

  return operations
}

async function loadStructuredWorkbook() {
  const workbook = buildEmptyWorkbook()

  const snapshots = await Promise.all(
    SHEET_KEYS.map((sheetKey) => getDocs(collection(db, 'costing_master', 'v1', 'sheets', getSheetDocId(sheetKey), 'chunks'))),
  )

  snapshots.forEach((snapshot, index) => {
    const sheetKey = SHEET_KEYS[index]
    const rows = snapshot.docs
      .map((item) => item.data())
      .sort((left, right) => Number(left.chunkIndex || 0) - Number(right.chunkIndex || 0))
      .flatMap((item) => item.rows || [])

    workbook[sheetKey] = normalizeStoredRows(sheetKey, rows)
  })

  return workbook
}

async function buildWorkbookStateFromSnapshot(snapshot) {
  if (!snapshot.exists()) {
    return {
      workbook: buildEmptyWorkbook(),
      metadata: {
        exists: false,
        importMeta: null,
        sheetSummary: {},
        updatedAt: null,
        updatedBy: '',
        updatedByEmail: '',
        version: 0,
        hasLegacyData: false,
      },
    }
  }

  const data = snapshot.data()
  const hasStructuredWorkbook = (data.version || 0) >= 2 || Object.keys(data.sheetSummary || {}).length > 0
  const legacyWorkbook = buildEmptyWorkbook()
  let hasLegacyData = false

  if (!hasStructuredWorkbook) {
    SHEET_KEYS.forEach((sheetKey) => {
      if (Array.isArray(data[sheetKey])) {
        legacyWorkbook[sheetKey] = normalizeStoredRows(sheetKey, data[sheetKey])
        hasLegacyData = true
      }
    })
  }

  return {
    workbook: hasStructuredWorkbook ? await loadStructuredWorkbook() : legacyWorkbook,
    metadata: {
      exists: true,
      importMeta: data.importMeta || null,
      sheetSummary: data.sheetSummary || {},
      updatedAt: data.updatedAt || null,
      updatedBy: data.updatedBy || '',
      updatedByEmail: data.updatedByEmail || '',
      version: data.version || 0,
      hasLegacyData,
    },
  }
}

function buildBlankRow(sheetKey, rowNumber) {
  const row = {}

  SHEET_CONFIG[sheetKey].columns.forEach((column) => {
    row[column.key] = column.key === 'sno' ? rowNumber : ''
  })

  return row
}

function getColumnConfig(sheetKey, columnKey) {
  return SHEET_CONFIG[sheetKey].columns.find((column) => column.key === columnKey)
}

function normalizeCellInput(column, value) {
  if (!column) {
    return value ?? ''
  }

  if (value === null || value === undefined) {
    return ''
  }

  if (column.type === 'number' || column.type === 'currency') {
    return value === '' ? '' : Number(value)
  }

  if (column.type === 'date') {
    if (!value) {
      return ''
    }

    if (typeof value === 'string') {
      return value.split('T')[0]
    }

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().split('T')[0]
  }

  return String(value)
}

function parseClipboardMatrix(rawText) {
  return String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((row, index, rows) => !(index === rows.length - 1 && row === ''))
    .map((row) => row.split('\t'))
}

function buildFillValue(baseValue, offset, column) {
  if (baseValue === '' || baseValue === null || baseValue === undefined) {
    return ''
  }

  if ((column.type === 'number' || column.type === 'currency') && !Number.isNaN(Number(baseValue))) {
    return Number(baseValue) + offset
  }

  if (column.type === 'date') {
    const parsed = new Date(baseValue)
    if (!Number.isNaN(parsed.getTime())) {
      parsed.setDate(parsed.getDate() + offset)
      return parsed.toISOString().split('T')[0]
    }
  }

  return baseValue
}

export default function Costing() {
  const { currentUser, profile } = useAuth()
  const canEdit = canEditCosting(profile)
  const isHod = profile?.role === ROLES.HOD

  const [activeSheet, setActiveSheet] = useState(SHEET_KEYS[0])
  const [sheetData, setSheetData] = useState(() => buildEmptyWorkbook())
  const [metadata, setMetadata] = useState({
    exists: false,
    importMeta: null,
    sheetSummary: {},
    updatedAt: null,
    updatedBy: '',
    updatedByEmail: '',
    version: 0,
    hasLegacyData: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [stagedImport, setStagedImport] = useState(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [hiddenCols, setHiddenCols] = useState({})
  const [showColManager, setShowColManager] = useState(false)
  const [editingCell, setEditingCell] = useState(null)
  const [selectedCell, setSelectedCell] = useState(null)
  const [fillDrag, setFillDrag] = useState(null)
  const [selectedDetailRowIndex, setSelectedDetailRowIndex] = useState(null)
  const [detailDraft, setDetailDraft] = useState(null)
  const [detailDirty, setDetailDirty] = useState(false)
  const [pageSize, setPageSize] = useState(PAGE_SIZE_OPTIONS[1])
  const [page, setPage] = useState(1)

  const fileInputRef = useRef(null)
  const tableWrapperRef = useRef(null)
  const fillDragRef = useRef(null)

  const currentCols = SHEET_CONFIG[activeSheet].columns
  const sheetColor = SHEET_CONFIG[activeSheet].color
  const sheetBgLight = SHEET_CONFIG[activeSheet].tint

  const hydrateFromSnapshot = useCallback(async (snapshot) => {
    const nextState = await buildWorkbookStateFromSnapshot(snapshot)
    setSheetData(nextState.workbook)
    setMetadata(nextState.metadata)
    setDirty(false)
    setStagedImport(null)
  }, [])

  useEffect(() => {
    let active = true

    const unsubscribe = onSnapshot(
      doc(db, 'costing_master', 'v1'),
      async (snapshot) => {
        if (!active) {
          return
        }

        setLoading(true)

        try {
          if (!active) {
            return
          }

          await hydrateFromSnapshot(snapshot)
        } catch (error) {
          console.error(error)
          if (active) {
            toast.error('Failed to load costing workbook.')
          }
        } finally {
          if (active) {
            setLoading(false)
          }
        }
      },
      (error) => {
        console.error(error)
        if (active) {
          toast.error('Failed to subscribe to costing workbook.')
          setLoading(false)
        }
      },
    )

    return () => {
      active = false
      unsubscribe()
    }
  }, [hydrateFromSnapshot])

  useEffect(() => {
    setPage(1)
    setEditingCell(null)
    setSelectedCell(null)
    setSelectedDetailRowIndex(null)
  }, [activeSheet, searchTerm, filterStatus, filterType, pageSize])

  const filteredRows = useMemo(() => {
    let rows = (sheetData[activeSheet] || []).map((row, sourceIndex) => ({ ...row, __sourceIndex: sourceIndex }))

    if (searchTerm) {
      const query = searchTerm.toLowerCase()
      rows = rows.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(query)))
    }

    if (filterStatus) {
      rows = rows.filter((row) => {
        const source = row.finalStatus || row.testStatus || row.status || row.reportCosting || ''
        return getStatusStyle(source).label.toLowerCase() === filterStatus.toLowerCase()
      })
    }

    if (filterType) {
      rows = rows.filter((row) => String(row.type || '').toLowerCase() === filterType.toLowerCase())
    }

    return rows
  }, [sheetData, activeSheet, searchTerm, filterStatus, filterType])

  const stats = useMemo(() => {
    const rows = sheetData[activeSheet] || []
    const totalCost = rows.reduce((sum, row) => sum + (Number(row.costing) || 0), 0)
    const doneCount = rows.filter((row) => String(row.finalStatus || row.testStatus || row.status || '').toLowerCase() === 'done').length
    const pendingCount = rows.filter((row) => String(row.finalStatus || row.testStatus || row.status || '').toLowerCase() === 'pending').length

    return {
      total: rows.length,
      totalCost,
      doneCount,
      pendingCount,
    }
  }, [sheetData, activeSheet])

  const visibleCols = useMemo(
    () => currentCols.filter((column) => !hiddenCols[`${activeSheet}:${column.key}`]),
    [activeSheet, currentCols, hiddenCols],
  )

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStartIndex = (currentPage - 1) * pageSize
  const pageRows = filteredRows.slice(pageStartIndex, pageStartIndex + pageSize)
  const selectedDetailRow = selectedDetailRowIndex === null ? null : (sheetData[activeSheet] || [])[selectedDetailRowIndex] || null
  const detailValues = detailDraft || selectedDetailRow

  useEffect(() => {
    if (!selectedDetailRow) {
      setDetailDraft(null)
      setDetailDirty(false)
      return
    }

    setDetailDraft({ ...selectedDetailRow })
    setDetailDirty(false)
  }, [selectedDetailRow])

  const mutateSheetRows = useCallback((sheetKey, updater) => {
    setSheetData((current) => {
      const baseRows = [...(current[sheetKey] || [])].map((row) => ({ ...row }))
      const nextRows = updater(baseRows) || baseRows

      return {
        ...current,
        [sheetKey]: nextRows.map((row, index) => ({
          ...buildBlankRow(sheetKey, index + 1),
          ...row,
          sno: index + 1,
        })),
      }
    })

    setDirty(true)
  }, [])

  const updateCell = useCallback((sheetKey, rowIdx, colKey, value) => {
    mutateSheetRows(sheetKey, (rows) => {
      const column = getColumnConfig(sheetKey, colKey)

      while (rows.length <= rowIdx) {
        rows.push(buildBlankRow(sheetKey, rows.length + 1))
      }

      rows[rowIdx] = {
        ...rows[rowIdx],
        [colKey]: normalizeCellInput(column, value),
      }

      return rows
    })
  }, [mutateSheetRows])

  const addRow = useCallback(() => {
    mutateSheetRows(activeSheet, (rows) => {
      rows.push(buildBlankRow(activeSheet, rows.length + 1))
      return rows
    })
  }, [activeSheet, mutateSheetRows])

  const deleteRow = useCallback((rowIdx) => {
    mutateSheetRows(activeSheet, (rows) => rows.filter((_, index) => index !== rowIdx))
    if (selectedDetailRowIndex === rowIdx) {
      setSelectedDetailRowIndex(null)
      setDetailDraft(null)
      setDetailDirty(false)
    }
    if (selectedCell?.row === rowIdx) {
      setSelectedCell(null)
    }
  }, [activeSheet, mutateSheetRows, selectedCell, selectedDetailRowIndex])

  const applyAutoFill = useCallback((sheetKey, startRow, endRow, colKey, startValue) => {
    const column = getColumnConfig(sheetKey, colKey)
    if (!column || column.readOnly) {
      return
    }

    mutateSheetRows(sheetKey, (rows) => {
      const lower = Math.min(startRow, endRow)
      const upper = Math.max(startRow, endRow)

      while (rows.length <= upper) {
        rows.push(buildBlankRow(sheetKey, rows.length + 1))
      }

      for (let rowIndex = lower; rowIndex <= upper; rowIndex += 1) {
        if (rowIndex === startRow) {
          continue
        }

        rows[rowIndex] = {
          ...rows[rowIndex],
          [colKey]: buildFillValue(startValue, rowIndex - startRow, column),
        }
      }

      return rows
    })
  }, [mutateSheetRows])

  useEffect(() => {
    function handleMouseUp() {
      const currentDrag = fillDragRef.current
      if (!currentDrag) {
        return
      }

      if (currentDrag.endRow !== null && currentDrag.endRow !== currentDrag.startRow) {
        applyAutoFill(currentDrag.sheetKey, currentDrag.startRow, currentDrag.endRow, currentDrag.colKey, currentDrag.startValue)
      }

      fillDragRef.current = null
      setFillDrag(null)
    }

    window.addEventListener('mouseup', handleMouseUp)
    return () => window.removeEventListener('mouseup', handleMouseUp)
  }, [applyAutoFill])

  async function handleImport(event) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const parsed = parseCostingWorkbook(await file.arrayBuffer())

      setSheetData(parsed.sheets)
      setDirty(true)
      setActiveSheet(SHEET_KEYS[0])
      setSearchTerm('')
      setFilterStatus('')
      setFilterType('')
      setSelectedDetailRowIndex(null)
      setEditingCell(null)
      setStagedImport({
        sourceFileName: file.name,
        importedAt: new Date().toISOString(),
        importedByName: profile?.name || 'Unknown User',
        importedByEmail: currentUser?.email || profile?.email || 'unknown@local',
        totalRows: SHEET_KEYS.reduce((sum, sheetKey) => sum + Number(parsed.sheetSummary[sheetKey]?.rowCount || 0), 0),
        totalCost: SHEET_KEYS.reduce((sum, sheetKey) => sum + Number(parsed.sheetSummary[sheetKey]?.totalCost || 0), 0),
        extraSheets: parsed.extraSheets,
      })

      toast.success(`Imported ${file.name} successfully.`)
      if (parsed.extraSheets.length > 0) {
        console.info('Ignored extra workbook sheets:', parsed.extraSheets)
      }
    } catch (error) {
      console.error(error)
      toast.error(`Failed to import Excel: ${error.message}`)
    } finally {
      event.target.value = ''
    }
  }

  function handleExport() {
    const workbook = XLSX.utils.book_new()

    SHEET_KEYS.forEach((sheetKey) => {
      const columns = SHEET_CONFIG[sheetKey].columns
      const rows = sheetData[sheetKey] || []
      const header = columns.map((column) => column.label)
      const body = rows.map((row) => columns.map((column) => row[column.key] || ''))
      const worksheet = XLSX.utils.aoa_to_sheet([header, ...body])
      worksheet['!cols'] = columns.map((column) => ({ wch: Math.max(10, Math.round(column.width / 7)) }))
      XLSX.utils.book_append_sheet(workbook, worksheet, SHEET_CONFIG[sheetKey].aliases[0])
    })

    XLSX.writeFile(workbook, `Costing_${new Date().toISOString().split('T')[0]}.xlsx`)
    toast.success('Exported workbook successfully.')
  }

  async function handleSave() {
    setSaving(true)

    try {
      const actor = buildActor(profile, currentUser)
      const nextSummary = SHEET_KEYS.reduce((accumulator, sheetKey) => {
        accumulator[sheetKey] = buildSheetSummaryEntry(sheetKey, sheetData[sheetKey] || [])
        return accumulator
      }, {})

      await commitOperations(buildWorkbookOperations(sheetData, metadata.sheetSummary, actor))

      await setDoc(
        doc(db, 'costing_master', 'v1'),
        {
          version: 2,
          sheetSummary: nextSummary,
          importMeta: stagedImport || metadata.importMeta || null,
          updatedAt: serverTimestamp(),
          updatedBy: actor.name,
          updatedByEmail: actor.email,
        },
        { merge: true },
      )

      setDirty(false)
      if (stagedImport) {
        setMetadata((current) => ({
          ...current,
          importMeta: stagedImport,
        }))
        setStagedImport(null)
      }
      toast.success('Costing workbook saved successfully.')
    } catch (error) {
      console.error(error)
      toast.error(`Failed to save workbook: ${error.message}`)
    } finally {
      setSaving(false)
    }
  }

  function triggerImport() {
    if (!isHod) {
      return
    }

    fileInputRef.current?.click()
  }

  function toggleCol(columnKey) {
    setHiddenCols((current) => ({
      ...current,
      [`${activeSheet}:${columnKey}`]: !current[`${activeSheet}:${columnKey}`],
    }))
  }

  function updateDetailDraft(columnKey, value) {
    const column = getColumnConfig(activeSheet, columnKey)

    if (!column || column.readOnly) {
      return
    }

    setDetailDraft((current) => ({
      ...(current || {}),
      [columnKey]: normalizeCellInput(column, value),
    }))
    setDetailDirty(true)
  }

  function handleDetailSave() {
    if (!canEdit || selectedDetailRowIndex === null || !detailDraft) {
      return
    }

    mutateSheetRows(activeSheet, (rows) => {
      if (!rows[selectedDetailRowIndex]) {
        return rows
      }

      rows[selectedDetailRowIndex] = {
        ...rows[selectedDetailRowIndex],
        ...detailDraft,
      }

      return rows
    })

    setDetailDirty(false)
    toast.success('Entry details updated.')
  }

  async function handleRefresh() {
    if (dirty) {
      toast.error('Save or discard your current changes before reloading.')
      return
    }

    setLoading(true)

    try {
      const snapshot = await getDoc(doc(db, 'costing_master', 'v1'))
      await hydrateFromSnapshot(snapshot)
      toast.success('Costing workbook reloaded.')
    } catch (error) {
      console.error(error)
      toast.error('Failed to reload costing workbook.')
    } finally {
      setLoading(false)
    }
  }

  function handleGridPaste(event) {
    if (!canEdit || !selectedCell || editingCell) {
      return
    }

    const matrix = parseClipboardMatrix(event.clipboardData?.getData('text/plain'))
    if (!matrix.length) {
      return
    }

    const startColumnIndex = visibleCols.findIndex((column) => column.key === selectedCell.col)
    if (startColumnIndex === -1) {
      return
    }

    event.preventDefault()

    mutateSheetRows(activeSheet, (rows) => {
      const lastTargetRow = selectedCell.row + matrix.length - 1

      while (rows.length <= lastTargetRow) {
        rows.push(buildBlankRow(activeSheet, rows.length + 1))
      }

      matrix.forEach((cells, rowOffset) => {
        const targetRowIndex = selectedCell.row + rowOffset

        cells.forEach((cellValue, colOffset) => {
          const column = visibleCols[startColumnIndex + colOffset]
          if (!column || column.readOnly) {
            return
          }

          rows[targetRowIndex] = {
            ...rows[targetRowIndex],
            [column.key]: normalizeCellInput(column, cellValue),
          }
        })
      })

      return rows
    })

    toast.success(`Pasted ${matrix.length} row(s) into the grid.`)
  }

  async function copySelectedCell() {
    if (!selectedCell) {
      return
    }

    const value = (sheetData[activeSheet] || [])[selectedCell.row]?.[selectedCell.col] ?? ''

    try {
      await navigator.clipboard.writeText(value === null || value === undefined ? '' : String(value))
      toast.success('Cell copied.')
    } catch (error) {
      console.error(error)
      toast.error('Clipboard copy is not available in this browser.')
    }
  }

  function moveSelection(rowDelta, colDelta) {
    if (!selectedCell) {
      return
    }

    const visibleRowIndex = pageRows.findIndex((row) => row.__sourceIndex === selectedCell.row)
    const nextRowIndex = Math.max(0, Math.min(pageRows.length - 1, visibleRowIndex + rowDelta))
    const nextColIndex = Math.max(0, Math.min(visibleCols.length - 1, selectedColumnIndex + colDelta))

    if (nextRowIndex < 0 || nextColIndex < 0 || !pageRows[nextRowIndex] || !visibleCols[nextColIndex]) {
      return
    }

    setSelectedCell({
      row: pageRows[nextRowIndex].__sourceIndex,
      col: visibleCols[nextColIndex].key,
    })
  }

  function handleGridKeyDown(event) {
    if (!selectedCell || editingCell) {
      return
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      copySelectedCell()
      return
    }

    if (event.key === 'Enter' && canEdit) {
      event.preventDefault()
      setEditingCell(selectedCell)
      return
    }

    if (event.key === 'Delete' && canEdit) {
      event.preventDefault()
      updateCell(activeSheet, selectedCell.row, selectedCell.col, '')
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSelection(1, 0)
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(-1, 0)
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      moveSelection(0, -1)
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault()
      moveSelection(0, 1)
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', flexDirection: 'column', gap: 16 }}>
        <Loader size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
        <p style={{ color: 'var(--muted)', fontWeight: 600 }}>Loading costing workbook...</p>
      </div>
    )
  }

  return (
    <div className="page" style={{ height: 'calc(100vh - 78px)', display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', width: '100%', maxWidth: '100%', minWidth: 0 }}>
      <div style={{ padding: '6px 8px 0', flexShrink: 0, minWidth: 0, maxWidth: '100%', width: '100%', overflowX: 'clip', boxSizing: 'border-box' }}>
        <div className="page-header" style={{ marginBottom: 6, minWidth: 0, maxWidth: '100%', width: '100%', overflow: 'hidden', boxSizing: 'border-box', gap: 12 }}>
          <div style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
              <FileSpreadsheet size={22} color={sheetColor} />
              <h1 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, lineHeight: 1.1 }}>Costing Register</h1>
              <span
                style={{
                  background: sheetBgLight,
                  color: sheetColor,
                  fontSize: '0.62rem',
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  padding: '2px 9px',
                  borderRadius: 20,
                  border: `1px solid ${sheetColor}33`,
                }}
              >
                MASTER WORKBOOK / MULTI SHEET
              </span>
              {dirty ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#d97706', fontSize: '0.68rem', fontWeight: 700 }}>
                  <AlertCircle size={13} />
                  Unsaved changes
                </span>
              ) : null}
            </div>
            {metadata.importMeta || stagedImport ? (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4, fontSize: '0.68rem', color: '#475569', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
                <span><strong>Source:</strong> {(stagedImport || metadata.importMeta)?.sourceFileName || 'NA'}</span>
                <span><strong>Imported By:</strong> {(stagedImport || metadata.importMeta)?.importedByName || metadata.updatedBy || 'NA'}</span>
                <span><strong>Imported At:</strong> {(stagedImport || metadata.importMeta)?.importedAt ? formatDateTime((stagedImport || metadata.importMeta).importedAt) : 'NA'}</span>
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', minWidth: 0, maxWidth: '100%' }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} />
            {isHod ? (
              <button className="button button-secondary" onClick={triggerImport} style={{ gap: 6, fontSize: '0.72rem', padding: '8px 12px' }}>
                <Upload size={14} />
                Import Excel
              </button>
            ) : null}
            <button className="button button-secondary" onClick={handleExport} style={{ gap: 6, fontSize: '0.72rem', padding: '8px 12px' }}>
              <Download size={14} />
              Export
            </button>
            <button className="button button-secondary" onClick={handleRefresh} style={{ gap: 6, fontSize: '0.72rem', padding: '8px 12px' }}>
              <RefreshCw size={14} />
              Refresh
            </button>
            <button
              className={`button ${dirty ? 'button-primary' : 'button-secondary'}`}
              onClick={handleSave}
              disabled={saving}
              style={{ gap: 6, fontSize: '0.72rem', padding: '8px 12px' }}
            >
              {saving ? <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {stagedImport ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16,
              marginBottom: 8,
              padding: '8px 12px',
              borderRadius: 10,
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1d4ed8',
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
              overflow: 'hidden',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ fontSize: '0.72rem', lineHeight: 1.45, minWidth: 0, overflowWrap: 'anywhere' }}>
              <strong>{stagedImport.sourceFileName}</strong> is staged locally with {stagedImport.totalRows.toLocaleString('en-IN')} rows and {formatCurrency(stagedImport.totalCost)} total costing.
              {stagedImport.extraSheets?.length ? ` ${stagedImport.extraSheets.length} extra workbook tab(s) were ignored.` : ''}
            </div>
            <button
              type="button"
              onClick={() => setStagedImport(null)}
              style={{ background: 'transparent', border: 'none', color: '#1d4ed8', cursor: 'pointer', fontWeight: 700 }}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid var(--ghost-border)', borderRadius: 0, margin: '0 0 0', overflow: 'hidden', boxShadow: 'none', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', borderBottom: '1px solid var(--ghost-border)', background: '#f8fafc', flexShrink: 0, minWidth: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', overflow: 'auto', minWidth: 0 }}>
            {SHEET_KEYS.map((sheetKey) => {
              const config = SHEET_CONFIG[sheetKey]
              const isActive = activeSheet === sheetKey
              const count = (sheetData[sheetKey] || []).length

              return (
                <button
                  key={sheetKey}
                  onClick={() => setActiveSheet(sheetKey)}
                  style={{
                    padding: '10px 16px',
                    border: 'none',
                    borderBottom: isActive ? `3px solid ${config.color}` : '3px solid transparent',
                    background: isActive ? '#fff' : 'transparent',
                    color: isActive ? config.color : 'var(--muted)',
                    fontWeight: isActive ? 800 : 600,
                    fontSize: '0.68rem',
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span>{config.label.toUpperCase()}</span>
                  <span
                    style={{
                      background: isActive ? config.color : '#e2e8f0',
                      color: isActive ? '#fff' : 'var(--muted)',
                      fontSize: '0.58rem',
                      fontWeight: 800,
                      padding: '1px 7px',
                      borderRadius: 20,
                      minWidth: 22,
                      textAlign: 'center',
                    }}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', borderRadius: 6, padding: '5px 10px', gap: 8, minWidth: 180, maxWidth: 260 }}>
              <Search size={13} color="var(--muted)" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search..."
                style={{ border: 'none', background: 'transparent', fontSize: '0.76rem', color: 'var(--text)', width: '100%' }}
              />
              {searchTerm ? (
                <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', padding: 0, display: 'flex' }}>
                  <X size={12} color="var(--muted)" />
                </button>
              ) : null}
            </div>

            <button
              onClick={() => setShowFilters((current) => !current)}
              style={{
                background: showFilters ? sheetBgLight : '#f1f5f9',
                color: showFilters ? sheetColor : 'var(--muted)',
                border: showFilters ? `1px solid ${sheetColor}44` : '1px solid transparent',
                borderRadius: 6,
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.68rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Filter size={13} />
              Filters
            </button>

            <button
              onClick={() => setShowColManager((current) => !current)}
              style={{
                background: '#f1f5f9',
                color: 'var(--muted)',
                border: '1px solid transparent',
                borderRadius: 6,
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.68rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Eye size={13} />
              Columns
            </button>

            {canEdit ? (
              <button
                onClick={addRow}
                style={{
                  background: sheetColor,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '6px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.68rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                <Plus size={13} />
                Add Row
              </button>
            ) : null}
          </div>
        </div>

        {showFilters ? (
          <div style={{ display: 'flex', gap: 12, padding: '8px 12px', background: sheetBgLight, borderBottom: '1px solid var(--ghost-border)', flexShrink: 0, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.62rem', fontWeight: 800, color: sheetColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</label>
              <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--ghost-border)', background: '#fff', fontSize: '0.76rem', cursor: 'pointer' }}>
                <option value="">All Statuses</option>
                {STATUS_FILTER_OPTIONS.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.62rem', fontWeight: 800, color: sheetColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Type</label>
              <select value={filterType} onChange={(event) => setFilterType(event.target.value)} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--ghost-border)', background: '#fff', fontSize: '0.76rem', cursor: 'pointer' }}>
                <option value="">All Types</option>
                {['PCR', 'TBR', 'OTR', '2W', 'LCV'].map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: '0.62rem', fontWeight: 800, color: sheetColor, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Page Size</label>
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--ghost-border)', background: '#fff', fontSize: '0.76rem', cursor: 'pointer' }}>
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size} rows</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button onClick={() => { setFilterStatus(''); setFilterType(''); setSearchTerm(''); setSelectedCell(null) }} style={{ background: 'none', border: '1px solid var(--ghost-border)', borderRadius: 5, padding: '5px 10px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--muted)', cursor: 'pointer' }}>
                Clear All
              </button>
            </div>

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'flex-end', color: 'var(--muted)', fontSize: '0.75rem' }}>
              {filteredRows.length} of {(sheetData[activeSheet] || []).length} rows
            </div>
          </div>
        ) : null}

        {showColManager ? (
          <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid var(--ghost-border)', flexShrink: 0 }}>
            <p style={{ margin: '0 0 8px', fontSize: '0.66rem', fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Toggle Columns - {SHEET_CONFIG[activeSheet].label}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {currentCols.map((column) => {
                const hidden = Boolean(hiddenCols[`${activeSheet}:${column.key}`])

                return (
                  <button
                    key={column.key}
                    onClick={() => toggleCol(column.key)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 20,
                      fontSize: '0.66rem',
                      fontWeight: 700,
                      border: `1px solid ${hidden ? '#e2e8f0' : sheetColor}`,
                      background: hidden ? '#f1f5f9' : sheetBgLight,
                      color: hidden ? '#94a3b8' : sheetColor,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 5,
                    }}
                  >
                    {hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                    {column.label}
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div
          ref={tableWrapperRef}
          tabIndex={0}
          onKeyDown={handleGridKeyDown}
          onPaste={handleGridPaste}
          onMouseDown={() => tableWrapperRef.current?.focus()}
          style={{ flex: 1, overflow: 'auto', minWidth: 0, outline: 'none', position: 'relative', padding: 0 }}
        >
          {pageRows.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 280, gap: 12, color: 'var(--muted)' }}>
              <FileSpreadsheet size={40} color={sheetColor} style={{ opacity: 0.35 }} />
              <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>No records{searchTerm || filterStatus || filterType ? ' matching filters' : ' yet'}</p>
              {canEdit && !searchTerm && !filterStatus && !filterType ? (
                <button
                  onClick={addRow}
                  style={{
                    background: sheetColor,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '9px 20px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                  }}
                >
                  <Plus size={14} />
                  Add First Row
                </button>
              ) : null}
            </div>
          ) : (
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', fontSize: '0.82rem', minWidth: '100%', width: 'max-content' }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                  {visibleCols.map((column, columnIndex) => (
                    <th
                      key={column.key}
                      style={{
                        width: column.width,
                        minWidth: column.width,
                        maxWidth: column.width,
                        background: '#f1f5f9',
                        color: sheetColor,
                        fontWeight: 800,
                        fontSize: '0.62rem',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        borderRight: '1px solid var(--ghost-border)',
                        borderBottom: `2px solid ${sheetColor}33`,
                        padding: '8px 10px',
                        textAlign: 'left',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        position: columnIndex === 0 ? 'sticky' : 'static',
                        left: columnIndex === 0 ? 0 : 'auto',
                        zIndex: columnIndex === 0 ? 15 : 10,
                      }}
                      title={column.label}
                    >
                      {column.label}
                    </th>
                  ))}

                  <th
                    style={{
                      width: canEdit ? 88 : 54,
                      minWidth: canEdit ? 88 : 54,
                      background: '#f1f5f9',
                      borderBottom: `2px solid ${sheetColor}33`,
                      position: 'sticky',
                      right: 0,
                      zIndex: 15,
                      textAlign: 'center',
                      color: 'var(--muted)',
                      fontSize: '0.62rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    Action
                  </th>
                </tr>
              </thead>

              <tbody>
                {pageRows.map((row, rowIndex) => {
                  const sourceIndex = row.__sourceIndex
                  const isEven = rowIndex % 2 === 0
                  const rowBg = isEven ? '#fff' : '#fafbfc'

                  return (
                    <tr
                      key={`${activeSheet}-${sourceIndex}`}
                      style={{ background: rowBg }}
                      onMouseEnter={(event) => { event.currentTarget.style.background = `${sheetColor}0a` }}
                      onMouseLeave={(event) => { event.currentTarget.style.background = rowBg }}
                    >
                      {visibleCols.map((column, columnIndex) => {
                        const isSelected = selectedCell?.row === sourceIndex && selectedCell?.col === column.key
                        const isFillPreview = fillDrag && fillDrag.colKey === column.key && sourceIndex !== fillDrag.startRow
                          ? sourceIndex >= Math.min(fillDrag.startRow, fillDrag.endRow ?? fillDrag.startRow)
                            && sourceIndex <= Math.max(fillDrag.startRow, fillDrag.endRow ?? fillDrag.startRow)
                          : false

                        return (
                          <CostingCell
                            key={column.key}
                            col={column}
                            value={row[column.key] || ''}
                            canEdit={canEdit}
                            sheetColor={sheetColor}
                            rowBackground={rowBg}
                            isSticky={columnIndex === 0}
                            isEditing={editingCell?.row === sourceIndex && editingCell?.col === column.key}
                            isSelected={isSelected}
                            isFillPreview={isFillPreview}
                            onSelect={() => setSelectedCell({ row: sourceIndex, col: column.key })}
                            onStartEdit={() => setEditingCell({ row: sourceIndex, col: column.key })}
                            onEndEdit={() => setEditingCell(null)}
                            onMouseEnter={() => {
                              if (!fillDragRef.current || fillDragRef.current.colKey !== column.key) {
                                return
                              }

                              const nextDrag = {
                                ...fillDragRef.current,
                                endRow: sourceIndex,
                              }

                              fillDragRef.current = nextDrag
                              setFillDrag(nextDrag)
                            }}
                            onHandleMouseDown={() => {
                              if (!canEdit || column.readOnly) {
                                return
                              }

                              const nextDrag = {
                                sheetKey: activeSheet,
                                startRow: sourceIndex,
                                endRow: sourceIndex,
                                colKey: column.key,
                                startValue: row[column.key] || '',
                              }

                              setSelectedCell({ row: sourceIndex, col: column.key })
                              fillDragRef.current = nextDrag
                              setFillDrag(nextDrag)
                            }}
                            onChange={(value) => updateCell(activeSheet, sourceIndex, column.key, value)}
                          />
                        )
                      })}

                      <td style={{ borderBottom: '1px solid #f1f5f9', textAlign: 'center', padding: '0 8px', position: 'sticky', right: 0, background: rowBg, zIndex: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <button
                            type="button"
                            onClick={() => setSelectedDetailRowIndex(sourceIndex)}
                            title="View row details"
                            style={{
                              background: `${sheetColor}12`,
                              border: '1px solid transparent',
                              color: sheetColor,
                              width: 30,
                              height: 30,
                              borderRadius: 8,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Eye size={14} />
                          </button>
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => deleteRow(sourceIndex)}
                              title="Delete row"
                              style={{
                                background: '#fff1f2',
                                border: '1px solid transparent',
                                cursor: 'pointer',
                                color: '#e11d48',
                                width: 30,
                                height: 30,
                                borderRadius: 8,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <X size={14} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                })}

                {canEdit ? (
                  <tr
                    onClick={addRow}
                    style={{ cursor: 'pointer', opacity: 0.4 }}
                    onMouseEnter={(event) => { event.currentTarget.style.opacity = 1; event.currentTarget.style.background = `${sheetColor}08` }}
                    onMouseLeave={(event) => { event.currentTarget.style.opacity = 0.4; event.currentTarget.style.background = 'transparent' }}
                  >
                    <td colSpan={visibleCols.length + 1} style={{ padding: '10px 14px', borderTop: '1px dashed var(--ghost-border)', color: sheetColor, fontWeight: 700, fontSize: '0.75rem' }}>
                      Click to add new row
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            background: '#f8fafc',
            borderTop: '1px solid var(--ghost-border)',
            flexShrink: 0,
            fontSize: '0.7rem',
            color: 'var(--muted)',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span><strong style={{ color: 'var(--text)' }}>{filteredRows.length}</strong> rows filtered</span>
            <span>Sheet: <strong style={{ color: sheetColor }}>{SHEET_CONFIG[activeSheet].label}</strong></span>
            <span><strong style={{ color: 'var(--text)' }}>{visibleCols.length}</strong> of <strong style={{ color: 'var(--text)' }}>{currentCols.length}</strong> columns visible</span>
            <span>Page <strong style={{ color: 'var(--text)' }}>{currentPage}</strong> / <strong style={{ color: 'var(--text)' }}>{pageCount}</strong></span>
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={currentPage === 1}
            >
              Prev
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={currentPage === pageCount}
            >
              Next
            </button>
            <span>
              Total Costing: <strong style={{ color: sheetColor, fontSize: '0.9rem' }}>₹{stats.totalCost.toLocaleString('en-IN')}</strong>
            </span>
            {dirty ? (
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  background: sheetColor,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 5,
                  padding: '6px 14px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Save size={12} />
                Save Changes
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .detail-field { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #f1f5f9; gap: 16px; }
        .detail-field:last-child { border-bottom: none; }
        .detail-label { font-size: 0.72rem; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
        .detail-value { font-size: 0.88rem; font-weight: 600; color: var(--text); text-align: right; word-break: break-word; }
      `}</style>

      {selectedDetailRow ? (
        <div className="modal-backdrop" onClick={() => setSelectedDetailRowIndex(null)}>
          <div className="modal-card-wide" onClick={(event) => event.stopPropagation()} style={{ borderTop: `6px solid ${sheetColor}` }}>
            <div className="modal-title-bar" style={{ background: sheetColor, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Maximize2 size={20} />
                <span>ENTRY DETAILS - S.NO {detailValues?.sno}</span>
              </div>
              <button onClick={() => setSelectedDetailRowIndex(null)} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', padding: '4px 8px', borderRadius: 4, cursor: 'pointer' }}>X</button>
            </div>

            <div className="modal-body" style={{ padding: '32px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
              <div>
                <div className="form-section-divider" style={{ borderBottomColor: `${sheetColor}22` }}>
                  <h4 style={{ color: sheetColor }}>General Information</h4>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {currentCols.slice(0, Math.ceil(currentCols.length / 2)).map((column) => (
                    <div key={column.key} className="detail-field">
                      <span className="detail-label">{column.label}</span>
                      <div className="detail-value" style={{ minWidth: canEdit && !column.readOnly ? 240 : 'auto' }}>
                        <DetailModalField
                          column={column}
                          value={detailValues?.[column.key]}
                          canEdit={canEdit}
                          sheetColor={sheetColor}
                          onChange={(value) => updateDetailDraft(column.key, value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="form-section-divider" style={{ borderBottomColor: `${sheetColor}22` }}>
                  <h4 style={{ color: sheetColor }}>Additional Data & Status</h4>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {currentCols.slice(Math.ceil(currentCols.length / 2)).map((column) => (
                    <div key={column.key} className="detail-field">
                      <span className="detail-label">{column.label}</span>
                      <div className="detail-value" style={{ minWidth: canEdit && !column.readOnly ? 240 : 'auto' }}>
                        <DetailModalField
                          column={column}
                          value={detailValues?.[column.key]}
                          canEdit={canEdit}
                          sheetColor={sheetColor}
                          onChange={(value) => updateDetailDraft(column.key, value)}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="form-section-divider" style={{ marginTop: '24px', borderBottomColor: `${sheetColor}22` }}>
                  <h4 style={{ color: sheetColor }}>Workbook Metadata</h4>
                </div>
                <div className="detail-field">
                  <span className="detail-label">Workbook Source</span>
                  <span className="detail-value">{(stagedImport || metadata.importMeta)?.sourceFileName || '—'}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-label">Imported At</span>
                  <span className="detail-value">{(stagedImport || metadata.importMeta)?.importedAt ? formatDateTime((stagedImport || metadata.importMeta).importedAt) : '—'}</span>
                </div>
                <div className="detail-field">
                  <span className="detail-label">Updated By</span>
                  <span className="detail-value">{metadata.updatedBy || '—'}</span>
                </div>
              </div>
            </div>

            <div className="modal-action-bar">
              {canEdit ? (
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setDetailDraft({ ...selectedDetailRow })
                    setDetailDirty(false)
                  }}
                  disabled={!detailDirty}
                >
                  Reset Changes
                </button>
              ) : null}
              {canEdit ? (
                <button className="button button-primary" onClick={handleDetailSave} style={{ background: sheetColor }} disabled={!detailDirty}>
                  Save Entry
                </button>
              ) : null}
              <button className="button button-primary" onClick={() => setSelectedDetailRowIndex(null)} style={{ background: sheetColor }}>
                Close Window
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function CostingCell({
  col,
  value,
  canEdit,
  sheetColor,
  rowBackground,
  isSticky,
  isEditing,
  isSelected,
  isFillPreview,
  onSelect,
  onStartEdit,
  onEndEdit,
  onMouseEnter,
  onHandleMouseDown,
  onChange,
}) {
  const [localVal, setLocalVal] = useState(value)

  useEffect(() => {
    setLocalVal(value)
  }, [value])

  const commit = () => {
    const nextValue = normalizeCellInput(col, localVal)

    if (nextValue !== value) {
      onChange(nextValue)
    }

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
    position: isSticky ? 'sticky' : 'relative',
    left: isSticky ? 0 : 'auto',
    overflow: 'hidden',
    background: isFillPreview ? `${sheetColor}14` : rowBackground,
    boxShadow: isSelected ? `inset 0 0 0 2px ${sheetColor}` : 'none',
    zIndex: isSelected ? 6 : (isSticky ? 3 : 1),
  }

  const fillHandle = isSelected && canEdit && !col.readOnly ? (
    <button
      type="button"
      aria-label="Fill column"
      onMouseDown={(event) => {
        event.stopPropagation()
        event.preventDefault()
        onHandleMouseDown()
      }}
      style={{ position: 'absolute', right: 1, bottom: 1, width: 8, height: 8, border: 'none', background: sheetColor, cursor: 'crosshair', borderRadius: 2 }}
    />
  ) : null

  const displayHandlers = {
    onMouseDown: onSelect,
    onDoubleClick: canEdit && !col.readOnly ? onStartEdit : undefined,
    onMouseEnter,
  }

  if (col.readOnly || !canEdit) {
    return (
      <td {...displayHandlers} style={{ ...tdStyle, padding: '8px 10px', color: col.key === 'sno' ? 'var(--text)' : 'var(--muted)', fontSize: '0.75rem', textAlign: col.key === 'sno' ? 'center' : 'left', fontWeight: col.key === 'sno' ? 700 : 500 }}>
        <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmt(value) || ''}</span>
      </td>
    )
  }

  if (col.type === 'status') {
    const style = getStatusStyle(value)

    if (!isEditing) {
      return (
        <td {...displayHandlers} style={tdStyle}>
          <div style={{ padding: '5px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 36 }}>
            {value ? (
              <span style={{ background: style.bg, color: style.color, fontSize: '0.65rem', fontWeight: 800, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap' }}>
                {style.label}
              </span>
            ) : (
              <span style={{ color: '#cbd5e1', fontSize: '0.7rem' }}>-</span>
            )}
            {fillHandle}
          </div>
        </td>
      )
    }

    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <select
          autoFocus
          value={localVal}
          onChange={(event) => setLocalVal(event.target.value)}
          onBlur={commit}
          style={{ width: '100%', height: '100%', border: 'none', padding: '6px 8px', fontSize: '0.78rem', background: '#fff', cursor: 'pointer' }}
        >
          {STATUS_OPTIONS.map((status) => (
            <option key={status} value={status}>{status || '-'}</option>
          ))}
        </select>
      </td>
    )
  }

  if (col.type === 'select' && col.options) {
    if (!isEditing) {
      return (
        <td {...displayHandlers} style={{ ...tdStyle, padding: '8px 10px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ fontSize: '0.78rem', color: value ? 'var(--text)' : '#cbd5e1' }}>{value || '-'}</span>
          {fillHandle}
        </td>
      )
    }

    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <select
          autoFocus
          value={localVal}
          onChange={(event) => setLocalVal(event.target.value)}
          onBlur={commit}
          style={{ width: '100%', height: '100%', border: 'none', padding: '6px 8px', fontSize: '0.78rem', background: '#fff', cursor: 'pointer' }}
        >
          {(col.options || []).map((option) => (
            <option key={option} value={option}>{option || '-'}</option>
          ))}
        </select>
      </td>
    )
  }

  if (col.type === 'currency') {
    if (!isEditing) {
      return (
        <td {...displayHandlers} style={{ ...tdStyle, padding: '8px 10px', cursor: 'text', textAlign: 'right' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: value ? '#0f766e' : '#cbd5e1', fontFamily: 'monospace' }}>
            {value ? `Rs. ${Number(value).toLocaleString('en-IN')}` : '-'}
          </span>
          {fillHandle}
        </td>
      )
    }

    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <input
          autoFocus
          type="number"
          value={localVal}
          onChange={(event) => setLocalVal(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Tab') commit() }}
          style={{ width: '100%', height: '100%', border: 'none', padding: '6px 10px', fontSize: '0.78rem', textAlign: 'right' }}
        />
      </td>
    )
  }

  if (col.type === 'date') {
    const displayVal = value ? (() => {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    })() : ''

    if (!isEditing) {
      return (
        <td {...displayHandlers} style={{ ...tdStyle, padding: '8px 10px', cursor: 'text', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '0.75rem', color: value ? 'var(--text)' : '#cbd5e1' }}>{displayVal || '-'}</span>
          {fillHandle}
        </td>
      )
    }

    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <input
          autoFocus
          type="date"
          value={localVal?.split('T')[0] || localVal}
          onChange={(event) => setLocalVal(event.target.value)}
          onBlur={commit}
          style={{ width: '100%', height: '100%', border: 'none', padding: '6px 10px', fontSize: '0.78rem' }}
        />
      </td>
    )
  }

  if (col.type === 'textarea') {
    if (!isEditing) {
      return (
        <td {...displayHandlers} style={{ ...tdStyle, padding: '8px 10px' }} title={String(value || '')}>
          <span
            style={{
              fontSize: '0.78rem',
              color: value ? 'var(--text)' : '#cbd5e1',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: 1.35,
              minHeight: 34,
              paddingRight: isSelected ? 8 : 0,
            }}
          >
            {fmt(value) || ''}
          </span>
          {fillHandle}
        </td>
      )
    }

    return (
      <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
        <textarea
          autoFocus
          value={localVal}
          onChange={(event) => setLocalVal(event.target.value)}
          onBlur={commit}
          style={{ width: '100%', minHeight: 72, border: 'none', padding: '8px 10px', fontSize: '0.78rem', background: '#fff', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </td>
    )
  }

  if (!isEditing) {
    return (
      <td {...displayHandlers} style={{ ...tdStyle, padding: '8px 10px', cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(value)}>
        <span style={{ fontSize: '0.78rem', color: value ? 'var(--text)' : '#cbd5e1', paddingRight: isSelected ? 8 : 0 }}>{fmt(value) || ''}</span>
        {fillHandle}
      </td>
    )
  }

  return (
    <td style={{ ...tdStyle, outline: `2px solid ${sheetColor}`, zIndex: 10 }}>
      <input
        autoFocus
        value={localVal}
        onChange={(event) => setLocalVal(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Tab') commit() }}
        style={{ width: '100%', height: 36, border: 'none', padding: '6px 10px', fontSize: '0.78rem', background: '#fff' }}
      />
    </td>
  )
}

function DetailModalField({ column, value, canEdit, sheetColor, onChange }) {
  if (!canEdit || column.readOnly) {
    if (column.type === 'status') {
      const style = getStatusStyle(value)

      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: style.bg,
            color: style.color,
            fontSize: '0.65rem',
            fontWeight: 800,
            padding: '2px 8px',
            borderRadius: 10,
          }}
        >
          {style.label}
        </span>
      )
    }

    if (column.type === 'currency') {
      return value ? formatCurrency(value) : '—'
    }

    return fmt(value) || '—'
  }

  const sharedInputStyle = {
    width: '100%',
    border: '1px solid var(--ghost-border)',
    borderRadius: 6,
    padding: '8px 10px',
    fontSize: '0.82rem',
    background: '#fff',
    color: 'var(--text)',
    boxShadow: `0 0 0 1px ${sheetColor}12 inset`,
  }

  if (column.type === 'status') {
    return (
      <select value={value || ''} onChange={(event) => onChange(event.target.value)} style={{ ...sharedInputStyle, cursor: 'pointer' }}>
        {STATUS_OPTIONS.map((status) => (
          <option key={status} value={status}>{status || '-'}</option>
        ))}
      </select>
    )
  }

  if (column.type === 'select' && column.options) {
    return (
      <select value={value || ''} onChange={(event) => onChange(event.target.value)} style={{ ...sharedInputStyle, cursor: 'pointer' }}>
        {(column.options || []).map((option) => (
          <option key={option} value={option}>{option || '-'}</option>
        ))}
      </select>
    )
  }

  if (column.type === 'currency' || column.type === 'number') {
    return (
      <input
        type="number"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...sharedInputStyle, textAlign: 'right' }}
      />
    )
  }

  if (column.type === 'date') {
    return (
      <input
        type="date"
        value={value?.split?.('T')?.[0] || value || ''}
        onChange={(event) => onChange(event.target.value)}
        style={sharedInputStyle}
      />
    )
  }

  if (column.type === 'textarea') {
    return (
      <textarea
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        style={{ ...sharedInputStyle, minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }}
      />
    )
  }

  return (
    <input
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      style={sharedInputStyle}
    />
  )
}

