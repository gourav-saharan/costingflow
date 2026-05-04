import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'
import {
  Download,
  Eye,
  FileSpreadsheet,
  Loader,
  Maximize2,
  Plus,
  Save,
  Upload,
  X,
} from 'lucide-react'
import { db, storage } from '../firebase'
import { formatCurrency, formatDateTime } from '../lib/format'
import { ROLES } from '../lib/constants'
import { canEditCosting } from '../lib/permissions'
import { useAuth } from '../contexts/AuthContext'
import {
  PAGE_SIZE_OPTIONS,
  SHEET_CONFIG,
  SHEET_KEYS,
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
const INITIAL_METADATA = {
  exists: false,
  importMeta: null,
  sheetSummary: {},
  updatedAt: null,
  updatedBy: '',
  updatedByEmail: '',
  version: 0,
  hasLegacyData: false,
}

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

function getSpreadsheetColumnLabel(index) {
  let label = ''
  let current = index

  while (current > 0) {
    const remainder = (current - 1) % 26
    label = String.fromCharCode(65 + remainder) + label
    current = Math.floor((current - 1) / 26)
  }

  return label || 'A'
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

function sanitizeStorageFileName(fileName) {
  return String(fileName || 'workbook.xlsx').replace(/[^a-zA-Z0-9._-]/g, '_')
}

async function uploadImportWorkbook(file, importMeta) {
  const storagePath = `costing_imports/v1/${Date.now()}-${sanitizeStorageFileName(file.name)}`
  const fileRef = ref(storage, storagePath)
  const snapshot = await uploadBytes(fileRef, file, {
    contentType: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    customMetadata: {
      importedAt: importMeta.importedAt,
      importedBy: importMeta.importedByEmail || 'unknown@local',
    },
  })
  const downloadURL = await getDownloadURL(snapshot.ref)

  return {
    storagePath,
    downloadURL,
    contentType: file.type || 'application/octet-stream',
    fileSize: file.size || 0,
    uploadedAt: new Date().toISOString(),
  }
}

function isStoragePermissionError(error) {
  return error?.code === 'storage/unauthorized' || error?.code === 'storage/unauthenticated'
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
  const { currentUser, profile, loading: authLoading } = useAuth()
  const canEdit = canEditCosting(profile)
  const isHod = profile?.role === ROLES.HOD
  const hasRemoteSession = Boolean(currentUser?.uid && !currentUser?.isBootstrap && !currentUser?.isLocalUser)

  const [activeSheet, setActiveSheet] = useState(SHEET_KEYS[0])
  const [sheetData, setSheetData] = useState(() => buildEmptyWorkbook())
  const [metadata, setMetadata] = useState(INITIAL_METADATA)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [stagedImport, setStagedImport] = useState(null)
  const [stagedImportFile, setStagedImportFile] = useState(null)
  const [showImportBanner, setShowImportBanner] = useState(false)
  const [editingCell, setEditingCell] = useState(null)
  const [selectedCell, setSelectedCell] = useState(null)
  const [fillDrag, setFillDrag] = useState(null)
  const [selectedDetailRowIndex, setSelectedDetailRowIndex] = useState(null)
  const [detailDraft, setDetailDraft] = useState(null)
  const [detailDirty, setDetailDirty] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = PAGE_SIZE_OPTIONS[1]

  const pageRef = useRef(null)
  const fileInputRef = useRef(null)
  const tableWrapperRef = useRef(null)
  const fillDragRef = useRef(null)

  const currentCols = SHEET_CONFIG[activeSheet].columns
  const sheetColor = SHEET_CONFIG[activeSheet].color

  const hydrateFromSnapshot = useCallback(async (snapshot) => {
    const nextState = await buildWorkbookStateFromSnapshot(snapshot)
    setSheetData(nextState.workbook)
    setMetadata(nextState.metadata)
    setDirty(false)
    setStagedImport(null)
    setStagedImportFile(null)
    setShowImportBanner(false)
  }, [])

  useEffect(() => {
    let active = true

    async function loadWorkbook() {
      if (authLoading) {
        return
      }

      if (!hasRemoteSession || !profile) {
        setSheetData(buildEmptyWorkbook())
        setMetadata(INITIAL_METADATA)
        setDirty(false)
        setStagedImport(null)
        setStagedImportFile(null)
        setShowImportBanner(false)
        setLoading(false)
        return
      }

      setLoading(true)

      try {
        const snapshot = await getDoc(doc(db, 'costing_master', 'v1'))
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
    }

    loadWorkbook()

    return () => {
      active = false
    }
  }, [authLoading, hasRemoteSession, hydrateFromSnapshot, profile])

  useEffect(() => {
    const shell = pageRef.current?.closest('.page-shell')
    if (!shell) {
      return undefined
    }

    shell.classList.add('page-shell-costing')

    return () => {
      shell.classList.remove('page-shell-costing')
    }
  }, [])

  useEffect(() => {
    setPage(1)
    setEditingCell(null)
    setSelectedCell(null)
    setSelectedDetailRowIndex(null)
  }, [activeSheet])

  const filteredRows = useMemo(
    () => (sheetData[activeSheet] || []).map((row, sourceIndex) => ({ ...row, __sourceIndex: sourceIndex })),
    [sheetData, activeSheet],
  )

  const stats = useMemo(() => {
    const rows = sheetData[activeSheet] || []
    return { totalCost: calculateSheetTotal(rows) }
  }, [sheetData, activeSheet])

  const visibleCols = currentCols

  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageStartIndex = (currentPage - 1) * pageSize
  const pageRows = filteredRows.slice(pageStartIndex, pageStartIndex + pageSize)
  const selectedColumnIndex = selectedCell ? visibleCols.findIndex((column) => column.key === selectedCell.col) : -1
  const selectedCellValue = selectedCell ? (sheetData[activeSheet] || [])[selectedCell.row]?.[selectedCell.col] ?? '' : ''
  const selectedCellRef = selectedCell && selectedColumnIndex >= 0
    ? `${getSpreadsheetColumnLabel(selectedColumnIndex + 1)}${selectedCell.row + 2}`
    : 'A2'
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
      setSelectedDetailRowIndex(null)
      setEditingCell(null)
      const nextImportMeta = {
        sourceFileName: file.name,
        importedAt: new Date().toISOString(),
        importedByName: profile?.name || 'Unknown User',
        importedByEmail: currentUser?.email || profile?.email || 'unknown@local',
        fileSize: file.size || 0,
        contentType: file.type || 'application/octet-stream',
        totalRows: SHEET_KEYS.reduce((sum, sheetKey) => sum + Number(parsed.sheetSummary[sheetKey]?.rowCount || 0), 0),
        totalCost: SHEET_KEYS.reduce((sum, sheetKey) => sum + Number(parsed.sheetSummary[sheetKey]?.totalCost || 0), 0),
        extraSheets: parsed.extraSheets,
      }

      setStagedImport(nextImportMeta)
      setStagedImportFile(file)
      setShowImportBanner(true)

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
      let importMetaToSave = stagedImport || metadata.importMeta || null
      let importUploadWarning = ''

      if (stagedImport && stagedImportFile) {
        try {
          const uploadedFile = await uploadImportWorkbook(stagedImportFile, stagedImport)
          importMetaToSave = {
            ...stagedImport,
            ...uploadedFile,
          }
        } catch (error) {
          if (!isStoragePermissionError(error)) {
            throw error
          }

          console.warn('Imported workbook could not be archived in Firebase Storage.', error)
          importUploadWarning = 'Workbook data saved, but the original Excel file could not be archived because Storage access is not configured for this account.'
          importMetaToSave = {
            ...stagedImport,
            uploadSkipped: true,
            uploadErrorCode: error.code || 'storage/unauthorized',
            uploadErrorMessage: error.message || 'Storage upload was denied.',
          }
        }
      }

      await commitOperations(buildWorkbookOperations(sheetData, metadata.sheetSummary, actor))

      await setDoc(
        doc(db, 'costing_master', 'v1'),
        {
          version: 2,
          sheetSummary: nextSummary,
          importMeta: importMetaToSave,
          updatedAt: serverTimestamp(),
          updatedBy: actor.name,
          updatedByEmail: actor.email,
        },
        { merge: true },
      )

      const latestSnapshot = await getDoc(doc(db, 'costing_master', 'v1'))
      await hydrateFromSnapshot(latestSnapshot)
      if (importUploadWarning) {
        toast.success('Costing workbook saved successfully.')
        toast.error(importUploadWarning, { duration: 6000 })
      } else {
        toast.success('Costing workbook saved successfully.')
      }
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

  if (!authLoading && (!currentUser || !profile || !hasRemoteSession)) {
    return (
      <div className="page" style={{ height: 'calc(100vh - 78px)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#ffffff', padding: 0 }}>
        <div style={{ maxWidth: 420, textAlign: 'center', color: '#475569', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <FileSpreadsheet size={32} color="#94a3b8" style={{ alignSelf: 'center' }} />
          <p style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>Sign in to open the costing workbook.</p>
          <p style={{ margin: 0, fontSize: '0.85rem', lineHeight: 1.5 }}>
            This page only loads after a real Firebase-backed login. Local placeholder sessions cannot read Firestore data.
          </p>
        </div>
      </div>
    )
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
    <div ref={pageRef} className="page" style={{ height: 'calc(100vh - 78px)', display: 'flex', flexDirection: 'column', gap: 0, overflow: 'hidden', width: '100%', maxWidth: '100%', minWidth: 0, background: '#ffffff', padding: '0' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #dfe5ec', borderRadius: 0, overflow: 'hidden', boxShadow: 'none', minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '0 10px', minHeight: 34, borderBottom: '1px solid #eceff3', background: '#ffffff', flexShrink: 0, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <FileSpreadsheet size={15} color={sheetColor} />
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#111827', whiteSpace: 'nowrap' }}>CostingSheet</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'auto' }}>
              {['File', 'Edit', 'View', 'Insert', 'Format', 'Data'].map((item) => (
                <button
                  key={item}
                  type="button"
                  style={{ border: 'none', background: 'transparent', padding: 0, color: '#6b7280', fontSize: '0.64rem', fontWeight: 700, whiteSpace: 'nowrap' }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleImport} style={{ display: 'none' }} />
            {isHod ? (
              <button className="button button-secondary" onClick={triggerImport} style={{ gap: 5, fontSize: '0.62rem', padding: '0 10px', minHeight: 24, borderRadius: 2, background: '#f3f4f6', boxShadow: 'none' }}>
                <Upload size={12} />
                Import
              </button>
            ) : null}
            <button className="button button-secondary" onClick={handleExport} style={{ gap: 5, fontSize: '0.62rem', padding: '0 10px', minHeight: 24, borderRadius: 2, background: '#f3f4f6', boxShadow: 'none' }}>
              <Download size={12} />
              Export
            </button>
            <button
              className={`button ${dirty ? 'button-primary' : 'button-secondary'}`}
              onClick={handleSave}
              disabled={saving}
              style={{ gap: 5, fontSize: '0.62rem', padding: '0 10px', minHeight: 24, borderRadius: 2, boxShadow: 'none', background: dirty ? '#16a34a' : '#f3f4f6', color: dirty ? '#fff' : '#111827' }}
            >
              {saving ? <Loader size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr) auto', gap: 6, alignItems: 'center', padding: '4px 10px', borderBottom: '1px solid #eceff3', background: '#fafbfc', flexShrink: 0, minWidth: 0 }}>
          <div style={{ minWidth: 72, padding: '4px 8px', borderRadius: 0, border: '1px solid #e5e7eb', background: '#fff', fontSize: '0.66rem', fontWeight: 700, color: '#334155', textAlign: 'center' }}>
            {selectedCellRef}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '0 8px', height: 28, borderRadius: 0, border: '1px solid #e5e7eb', background: '#fff' }}>
            <span style={{ fontSize: '0.66rem', fontWeight: 800, color: sheetColor }}>fx</span>
            <span style={{ fontSize: '0.68rem', color: selectedCell ? '#0f172a' : '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {selectedCell ? fmt(selectedCellValue) || 'Empty cell' : 'Select any cell to inspect or edit its value'}
            </span>
          </div>
          <div style={{ fontSize: '0.64rem', color: '#64748b', fontWeight: 700, whiteSpace: 'nowrap' }}>
            {metadata.updatedAt ? formatDateTime(metadata.updatedAt) : ((stagedImport || metadata.importMeta)?.importedAt ? formatDateTime((stagedImport || metadata.importMeta).importedAt) : 'No timestamp')}
          </div>
        </div>

        {stagedImport && showImportBanner ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '4px 10px', borderBottom: '1px solid #dbeafe', background: '#eff6ff', color: '#1d4ed8', flexShrink: 0 }}>
            <div style={{ fontSize: '0.64rem', lineHeight: 1.3, minWidth: 0, overflowWrap: 'anywhere' }}>
              <strong>{stagedImport.sourceFileName}</strong> is staged with {stagedImport.totalRows.toLocaleString('en-IN')} rows and {formatCurrency(stagedImport.totalCost)} total costing.
              {stagedImport.extraSheets?.length ? ` ${stagedImport.extraSheets.length} extra workbook tab(s) were ignored.` : ''}
            </div>
            <button type="button" onClick={() => setShowImportBanner(false)} style={{ background: 'transparent', border: 'none', color: '#1d4ed8', cursor: 'pointer', fontWeight: 700, flexShrink: 0, fontSize: '0.64rem' }}>
              Hide
            </button>
          </div>
        ) : null}

        <div
          ref={tableWrapperRef}
          tabIndex={0}
          onKeyDown={handleGridKeyDown}
          onPaste={handleGridPaste}
          onMouseDown={() => tableWrapperRef.current?.focus()}
          style={{ flex: 1, overflow: 'auto', minWidth: 0, outline: 'none', position: 'relative', padding: 0, background: '#fff' }}
        >
          {pageRows.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 280, gap: 12, color: 'var(--muted)' }}>
              <FileSpreadsheet size={40} color={sheetColor} style={{ opacity: 0.35 }} />
              <p style={{ fontWeight: 600, fontSize: '0.9rem' }}>No records yet</p>
              {canEdit ? (
                <button
                  onClick={addRow}
                  style={{
                    background: sheetColor,
                    color: '#fff',
                    border: 'none',
                    borderRadius: 8,
                    padding: '9px 20px',
                    fontSize: '0.74rem',
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
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', fontSize: '0.72rem', minWidth: '100%', width: 'max-content' }}>
              <thead>
                <tr style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                  {visibleCols.map((column, columnIndex) => (
                    <th
                      key={column.key}
                      style={{
                        width: column.width,
                        minWidth: column.width,
                        maxWidth: column.width,
                        background: '#f7f8fa',
                        color: '#6b7280',
                        fontWeight: 800,
                        fontSize: '0.54rem',
                        letterSpacing: '0.04em',
                        textTransform: 'uppercase',
                        borderRight: '1px solid #eceff3',
                        borderBottom: '1px solid #d9dee5',
                        padding: '6px 8px',
                        textAlign: column.key === 'sno' ? 'center' : 'left',
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
                      width: canEdit ? 76 : 48,
                      minWidth: canEdit ? 76 : 48,
                      background: '#f7f8fa',
                      borderBottom: '1px solid #d9dee5',
                      position: 'sticky',
                      right: 0,
                      zIndex: 15,
                      textAlign: 'center',
                      color: '#6b7280',
                      fontSize: '0.54rem',
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
                  const rowBg = '#fff'

                  return (
                    <tr
                      key={`${activeSheet}-${sourceIndex}`}
                      style={{ background: rowBg }}
                      onMouseEnter={(event) => { event.currentTarget.style.background = '#fbfdff' }}
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

                      <td style={{ borderBottom: '1px solid #edf1f5', textAlign: 'center', padding: '0 4px', position: 'sticky', right: 0, background: rowBg, zIndex: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                          <button
                            type="button"
                            onClick={() => setSelectedDetailRowIndex(sourceIndex)}
                            title="View row details"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: sheetColor,
                              width: 22,
                              height: 22,
                              borderRadius: 0,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Eye size={13} />
                          </button>
                          {canEdit ? (
                            <button
                              type="button"
                              onClick={() => deleteRow(sourceIndex)}
                              title="Delete row"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              color: '#e11d48',
                              width: 22,
                              height: 22,
                              borderRadius: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              }}
                            >
                              <X size={13} />
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
                    onMouseEnter={(event) => { event.currentTarget.style.opacity = 1; event.currentTarget.style.background = '#fbfdff' }}
                    onMouseLeave={(event) => { event.currentTarget.style.opacity = 0.4; event.currentTarget.style.background = 'transparent' }}
                  >
                    <td colSpan={visibleCols.length + 1} style={{ padding: '9px 12px', borderTop: '1px dashed #dbe2ea', color: sheetColor, fontWeight: 700, fontSize: '0.7rem' }}>
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
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            alignItems: 'center',
            padding: '0',
            background: '#f8fafc',
            borderTop: '1px solid #dfe5ec',
            flexShrink: 0,
            fontSize: '0.66rem',
            color: 'var(--muted)',
            minWidth: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', overflow: 'auto', minWidth: 0, borderRight: '1px solid #dfe5ec' }}>
              {SHEET_KEYS.map((sheetKey) => {
                const config = SHEET_CONFIG[sheetKey]
                const isActive = activeSheet === sheetKey
                const count = (sheetData[sheetKey] || []).length

                return (
                  <button
                    key={sheetKey}
                    type="button"
                    onClick={() => setActiveSheet(sheetKey)}
                    style={{
                      minHeight: 34,
                      padding: '0 12px',
                      border: 'none',
                      borderTop: isActive ? `2px solid ${config.color}` : '2px solid transparent',
                      background: isActive ? '#fff' : 'transparent',
                      color: isActive ? '#111827' : '#6b7280',
                      fontWeight: isActive ? 800 : 700,
                      fontSize: '0.64rem',
                      letterSpacing: '0.03em',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span>{config.label}</span>
                    <span
                      style={{
                        minWidth: 18,
                        padding: '0 4px',
                        borderRadius: 0,
                        background: 'transparent',
                        color: isActive ? config.color : '#9ca3af',
                        fontSize: '0.56rem',
                        fontWeight: 800,
                        textAlign: 'center',
                      }}
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '0 10px', minWidth: 0, whiteSpace: 'nowrap' }}>
              <span><strong style={{ color: '#0f172a' }}>{filteredRows.length}</strong> rows</span>
              <span><strong style={{ color: '#0f172a' }}>{visibleCols.length}</strong> of <strong style={{ color: '#0f172a' }}>{currentCols.length}</strong> columns visible</span>
              <span>{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 10px', borderLeft: '1px solid #dfe5ec', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <span>Page <strong style={{ color: '#0f172a' }}>{currentPage}</strong> / <strong style={{ color: '#0f172a' }}>{pageCount}</strong></span>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={currentPage === 1}
              style={{ minHeight: 24, padding: '0 8px', fontSize: '0.62rem', borderRadius: 0, background: 'transparent' }}
            >
              Prev
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
              disabled={currentPage === pageCount}
              style={{ minHeight: 24, padding: '0 8px', fontSize: '0.62rem', borderRadius: 0, background: 'transparent' }}
            >
              Next
            </button>
            <span>
              Total Costing: <strong style={{ color: sheetColor, fontSize: '0.8rem' }}>₹{stats.totalCost.toLocaleString('en-IN')}</strong>
            </span>
            {dirty ? (
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  background: sheetColor,
                  color: '#fff',
                  border: 'none',
                  borderRadius: 2,
                  padding: '0 10px',
                  minHeight: 24,
                  fontSize: '0.62rem',
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
                  <span className="detail-label">Imported File</span>
                  <span className="detail-value">
                    {(stagedImport || metadata.importMeta)?.downloadURL ? (
                      <a
                        href={(stagedImport || metadata.importMeta).downloadURL}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: sheetColor, textDecoration: 'none', fontWeight: 700 }}
                      >
                        Open workbook
                      </a>
                    ) : (
                      'Not uploaded yet'
                    )}
                  </span>
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

  const cellBackground = col.key === 'sno'
    ? (isFillPreview ? `${sheetColor}14` : '#f8fafc')
    : (isFillPreview ? `${sheetColor}14` : rowBackground)

  const tdStyle = {
    borderRight: '1px solid #eceff3',
    borderBottom: '1px solid #eceff3',
    padding: 0,
    verticalAlign: 'middle',
    minWidth: col.width,
    maxWidth: col.width,
    width: col.width,
    position: isSticky ? 'sticky' : 'relative',
    left: isSticky ? 0 : 'auto',
    overflow: 'hidden',
    background: cellBackground,
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
      style={{ position: 'absolute', right: 1, bottom: 1, width: 7, height: 7, border: 'none', background: sheetColor, cursor: 'crosshair', borderRadius: 2 }}
    />
  ) : null

  const displayHandlers = {
    onMouseDown: onSelect,
    onDoubleClick: canEdit && !col.readOnly ? onStartEdit : undefined,
    onMouseEnter,
  }

  if (col.readOnly || !canEdit) {
    return (
      <td {...displayHandlers} style={{ ...tdStyle, padding: '5px 8px', color: col.key === 'sno' ? '#475569' : '#334155', fontSize: '0.68rem', textAlign: col.key === 'sno' ? 'center' : 'left', fontWeight: col.key === 'sno' ? 700 : 500 }}>
        <span style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmt(value) || ''}</span>
      </td>
    )
  }

  if (col.type === 'status') {
    const style = getStatusStyle(value)

    if (!isEditing) {
      return (
        <td {...displayHandlers} style={tdStyle}>
          <div style={{ padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', minHeight: 28 }}>
            {value ? (
              <span style={{ color: style.color, fontSize: '0.68rem', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {style.label}
              </span>
            ) : (
              <span style={{ color: '#cbd5e1', fontSize: '0.66rem' }}>-</span>
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
          style={{ width: '100%', height: '100%', border: 'none', padding: '5px 8px', fontSize: '0.72rem', background: '#fff', cursor: 'pointer' }}
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
        <td {...displayHandlers} style={{ ...tdStyle, padding: '5px 8px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <span style={{ fontSize: '0.68rem', color: value ? 'var(--text)' : '#cbd5e1' }}>{value || '-'}</span>
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
          style={{ width: '100%', height: '100%', border: 'none', padding: '5px 8px', fontSize: '0.72rem', background: '#fff', cursor: 'pointer' }}
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
        <td {...displayHandlers} style={{ ...tdStyle, padding: '5px 8px', cursor: 'text', textAlign: 'right' }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 600, color: value ? '#0f766e' : '#cbd5e1', fontFamily: 'monospace' }}>
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
          style={{ width: '100%', height: '100%', border: 'none', padding: '5px 8px', fontSize: '0.72rem', textAlign: 'right' }}
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
        <td {...displayHandlers} style={{ ...tdStyle, padding: '5px 8px', cursor: 'text', whiteSpace: 'nowrap' }}>
          <span style={{ fontSize: '0.68rem', color: value ? 'var(--text)' : '#cbd5e1' }}>{displayVal || '-'}</span>
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
          style={{ width: '100%', height: '100%', border: 'none', padding: '5px 8px', fontSize: '0.72rem' }}
        />
      </td>
    )
  }

  if (col.type === 'textarea') {
    if (!isEditing) {
      return (
        <td {...displayHandlers} style={{ ...tdStyle, padding: '5px 8px' }} title={String(value || '')}>
          <span
            style={{
              fontSize: '0.68rem',
              color: value ? 'var(--text)' : '#cbd5e1',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: 1.3,
              minHeight: 30,
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
          style={{ width: '100%', minHeight: 64, border: 'none', padding: '7px 8px', fontSize: '0.72rem', background: '#fff', resize: 'vertical', fontFamily: 'inherit' }}
        />
      </td>
    )
  }

  if (!isEditing) {
    return (
      <td {...displayHandlers} style={{ ...tdStyle, padding: '5px 8px', cursor: 'text', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(value)}>
        <span style={{ fontSize: '0.68rem', color: value ? 'var(--text)' : '#cbd5e1', paddingRight: isSelected ? 8 : 0 }}>{fmt(value) || ''}</span>
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
        style={{ width: '100%', height: 32, border: 'none', padding: '5px 8px', fontSize: '0.72rem', background: '#fff' }}
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

