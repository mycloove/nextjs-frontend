import Link from 'next/link'

/** Public product information only. Never includes a restored document. */
export default function MrMarkdownPublicInfo() {
  return (
    <section className="pm-public-info" aria-labelledby="mr-markdown-about">
      <p className="pm-public-info-label">The document workflow</p>
      <h2 id="mr-markdown-about">Mr. Markdown by mycloove</h2>
      <p className="pm-public-info-intro">
        An online Markdown editor with live preview, and a PDF-to-Markdown
        workflow in the same workspace. Start with a blank document or extract
        a PDF, then keep editing the text and structure before you export.
      </p>
      <div className="pm-public-info-columns">
        <div>
          <h3>From a fixed page to editable text</h3>
          <ol>
            <li>Choose a PDF and a conversion mode, or open a blank Markdown editor.</li>
            <li>Review headings, tables, code, and reading order in the editor and preview.</li>
            <li>Save Markdown or choose an available export format, then check the result.</li>
          </ol>
          <pre aria-label="Example Markdown syntax, not a conversion result">{'# Project notes\n\n- Review the source\n- Edit the Markdown\n- Check the export'}</pre>
        </div>
        <div>
          <h3>Know the boundaries</h3>
          <p>
            PDF extraction is not a guarantee of identical layout. Scanned
            pages need OCR, whose language support depends on the processing
            service. Review recognition errors and complex tables carefully.
          </p>
          <p>
            Bijoy handling can help with legacy Bangla text. It does not make
            every broken or scanned document recoverable. The workspace shows
            current file limits, action costs, and account requirements.
          </p>
          <p>
            Completed documents can be saved in this browser to restore your
            workspace. Read the <Link href="/privacy">privacy policy</Link>
            {' '}before working with sensitive content.
          </p>
          <nav aria-label="Related document tools" className="pm-public-info-links">
            <Link href="/bijoy-converter">Bijoy to Unicode</Link>
            <Link href="/image-to-text">Image to Text</Link>
            <Link href="/markdown-to-pdf">Markdown to PDF</Link>
          </nav>
        </div>
      </div>
    </section>
  )
}
