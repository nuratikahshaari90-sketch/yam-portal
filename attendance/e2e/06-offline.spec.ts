import { expect, test, type Page } from '@playwright/test'
import { login, sql, PASSWORD } from './helpers'

async function clockIn(page: Page, mode: string, where: string, what: string) {
  await page.getByRole('radio', { name: mode }).click()
  await page.getByLabel('Where are you working?').fill(where)
  await page.getByLabel('Purpose or task').fill(what)
  await page.getByRole('button', { name: 'Clock In' }).click()
}

test.describe('Stage 6: offline mode', () => {
  test('clock in and out with no internet, then sync automatically', async ({ page, context }) => {
    await login(page, 'kavitha@yam.test')
    await context.setOffline(true)
    await expect(page.getByTestId('syncbar')).toContainText('Offline')
    await clockIn(page, 'Client Site', 'Kampung Sungai Ruil (no signal)', 'Water filter check')
    await expect(page.getByText('Saved on this phone')).toBeVisible()
    await expect(page.locator('.status-card')).toContainText('Waiting to sync')
    await expect(page.getByTestId('syncbar')).toHaveText('Offline, 1 entry waiting to sync')

    await page.getByLabel('What did you get done?').fill('Replaced 3 filters')
    await page.getByRole('button', { name: 'Clock Out' }).click()
    await expect(page.getByTestId('syncbar')).toHaveText('Offline, 2 entries waiting to sync')
    await page.getByRole('link', { name: /More/ }).click() // in-app navigation works offline
    await page.getByRole('link', { name: /Sync status/ }).click()
    await expect(page.getByText('Clock in – Client Site')).toBeVisible()
    await expect(page.getByText('Clock out', { exact: true })).toBeVisible()

    await context.setOffline(false)
    await expect(page.getByText('All your entries are synced.')).toBeVisible({ timeout: 15000 })
    const row = sql(`select clock_in_offline, clock_out_offline, clock_in_device_at = clock_in_at, clock_in_server_at >= clock_in_at, clock_out_note
                     from attendance_entries where location = 'Kampung Sungai Ruil (no signal)'`)
    expect(row).toBe('t|t|t|t|Replaced 3 filters')
    await page.goto('/')
    await expect(page.getByTestId('entry').last()).toContainText('Recorded offline')
  })

  test('a clash with another device is never lost: it goes to HR', async ({ page, context, browser }) => {
    await login(page, 'farid@yam.test')
    await clockIn(page, 'Office', 'YAM HQ, Bangi', 'Reports')
    await expect(page.locator('.status-card')).toBeVisible()
    await context.setOffline(true)
    await page.getByRole('button', { name: 'Clock Out' }).click()
    await expect(page.getByTestId('syncbar')).toHaveText('Offline, 1 entry waiting to sync')
    // Meanwhile the entry was closed from another phone
    sql(`update attendance_entries set clock_out_at = now(), clock_out_server_at = now()
         where staff_id = '11111111-0000-0000-0000-000000000004' and clock_out_at is null`)
    await context.setOffline(false)
    await expect(page.getByTestId('syncbar')).toContainText('1 entry could not be applied', { timeout: 15000 })
    await page.getByTestId('syncbar').getByRole('link').click()
    await expect(page.getByText(/already clocked out/)).toBeVisible()
    await expect(page.getByText('A copy has been sent to HR')).toBeVisible()

    // HR sees it and resolves it
    const hr = await (await browser.newContext()).newPage()
    await login(hr, 'hr@yam.test')
    await hr.goto('/admin/sync-issues')
    const issue = hr.getByTestId('sync-issue').first()
    await expect(issue).toContainText('Muhammad Farid Hakim')
    await expect(issue).toContainText('Clock out')
    hr.once('dialog', (d) => d.accept('Checked with Farid, second clock-out ignored'))
    await issue.getByRole('button', { name: 'Mark resolved' }).click()
    await expect(hr.getByText('No open sync issues.')).toBeVisible()

    // Staff can clear it from the phone
    await page.getByRole('button', { name: 'OK, remove from this phone' }).click()
    await expect(page.getByText('All your entries are synced.')).toBeVisible()
  })

  test('installed app opens and works with no internet (service worker)', async ({ page, context }) => {
    await page.goto('http://localhost:4173/login')
    await page.getByLabel('Work email').fill('meiling@yam.test')
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true))
    await page.reload() // let the service worker take control and caches fill
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()

    await context.setOffline(true)
    await page.reload()
    await expect(page.getByTestId('syncbar')).toContainText('Offline')
    await expect(page.getByRole('heading', { name: 'Hi, Lim' })).toBeVisible()
    // Mei Ling's sample data has a missed clock-out, cached from the last online visit
    await expect(page.getByRole('button', { name: 'Clock Out' })).toBeVisible()
    await page.getByRole('button', { name: 'Clock Out' }).click()
    await expect(page.getByTestId('syncbar')).toHaveText('Offline, 1 entry waiting to sync')
    await context.setOffline(false)
    await expect(page.getByTestId('syncbar')).toHaveCount(0, { timeout: 15000 })
    expect(sql(`select count(*) from attendance_entries
                where staff_id = '11111111-0000-0000-0000-000000000006' and clock_out_offline`)).toBe('1')
  })
})
