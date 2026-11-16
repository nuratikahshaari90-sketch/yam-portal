import { expect, test } from '@playwright/test'
import { login, sql } from './helpers'

test.describe('Stage 4: outstation trips', () => {
  test('request a trip; it goes to HR when there is no supervisor', async ({ page }) => {
    await login(page, 'meiling@yam.test')
    await page.goto('/requests')
    await page.getByRole('link', { name: 'Request an outstation trip' }).click()
    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await expect(page.getByRole('alert')).toContainText('Please enter the destination.')
    await page.getByLabel('Destination').fill('Melaka')
    await page.getByLabel('Start date').fill('2026-11-03')
    await page.getByLabel('End date').fill('2026-11-04')
    await page.getByLabel('Purpose').fill('Donor visit')
    await page.getByLabel('Estimated cost (RM)').fill('280')
    await page.getByRole('button', { name: 'Submit for approval' }).click()
    await expect(page.getByText('Pending approval')).toBeVisible()
    await expect(page.getByText('HR/Admin')).toBeVisible()
    await expect(page.getByText('RM 280.00')).toBeVisible()
  })

  test('changes requested: staff sees the comment, edits and resubmits', async ({ page }) => {
    await login(page, 'kavitha@yam.test')
    await page.goto('/trips')
    const item = page.locator('.list-item', { hasText: 'Kota Bharu' })
    await expect(item).toContainText('Changes requested')
    await item.click()
    await expect(page.getByText('Please add an estimated cost for transport and accommodation.')).toBeVisible()
    await page.getByLabel('Estimated cost (RM)').fill('520')
    await page.getByLabel('Cost breakdown').fill('Bus RM120, hotel RM300, meals RM100')
    await page.getByRole('button', { name: 'Resubmit for approval' }).click()
    await expect(page.getByText('Pending approval')).toBeVisible()
    await expect(page.getByText('Siti Aminah Yusof').first()).toBeVisible()
  })

  test('trip page shows every clock-in during the trip', async ({ page }) => {
    await login(page, 'farid@yam.test')
    await page.goto('/trips')
    await page.locator('.list-item', { hasText: 'Kuantan' }).click()
    await expect(page.getByText('14 Sept – Thu, 17 Sept 2026 (4 days)')).toBeVisible()
    await expect(page.locator('.stat', { hasText: 'Days worked' })).toContainText('3')
    await expect(page.getByTestId('entry')).toHaveCount(3)
    await expect(page.locator('section', { hasText: 'Wed, 16 Sept' })).toContainText('No clock-in')
  })

  test('outstation clock-in: warns without a trip, links to today\'s approved trip', async ({ page }) => {
    await login(page, 'meiling@yam.test')
    // She forgot to clock out on 24 Sep: the app asks her to clock out first
    await expect(page.locator('.status-card')).toContainText('24 Sept')
    await page.getByRole('button', { name: 'Clock Out' }).click()
    await expect(page.getByRole('button', { name: 'Clock In' })).toBeVisible()
    await page.getByRole('radio', { name: 'Outstation' }).click()
    await expect(page.getByText(/no approved outstation trip for today/)).toBeVisible()

    sql(`insert into trips (staff_id, destination, start_date, end_date, purpose, status)
         values ('11111111-0000-0000-0000-000000000006', 'Kuala Terengganu',
                 (now() at time zone 'Asia/Kuala_Lumpur')::date, (now() at time zone 'Asia/Kuala_Lumpur')::date + 1,
                 'Programme launch', 'approved')`)
    await page.reload()
    await page.getByRole('radio', { name: 'Outstation' }).click()
    await expect(page.getByLabel('Outstation trip')).toContainText('Kuala Terengganu')
    await page.getByLabel('Where are you working?').fill('Dewan Besar, Kuala Terengganu')
    await page.getByLabel('Purpose or task').fill('Programme launch setup')
    await page.getByRole('button', { name: 'Clock In' }).click()
    await expect(page.locator('.status-card')).toContainText('Outstation')
    await expect(page.getByTestId('entry')).not.toContainText('no approved trip')
    const linked = sql(`select t.destination from attendance_entries a join trips t on t.id = a.trip_id
                        where a.staff_id = '11111111-0000-0000-0000-000000000006' and a.clock_out_at is null`)
    expect(linked).toBe('Kuala Terengganu')
  })
})
