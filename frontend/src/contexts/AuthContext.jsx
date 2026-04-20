import { createContext, useContext, useEffect, useState } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { findDevUserByCredentials } from '../services/devUsers'

const AuthContext = createContext(null)
const ENABLE_LOCAL_DEV_AUTH = import.meta.env.VITE_ENABLE_LOCAL_DEV_AUTH === 'true'
const DEV_SESSION_KEY = 'costingflow-dev-bootstrap-session'
const DEV_BOOTSTRAP_EMAIL = import.meta.env.VITE_DEV_BOOTSTRAP_HOD_EMAIL
const DEV_BOOTSTRAP_PASSWORD = import.meta.env.VITE_DEV_BOOTSTRAP_HOD_PASSWORD
const DEV_BOOTSTRAP_NAME = import.meta.env.VITE_DEV_BOOTSTRAP_HOD_NAME || 'HOD Admin'

function getBootstrapProfile(email, password) {
  if (!import.meta.env.DEV || !ENABLE_LOCAL_DEV_AUTH) {
    return null
  }

  if (!DEV_BOOTSTRAP_EMAIL || !DEV_BOOTSTRAP_PASSWORD) {
    return null
  }

  if (email !== DEV_BOOTSTRAP_EMAIL || password !== DEV_BOOTSTRAP_PASSWORD) {
    return null
  }

  return {
    uid: 'dev-hod-bootstrap',
    email: DEV_BOOTSTRAP_EMAIL,
    profile: {
      name: DEV_BOOTSTRAP_NAME,
      email: DEV_BOOTSTRAP_EMAIL,
      role: 'HOD',
      department: 'VDD',
      status: 'Active',
      permissions: {
        viewCosting: true,
        editCosting: true,
        approveReports: true,
        accessAllDepartments: true,
        manageUsers: true,
        manageAssignments: true,
        manageCommercial: true,
        manageAuditLogs: true,
        submitRequests: true,
      },
    },
  }
}

function buildSessionUser(uid, email, flags = {}) {
  return {
    uid,
    email,
    ...flags,
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  async function refreshProfile(uid) {
    const profileSnapshot = await getDoc(doc(db, 'users', uid))
    if (!profileSnapshot.exists()) {
      throw new Error('Your account profile is missing. Ask HOD to provision access.')
    }

    const nextProfile = profileSnapshot.data()
    if (nextProfile.status === 'Disabled') {
      throw new Error('Your account is disabled. Contact HOD.')
    }

    setProfile(nextProfile)
    return nextProfile
  }

  function setBootstrapSession(bootstrap) {
    const session = {
      uid: bootstrap.uid,
      email: bootstrap.email,
      profile: bootstrap.profile,
      sessionType: 'bootstrap',
    }

    localStorage.setItem(DEV_SESSION_KEY, JSON.stringify(session))
    setCurrentUser(buildSessionUser(bootstrap.uid, bootstrap.email, { isBootstrap: true }))
    setProfile(bootstrap.profile)
    return session
  }

  function setDevUserSession(devUser) {
    const session = {
      uid: devUser.uid,
      email: devUser.email,
      profile: {
        name: devUser.name,
        email: devUser.email,
        role: devUser.role,
        department: devUser.department,
        status: devUser.status,
        permissions: devUser.permissions,
      },
      sessionType: 'local-user',
    }

    localStorage.setItem(DEV_SESSION_KEY, JSON.stringify(session))
    setCurrentUser(buildSessionUser(devUser.uid, devUser.email, { isLocalUser: true }))
    setProfile(session.profile)
    return session
  }

  async function login(email, password) {
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password)
      await refreshProfile(credential.user.uid)
      return credential
    } catch (firebaseError) {
      const bootstrap = getBootstrapProfile(email, password)
      if (bootstrap) {
        return setBootstrapSession(bootstrap)
      }

      if (ENABLE_LOCAL_DEV_AUTH) {
        const localDevUser = findDevUserByCredentials(email.trim().toLowerCase(), password)
        if (localDevUser) {
          return setDevUserSession(localDevUser)
        }
      }

      throw firebaseError
    }
  }

  async function logout() {
    localStorage.removeItem(DEV_SESSION_KEY)
    setCurrentUser(null)
    setProfile(null)

    if (auth.currentUser) {
      await signOut(auth)
    }
  }

  useEffect(() => {
    if (!ENABLE_LOCAL_DEV_AUTH) {
      localStorage.removeItem(DEV_SESSION_KEY)
    }

    const storedBootstrap = localStorage.getItem(DEV_SESSION_KEY)
    if (ENABLE_LOCAL_DEV_AUTH && storedBootstrap) {
      try {
        const parsed = JSON.parse(storedBootstrap)
        setCurrentUser(buildSessionUser(parsed.uid, parsed.email, {
          isBootstrap: parsed.sessionType === 'bootstrap',
          isLocalUser: parsed.sessionType === 'local-user',
        }))
        setProfile(parsed.profile)
        setLoading(false)
        return undefined
      } catch {
        localStorage.removeItem(DEV_SESSION_KEY)
      }
    }

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setLoading(true)

      if (!user) {
        const storedSession = localStorage.getItem(DEV_SESSION_KEY)
        if (ENABLE_LOCAL_DEV_AUTH && storedSession) {
          try {
            const parsed = JSON.parse(storedSession)
            setCurrentUser(buildSessionUser(parsed.uid, parsed.email, {
              isBootstrap: parsed.sessionType === 'bootstrap',
              isLocalUser: parsed.sessionType === 'local-user',
            }))
            setProfile(parsed.profile)
            setLoading(false)
            return
          } catch {
            localStorage.removeItem(DEV_SESSION_KEY)
          }
        }

        setCurrentUser(null)
        setProfile(null)
        setLoading(false)
        return
      }

      try {
        setCurrentUser(user)
        await refreshProfile(user.uid)
      } catch (error) {
        await signOut(auth)
        setCurrentUser(null)
        setProfile(null)
        console.error(error)
      } finally {
        setLoading(false)
      }
    })

    return unsubscribe
  }, [])

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        profile,
        loading,
        login,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
