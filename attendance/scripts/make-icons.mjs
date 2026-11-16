// Generates the home-screen icons in public/icons from an inline SVG.
// Run: node scripts/make-icons.mjs   (replace the SVG with YAM's logo if preferred)
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'

const svg = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 110}" fill="#0b6b50"/>
  <g transform="translate(256 236) scale(${pad ? 0.78 : 1})">
    <circle r="130" fill="none" stroke="#fff" stroke-width="30"/>
    <path d="M0 -78 V0 L58 42" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
    <text y="222" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="88" fill="#fff" letter-spacing="6">YAM</text>
  </g>
</svg>`

const out = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['apple-touch-icon.png', 180, true],
  ['icon-maskable-512.png', 512, true],
]
mkdirSync('public/icons', { recursive: true })
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const page = await browser.newPage()
for (const [name, size, pad] of out) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0">${svg(pad).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`)
  await page.screenshot({ path: `public/icons/${name}`, omitBackground: true })
}
await browser.close()
console.log('icons written')
