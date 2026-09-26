// Turn technical errors into plain-English messages.
export function friendlyError(e: unknown): string {
  const msg =
    typeof e === 'string'
      ? e
      : e && typeof e === 'object' && 'message' in e
        ? String((e as { message: unknown }).message)
        : 'Something went wrong.'
  if (/EMAIL_NOT_REGISTERED|Database error saving new user/i.test(msg))
    return 'This email has not been registered by HR/Admin yet. Please contact HR.'
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password. Please try again.'
  if (/Email not confirmed/i.test(msg))
    return 'Please open the activation email we sent you and tap the link first.'
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg))
    return 'No internet connection. Please try again when you are back online.'
  if (/rate limit/i.test(msg)) return 'Too many attempts. Please wait a few minutes and try again.'
  if (/Password should be/i.test(msg)) return 'Password must be at least 8 characters.'
  if (/duplicate key value.*email/i.test(msg)) return 'That email is already registered.'
  if (/duplicate key value.*staff_no/i.test(msg)) return 'That staff number is already used.'
  if (/duplicate key value.*holiday_date/i.test(msg)) return 'There is already a holiday on that date.'
  if (/duplicate key value.*effective_from/i.test(msg)) return 'A schedule already starts on that date. Pick another date.'
  return msg
}

/** True when the failure is a connectivity problem (retry later), not a rejected request. */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  const status = e && typeof e === 'object' && 'status' in e ? Number((e as { status: unknown }).status) : undefined
  if (status !== undefined && (status === 0 || status >= 500 || status === 408 || status === 429)) return true
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout|ECONNREFUSED|JWT expired/i.test(msg)
}
