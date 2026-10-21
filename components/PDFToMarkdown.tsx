/* Thin re-export shim.
   The full premium implementation now lives in ./PDFToMarkdown/index.tsx,
   split across icons.tsx, utils.ts, views.tsx, premium.css.
   Existing consumers (e.g. app/page.tsx) importing default from this path
   continue to work unchanged. */

export { default } from './PDFToMarkdown/index'
