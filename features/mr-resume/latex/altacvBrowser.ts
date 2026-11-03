import { assertLatexPath, cloneAsNewProject, LatexProjectError, newLatexId, reviseProject, validateLatexProject } from './project.ts'
import type { LatexProject, LatexTextFile } from './types.ts'

type Command = { name: string; start: number; end: number; depth: number }
type Group = { start: number; end: number; value: string }
type Edit = { start: number; end: number; text: string }

function unsupported(detail: string): never {
  throw new LatexProjectError(`Cannot make a browser-compatible AltaCV copy: ${detail}. All original sources and images are unchanged.`, 'unsupported_altacv_entry')
}

/** Mask comments, rather than deleting them, so edits still address the original source. */
function uncommented(source: string) {
  const chars = source.split('')
  for (let i = 0; i < chars.length; i++) if (chars[i] === '%') {
    let slashes = 0
    for (let j = i - 1; j >= 0 && source[j] === '\\'; j--) slashes++
    if (slashes % 2 === 0) for (; i < chars.length && chars[i] !== '\n' && chars[i] !== '\r'; i++) chars[i] = ' '
  }
  return chars.join('')
}

function commands(code: string) {
  const result: Command[] = []
  let depth = 0, balanced = true
  for (let i = 0; i < code.length; i++) {
    if (code[i] === '\\') {
      let end = i + 1
      if (/[A-Za-z@]/u.test(code[end] ?? '')) while (/[A-Za-z@]/u.test(code[end] ?? '')) end++
      else end++
      result.push({ name: code.slice(i + 1, end), start: i, end, depth })
      i = end - 1
    } else if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth < 0) balanced = false
  }
  return { items: result, balanced: balanced && depth === 0 }
}

/** Optional arguments may contain braces, commas and nested [regular] icon options. */
function group(code: string, from: number, open = '{'): Group | null {
  let start = from
  while (/\s/u.test(code[start] ?? '') && start < code.length) start++
  if (code[start] !== open) return null
  const stack = [open]
  for (let i = start + 1; i < code.length; i++) {
    if (code[i] === '\\') { i++; continue }
    if (code[i] === '{' || (code[i] === '[' && stack.at(-1) !== '{')) stack.push(code[i])
    else if (code[i] === '}' || (code[i] === ']' && stack.at(-1) !== '{')) {
      if ((code[i] === '}' ? '{' : '[') !== stack.pop()) unsupported('an argument has mismatched delimiters')
      if (!stack.length) return { start, end: i + 1, value: code.slice(start + 1, i) }
    }
  }
  return unsupported('an argument is unfinished')
}

const requiredGroup = (code: string, from: number) => group(code, from) ?? unsupported('a required literal argument is missing')

function entrySource(file: LatexTextFile) {
  if (!/\.tex$/iu.test(file.path)) return null
  const code = uncommented(file.content), scanned = commands(code)
  const classes = scanned.items.filter((item) => item.name === 'documentclass' && item.depth === 0)
  if (classes.length !== 1) return null
  const declaration = classes[0], options = group(code, declaration.end, '[')
  const className = requiredGroup(code, options?.end ?? declaration.end)
  if (className.value.trim() !== 'altacv') return null
  const boundaries = scanned.items.filter((item) => item.depth === 0 && (item.name === 'begin' || item.name === 'end'))
    .map((item) => ({ ...item, argument: requiredGroup(code, item.end) })).filter((item) => item.argument.value.trim() === 'document')
  if (boundaries.length !== 2 || boundaries[0].name !== 'begin' || boundaries[1].name !== 'end' || className.end > boundaries[0].start) return null
  return { code, items: scanned.items, balanced: scanned.balanced, declaration, className, begin: boundaries[0], end: boundaries[1] }
}

/** Preamble fragments and commented examples are not document entry points. */
export function findAltaCvEntry(project: LatexProject): LatexTextFile | null {
  if (project.templateId === 'altacv-browser') return null
  const selected = project.files.find((file) => file.path === project.mainFile)
  for (const file of selected ? [selected, ...project.files.filter((item) => item !== selected)] : project.files) {
    try { if (entrySource(file)) return file } catch (error) { if (!(error instanceof LatexProjectError)) throw error }
  }
  return null
}

function replace(source: string, edits: Edit[]) {
  let result = '', cursor = 0
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.start < cursor) unsupported('source transformations overlap')
    result += source.slice(cursor, edit.start) + edit.text
    cursor = edit.end
  }
  return result + source.slice(cursor)
}

const comment = (source: string) => `\n${source.split(/\r\n|\n|\r/u).map((line) => `% ${line}`).join('\n')}\n`
const nativeCommands = new Set(['documentclass', 'usepackage', 'RequirePackage', 'setmainfont', 'setsansfont', 'setmonofont', 'newfontfamily', 'fontfamily', 'iftutex', 'addbibresource', 'definecolor', 'colorlet', 'tikz', 'usetikzlibrary'])
const hooks = new Set(['namefont', 'taglinefont', 'personalinfofont', 'cvsectionfont', 'cvsubsectionfont', 'cvItemMarker', 'datename', 'locationname'])
const packages = new Set(['paracol', 'roboto', 'lato', 'sourcesanspro', 'fontspec', 'biblatex', 'xcolor', 'fontawesome5', 'simpleicons', 'tikz', 'inputenc', 'fontenc', 'lmodern', 'geometry', 'graphicx', 'color', 'multicol', 'enumitem', 'etoolbox', 'xparse', 'expl3', 'hyperref', 'iftex'])

function resolveSource(project: LatexProject, owner: LatexTextFile, reference: string, extension: 'tex' | 'bib') {
  const path = reference.trim().endsWith(`.${extension}`) ? reference.trim() : `${reference.trim()}.${extension}`
  assertLatexPath(path, 'text')
  if (!path.endsWith(`.${extension}`)) unsupported(`unsupported ${extension} resource ${reference}`)
  const folder = owner.path.slice(0, owner.path.lastIndexOf('/') + 1)
  return project.files.find((file) => file.path === `${folder}${path}`) ?? project.files.find((file) => file.path === path) ?? unsupported(`missing original resource ${reference}`)
}

function preamble(project: LatexProject, file: LatexTextFile, entry: NonNullable<ReturnType<typeof entrySource>>) {
  const kept: string[] = [], geometry: string[] = [], references: string[] = [], removed: Edit[] = []
  let covered = entry.className.end
  const addResource = (owner: LatexTextFile, value: string) => {
    if (!value.trim().endsWith('.bib')) unsupported('bibliography resources must be literal local .bib filenames')
    const resource = resolveSource(project, owner, value, 'bib')
    if (!references.includes(resource.path)) references.push(resource.path)
  }
  if (entry.code.slice(0, entry.declaration.start).trim()) unsupported('executable code precedes the document class')
  for (const item of entry.items.filter((item) => item.start >= entry.className.end && item.start < entry.begin.start && item.depth === 0)) {
    if (item.start < covered) continue
    let position = item.end
    const star = entry.code[position] === '*'
    if (star) position++
    const optional = group(entry.code, position, '[')
    if (optional) position = optional.end
    const args: Group[] = []
    const take = (count: number) => { for (let i = 0; i < count; i++) { const arg = requiredGroup(entry.code, position); args.push(arg); position = arg.end } }
    let retain = false
    switch (item.name) {
      case 'iftutex': case 'else': case 'fi': break
      case 'setmainfont': case 'setsansfont': case 'setmonofont': take(1); position = group(entry.code, position, '[')?.end ?? position; break
      case 'usepackage': case 'RequirePackage':
        take(1)
        if (args[0].value.split(',').some((name) => !packages.has(name.trim()))) unsupported('an additional preamble package is not covered by this adapter')
        break
      case 'definecolor': take(3); break
      case 'colorlet': take(2); break
      case 'geometry':
        take(1)
        if (!/^(?:(?:left|right|top|bottom|margin|hmargin|vmargin|columnsep|headheight|headsep|footskip)\s*=\s*(?:\d+(?:\.\d+)?|\.\d+)(?:cm|mm|in|pt|bp|pc|em|ex)\s*)(?:,\s*(?:left|right|top|bottom|margin|hmargin|vmargin|columnsep|headheight|headsep|footskip)\s*=\s*(?:\d+(?:\.\d+)?|\.\d+)(?:cm|mm|in|pt|bp|pc|em|ex)\s*)*$/u.test(args[0].value.trim())) unsupported('geometry needs simple literal margins and dimensions')
        geometry.push(`\\geometry{${args[0].value.trim()}}`)
        break
      case 'input': {
        take(1)
        if (!/(?:^|\/)pubs-(?:num|authoryear)(?:\.tex)?$/u.test(args[0].value.trim())) unsupported('an additional preamble input cannot be discarded safely')
        const fragment = resolveSource(project, file, args[0].value, 'tex'), code = uncommented(fragment.content)
        if (entrySource(fragment)) unsupported('a publications formatting input is a document, not a fragment')
        for (const resource of commands(code).items.filter((item) => item.name === 'addbibresource')) addResource(fragment, requiredGroup(code, group(code, resource.end, '[')?.end ?? resource.end).value)
        break
      }
      case 'addbibresource': take(1); addResource(file, args[0].value); break
      case 'renewcommand':
        take(1)
        if (group(entry.code, position, '[')) unsupported('parameterized preamble command overrides are not supported')
        take(1)
        if (hooks.has(args[0].value.replace(/^\\/u, '').trim())) {
          if (commands(args[1].value).items.some((token) => nativeCommands.has(token.name) || /^fa[A-Z]/u.test(token.name))) unsupported('a retained font or text hook needs unavailable commands')
          retain = true
        } else if (!['\\familydefault', '\\cvRatingMarker', '\\cvDateMarker', '\\cvLocationMarker'].includes(args[0].value.trim())) unsupported('an additional preamble override cannot be discarded safely')
        break
      case 'name': case 'tagline': case 'personalinfo': case 'mynames': take(1); retain = true; break
      case 'photoL': case 'photoR': take(2); retain = true; break
      case 'NewInfoField': take(2); position = group(entry.code, position, '[')?.end ?? position; retain = true; break
      default: unsupported(`preamble command \\${item.name} is outside the supported AltaCV sample surface`)
    }
    if (retain) kept.push(file.content.slice(item.start, position))
    removed.push({ start: item.start - entry.className.end, end: position - entry.className.end, text: '' })
    covered = position
  }
  if (replace(entry.code.slice(entry.className.end, entry.begin.start), removed).trim()) unsupported('the preamble contains additional source that cannot be discarded safely')
  return { kept, geometry, references }
}

function body(file: LatexTextFile, entry: NonNullable<ReturnType<typeof entrySource>>, references: string[]) {
  const edits: Edit[] = [], environments: string[] = []
  let inColumns = false, printed = false, covered = entry.begin.argument.end
  for (const item of entry.items.filter((item) => item.start >= entry.begin.argument.end && item.start < entry.end.start)) {
    if (nativeCommands.has(item.name)) unsupported(`body command \\${item.name} requires a separate adaptation`)
    if (item.start < covered) continue
    let position = item.end
    switch (item.name) {
      case 'printbibliography': {
        if (entry.code[position] === '*') unsupported('starred publication commands are not supported')
        const options = group(entry.code, position, '[')
        position = options?.end ?? position
        if (!references.length) unsupported('publications have no original local bibliography resource')
        const original = comment(file.content.slice(item.start, position))
        edits.push({ start: item.start, end: position, text: printed
          ? `% This original publication group is included in the combined bibliography above.${original}`
          : `% Browser adaptation: all original publication groups are combined using real classic BibTeX.${original}\\bibliographystyle{plain}\n\\bibliography{${references.map((path) => path.slice(0, -4)).join(',')}}\n` })
        printed = true
        break
      }
      case 'columnratio': {
        const ratio = requiredGroup(entry.code, position)
        if (!/^(?:0?\.\d+)$/u.test(ratio.value.trim()) || Number(ratio.value) <= 0 || Number(ratio.value) >= 1) unsupported('column ratios must be literal fractions between zero and one')
        position = ratio.end
        edits.push({ start: item.start, end: position, text: comment(`Original column ratio, replaced by equal-width balanced columns: ${file.content.slice(item.start, position)}`) })
        break
      }
      case 'begin': case 'end': {
        const environment = requiredGroup(entry.code, position)
        const name = environment.value.trim()
        if (!/^[A-Za-z*]+$/u.test(name)) unsupported('environment names must be literal')
        if (item.name === 'begin') environments.push(name)
        else if (environments.pop() !== name) unsupported('document environments are mismatched')
        position = environment.end
        if (['tikzpicture', 'tcolorbox', 'paracol*'].includes(name)) unsupported(`environment ${name} is not supported`)
        if (name !== 'paracol') break
        if (item.name === 'begin') {
          const count = requiredGroup(entry.code, position)
          if (inColumns || count.value.trim() !== '2') unsupported('only non-nested two-column paracol layouts can be adapted')
          position = count.end; inColumns = true
          edits.push({ start: item.start, end: position, text: '% Browser adaptation: equal-width balanced multicol flow, not independent 6:4 paracol columns.\n\\begin{multicols}{2}' })
        } else {
          if (!inColumns) unsupported('a paracol environment has no matching beginning')
          inColumns = false
          edits.push({ start: item.start, end: position, text: '\\end{multicols}' })
        }
        break
      }
      case 'switchcolumn':
        if (!inColumns || entry.code[position] === '*' || group(entry.code, position, '[')) unsupported('only plain switches inside two-column paracol are supported')
        edits.push({ start: item.start, end: position, text: '\\columnbreak' })
        break
      case 'newpage':
        if (inColumns) edits.push({ start: item.start, end: position, text: '\\columnbreak' })
        break
      case 'input': case 'include': {
        const input = requiredGroup(entry.code, position)
        if (/(?:^|\/)pubs-(?:num|authoryear)(?:\.tex)?$/u.test(input.value.trim())) unsupported('publications formatting inputs belong in the preamble')
        position = input.end
        break
      }
      case 'wheelchart': {
        position = group(entry.code, position, '[')?.end ?? position
        const outer = requiredGroup(entry.code, position), inner = requiredGroup(entry.code, outer.end), values = requiredGroup(entry.code, inner.end)
        if (!values.value.trim()) unsupported('a wheel chart needs at least one original value/description pair')
        // clist protects braced commas; delimited TeX arguments keep the complete description after the third slash.
        let depth = 0, start = 0
        for (let i = 0; i <= values.value.length; i++) {
          if (values.value[i] === '\\') { i++; continue }
          if (values.value[i] === '{') depth++
          else if (values.value[i] === '}') depth--
          if (i === values.value.length || (values.value[i] === ',' && depth === 0)) {
            const value = values.value.slice(start, i).trim()
            if (value && !/^\d+(?:\.\d+)?\/[^/]+\/[^/]+\/[\s\S]+$/u.test(value)) unsupported('a wheel chart needs value/width/color/description entries')
            start = i + 1
          }
        }
        position = values.end
        break
      }
    }
    covered = position
  }
  if (inColumns || environments.length) unsupported('a document environment is unfinished')
  return replace(file.content.slice(entry.begin.start, entry.end.argument.end), edits.map((edit) => ({ ...edit, start: edit.start - entry.begin.start, end: edit.end - entry.begin.start })))
}

const browserFonts = String.raw`% SmilePDF managed fonts v2: real fonts selected for the active TeX engine.
\RequirePackage{iftex}
\ifPDFTeX
  \RequirePackage{lmodern}
  \RequirePackage[T1]{fontenc}
\else
  \RequirePackage{fontspec}
  % The Unicode bundle contains Roman OpenType, not Sans/Mono OpenType families.
  \setmainfont{Latin Modern Roman}
  \setsansfont{Latin Modern Roman}
  \setmonofont{Latin Modern Roman}
\fi
`

function browserStyle(packagePath: string) {
  return String.raw`% SmilePDF browser-compatible AltaCV support, version 2.
% Uses real Latin Modern, core color and graphicx; no FontAwesome or PDF/A claim.
% Icon arguments are consumed without expansion. Text labels replace icon glyphs.
% Photos are rectangular. The wheel chart becomes its original value/description list.
\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{${packagePath}}[2026/11/03 Browser-compatible AltaCV copy]
${browserFonts}
\RequirePackage{color,graphicx,multicol,enumitem,etoolbox,xparse}
\RequirePackage[hidelinks]{hyperref}
\definecolor{name}{rgb}{0,0,0}
\definecolor{tagline}{rgb}{0.5608,0.051,0.051}
\definecolor{heading}{rgb}{0.2706,0.0314,0.0314}
\definecolor{headingrule}{rgb}{0.9059,0.8196,0.5725}
\definecolor{subheading}{rgb}{0.5608,0.051,0.051}
\definecolor{accent}{rgb}{0.5608,0.051,0.051}
\definecolor{emphasis}{rgb}{0.1804,0.1804,0.1804}
\definecolor{body}{rgb}{0.4,0.4,0.4}
\renewcommand{\familydefault}{\sfdefault}
\newcommand{\namefont}{\Huge\rmfamily\bfseries}
\newcommand{\taglinefont}{\large\bfseries}
\newcommand{\personalinfofont}{\footnotesize}
\newcommand{\cvsectionfont}{\Large\rmfamily\bfseries}
\newcommand{\cvsubsectionfont}{\large\bfseries}
\newcommand{\cvItemMarker}{{\small\textbullet}}
\newcommand{\datename}{Date}
\newcommand{\locationname}{Location}
\setlist[itemize]{leftmargin=*,label=\cvItemMarker,nosep,itemsep=0.25\baselineskip}
\setlength{\parindent}{0pt}
\AtBeginDocument{\pagestyle{empty}\color{body}\raggedright}
\def\smilepdf@name{}
\def\smilepdf@tagline{}
\def\smilepdf@personalinfo{}
\newcommand{\name}[1]{\def\smilepdf@name{#1}}
\newcommand{\tagline}[1]{\def\smilepdf@tagline{#1}}
\newcommand{\personalinfo}[1]{\def\smilepdf@personalinfo{#1}}
\NewDocumentCommand{\printinfo}{o m m o}{%
  \IfNoValueTF{#1}{\textcolor{accent}{Info:}}{\textcolor{accent}{#1:}}\space
  \IfNoValueTF{#4}{\nolinkurl{#3}}{\href{#4}{\nolinkurl{#3}}}\par}
\NewDocumentCommand{\NewInfoField}{s m m o}{%
  \IfBooleanTF{#1}{%
    \csdef{#2}##1##2{\printinfo[\MakeUppercase{#2}]{}{##1}[##2]}%
  }{%
    \IfNoValueTF{#4}{\csdef{#2}##1{\printinfo[\MakeUppercase{#2}]{}{##1}}}%
      {\csdef{#2}##1{\printinfo[\MakeUppercase{#2}]{}{##1}[#4##1]}}}}
\newcommand{\email}[1]{\printinfo[Email]{}{#1}[mailto:#1]}
\newcommand{\phone}[1]{\printinfo[Phone]{}{#1}[tel:#1]}
\newcommand{\mailaddress}[1]{\textcolor{accent}{Address:}\space #1\par}
\newcommand{\location}[1]{\textcolor{accent}{\locationname:}\space #1\par}
\newcommand{\homepage}[1]{\printinfo[Website]{}{#1}[https://#1]}
\newcommand{\twitter}[1]{\printinfo[Twitter]{}{#1}[https://twitter.com/#1]}
\newcommand{\xtwitter}[1]{\printinfo[X]{}{#1}[https://x.com/#1]}
\newcommand{\linkedin}[1]{\printinfo[LinkedIn]{}{#1}[https://linkedin.com/in/#1]}
\newcommand{\github}[1]{\printinfo[GitHub]{}{#1}[https://github.com/#1]}
\newcommand{\orcid}[1]{\printinfo[ORCID]{}{#1}[https://orcid.org/#1]}
\newlength{\smilepdf@photowidth}
\newlength{\smilepdf@leftsize}
\newlength{\smilepdf@rightsize}
\def\smilepdf@leftphotos{}
\def\smilepdf@rightphotos{}
\newcommand{\smilepdf@addleft}[1]{%
  \appto\smilepdf@leftphotos{\includegraphics[width=\smilepdf@leftsize,height=\smilepdf@leftsize,keepaspectratio]{#1}\hspace{1ex}}%
  \addtolength{\smilepdf@photowidth}{\smilepdf@leftsize}\addtolength{\smilepdf@photowidth}{1ex}}
\newcommand{\smilepdf@addright}[1]{%
  \appto\smilepdf@rightphotos{\includegraphics[width=\smilepdf@rightsize,height=\smilepdf@rightsize,keepaspectratio]{#1}\hspace{1ex}}%
  \addtolength{\smilepdf@photowidth}{\smilepdf@rightsize}\addtolength{\smilepdf@photowidth}{1ex}}
\newcommand{\photoL}[2]{\setlength{\smilepdf@leftsize}{#1}\forcsvlist{\smilepdf@addleft}{#2}}
\newcommand{\photoR}[2]{\setlength{\smilepdf@rightsize}{#1}\forcsvlist{\smilepdf@addright}{#2}}
\newcommand{\makecvheader}{%
  \par\begingroup\smilepdf@leftphotos%
  \begin{minipage}[b]{\dimexpr\linewidth-\smilepdf@photowidth\relax}\raggedright
    {\namefont\color{name}\smilepdf@name\par}\smallskip
    {\taglinefont\color{tagline}\smilepdf@tagline\par}\medskip
    {\personalinfofont\smilepdf@personalinfo\par}
  \end{minipage}\smilepdf@rightphotos\par\endgroup\medskip}
\NewDocumentCommand{\cvsection}{o m}{%
  \par\bigskip{\cvsectionfont\color{heading}#2\par}%
  {\color{headingrule}\rule{\linewidth}{1pt}\par}\smallskip
  \IfNoValueF{#1}{\input{#1}}}
\newcommand{\cvsubsection}[1]{\par\smallskip{\cvsubsectionfont\color{subheading}#1\par}\smallskip}
\newcommand{\cvevent}[4]{%
  \par\smallskip{\large\color{emphasis}#1\par}%
  \ifstrempty{#2}{}{\textbf{\textcolor{accent}{#2}}\par}%
  \ifstrempty{#3}{}{{\small\datename:\space #3\par}}%
  \ifstrempty{#4}{}{{\small\locationname:\space #4\par}}\smallskip}
\newcommand{\divider}{\par\smallskip{\color{headingrule}\rule{\linewidth}{0.4pt}\par}\smallskip}
\newcommand{\cvtag}[1]{\leavevmode\begingroup\fboxsep=0.45em\fbox{\strut #1}\endgroup\hspace{0.35em}}
\newcommand{\cvskill}[2]{\par\textbf{\textcolor{emphasis}{#1}}\hfill\textcolor{accent}{#2/5}\par}
\newcommand{\cvachievement}[3]{\par\smallskip\textbf{\textcolor{emphasis}{#2}}\par #3\par\smallskip}
% The exact sample has four referee arguments; AltaCV's three-argument form is also readable.
\NewDocumentCommand{\cvref}{m m m g}{%
  \par\smallskip\textbf{\textcolor{emphasis}{#1}}\par
  \IfNoValueTF{#4}{\email{#2}#3\par}{#2\par\email{#3}#4\par}}
% Classic BibTeX cannot implement biblatex's own-author highlighting. Consume, never expand, its name list.
\newcommand{\mynames}[1]{}
\ExplSyntaxOn
\cs_new_protected:Npn \smilepdf_wheel_item:w #1/#2/#3/#4\q_stop
  { \item \textbf{#1:}~#4 }
\NewDocumentCommand{\wheelchart}{O{0} m m m}
  { \begin{itemize}[leftmargin=*,label={}]
    \clist_map_inline:nn {#4} { \smilepdf_wheel_item:w ##1\q_stop }
    \end{itemize} }
\ExplSyntaxOff
\endinput
`
}

/** An explicit, independent copy; this never uploads, compiles, or edits the imported project. */
export function createAltaCvBrowserProject(project: LatexProject, entryPath?: string): LatexProject {
  validateLatexProject(project)
  if (project.templateId === 'altacv-browser') unsupported('this project is already a browser-compatible copy')
  const file = entryPath === undefined ? findAltaCvEntry(project) : project.files.find((file) => file.path === entryPath)
  const entry = file && entrySource(file)
  if (!file || !entry) unsupported('select an uncommented, complete .tex document using the altacv class')
  if (!entry.balanced || entry.code.slice(entry.end.argument.end).trim()) unsupported('the document has unbalanced groups or executable trailing source')
  const prepared = preamble(project, file, entry), adaptedBody = body(file, entry, prepared.references)
  const paths = [...project.files, ...project.assets].map((file) => file.path.toLowerCase())
  let directory = 'smilepdf-browser', suffix = 1
  while (paths.some((path) => path === directory || path.startsWith(`${directory}/`))) directory = `smilepdf-browser-${suffix++}`
  const mainFile = `${directory}/main.tex`, packagePath = `${directory}/altacv-browser`
  const folder = file.path.slice(0, file.path.lastIndexOf('/') + 1)
  const notice = `% SmilePDF browser-compatible COPY of ${file.path}; original files and license are retained unchanged.\n`
    + '% Changes: article/A4/10pt and real engine-aware Latin Modern fonts; core color palette and readable platform labels, not icons.\n'
    + '% Rectangular photos; equal-width balanced multicol flow replaces independent paracol columns and their 6:4 ratio.\n'
    + '% Wheel charts show original values/descriptions. Publications use combined plain classic BibTeX, not Biber.\n'
    + '% Original publication grouping, sorting and own-author highlighting are not reproduced; no PDF/A claim is made.\n'
  const main = file.content.slice(0, entry.declaration.start) + notice
    + '\\documentclass[10pt,a4paper]{article}\n\\usepackage{geometry}\n'
    + `${(prepared.geometry.length ? prepared.geometry : ['\\geometry{left=1.25cm,right=1.25cm,top=1.5cm,bottom=1.5cm,columnsep=1.2cm}']).join('\n')}\n`
    + `\\usepackage{${packagePath}}\n${folder ? `\\graphicspath{{${folder}}}\n` : ''}`
    + `${prepared.kept.join('\n')}\n${adaptedBody}${file.content.slice(entry.end.argument.end)}`
  const copy = cloneAsNewProject(project)
  return validateLatexProject({ ...copy, mainFile, engine: 'pdflatex', templateId: 'altacv-browser', templateVersion: 2,
    files: [...copy.files, { id: newLatexId(), path: mainFile, content: main }, { id: newLatexId(), path: `${packagePath}.sty`, content: browserStyle(packagePath) }] })
}

/** Repair only the shipped v1 generated font block, never body text or custom font choices. */
export function repairAltaCvBrowserProject(project: LatexProject): LatexProject {
  validateLatexProject(project)
  if (project.templateId !== 'altacv-browser' || project.templateVersion !== 1 || project.mainFile === null) return project
  const main = project.files.find((file) => file.path === project.mainFile)
  if (!main?.content.includes('% SmilePDF browser-compatible COPY of ')) return project
  const boundary = main.content.indexOf('\\begin{document}')
  if (boundary < 0) return project
  const prefix = main.content.slice(0, boundary), suffix = main.content.slice(boundary)
  const packagePath = /\\usepackage\{([^}]+\/altacv-browser)\}/u.exec(uncommented(prefix))?.[1]
  const style = project.files.find((file) => file.path === `${packagePath}.sty`)
  const anchor = '\\RequirePackage{color,graphicx,multicol,enumitem,etoolbox,xparse}'
  if (!style?.content.startsWith('% SmilePDF browser-compatible AltaCV support, version 1.') || !style.content.includes(anchor)) return project
  const legacyFonts = /(?:\\usepackage\{lmodern\}\r?\n\\usepackage\[T1\]\{fontenc\}|\\usepackage\[T1\]\{fontenc\}\r?\n\\usepackage\{lmodern\})\r?\n/u
  if (!legacyFonts.test(prefix)) return project
  const nextPrefix = prefix.replace(legacyFonts, '% Updated managed Latin Modern fonts; body and original files are unchanged.\n')
  if (/\\(?:setmainfont|setsansfont|setmonofont|newfontfamily)|\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\b(?:fontenc|fontspec|lmodern|lato|roboto)\b/u.test(uncommented(nextPrefix))) return project
  if (/\\(?:setmainfont|setsansfont|setmonofont|newfontfamily)|\\RequirePackage(?:\[[^\]]*\])?\{[^}]*\b(?:fontenc|fontspec|lmodern|lato|roboto)\b/u.test(uncommented(style.content))) return project
  const repairedStyle = style.content.replace('support, version 1.', 'support, version 2.').replace(anchor, browserFonts + anchor)
  return reviseProject(project, { templateVersion: 2, files: project.files.map((file) => file.id === main.id ? { ...file, content: nextPrefix + suffix } : file.id === style.id ? { ...file, content: repairedStyle } : file) })
}
