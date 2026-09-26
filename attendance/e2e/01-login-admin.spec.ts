import { expect, test } from '@playwright/test'
import { clearMail, latestEmailLink, login, logout } from './helpers'

test.describe('Stage 1: login, roles, schedules', () => {
  test('wrong password shows a plain-English error', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Work email').fill('farid@yam.test')
    await page.getByLabel('Password').fill('wrong-password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByText('Wrong email or password')).toBeVisible()
  })

  test('staff cannot see HR/Admin screens', async ({ page }) => {
    await login(page, 'farid@yam.test')
    await page.goto('/more')
    await expect(page.getByText('HR/Admin', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Approvals/ })).toHaveCount(0)
    await page.goto('/admin/staff')
    await expect(page).toHaveURL(/\/$/)
    await logout(page)
  })

  test('HR sees all staff and Kavitha\'s weekend schedule history', async ({ page }) => {
    await login(page, 'hr@yam.test')
    await page.goto('/admin/staff')
    await expect(page.locator('a.list-item')).toHaveCount(7)
    await page.getByRole('link', { name: /Kavitha Rajan/ }).click()
    await expect(page.getByText('Works Wed, Thu, Fri, Sat, Sun · Off Mon, Tue').first()).toBeVisible()
    await expect(page.getByText('Current')).toBeVisible()
    await expect(page.getByText('Works Mon, Tue, Wed, Thu, Fri · Off Sat, Sun')).toBeVisible() // older version kept
  })

  test('HR registers a new staff member and changes their schedule', async ({ page }) => {
    await login(page, 'hr@yam.test')
    await page.goto('/admin/staff/new')
    await page.getByLabel('Full name').fill('Test Person')
    await page.getByLabel('Work email').fill('Test.Person@yam.test')
    await page.getByLabel('Staff no.').fill('YAM099')
    await page.getByLabel('Supervisor').selectOption({ label: 'Siti Aminah Yusof (Supervisor)' })
    await page.getByRole('button', { name: 'Add staff member' }).click()
    await expect(page.getByText('Not activated yet')).toBeVisible()
    await expect(page.getByText('test.person@yam.test').first()).toBeVisible()
    await page.getByRole('button', { name: 'Change schedule' }).click()
    await page.getByRole('button', { name: 'Mon', exact: true }).click()
    await page.getByRole('button', { name: 'Sat', exact: true }).click()
    await page.getByLabel('Starts from').fill('2026-10-01')
    await page.getByRole('button', { name: 'Save schedule' }).click()
    await expect(page.getByText('Works Tue, Wed, Thu, Fri, Sat · Off Mon, Sun')).toBeVisible()
    await expect(page.getByText('Upcoming')).toBeVisible()
    // Changing a supervisor warns that only new requests move
    await page.getByLabel('Supervisor').selectOption('')
    await expect(page.getByText(/Only new requests will go to the new supervisor/)).toBeVisible()
  })

  test('HR manages holidays and settings', async ({ page }) => {
    await login(page, 'hr@yam.test')
    await page.goto('/admin/holidays')
    await expect(page.getByText('Malaysia Day')).toBeVisible()
    await page.getByLabel('Date').fill('2026-12-24')
    await page.getByLabel('Name').fill('Company Family Day')
    await page.getByRole('button', { name: 'Add holiday' }).click()
    await expect(page.getByText('Company Family Day')).toBeVisible()
    await page.goto('/admin/settings')
    await expect(page.getByLabel('Mileage rate (RM per km)')).toHaveValue('0.6')
    await expect(page.getByLabel('Claims')).toHaveValue('hr')
    await expect(page.getByLabel('Leave requests')).toHaveValue('supervisor')
  })

  test('unregistered email cannot activate; registered one can, via email link', async ({ page }) => {
    await clearMail()
    await page.goto('/activate')
    await page.getByLabel('Work email').fill('stranger@gmail.com')
    await page.getByLabel('Choose a password').fill('Password123')
    await page.getByLabel('Type the password again').fill('Password123')
    await page.getByRole('button', { name: 'Activate' }).click()
    await expect(page.getByText('has not been registered by HR')).toBeVisible()

    await page.getByLabel('Work email').fill('newstaff@yam.test')
    await page.getByRole('button', { name: 'Activate' }).click()
    await expect(page.getByText('Check your email')).toBeVisible()
    const link = await latestEmailLink('newstaff@yam.test', /confirm/i)
    await page.goto(link)
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await page.goto('/more')
    await expect(page.getByText('Hafiz Abdullah')).toBeVisible()
  })

  test('password reset by email', async ({ page }) => {
    await clearMail()
    await page.goto('/forgot')
    await page.getByLabel('Work email').fill('director@yam.test')
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText(/reset link is on its way/)).toBeVisible()
    const link = await latestEmailLink('director@yam.test', /reset/i)
    await page.goto(link)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    await page.getByLabel('New password').fill('NewPass#2026')
    await page.getByLabel('Type it again').fill('NewPass#2026')
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await logout(page)
    await login(page, 'director@yam.test', 'NewPass#2026')
  })
})
