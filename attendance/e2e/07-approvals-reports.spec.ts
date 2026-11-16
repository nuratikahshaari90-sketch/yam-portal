import { expect, test } from '@playwright/test'
import ExcelJS from 'exceljs'
import { readFileSync } from 'node:fs'
import { login, logout, resetDatabase } from './helpers'

test.describe('Stage 7: approvals, exceptions and reports', () => {
  // Counts in these tests assume the original sample data.
  test.beforeAll(() => resetDatabase())
  test.setTimeout(180_000)

  test('supervisor approves leave and asks for changes on a trip', async ({ page }) => {
    await login(page, 'supervisor@yam.test')
    await expect(page.getByRole('link', { name: /Approvals/ }).locator('.badge')).toHaveText('2')
    await page.getByRole('link', { name: /Approvals/ }).click()
    await expect(page.getByTestId('approval')).toHaveCount(2)
    const leave = page.getByTestId('approval').filter({ hasText: 'Annual Leave' })
    await leave.getByLabel('Comment').fill('Enjoy Deepavali')
    await leave.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByTestId('approval')).toHaveCount(1)

    const trip = page.getByTestId('approval').filter({ hasText: 'Tanah Rata' })
    await trip.getByRole('button', { name: 'Ask for changes' }).click()
    await expect(trip.getByRole('alert')).toContainText('Please add a comment')
    await trip.getByLabel('Comment').fill('Please add the mileage estimate')
    await trip.getByRole('button', { name: 'Ask for changes' }).click()
    await expect(page.getByText('Nothing waiting for you.')).toBeVisible()
    await logout(page)

    await login(page, 'kavitha@yam.test')
    await page.goto('/leave')
    await expect(page.locator('.list-item', { hasText: '7 Oct' })).toContainText('Approved')
    await page.goto('/trips')
    await page.locator('.list-item', { hasText: 'Tanah Rata' }).click()
    await expect(page.getByText('Please add the mileage estimate')).toBeVisible()
  })

  test('HR reviews attendance exceptions: fixes a missed clock-out, approves overtime, rejects off-day work', async ({ page }) => {
    await login(page, 'hr@yam.test')
    await page.goto('/approvals')
    await page.getByRole('tab', { name: /Attend/ }).click()
    const missed = page.getByTestId('approval').filter({ hasText: 'Lim Mei Ling' }).filter({ hasText: 'Missed clock-out' })
    await missed.getByLabel('Correct clock-out time').fill('2026-09-24T17:45')
    await missed.getByLabel('Comment').fill('Confirmed by phone')
    await missed.getByRole('button', { name: 'Fix & approve' }).click()
    await expect(page.getByTestId('approval').filter({ hasText: 'Missed clock-out' })).toHaveCount(0)

    const ot = page.getByTestId('approval').filter({ hasText: 'Wed 23 Sep' })
    await expect(ot).toContainText('Over daily hour limit')
    await ot.getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByTestId('approval').filter({ hasText: 'Wed 23 Sep' })).toHaveCount(0)

    const sat = page.getByTestId('approval').filter({ hasText: 'Sat 19 Sep' })
    await expect(sat).toContainText('Work on Off Day')
    await sat.getByLabel('Comment').fill('Not pre-approved')
    await sat.getByRole('button', { name: 'Reject' }).click()
    await expect(page.getByTestId('approval').filter({ hasText: 'Sat 19 Sep' })).toHaveCount(0)

    await expect(page.getByTestId('approval').filter({ hasText: 'Outstation, no approved trip' })).toBeVisible()
    await logout(page)
    await login(page, 'meiling@yam.test')
    await page.goto('/history?view=day&date=2026-09-24')
    await expect(page.getByTestId('entry')).toContainText('5:45 pm')
    await expect(page.getByTestId('entry')).toContainText('Corrected by HR')
  })

  test('HR approves a claim, then marks it paid', async ({ page }) => {
    await login(page, 'hr@yam.test')
    await page.goto('/approvals')
    await page.getByRole('tab', { name: /Claims/ }).click()
    const claim = page.getByTestId('approval').filter({ hasText: 'Kuantan' })
    await expect(claim).toContainText('RM 762.10')
    await expect(claim).toContainText('4 without receipt')
    await claim.getByRole('button', { name: 'Approve' }).click()
    await page.getByRole('tab', { name: /To pay/ }).click()
    const pay = page.getByTestId('to-pay').filter({ hasText: 'Muhammad Farid Hakim' })
    await pay.getByLabel('Payment reference').fill('IBG-20260930-007')
    await pay.getByRole('button', { name: 'Mark paid' }).click()
    await expect(page.getByText('No approved claims waiting for payment.')).toBeVisible()
    await logout(page)
    await login(page, 'farid@yam.test')
    await page.goto('/claims')
    await expect(page.locator('.list-item', { hasText: 'Kuantan' })).toContainText('Paid')
  })

  test('HR reassigns a pending request; the new approver can act on it', async ({ page }) => {
    await login(page, 'hr@yam.test')
    await page.goto('/approvals')
    const ipoh = page.getByTestId('approval').filter({ hasText: 'Ipoh' })
    await ipoh.getByText('Reassign to another approver').click()
    await ipoh.getByLabel('New approver').selectOption({ label: 'Siti Aminah Yusof' })
    await ipoh.getByRole('button', { name: 'Move' }).click()
    await expect(page.getByTestId('approval').filter({ hasText: 'Ipoh' })).toContainText('Routed to Siti Aminah Yusof')
    await logout(page)
    await login(page, 'supervisor@yam.test')
    await page.goto('/approvals')
    await page.getByTestId('approval').filter({ hasText: 'Ipoh' }).getByRole('button', { name: 'Approve' }).click()
    await expect(page.getByTestId('approval').filter({ hasText: 'Ipoh' })).toHaveCount(0)
  })

  test('monthly attendance and claims reports, exported to Excel and PDF', async ({ page }) => {
    await login(page, 'hr@yam.test')
    await page.goto('/reports')
    await page.getByLabel('Month').fill('2026-09')
    const farid = page.locator('tr', { hasText: 'Muhammad Farid Hakim' })
    await expect(farid).toBeVisible()
    await expect(page.locator('th', { hasText: 'Work on Public Holiday (days)' })).toBeVisible()

    const [xlsx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '⬇ Excel' }).click()])
    expect(xlsx.suggestedFilename()).toBe('YAM-attendance-2026-09.xlsx')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(readFileSync(await xlsx.path()))
    const ws = wb.getWorksheet('Attendance')!
    const header = ws.getRow(4).values as string[]
    const rowOf = (name: string) => {
      for (let i = 5; i <= ws.rowCount; i++) if (ws.getRow(i).getCell(1).value === name) return ws.getRow(i)
      throw new Error(name)
    }
    const col = (h: string) => header.indexOf(h)
    const f = rowOf('Muhammad Farid Hakim')
    // Earlier in this file HR rejected Farid's Saturday work and approved the 23 Sep overtime
    expect(f.getCell(col('Days worked')).value).toBe(16)
    expect(f.getCell(col('Outstation')).value).toBe(4)
    expect(f.getCell(col('Work on Off Day (days)')).value).toBe(0)
    expect(f.getCell(col('Annual Leave')).value).toBe(2)
    expect(f.getCell(col('OT hours (approved)')).value).toBe(2.5)
    expect(f.getCell(col('OT hours (pending)')).value).toBe(1.5)
    const k = rowOf('Kavitha Rajan')
    expect(k.getCell(col('Work on Public Holiday (days)')).value).toBe(1)
    expect(k.getCell(col('Hospitalization Leave')).value).toBe(2)
    expect(rowOf('TOTAL')).toBeTruthy()

    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '⬇ PDF' }).click()])
    expect(pdf.suggestedFilename()).toBe('YAM-attendance-2026-09.pdf')
    expect(readFileSync(await pdf.path()).subarray(0, 4).toString()).toBe('%PDF')

    await page.getByRole('tab', { name: 'Per person' }).click()
    await page.getByLabel('Staff member').selectOption({ label: 'Kavitha Rajan' })
    await expect(page.locator('tr', { hasText: 'Sat, 5 Sept' })).toContainText('On Leave (Hospitalization Leave)')
    await expect(page.locator('tr', { hasText: 'Wed, 16 Sept' })).toContainText('Public holiday: Malaysia Day')

    await page.getByRole('tab', { name: 'Claims' }).click()
    await expect(page.locator('tr', { hasText: 'Kuantan' })).toContainText('762.10')
    const [cx] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '⬇ Excel' }).click()])
    expect(cx.suggestedFilename()).toBe('YAM-claims-2026-09.xlsx')
    await expect(page.locator('tr', { hasText: 'Total' }).last()).toContainText('1291.10')
  })

  test('staff cannot open approvals or reports', async ({ page }) => {
    await login(page, 'farid@yam.test')
    await page.goto('/approvals')
    await expect(page).toHaveURL(/\/$/)
    await page.goto('/reports')
    await expect(page).toHaveURL(/\/$/)
  })
})
