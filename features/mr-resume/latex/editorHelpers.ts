/** CodeMirror can preserve a consistent CRLF/CR file without changing it to LF on every edit. */
export function sourceLineSeparator(source: string) {
  const breaks = source.match(/\r\n|\r|\n/gu)
  if (!breaks?.length) return '\n'
  return breaks.every((item) => item === breaks[0]) ? breaks[0] : '\n'
}

function stripComment(line: string) {
  return line.replace(/(?<!\\)(?:\\\\)*%.*/u, '')
}

export function environmentFold(source: string, lineNumber: number): { from: number; to: number; endLine: number } | null {
  const separator = sourceLineSeparator(source), lines = source.split(separator)
  if (lineNumber < 1 || lineNumber > lines.length) return null
  const start = stripComment(lines[lineNumber - 1]), begin = start.match(/\\begin\{([^{}]+)\}/u)
  if (!begin) return null
  let depth = 0, from = 0, offset = 0
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (index < lineNumber - 1) { offset += line.length + separator.length; continue }
    if (index === lineNumber - 1) from = offset + line.length
    for (const match of stripComment(line).matchAll(/\\(begin|end)\{([^{}]+)\}/gu)) if (match[2] === begin[1]) {
      if (match[1] === 'begin') depth++
      else if (--depth === 0) return index > lineNumber - 1 ? { from, to: offset, endLine: index + 1 } : null
    }
    offset += line.length + separator.length
  }
  return null
}

export const latexSnippets = [
  { label: '\\section*', template: '\\section*{${1:Heading}}\n${2:Writing}', detail: 'Resume section' },
  { label: '\\subsection*', template: '\\subsection*{${1:Heading}}\n${2:Writing}', detail: 'Subsection' },
  { label: '\\textbf', template: '\\textbf{${1:text}}', detail: 'Bold text' },
  { label: '\\emph', template: '\\emph{${1:text}}', detail: 'Emphasis' },
  { label: '\\href', template: '\\href{${1:https://example.com}}{${2:Link text}}', detail: 'Link' },
  { label: '\\input', template: '\\input{${1:section.tex}}', detail: 'Include local source' },
  { label: '\\includegraphics', template: '\\includegraphics[width=${1:30mm}]{${2:profile-photo.jpg}}', detail: 'Local image (graphicx required)' },
  { label: '\\begin{itemize}', template: '\\begin{itemize}\n  \\item ${1:Achievement}\n\\end{itemize}', detail: 'Achievement list' },
  { label: '\\begin', template: '\\begin{${1:environment}}\n  ${2:content}\n\\end{${1:environment}}', detail: 'Paired environment' },
  { label: '\\resumeentry', template: '\\resumeentry{${1:Role, Organization}}{${2:Dates}}{${3:Location}}', detail: 'Career / academic template entry' },
  { label: '\\addbibresource', template: '\\addbibresource{${1:references.bib}}', detail: 'Local bibliography (biblatex required)' },
  { label: '\\textenglish', template: '\\textenglish{${1:English writing}}', detail: 'English span (polyglossia required)' },
] as const
