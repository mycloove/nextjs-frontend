import { getBengaliTexFamily } from './resumeFonts.ts'

/** A generic family must come last; otherwise it hides the Bengali webfont. */
export function paperFontStack(font: string, family: string, bengali: boolean): string {
  if (!bengali) return family
  if (font === 'Inter' || family === 'inherit') return '"Noto Sans Bengali", sans-serif'
  if (family.includes('Mr Resume ') || font === 'Noto Sans Bengali') return family
  const names = family.split(',').map((name) => name.trim())
  const generic = names.find((name) => /^(?:serif|sans-serif|system-ui)$/u.test(name)) ?? 'sans-serif'
  return [...names.filter((name) => !/^(?:serif|sans-serif|system-ui)$/u.test(name)), '"Noto Sans Bengali"', generic].join(', ')
}

export function latexLanguageSetup(font: string, language: 'English' | 'Bangla', containsBangla: boolean): string {
  if (language !== 'Bangla' && !containsBangla) return ''
  return `\\usepackage{polyglossia}\n\\setdefaultlanguage{${language === 'Bangla' ? 'bengali' : 'english'}}\n\\setotherlanguage{${language === 'Bangla' ? 'english' : 'bengali'}}\n\\newfontfamily\\bengalifont[Script=Bengali]{${getBengaliTexFamily(font)}}\n`
}

export function escapeLatex(value: string, bilingual = false): string {
  const escaped = value.replace(/[\\{}$&#%_~^]/g, (character) => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' })[character]!)
  return bilingual ? escaped.replace(/[\u0980-\u09ff\u200c\u200d]+(?:[ \t]+[\u0980-\u09ff\u200c\u200d]+)*/gu, (run) => `\\textbengali{${run}}`) : escaped
}
