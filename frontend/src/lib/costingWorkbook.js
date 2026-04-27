import * as XLSX from 'xlsx'
import { formatCurrency } from './format'

const TYPE_OPTIONS = ['PCR', 'TBR', 'OTR', '2W', 'LCV']
const REQUEST_OPTIONS = ['Received', 'Pending', 'Not Received']
const SERVER_OPTIONS = ['Yes', 'No', 'Done', '']

export const CHUNK_SIZE = 200
export const PAGE_SIZE_OPTIONS = [50, 100, 250]
export const STATUS_FILTER_OPTIONS = ['Done', 'In Progress', 'Pending', 'Not Started']

export const SHEET_CONFIG = {
  'VD Outdoor': {
    id: 'vd-outdoor',
    label: 'VD Outdoor',
    color: '#1246a1',
    tint: '#eaf1ff',
    aliases: ['VD Outdoor', 'VDD Outdoor', 'VD_Outdoor'],
    columns: [
      { key: 'sno', label: 'S. No.', width: 80, type: 'number', readOnly: true },
      { key: 'month', label: 'Month', width: 130, type: 'date' },
      { key: 'tmgRef', label: 'TMG Ref. No.', width: 170, type: 'text' },
      { key: 'projectNo', label: 'Project No.', width: 170, type: 'text' },
      { key: 'tyreSize', label: 'Tyre Size', width: 240, type: 'text' },
      { key: 'vehicle', label: 'Vehicle', width: 160, type: 'text' },
      { key: 'tests', label: 'Tests', width: 320, type: 'textarea' },
      { key: 'type', label: 'Type', width: 100, type: 'select', options: TYPE_OPTIONS },
      { key: 'variants', label: 'No. of Variants', width: 120, type: 'number' },
      { key: 'costing', label: 'Costing (Rs.)', width: 140, type: 'currency' },
      { key: 'testRequest', label: 'Test Request', width: 140, type: 'select', options: REQUEST_OPTIONS },
      { key: 'originator', label: 'Test Request Originator', width: 260, type: 'text' },
      { key: 'reqDate', label: 'Test rqst date', width: 150, type: 'date', importAliases: ['Test Rqst Date'] },
      { key: 'compDate', label: 'Test completion date', width: 170, type: 'date', importAliases: ['Test Completion Date'] },
      { key: 'testStatus', label: 'Testing Status', width: 150, type: 'status' },
      { key: 'results', label: 'Results', width: 120, type: 'status' },
      { key: 'taskAssigned', label: 'Task Assigned', width: 140, type: 'status' },
      { key: 'testReqNo', label: 'Test Request number', width: 170, type: 'text', importAliases: ['Test Request No.', 'Test Request Number'] },
      { key: 'htac', label: 'HTAC', width: 140, type: 'text' },
      { key: 'reportCosting', label: 'Report & costing', width: 150, type: 'status', importAliases: ['Report & Costing'] },
      { key: 'costingInit', label: 'Costing Initiated', width: 150, type: 'date', importAliases: ['Costing\nInitiated'] },
      { key: 'costingDone', label: 'Costing finished', width: 150, type: 'date', importAliases: ['Costing Finished'] },
      { key: 'resultServer', label: 'Result in server', width: 150, type: 'select', options: SERVER_OPTIONS, importAliases: ['Result in Server'] },
      { key: 'ulrNo', label: 'ULR No.', width: 170, type: 'text' },
      { key: 'comments', label: 'Comments', width: 220, type: 'text' },
      { key: 'initiatedBy', label: 'Initiated by/ Completed by', width: 220, type: 'text', importAliases: ['Initiated by / Completed by'] },
    ],
  },
  'Anechoic Chamber': {
    id: 'anechoic-chamber',
    label: 'Anechoic Chamber',
    color: '#5b2da8',
    tint: '#f3ecff',
    aliases: ['Anechoic chamber', 'Anechoic Chamber'],
    columns: [
      { key: 'sno', label: 'S. No.', width: 80, type: 'number', readOnly: true },
      { key: 'month', label: 'Month', width: 130, type: 'date' },
      { key: 'tmgRef', label: 'TMG Ref. No.', width: 170, type: 'text' },
      { key: 'projectNo', label: 'Project No.', width: 170, type: 'text' },
      { key: 'tyreSize', label: 'Tyre Size', width: 240, type: 'text' },
      { key: 'testCompleted', label: 'Test Completed', width: 220, type: 'text' },
      { key: 'testCode', label: 'Test Code used', width: 150, type: 'text', importAliases: ['Test Code Used'] },
      { key: 'type', label: 'Type', width: 100, type: 'select', options: TYPE_OPTIONS },
      { key: 'variants', label: 'No. of Variants', width: 120, type: 'number' },
      { key: 'costing', label: 'Costing (Rs.)', width: 140, type: 'currency' },
      { key: 'testRequest', label: 'Test Request', width: 140, type: 'select', options: REQUEST_OPTIONS.concat(['Recived']) },
      { key: 'reqDate', label: 'Test rqst date', width: 150, type: 'date', importAliases: ['Test Rqst Date'] },
      { key: 'testReqNo', label: 'Test Request number', width: 170, type: 'text', importAliases: ['Test Request No.', 'Test Request Number'] },
      { key: 'compDate', label: 'Test completion date', width: 170, type: 'date', importAliases: ['Test Completion Date'] },
      { key: 'testStatus', label: 'Testing Status', width: 150, type: 'status' },
      { key: 'results', label: 'Results', width: 120, type: 'status' },
      { key: 'taskAssigned', label: 'Task Assigned', width: 140, type: 'status' },
      { key: 'htac', label: 'HTAC', width: 140, type: 'text' },
      { key: 'reportCosting', label: 'Report & costing', width: 150, type: 'status', importAliases: ['Report & Costing'] },
      { key: 'costingInit', label: 'Costing Initiated', width: 150, type: 'date', importAliases: ['Costing\nInitiated'] },
      { key: 'costingDone', label: 'Costing finished', width: 150, type: 'date', importAliases: ['Costing Finished'] },
      { key: 'resultServer', label: 'Result in server', width: 150, type: 'select', options: SERVER_OPTIONS, importAliases: ['Result in Server'] },
      { key: 'comments', label: 'Comments', width: 220, type: 'text' },
      { key: 'initiatedBy', label: 'Initiated by/ Completed by', width: 220, type: 'text', importAliases: ['Initiated by / Completed by'] },
      { key: 'mon', label: 'Monday', width: 110, type: 'text' },
      { key: 'tue', label: 'Tuesday', width: 110, type: 'text' },
      { key: 'wed', label: 'Wednesday', width: 110, type: 'text' },
      { key: 'thu', label: 'Thursday', width: 110, type: 'text' },
      { key: 'fri', label: 'Friday', width: 110, type: 'text' },
      { key: 'sat', label: 'Saturday', width: 110, type: 'text' },
      { key: 'finalStatus', label: 'Final Status', width: 150, type: 'status' },
      { key: 'report', label: 'Report', width: 140, type: 'text' },
    ],
  },
  'ONLEVEL / FTCT+': {
    id: 'onlevel-ftct',
    label: 'ONLEVEL / FTCT+',
    color: '#006b7f',
    tint: '#e8f8fb',
    aliases: ['ONLEVEL FTCT+', 'ONLEVEL / FTCT+', 'OnLevel FTCT+'],
    columns: [
      { key: 'sno', label: 'S. No.', width: 80, type: 'number', readOnly: true },
      { key: 'date', label: 'Date', width: 130, type: 'date' },
      { key: 'tmgRef', label: 'TMG Ref. No.', width: 170, type: 'text' },
      { key: 'projectNo', label: 'Project No.', width: 170, type: 'text' },
      { key: 'testReqNo', label: 'Test Request number', width: 180, type: 'text', importAliases: ['Test Request Number', 'Test Request No.'] },
      { key: 'machine', label: 'Machine (FTCT+/Onlevel)', width: 200, type: 'select', options: ['FTCT+', 'Onlevel', ''] },
      { key: 'tyreSize', label: 'Tyre Size', width: 240, type: 'text' },
      { key: 'project', label: 'Project / Brand', width: 180, type: 'text' },
      { key: 'testCompleted', label: 'Test Completed', width: 220, type: 'text' },
      { key: 'lmsCode', label: 'LMS Code used', width: 150, type: 'text', importAliases: ['LMS Code Used'] },
      { key: 'noTyres', label: 'No of Tyres', width: 120, type: 'number' },
      { key: 'noTests', label: 'No. of Tests', width: 120, type: 'number' },
      { key: 'costing', label: 'Costing (Rs)', width: 140, type: 'currency' },
      { key: 'compDate', label: 'Test completion date', width: 170, type: 'date', importAliases: ['Test Completion Date'] },
      { key: 'testStatus', label: 'Testing Status', width: 150, type: 'status' },
      { key: 'taskAssigned', label: 'Task Assigned', width: 140, type: 'status' },
      { key: 'reportStatus', label: 'Status of Report', width: 150, type: 'status' },
      { key: 'costingLms', label: 'Costing in LMS', width: 150, type: 'text' },
      { key: 'htac', label: 'HTAC No.', width: 140, type: 'text' },
      { key: 'resultServer', label: 'Result in server', width: 150, type: 'select', options: SERVER_OPTIONS, importAliases: ['Result in Server'] },
      { key: 'comments', label: 'Comments', width: 220, type: 'text' },
      { key: 'initiatedBy', label: 'Initiated by/ Completed by', width: 220, type: 'text', importAliases: ['Initiated by / Completed by'] },
      { key: 'mon', label: 'Monday', width: 110, type: 'text' },
      { key: 'tue', label: 'Tuesday', width: 110, type: 'text' },
      { key: 'wed', label: 'Wednesday', width: 110, type: 'text' },
      { key: 'thu', label: 'Thursday', width: 110, type: 'text' },
      { key: 'fri', label: 'Friday', width: 110, type: 'text' },
      { key: 'sat', label: 'Saturday', width: 110, type: 'text' },
      { key: 'finalStatus', label: 'Final Status', width: 150, type: 'status' },
      { key: 'report', label: 'Report', width: 140, type: 'text' },
    ],
  },
  TNM: {
    id: 'tnm',
    label: 'TNM',
    color: '#11743f',
    tint: '#eaf8ef',
    aliases: ['TNM'],
    columns: [
      { key: 'sno', label: 'S. No.', width: 80, type: 'number', readOnly: true },
      { key: 'tmgRef', label: 'TMG Ref. No.', width: 170, type: 'text' },
      { key: 'projectNo', label: 'Project No.', width: 170, type: 'text' },
      { key: 'tyreSize', label: 'Tyre Size', width: 240, type: 'text' },
      { key: 'testCompleted', label: 'Test Completed', width: 220, type: 'text' },
      { key: 'type', label: 'Type', width: 100, type: 'select', options: TYPE_OPTIONS },
      { key: 'variants', label: 'No. of Variants', width: 120, type: 'number' },
      { key: 'costing', label: 'Costing (Rs.)', width: 140, type: 'currency' },
      { key: 'htac', label: 'HTAC', width: 140, type: 'text' },
      { key: 'doneBy', label: 'Done by', width: 150, type: 'text' },
      { key: 'status', label: 'Status', width: 140, type: 'status' },
      { key: 'testReqNo', label: 'Test Request No', width: 170, type: 'text', importAliases: ['Test Request No.', 'Test Request Number'] },
      { key: 'remarks', label: 'Remarks', width: 220, type: 'text' },
      { key: 'compDate', label: 'Test completion date', width: 170, type: 'date', importAliases: ['Test Completion Date'] },
      { key: 'mon', label: 'Monday', width: 110, type: 'text' },
      { key: 'tue', label: 'Tuesday', width: 110, type: 'text' },
      { key: 'wed', label: 'Wednesday', width: 110, type: 'text' },
      { key: 'thu', label: 'Thursday', width: 110, type: 'text' },
      { key: 'fri', label: 'Friday', width: 110, type: 'text' },
      { key: 'sat', label: 'Saturday', width: 110, type: 'text' },
      { key: 'finalStatus', label: 'Final Status', width: 150, type: 'status' },
      { key: 'report', label: 'Report', width: 140, type: 'text' },
    ],
  },
  'Internal VDD': {
    id: 'internal-vdd',
    label: 'Internal VDD',
    color: '#a32020',
    tint: '#fff0f0',
    aliases: ['Internal VDD', 'Internal_VDD'],
    columns: [
      { key: 'sno', label: 'S. No.', width: 80, type: 'number', readOnly: true },
      { key: 'tmgRef', label: 'TMG Ref. No.', width: 170, type: 'text' },
      { key: 'projectNo', label: 'Project No.', width: 170, type: 'text' },
      { key: 'tyreSize', label: 'Tyre Size', width: 240, type: 'text' },
      { key: 'workArea', label: 'Test Completed / Work Area', width: 240, type: 'text' },
      { key: 'type', label: 'Type', width: 100, type: 'select', options: TYPE_OPTIONS },
      { key: 'variants', label: 'No. of Variants', width: 120, type: 'number' },
      { key: 'costing', label: 'Costing (Rs.)', width: 140, type: 'currency' },
      { key: 'testRequest', label: 'Test Request', width: 140, type: 'select', options: REQUEST_OPTIONS },
      { key: 'reqDate', label: 'Test rqst date', width: 150, type: 'date', importAliases: ['Test Rqst Date'] },
      { key: 'testStatus', label: 'Testing Status', width: 150, type: 'status' },
      { key: 'results', label: 'Results', width: 120, type: 'status' },
      { key: 'taskAssigned', label: 'Task Assigned', width: 140, type: 'status' },
      { key: 'testReqNo', label: 'Test Request number', width: 170, type: 'text', importAliases: ['Test Request No.', 'Test Request Number'] },
      { key: 'htac', label: 'HTAC', width: 140, type: 'text' },
      { key: 'reportCosting', label: 'Report & costing', width: 150, type: 'status', importAliases: ['Report & Costing'] },
      { key: 'costingInit', label: 'Costing Initiated', width: 150, type: 'date', importAliases: ['Costing\nInitiated'] },
      { key: 'costingDone', label: 'Costing finished', width: 150, type: 'date', importAliases: ['Costing Finished'] },
      { key: 'resultServer', label: 'Result in server', width: 150, type: 'select', options: SERVER_OPTIONS, importAliases: ['Result in Server'] },
      { key: 'comments', label: 'Comments', width: 220, type: 'text' },
      { key: 'initiatedBy', label: 'Initiated by/ Completed by', width: 220, type: 'text', importAliases: ['Initiated by / Completed by'] },
      { key: 'compDate', label: 'Test completion date', width: 170, type: 'date', importAliases: ['Test Completion Date'] },
      { key: 'mon', label: 'Monday', width: 110, type: 'text' },
      { key: 'tue', label: 'Tuesday', width: 110, type: 'text' },
      { key: 'wed', label: 'Wednesday', width: 110, type: 'text' },
      { key: 'thu', label: 'Thursday', width: 110, type: 'text' },
      { key: 'fri', label: 'Friday', width: 110, type: 'text' },
      { key: 'sat', label: 'Saturday', width: 110, type: 'text' },
      { key: 'finalStatus', label: 'Final Status', width: 150, type: 'status' },
      { key: 'report', label: 'Report', width: 140, type: 'text' },
    ],
  },
}

export const SHEET_KEYS = Object.keys(SHEET_CONFIG)

function normalizeToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\r?\n/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '')
}

function toIsoDate(value) {
  if (!value && value !== 0) {
    return ''
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().split('T')[0]
  }

  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d))
      return date.toISOString().split('T')[0]
    }
  }

  const parsedDate = new Date(String(value).trim())
  if (!Number.isNaN(parsedDate.getTime())) {
    return parsedDate.toISOString().split('T')[0]
  }

  return String(value).trim()
}

function sanitizeImportedValue(value, column) {
  if (value === null || value === undefined) {
    return ''
  }

  if (column.type === 'date') {
    return toIsoDate(value)
  }

  if (column.type === 'number' || column.type === 'currency') {
    const cleaned = typeof value === 'string' ? value.replace(/,/g, '').trim() : value
    const numeric = Number(cleaned)
    return Number.isFinite(numeric) ? numeric : String(value).trim()
  }

  return String(value).replace(/\s+/g, ' ').trim()
}

function getMatchingSheetName(workbookSheetNames, aliases) {
  const normalizedAliases = aliases.map((alias) => normalizeToken(alias))
  return workbookSheetNames.find((sheetName) => normalizedAliases.includes(normalizeToken(sheetName))) || null
}

function getHeaderIndex(grid) {
  return grid.findIndex((row) => Array.isArray(row) && row.some((cell) => String(cell ?? '').trim()))
}

function getColumnIndex(headers, column) {
  const normalizedHeaders = headers.map((header) => normalizeToken(header))
  const aliases = [column.label, ...(column.importAliases || [])].map((label) => normalizeToken(label))
  return normalizedHeaders.findIndex((header) => aliases.includes(header))
}

function rowHasValues(row) {
  return Object.entries(row).some(([key, value]) => key !== 'sno' && String(value ?? '').trim() !== '')
}

export function buildEmptyWorkbook() {
  return SHEET_KEYS.reduce((accumulator, key) => {
    accumulator[key] = []
    return accumulator
  }, {})
}

export function getSheetDocId(sheetKey) {
  return SHEET_CONFIG[sheetKey].id
}

export function normalizeStoredRows(sheetKey, rows) {
  const columns = SHEET_CONFIG[sheetKey].columns

  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const normalized = {}

      columns.forEach((column) => {
        if (column.key === 'sno') {
          return
        }

        normalized[column.key] = sanitizeImportedValue(row?.[column.key] ?? '', column)
      })

      return normalized
    })
    .filter((row) => rowHasValues(row))
    .map((row, index) => ({
      ...row,
      sno: index + 1,
    }))
}

export function createBlankRow(sheetKey, nextSno) {
  const row = {}
  SHEET_CONFIG[sheetKey].columns.forEach((column) => {
    row[column.key] = column.key === 'sno' ? nextSno : ''
  })
  return row
}

export function chunkSheetRows(rows) {
  const chunks = []
  for (let index = 0; index < rows.length; index += CHUNK_SIZE) {
    chunks.push(rows.slice(index, index + CHUNK_SIZE))
  }
  return chunks
}

export function calculateSheetTotal(rows) {
  return rows.reduce((sum, row) => sum + Number(row.costing || 0), 0)
}

export function buildSheetSummaryEntry(sheetKey, rows) {
  return {
    rowCount: rows.length,
    chunkCount: chunkSheetRows(rows).length,
    totalCost: calculateSheetTotal(rows),
    columnCount: SHEET_CONFIG[sheetKey].columns.length,
  }
}

export function getRowPrimaryStatus(row) {
  return row.finalStatus || row.testStatus || row.status || row.reportCosting || row.results || ''
}

export function getStatusTone(status) {
  const normalized = String(status || '').toLowerCase()

  if (!normalized) {
    return { background: '#eef2f7', color: '#6b7280', border: '#d6dde7' }
  }

  if (normalized.includes('done') || normalized.includes('approved') || normalized.includes('closed')) {
    return { background: '#e8f7ed', color: '#16703a', border: '#bfe1c8' }
  }

  if (normalized.includes('reject') || normalized.includes('fail')) {
    return { background: '#fdebec', color: '#a42b34', border: '#f4c8cd' }
  }

  if (normalized.includes('progress') || normalized.includes('ongoing') || normalized.includes('on going')) {
    return { background: '#fff5df', color: '#a05a00', border: '#f0d7a3' }
  }

  if (normalized.includes('pending') || normalized.includes('not started')) {
    return { background: '#eef4ff', color: '#2754a5', border: '#cedcf8' }
  }

  return { background: '#f4f5f7', color: '#374151', border: '#e2e6ec' }
}

export function formatCellValue(value, column) {
  if (value === null || value === undefined || value === '') {
    return ''
  }

  if (column.type === 'currency') {
    return formatCurrency(value)
  }

  if (column.type === 'date') {
    const parsedDate = new Date(value)
    if (!Number.isNaN(parsedDate.getTime())) {
      return parsedDate.toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    }
  }

  return String(value)
}

export function parseCostingWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true, raw: true })
  const sheets = buildEmptyWorkbook()
  const missingSheets = []
  const extraSheets = []
  const sheetReports = []

  SHEET_KEYS.forEach((sheetKey) => {
    const config = SHEET_CONFIG[sheetKey]
    const workbookSheetName = getMatchingSheetName(workbook.SheetNames, config.aliases)

    if (!workbookSheetName) {
      missingSheets.push(config.label)
      return
    }

    const worksheet = workbook.Sheets[workbookSheetName]
    const grid = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: true })
    const headerIndex = getHeaderIndex(grid)
    const headers = headerIndex >= 0 ? grid[headerIndex].map((cell) => String(cell ?? '').trim()) : []
    const columnIndexes = {}
    const missingColumns = []

    config.columns.forEach((column) => {
      const index = getColumnIndex(headers, column)
      columnIndexes[column.key] = index
      if (index === -1 && !column.readOnly) {
        missingColumns.push(column.label)
      }
    })

    const rawRows = headerIndex >= 0 ? grid.slice(headerIndex + 1) : []
    const normalizedRows = rawRows
      .map((cells, rowIndex) => {
        const row = {}
        config.columns.forEach((column) => {
          if (column.key === 'sno') {
            row.sno = rowIndex + 1
            return
          }

          const sourceIndex = columnIndexes[column.key]
          row[column.key] = sourceIndex >= 0 ? sanitizeImportedValue(cells[sourceIndex], column) : ''
        })
        return row
      })
      .filter((row) => rowHasValues(row))

    sheets[sheetKey] = normalizeStoredRows(sheetKey, normalizedRows)
    sheetReports.push({
      sheetKey,
      label: config.label,
      workbookSheetName,
      rowCount: sheets[sheetKey].length,
      totalCost: calculateSheetTotal(sheets[sheetKey]),
      missingColumns,
    })
  })

  workbook.SheetNames.forEach((workbookSheetName) => {
    const matched = SHEET_KEYS.some((sheetKey) => {
      const config = SHEET_CONFIG[sheetKey]
      return config.aliases.some((alias) => normalizeToken(alias) === normalizeToken(workbookSheetName))
    })

    if (!matched) {
      extraSheets.push(workbookSheetName)
    }
  })

  return {
    sheets,
    sheetSummary: SHEET_KEYS.reduce((accumulator, sheetKey) => {
      accumulator[sheetKey] = buildSheetSummaryEntry(sheetKey, sheets[sheetKey])
      return accumulator
    }, {}),
    sheetReports,
    missingSheets,
    extraSheets,
    importWarnings: [],
    blockingIssues: [],
  }
}
