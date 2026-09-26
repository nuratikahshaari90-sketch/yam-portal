import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth, useRole } from './auth/AuthProvider'
import { ActivatePage, ForgotPage, InactivePage, LoginPage, ResetPasswordPage } from './auth/AuthPages'
import { ToastProvider, Loading } from './components/ui'
import { MorePage } from './features/MorePage'
import { StaffEditPage, StaffListPage } from './features/admin/StaffPages'
import { HolidaysPage } from './features/admin/HolidaysPage'
import { SettingsPage } from './features/admin/SettingsPage'
import { Layout } from './components/Layout'
import { ClockScreen } from './features/clock/ClockScreen'
import { HistoryScreen } from './features/clock/HistoryScreen'
import { RequestsPage } from './features/RequestsPage'
import { LeaveDetailPage, LeaveFormPage, LeaveListPage } from './features/leave/LeavePages'

function Placeholder({ title }: { title: string }) {
  return (
    <Layout title={title}>
      <p className="muted">Coming in the next stage.</p>
    </Layout>
  )
}

function AdminOnly({ children }: { children: ReactNode }) {
  const { isAdmin } = useRole()
  return isAdmin ? children : <Navigate to="/" replace />
}

function Gate() {
  const { session, staff, inactive, recovery } = useAuth()
  const location = useLocation()
  const publicPaths = ['/login', '/activate', '/forgot', '/reset-password']

  if (session === undefined) return <Loading text="Starting…" />
  if (recovery && location.pathname !== '/reset-password') return <Navigate to="/reset-password" replace />

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/activate" element={<ActivatePage />} />
        <Route path="/forgot" element={<ForgotPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }
  if (location.pathname === '/reset-password') return <ResetPasswordPage />
  if (inactive) return <InactivePage />
  if (!staff) return <Loading text="Loading your profile…" />
  if (publicPaths.includes(location.pathname)) return <Navigate to="/" replace />

  return (
    <Routes>
      <Route path="/" element={<ClockScreen />} />
      <Route path="/history" element={<HistoryScreen />} />
      <Route path="/requests" element={<RequestsPage />} />
      <Route path="/leave" element={<LeaveListPage />} />
      <Route path="/leave/new" element={<LeaveFormPage />} />
      <Route path="/leave/:id/edit" element={<LeaveFormPage />} />
      <Route path="/leave/:id" element={<LeaveDetailPage />} />
      <Route path="/more" element={<MorePage />} />
      <Route path="/admin/staff" element={<AdminOnly><StaffListPage /></AdminOnly>} />
      <Route path="/admin/staff/:id" element={<AdminOnly><StaffEditPage /></AdminOnly>} />
      <Route path="/admin/holidays" element={<AdminOnly><HolidaysPage /></AdminOnly>} />
      <Route path="/admin/settings" element={<AdminOnly><SettingsPage /></AdminOnly>} />
      <Route path="*" element={<Placeholder title="Coming soon" />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Gate />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
