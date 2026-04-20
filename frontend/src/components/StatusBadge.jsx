import clsx from 'clsx'
import { STATUS } from '../lib/constants'

const toneMap = {
  [STATUS.PENDING]: 'warning',
  [STATUS.COSTING_INITIATED]: 'info',
  [STATUS.ASSIGNED]: 'info',
  [STATUS.IN_PROGRESS]: 'warning',
  [STATUS.REVIEW_PENDING]: 'warning',
  [STATUS.REJECTED]: 'danger',
  [STATUS.COMMERCIAL_PENDING]: 'info',
  [STATUS.CLOSED]: 'success',
  Approved: 'success',
  Rejected: 'danger',
  'Invoice Raised': 'info',
  'Payment Received': 'success',
}

export default function StatusBadge({ status }) {
  return (
    <span className={clsx('badge', toneMap[status] || 'neutral')}>
      {status || 'NA'}
    </span>
  )
}
