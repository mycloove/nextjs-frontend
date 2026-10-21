export async function generateSamplePdfFiles(): Promise<File[]> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')

  const sampleDefinitions = [
    {
      name: 'Quarterly_Report_2026.pdf',
      size: [595.28, 841.89] as [number, number],
      pages: 3,
      color: rgb(0.77, 0.57, 0.31),
    },
    {
      name: 'Executive_Summary.pdf',
      size: [612, 792] as [number, number],
      pages: 2,
      color: rgb(0.5, 0.66, 0.54),
    },
    {
      name: 'Financial_Appendix.pdf',
      size: [595.28, 419.53] as [number, number],
      pages: 4,
      color: rgb(0.44, 0.62, 0.71),
    },
  ]

  const files: File[] = []
  for (const def of sampleDefinitions) {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.HelveticaBold)
    for (let i = 1; i <= def.pages; i++) {
      const page = doc.addPage(def.size)
      const [w, h] = def.size
      page.drawRectangle({
        x: 0,
        y: h * 0.85,
        width: w,
        height: h * 0.15,
        color: def.color,
      })
      page.drawText(def.name.replace('.pdf', ''), {
        x: 24,
        y: h * 0.9,
        size: 16,
        font,
        color: rgb(0.1, 0.1, 0.1),
      })
      page.drawText(`Page ${i} of ${def.pages}`, {
        x: 24,
        y: h * 0.5,
        size: 28,
        font,
        color: rgb(0.2, 0.2, 0.2),
      })
      page.drawText('Interactive PDF Sample Document', {
        x: 24,
        y: 28,
        size: 12,
        font,
        color: rgb(0.4, 0.4, 0.4),
      })
    }
    const bytes = await doc.save()
    files.push(new File([bytes.slice()], def.name, { type: 'application/pdf' }))
  }

  return files
}
