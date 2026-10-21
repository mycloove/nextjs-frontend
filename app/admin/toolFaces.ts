/**
 * The face each instrument already wears in the product.
 *
 * The fifteen shell tools take their glyph straight from lib/tools/registry.ts,
 * which is where the homepage and the tool chrome read it from — an operator
 * closing an instrument on the bench should be looking at the same face they see
 * on the card. The three that are not shell tools (they live outside the (tools)
 * group) get a glyph here and nowhere else, because there is no registry entry
 * for them to borrow.
 *
 * Deliberately not derived from the registry at runtime: the bench must not
 * import the shell tool registry, and a copy is honest about what it is. When a
 * registry glyph changes, this table is the second place to change, which is the
 * same duplication TOOL_CATALOG already carries and the reason the audit flags
 * a missing cross-check test.
 */
const FACES: Record<string, string> = {
  // Shell tools — glyphs must match lib/tools/registry.ts.
  'image-to-pdf': '🖼️',
  'pdf-to-images': '📄',
  'pdf-to-word': '📝',
  'word-to-pdf': '📃',
  'image-to-text': '🔎',
  'pdf-to-markdown': '✍️',
  'markdown-to-pdf': '📑',
  'ai-analyzer': '✨',
  'batch-process': '⚡',
  'fasta-tools': '🧬',
  'bijoy-converter': '🔤',
  'merge-pdf': '🔗',
  'split-pdf': '✂️',
  'rotate-pdf': '🔄',
  'compress-pdf': '🗜️',
  // Standalone apps — bench-only.
  'document-ai': '🧠',
  'pdf-editor': '🖊️',
  'image-editor': '🎨',
}

export function toolFace(toolId: string) {
  return FACES[toolId] ?? '⚙️'
}