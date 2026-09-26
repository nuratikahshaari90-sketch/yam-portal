import { expect, test } from '@playwright/test'
import { login } from './helpers'

function todayDowKL() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }))
  return d.getDay() === 0 ? 7 : d.getDay()
}

test.describe('Stage 2: clock in and clock out', () => {
  test('clock in requires mode, location and purpose; then clock out with a note', async ({ page }) => {
    await login(page, 'farid@yam.test')
    const dow = todayDowKL()
    if (dow >= 6) await expect(page.getByText(/Today is your off day/)).toBeVisible()
    else await expect(page.getByText(/Today is your off day/)).toHaveCount(0)

    await page.getByRole('radio', { name: 'Client Site' }).click()
    await page.getByLabel('Where are you working?').fill('')
    await page.getByRole('button', { name: 'Clock In' }).click()
    await expect(page.getByText('Please type where you are working.')).toBeVisible()

    await page.getByLabel('Where are you working?').fill('Client office, Putrajaya')
    await page.getByRole('button', { name: 'Clock In' }).click()
    await expect(page.getByText('Please enter the purpose or task.')).toBeVisible()

    await page.getByLabel('Purpose or task').fill('Audit of beneficiary records')
    await page.getByRole('button', { name: 'Clock In' }).click()
    await expect(page.getByText('Clocked in', { exact: true }).first()).toBeVisible()
    await expect(page.locator('.status-card')).toContainText('Client Site · Client office, Putrajaya')
    await expect(page.getByTestId('entry')).toHaveCount(1)
    await expect(page.getByTestId('entry')).toContainText('still clocked in')
    if (dow >= 6) await expect(page.getByTestId('entry')).toContainText('Work on Off Day')

    await page.getByLabel('What did you get done?').fill('Checked 40 files')
    await page.getByRole('button', { name: 'Clock Out' }).click()
    await expect(page.getByRole('button', { name: 'Clock In' })).toBeVisible()
    await expect(page.getByTestId('entry')).toContainText('Done: Checked 40 files')

    // Last used mode and location are remembered, purpose is not
    await expect(page.getByRole('radio', { name: 'Client Site' })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByLabel('Where are you working?')).toHaveValue('Client office, Putrajaya')
    await expect(page.getByLabel('Purpose or task')).toHaveValue('')
  })

  test('history shows day, week and month with tags and totals', async ({ page }) => {
    await login(page, 'farid@yam.test')
    await page.goto('/history?view=month&date=2026-09-01')
    await expect(page.getByText('September 2026')).toBeVisible()
    const sat19 = page.locator('.list-item', { hasText: 'Sat, 19 Sept' })
    await expect(sat19).toContainText('Client Site')
    await expect(sat19).toContainText('Off day')
    await expect(sat19).toContainText('Awaiting HR review')
    await expect(page.locator('.list-item', { hasText: 'Wed, 23 Sept' })).toContainText('10h 30m')
    await expect(page.locator('.list-item', { hasText: 'Wed, 16 Sept' })).toContainText('Public holiday: Malaysia Day')

    await page.locator('.list-item', { hasText: 'Wed, 23 Sept' }).click()
    await expect(page.getByRole('tab', { name: 'Day', selected: true })).toBeVisible()
    await expect(page.getByTestId('entry')).toContainText('Overtime')
    await expect(page.getByTestId('entry')).toContainText('Over daily hour limit')

    await page.getByRole('tab', { name: 'Week' }).click()
    await expect(page.getByText('Week of Mon, 21 Sept')).toBeVisible()
    await page.getByRole('button', { name: 'Previous' }).click()
    await expect(page.getByText('Week of Mon, 14 Sept')).toBeVisible()
    // 14, 15, 17 outstation + 18 WFH + Sat 19 off-day work (16 = Malaysia Day)
    await expect(page.locator('.stat', { hasText: 'Days worked' })).toContainText('5')
    await expect(page.locator('.stat', { hasText: 'Off day / holiday work' })).toContainText('1')
  })

  test('staff only ever see their own records', async ({ page }) => {
    await login(page, 'meiling@yam.test')
    await page.goto('/history?view=month&date=2026-09-01')
    await expect(page.locator('.list-item', { hasText: 'Sat, 19 Sept' })).not.toContainText('Client Site')
    await expect(page.locator('.list-item', { hasText: 'Thu, 24 Sept' })).toContainText('Awaiting HR review')
  })
})
