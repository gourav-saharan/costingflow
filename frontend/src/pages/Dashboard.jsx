import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { collection, getDocs } from 'firebase/firestore'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../firebase'
import { formatCurrency, toDate } from '../lib/format'
import { ROLES, STATUS } from '../lib/constants'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function buildMonthlyTrend(costings) {
  const currentYear = new Date().getFullYear()
  const initial = MONTHS.map((name) => ({ name, total: 0 }))

  costings.forEach((costing) => {
    const createdAt = toDate(costing.createdAt || costing.updatedAt)
    if (createdAt && createdAt.getFullYear() === currentYear) {
      initial[createdAt.getMonth()].total += Number(costing.totalCost || 0)
    }
  })

  return initial
}

function buildYearlyTrend(costings) {
  const currentYear = new Date().getFullYear()
  const years = [currentYear - 2, currentYear - 1, currentYear]

  return years.map((year) => ({
    year: String(year),
    total: costings
      .filter((costing) => toDate(costing.createdAt || costing.updatedAt)?.getFullYear() === year)
      .reduce((sum, costing) => sum + Number(costing.totalCost || 0), 0),
  }))
}

function buildTeamPerformance(assignments) {
  const summary = {
    'Mysuru (RPSCOE)': { name: 'Mysuru', total: 0, completed: 0 },
    'Indore (NATRAX)': { name: 'Indore', total: 0, completed: 0 },
  }

  assignments.forEach((assignment) => {
    const key = assignment.location || 'Mysuru (RPSCOE)'
    if (!summary[key]) {
      summary[key] = { name: key, total: 0, completed: 0 }
    }

    summary[key].total += 1
    if (assignment.status === STATUS.CLOSED) {
      summary[key].completed += 1
    }
  })

  return Object.values(summary)
}

export default function Dashboard() {
  const { currentUser, profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    monthlyCosting: 0,
    yearlyCosting: 0,
  })
  const [monthlyTrend, setMonthlyTrend] = useState([])
  const [yearlyTrend, setYearlyTrend] = useState([])
  const [teamPerformance, setTeamPerformance] = useState([])
  const [userSummary, setUserSummary] = useState([])

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true)

      try {
        const [requestSnapshot, costingSnapshot, assignmentSnapshot, userSnapshot] = await Promise.all([
          getDocs(collection(db, 'test_requests')),
          getDocs(collection(db, 'costing')),
          getDocs(collection(db, 'assignments')),
          profile?.role === ROLES.HOD ? getDocs(collection(db, 'users')) : Promise.resolve(null),
        ])

        const requests = requestSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        const allCostings = costingSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        const assignments = assignmentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
        const users = userSnapshot ? userSnapshot.docs.map((item) => item.data()) : []

        const scopedRequests = profile?.role === ROLES.PDC
          ? requests.filter((item) => item.createdByUid === currentUser?.uid)
          : requests
        const scopedAssignments = profile?.role === ROLES.ENGINEER
          ? assignments.filter((item) => item.engineerUid === currentUser?.uid)
          : assignments
        const scopedCostings = profile?.role === ROLES.ENGINEER
          ? allCostings.filter((item) => item.engineerUid === currentUser?.uid || item.createdByUid === currentUser?.uid)
          : allCostings

        const source = profile?.role === ROLES.PDC ? scopedRequests : scopedAssignments.length ? scopedAssignments : scopedRequests
        const pendingCount = source.filter((item) => item.status === STATUS.PENDING || item.status === STATUS.COSTING_INITIATED).length
        const inProgressCount = source.filter((item) => [STATUS.ASSIGNED, STATUS.IN_PROGRESS, STATUS.REVIEW_PENDING, STATUS.COMMERCIAL_PENDING].includes(item.status)).length
        const completedCount = source.filter((item) => item.status === STATUS.CLOSED).length

        const now = new Date()
        const monthlyCosting = scopedCostings
          .filter((item) => {
            const date = toDate(item.createdAt || item.updatedAt)
            return date && date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
          })
          .reduce((sum, item) => sum + Number(item.totalCost || 0), 0)

        const yearlyCosting = scopedCostings
          .filter((item) => toDate(item.createdAt || item.updatedAt)?.getFullYear() === now.getFullYear())
          .reduce((sum, item) => sum + Number(item.totalCost || 0), 0)

        setStats({
          total: source.length,
          pending: pendingCount,
          inProgress: inProgressCount,
          completed: completedCount,
          monthlyCosting,
          yearlyCosting,
        })
        setMonthlyTrend(buildMonthlyTrend(scopedCostings))
        setYearlyTrend(buildYearlyTrend(scopedCostings))
        setTeamPerformance(buildTeamPerformance(scopedAssignments))
        setUserSummary(
          users.map((user) => ({
            role: user.role,
            department: user.department,
            status: user.status,
          })),
        )
      } finally {
        setLoading(false)
      }
    }

    loadDashboard()
  }, [currentUser?.uid, profile?.role])

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        description={`Secure workflow overview for ${profile?.name || 'user'}.`}
      />

      <div className="stats-grid">
        <StatCard label="Total tests" value={loading ? '...' : stats.total} helper="Across active workflow scope" />
        <StatCard label="Pending" value={loading ? '...' : stats.pending} helper="Waiting for action" />
        <StatCard label="In progress" value={loading ? '...' : stats.inProgress} helper="Assigned, testing or review" />
        <StatCard label="Completed" value={loading ? '...' : stats.completed} helper="Closed workflows" />
        <StatCard label="Monthly costing" value={loading ? '...' : formatCurrency(stats.monthlyCosting)} helper="Current month" />
        <StatCard label="Yearly costing" value={loading ? '...' : formatCurrency(stats.yearlyCosting)} helper="Current financial year view" />
      </div>

      <div className="grid-two">
        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h3>Monthly costing trend</h3>
              <p>HTAC cost initiation value by month</p>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="name" stroke="rgba(255,255,255,0.6)" />
                <YAxis stroke="rgba(255,255,255,0.6)" />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Line type="monotone" dataKey="total" stroke="#63e0cf" strokeWidth={3} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel chart-panel">
          <div className="panel-header">
            <div>
              <h3>Yearly costing comparison</h3>
              <p>Year-wise costing summary for HOD and managers</p>
            </div>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={yearlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="year" stroke="rgba(255,255,255,0.6)" />
                <YAxis stroke="rgba(255,255,255,0.6)" />
                <Tooltip formatter={(value) => formatCurrency(value)} />
                <Bar dataKey="total" fill="#f4b942" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="grid-two">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>Team-wise performance</h3>
              <p>Execution and closure split by test location</p>
            </div>
          </div>
          <div className="summary-list">
            {teamPerformance.length === 0 ? (
              <div className="empty-state">No assignment data available yet.</div>
            ) : (
              teamPerformance.map((team) => (
                <div key={team.name} className="summary-row">
                  <div>
                    <strong>{team.name}</strong>
                    <p>{team.total} total tasks</p>
                  </div>
                  <div className="summary-metric">
                    <strong>{team.completed}</strong>
                    <span>closed</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <h3>HOD access snapshot</h3>
              <p>Role mix across enabled users</p>
            </div>
          </div>
          {profile?.role !== ROLES.HOD ? (
            <div className="empty-state">Visible only on HOD account.</div>
          ) : (
            <div className="summary-list">
              {['HOD', 'Manager', 'Chief Manager', 'Engineer', 'PDC', 'Commercial'].map((role) => {
                const total = userSummary.filter((item) => item.role === role && item.status === 'Active').length
                return (
                  <div key={role} className="summary-row">
                    <strong>{role}</strong>
                    <span>{total} active users</span>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
