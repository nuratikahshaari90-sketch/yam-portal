import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Staff } from '../lib/types'
import { cacheGet, cacheSet } from '../offline/db'
import { setSyncUser, startAutoSync, syncNow } from '../offline/outbox'
import { isNetworkError } from '../lib/errors'

interface AuthState {
  session: Session | null | undefined // undefined = still checking
  staff: Staff | null
  inactive: boolean
  recovery: boolean
  clearRecovery: () => void
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}

const Ctx = createContext<AuthState>(null as unknown as AuthState)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [staff, setStaff] = useState<Staff | null>(null)
  const [inactive, setInactive] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [loadingStaff, setLoadingStaff] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  const loadStaff = useCallback(async () => {
    if (!userId) {
      setStaff(null)
      setSyncUser(null)
      return
    }
    setLoadingStaff(true)
    const key = `me:${userId}`
    try {
      const { data, error, status } = await supabase.from('staff').select('*').eq('user_id', userId).maybeSingle()
      if (error) throw Object.assign(new Error(error.message), { status })
      if (!data) {
        setInactive(true)
        setStaff(null)
      } else {
        setInactive(false)
        setStaff(data as Staff)
        await cacheSet(key, data)
      }
    } catch (e) {
      if (!isNetworkError(e)) throw e
      const cached = await cacheGet<Staff>(key)
      if (cached) setStaff(cached)
    } finally {
      setLoadingStaff(false)
    }
  }, [userId])

  useEffect(() => {
    void loadStaff()
  }, [loadStaff])

  useEffect(() => {
    setSyncUser(staff?.id ?? null)
    if (staff) {
      startAutoSync()
      void syncNow()
    }
  }, [staff])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut({ scope: 'local' })
    setStaff(null)
    setSyncUser(null)
  }, [])

  const value: AuthState = {
    session: session === undefined || (session && !staff && !inactive && loadingStaff) ? undefined : session,
    staff,
    inactive,
    recovery,
    clearRecovery: () => setRecovery(false),
    signOut,
    refresh: loadStaff,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useRole() {
  const { staff } = useAuth()
  const role = staff?.role ?? 'staff'
  return {
    role,
    isAdmin: role === 'admin',
    isSupervisor: role === 'supervisor',
    canApprove: role === 'admin' || role === 'supervisor',
  }
}
