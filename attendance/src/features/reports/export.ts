// Excel and PDF export, loaded only when needed (keeps the app fast on phones).

export interface Column<T> {
  header: string
  value: (row: T) => string | number | null
  numeric?: boolean
  total?: boolean // show a total of this column in the last row
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

function totalsRow<T>(columns: Column<T>[], rows: T[]): (string | number | null)[] | null {
  if (!columns.some((c) => c.total)) return null
  return columns.map((c, i) =>
    i === 0 ? 'TOTAL' : c.total ? Math.round(rows.reduce((s, r) => s + Number(c.value(r) ?? 0), 0) * 100) / 100 : '',
  )
}

export interface Sheet<T> {
  name: string
  title: string
  columns: Column<T>[]
  rows: T[]
}

export async function exportExcel(filename: string, sheets: Sheet<any>[]) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'YAM Staff'
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31))
    ws.addRow([s.title]).font = { bold: true, size: 13 }
    ws.addRow([`Generated ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}`]).font = { italic: true, size: 9 }
    ws.addRow([])
    const header = ws.addRow(s.columns.map((c) => c.header))
    header.font = { bold: true }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F2EC' } }
    for (const r of s.rows) ws.addRow(s.columns.map((c) => c.value(r)))
    const t = totalsRow(s.columns, s.rows)
    if (t) ws.addRow(t).font = { bold: true }
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1)
      col.width = Math.min(40, Math.max(10, c.header.length + 2))
      if (c.numeric) col.numFmt = '#,##0.00'
    })
    ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }]
  }
  const buf = await wb.xlsx.writeBuffer()
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename)
}

export async function exportPdf(filename: string, sheets: Sheet<any>[]) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  sheets.forEach((s, idx) => {
    if (idx > 0) doc.addPage()
    doc.setFontSize(13)
    doc.text(s.title, 30, 32)
    doc.setFontSize(8)
    doc.text(`Yayasan Amal Malaysia · Generated ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kuala_Lumpur' })}`, 30, 46)
    const fmt = (v: unknown, c: Column<unknown>) =>
      v == null ? '' : c.numeric && typeof v === 'number' ? v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v)
    const body = s.rows.map((r) => s.columns.map((c) => fmt(c.value(r), c)))
    const t = totalsRow(s.columns, s.rows)
    autoTable(doc, {
      startY: 56,
      head: [s.columns.map((c) => c.header)],
      body,
      foot: t ? [t.map((v, i) => fmt(v, s.columns[i]))] : undefined,
      styles: { fontSize: s.columns.length > 14 ? 6 : 7.5, cellPadding: 3 },
      headStyles: { fillColor: [11, 107, 80] },
      footStyles: { fillColor: [227, 242, 236], textColor: 20, fontStyle: 'bold' },
      columnStyles: Object.fromEntries(s.columns.map((c, i) => [i, { halign: c.numeric ? 'right' : 'left' }])),
      margin: { left: 30, right: 30 },
    })
  })
  doc.save(filename)
}
