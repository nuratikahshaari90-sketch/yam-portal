import { expect, type Page } from '@playwright/test'

export const PASSWORD = 'YamTest#2026'
export const MAILPIT = 'http://127.0.0.1:54324'
export const API = 'http://127.0.0.1:54321'
export const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Work email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

export async function logout(page: Page) {
  await page.goto('/more')
  await page.getByRole('button', { name: /Sign out/ }).click()
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
}

/** Find the newest email to an address in the local test mailbox and return the first link in it. */
export async function latestEmailLink(to: string, subjectRe: RegExp): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
    const json = (await res.json()) as { messages: { ID: string; Subject: string }[] }
    const msg = json.messages.find((m) => subjectRe.test(m.Subject))
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { HTML: string; Text: string }
      const m = (full.HTML || full.Text).match(/href="([^"]+)"/) ?? full.Text.match(/(https?:\/\/\S+)/)
      if (m) return m[1].replace(/&amp;/g, '&')
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`No email for ${to}`)
}

export async function clearMail() {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' })
}
