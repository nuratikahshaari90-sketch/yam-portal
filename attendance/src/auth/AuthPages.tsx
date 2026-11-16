import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { friendlyError } from '../lib/errors'
import { Field, Notice } from '../components/ui'
import { useAuth } from './AuthProvider'

function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="auth-wrap">
      <div className="brand-mark">
        <img src="/icons/icon-192.png" alt="" />
        <div>
          <div className="t1">YAM Staff</div>
          <div className="t2">Yayasan Amal Malaysia</div>
        </div>
      </div>
      <h1>{title}</h1>
      {children}
    </div>
  )
}

const redirect = (path: string) => `${window.location.origin}${path}`

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [params] = useSearchParams()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setBusy(false)
    if (error) setError(friendlyError(error))
  }

  return (
    <AuthShell title="Sign in">
      {params.get('activated') && <Notice kind="ok">Your account is active. Sign in with your new password.</Notice>}
      <form onSubmit={submit}>
        <Field label="Work email" htmlFor="email">
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="password">
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Notice kind="error">{error}</Notice>
        <button className="btn" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p style={{ marginTop: 20 }}>
        <Link to="/forgot">Forgot password?</Link>
      </p>
      <p className="muted">
        First time here? <Link to="/activate">Activate your account</Link>
      </p>
    </AuthShell>
  )
}

export function ActivatePage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('The two passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { emailRedirectTo: redirect('/login?activated=1') },
    })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else setDone(true)
  }

  if (done)
    return (
      <AuthShell title="Check your email">
        <Notice kind="ok">
          We sent an activation link to <b>{email}</b>. Open it on this phone to finish, then sign in.
        </Notice>
        <Link className="btn secondary" to="/login">
          Back to sign in
        </Link>
      </AuthShell>
    )

  return (
    <AuthShell title="Activate your account">
      <p className="muted">Use the work email HR registered for you, and choose your own password.</p>
      <form onSubmit={submit}>
        <Field label="Work email" htmlFor="email">
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Choose a password" htmlFor="pw" hint="At least 8 characters.">
          <input id="pw" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Type the password again" htmlFor="pw2">
          <input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Notice kind="error">{error}</Notice>
        <button className="btn" disabled={busy}>
          {busy ? 'Please wait…' : 'Activate'}
        </button>
      </form>
      <p style={{ marginTop: 20 }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  )
}

export function ForgotPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: redirect('/reset-password'),
    })
    setBusy(false)
    if (error) setError(friendlyError(error))
    else setSent(true)
  }

  return (
    <AuthShell title="Reset password">
      {sent ? (
        <Notice kind="ok">If {email} is registered, a reset link is on its way. Open it on this phone.</Notice>
      ) : (
        <form onSubmit={submit}>
          <Field label="Work email" htmlFor="email">
            <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Notice kind="error">{error}</Notice>
          <button className="btn" disabled={busy}>
            Send reset link
          </button>
        </form>
      )}
      <p style={{ marginTop: 20 }}>
        <Link to="/login">Back to sign in</Link>
      </p>
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const { session, clearRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('The two passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(friendlyError(error))
    clearRecovery()
    navigate('/', { replace: true })
  }

  if (!session)
    return (
      <AuthShell title="Reset password">
        <Notice kind="warn">This reset link has expired or was already used. Please request a new one.</Notice>
        <Link className="btn" to="/forgot">
          Request a new link
        </Link>
      </AuthShell>
    )

  return (
    <AuthShell title="Choose a new password">
      <form onSubmit={submit}>
        <Field label="New password" htmlFor="pw" hint="At least 8 characters.">
          <input id="pw" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Type it again" htmlFor="pw2">
          <input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Notice kind="error">{error}</Notice>
        <button className="btn" disabled={busy}>
          Save new password
        </button>
      </form>
    </AuthShell>
  )
}

export function InactivePage() {
  const { signOut } = useAuth()
  return (
    <AuthShell title="Account not active">
      <Notice kind="warn">Your account is not active. Please contact HR/Admin.</Notice>
      <button className="btn secondary" onClick={() => void signOut()}>
        Sign out
      </button>
    </AuthShell>
  )
}
