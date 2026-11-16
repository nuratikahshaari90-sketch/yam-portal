import { expect, test } from '@playwright/test'
import { login, sql, TINY_PNG } from './helpers'

test.describe('Stage 5: claims', () => {
  test('claim from the trip page: mileage is calculated, receipts attached, trip total updates', async ({ page }) => {
    await login(page, 'farid@yam.test')
    await page.goto('/trips')
    await page.locator('.list-item', { hasText: 'Kuantan' }).click()
    await expect(page.getByTestId('trip-total')).toHaveText('RM 762.10')
    await page.getByRole('link', { name: 'Make a claim for this trip' }).click()
    await expect(page.getByLabel('Outstation trip')).toHaveValue('44444444-0000-0000-0000-000000000001')

    await page.getByRole('button', { name: 'Submit claim' }).click()
    await expect(page.getByRole('alert')).toContainText('Item 1: please enter the date.')

    const item1 = page.getByTestId('claim-item').nth(0)
    await item1.getByLabel('Date').fill('2026-09-16')
    await item1.getByLabel('Category').selectOption('mileage')
    await item1.getByLabel('Description').fill('Kuantan town to relief centre')
    await item1.getByLabel('Kilometres').fill('42.5')
    await expect(item1.getByTestId('mileage-amount')).toHaveText('Amount: RM 25.50')

    await page.getByRole('button', { name: '+ Add another item' }).click()
    const item2 = page.getByTestId('claim-item').nth(1)
    await expect(item2.getByLabel('Date')).toHaveValue('2026-09-16')
    await item2.getByLabel('Category').selectOption('meals')
    await item2.getByLabel('Description').fill('Dinner with volunteers')
    await item2.getByLabel('Amount (RM)').fill('18.90')
    await item2.getByTestId('file-input').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: TINY_PNG })
    await expect(item2.getByAltText('Attachment preview')).toBeVisible()
    await expect(page.getByTestId('claim-total')).toHaveText('RM 44.40')

    await page.getByRole('button', { name: 'Submit claim' }).click()
    await expect(page.locator('.chip.submitted')).toHaveText('Submitted')
    await expect(page.getByText('42.5 km × RM 0.60')).toBeVisible()
    await expect(page.getByRole('button', { name: /View attachment/ })).toBeVisible()
    await page.getByRole('link', { name: 'Kuantan, Pahang' }).click()
    await expect(page.getByTestId('trip-total')).toHaveText('RM 806.50')
  })

  test('claim draft with a receipt photo saved offline syncs later', async ({ page, context }) => {
    await login(page, 'meiling@yam.test')
    await page.goto('/claims/new')
    await page.getByLabel('Outstation trip').selectOption({ label: 'George Town, Penang (Mon, 21 Sept – Tue, 22 Sept 2026)' })
    await context.setOffline(true)
    const item = page.getByTestId('claim-item').nth(0)
    await item.getByLabel('Date').fill('2026-09-22')
    await item.getByLabel('Category').selectOption('parking')
    await item.getByLabel('Description').fill('Airport parking')
    await item.getByLabel('Amount (RM)').fill('24')
    await item.getByTestId('file-input').setInputFiles({ name: 'parking.png', mimeType: 'image/png', buffer: TINY_PNG })
    await expect(page.getByRole('button', { name: 'Submit claim' })).toBeDisabled()
    await page.getByRole('button', { name: 'Save draft' }).click()
    await expect(page.getByTestId('syncbar')).toContainText('Offline, 1 entry waiting to sync')
    await expect(page.locator('.list-item', { hasText: 'waiting to sync' })).toBeVisible()

    await context.setOffline(false)
    await expect(page.getByTestId('syncbar')).toHaveCount(0, { timeout: 15000 })
    const path = sql(`select receipt_path from claim_items i join claims c on c.id = i.claim_id
                      where c.staff_id = '11111111-0000-0000-0000-000000000006' and i.description = 'Airport parking'`)
    expect(path).toMatch(/^11111111-0000-0000-0000-000000000006\/receipts\/.+\.jpg$/)
    expect(sql(`select count(*) from storage.objects where name = '${path}'`)).toBe('1')
  })

  test('paid claims show the payment reference', async ({ page }) => {
    await login(page, 'meiling@yam.test')
    await page.goto('/claims')
    await page.locator('.list-item', { hasText: 'Paid' }).click()
    await expect(page.getByText('IBG-20260925-0012')).toBeVisible()
    await expect(page.getByText('RM 529.00')).toBeVisible()
  })
})
