import assert from 'node:assert/strict'
import test from 'node:test'
import { createAltaCvBrowserProject, findAltaCvEntry, repairAltaCvBrowserProject } from './altacvBrowser.ts'
import { LatexProjectError, validateLatexProject } from './project.ts'
import { LATEX_PROJECT_VERSION, type LatexProject } from './types.ts'

// Actual v1.7.4 sample.tex preamble and writing; explanatory comments are shortened.
// Unicode is escaped only in this TS fixture, not normalized in the imported TeX.
const address = '\u00c5ddr\u00e9s\u015f, Street, 00000 C\u00f3untry'
const sample = String.raw`%%%%%%%%%%%%%%%%%
% This is an sample CV template created using altacv.cls
% (v1.7.4, 30 July 2025) written by LianTze Lim (liantze@gmail.com). Compiles with pdfLaTeX, XeLaTeX and LuaLaTeX.
%
%% It may be distributed and/or modified under the
%% conditions of the LaTeX Project Public License, either version 1.3
%% of this license or (at your option) any later version.
%% The latest version of this license is in
%%    http://www.latex-project.org/lppl.txt
%% and version 1.3 or later is part of all distributions of LaTeX
%% version 2003/12/01 or later.
%%%%%%%%%%%%%%%%
% \documentclass[10pt,a4paper,withhyper,normalphoto]{altacv}
\documentclass[10pt,a4paper,withhyper]{altacv}
\geometry{left=1.25cm,right=1.25cm,top=1.5cm,bottom=1.5cm,columnsep=1.2cm}
\usepackage{paracol}
\iftutex
  \setmainfont{Roboto Slab}
  \setsansfont{Lato}
  \renewcommand{\familydefault}{\sfdefault}
\else
  \usepackage[rm]{roboto}
  \usepackage[defaultsans]{lato}
  \renewcommand{\familydefault}{\sfdefault}
\fi
\definecolor{SlateGrey}{HTML}{2E2E2E}
\definecolor{LightGrey}{HTML}{666666}
\definecolor{DarkPastelRed}{HTML}{450808}
\definecolor{PastelRed}{HTML}{8F0D0D}
\definecolor{GoldenEarth}{HTML}{E7D192}
\colorlet{name}{black}
\colorlet{tagline}{PastelRed}
\colorlet{heading}{DarkPastelRed}
\colorlet{headingrule}{GoldenEarth}
\colorlet{subheading}{PastelRed}
\colorlet{accent}{PastelRed}
\colorlet{emphasis}{SlateGrey}
\colorlet{body}{LightGrey}
\renewcommand{\namefont}{\Huge\rmfamily\bfseries}
\renewcommand{\personalinfofont}{\footnotesize}
\renewcommand{\cvsectionfont}{\LARGE\rmfamily\bfseries}
\renewcommand{\cvsubsectionfont}{\large\bfseries}
\renewcommand{\cvItemMarker}{{\small\textbullet}}
\renewcommand{\cvRatingMarker}{\faCircle}
\input{pubs-num}
\addbibresource{sample.bib}
\begin{document}
\name{Your Name Here}
\tagline{Your Position or Tagline Here}
\photoR{2.8cm}{Globe_High}
% \photoL{2.5cm}{Yacht_High,Suitcase_High}

\personalinfo{%
  \email{your_name@email.com}
  \phone{000-00-0000}
  \mailaddress{${address}}
  \location{Location, COUNTRY}
  \homepage{www.homepage.com}
  % \twitter{@twitterhandle}
  \xtwitter{@x-handle}
  \linkedin{your_id}
  \github{your_id}
  \orcid{0000-0000-0000-0000}
  % \printinfo{\faPaw}{Hey ho!}[https://example.com/]
  \NewInfoField{gitlab}{\faGitlab}[https://gitlab.com/]
  \gitlab{your_id}
  \NewInfoField*{mastodon}{\faMastodon}
  \mastodon{@username@instance}{https://instance.url/@username}
}

\makecvheader
\columnratio{0.6}
\begin{paracol}{2}
\cvsection{Experience}

\cvevent{Job Title 1}{Company 1}{Month 20XX -- Ongoing}{Location}
\begin{itemize}
\item Job description 1
\item Job description 2
\end{itemize}

\divider

\cvevent{Job Title 2}{Company 2}{Month 20XX -- Ongoing}{Location}
\begin{itemize}
\item Job description 1
\item Job description 2
\end{itemize}

\cvsection{Projects}

\cvevent{Project 1}{Funding agency/institution}{}{}
\begin{itemize}
\item Details
\end{itemize}

\divider

\cvevent{Project 2}{Funding agency/institution}{Project duration}{}
A short abstract would also work.

\medskip

\cvsection{A Day of My Life}

\wheelchart{1.5cm}{0.5cm}{%
  6/8em/accent!30/{Sleep,\\beautiful sleep},
  3/8em/accent!40/Hopeful novelist by night,
  8/8em/accent!60/Daytime job,
  2/10em/accent/Sports and relaxation,
  5/6em/accent!20/Spending time with family
}

\newpage

\cvsection{Publications}

\mynames{Lim/Lian\bibnamedelima Tze,
  Wong/Lian\bibnamedelima Tze,
  Lim/Tracy,
  Lim/L.\bibnamedelimi T.}
\nocite{*}

\printbibliography[heading=pubtype,title={\printinfo{\faBook}{Books}},type=book]

\divider

\printbibliography[heading=pubtype,title={\printinfo{\faFile*[regular]}{Journal Articles}},type=article]

\divider

\printbibliography[heading=pubtype,title={\printinfo{\faUsers}{Conference Proceedings}},type=inproceedings]

\switchcolumn

\cvsection{My Life Philosophy}

\begin{quote}
${'``'}Something smart or heartfelt, preferably in one sentence.''
\end{quote}

\cvsection{Most Proud of}

\cvachievement{\faTrophy}{Fantastic Achievement}{and some details about it}

\divider

\cvachievement{\faHeartbeat}{Another achievement}{more details about it of course}

\divider

\cvachievement{\faHeartbeat}{Another achievement}{more details about it of course}

\cvsection{Strengths}

\cvtag{Hard-working}
\cvtag{Eye for detail}\\
\cvtag{Motivator \& Leader}

\divider\smallskip

\cvtag{C++}
\cvtag{Embedded Systems}\\
\cvtag{Statistical Analysis}

\cvsection{Languages}

\cvskill{English}{5}
\divider

\cvskill{Spanish}{4}
\divider

\cvskill{German}{3.5} %% Supports X.5 values.
\medskip

\cvsection{Education}

\cvevent{Ph.D.\ in Your Discipline}{Your University}{Sept 2002 -- June 2006}{}
Thesis title: Wonderful Research

\divider

\cvevent{M.Sc.\ in Your Discipline}{Your University}{Sept 2001 -- June 2002}{}

\divider

\cvevent{B.Sc.\ in Your Discipline}{Stanford University}{Sept 1998 -- June 2001}{}

\cvsection{Referees}

\cvref{Prof.\ Alpha Beta}{Institute}{a.beta@university.edu}
{Address Line 1\\Address Line 2}

\divider

\cvref{Prof.\ Gamma Delta}{Institute}{g.delta@university.edu}
{Address Line 1\\Address Line 2}

\end{paracol}
\end{document}
`

const bibliography = `@article{lim:else:2011,
  title = {A Study into Fireside Story-Telling},
  journal = {Journal of Carrying On},
  volume = {7},
  author = {Lim, Lian Tze and Someone, Else and Other, Author},
  year = {2008}
}

@article{wong:else:2011,
  title = {A Non-Existant Paper},
  journal = {Journal of Carrying On},
  volume = {12},
  author = {Wong, Lian Tze and Someone, Else},
  year = {2011}
}

@book{else:lim:2010,
  title = {A Fictional Research},
  author = {Someone, Else and Lim, Tracy},
  year = {2010},
  address = {Somewhere, Some Place}
}

@inproceedings{else:lim.init:2010,
  title = {Another Paper Something Something},
  booktitle = {Proceedings of the 72nd AmaZing Conference},
  author = {Someone, Else and Lim, L. T.},
  year = {2013},
  address = {Far Far Away}
}
`
const pubs = String.raw`\usepackage[backend=biber,style=ieee,sorting=ydnt,defernumbers=true]{biblatex}
\setlength{\bibhang}{1.25em}
\DeclareFieldFormat{labelnumberwidth}{\makebox[\bibhang][l]{\itemmarker}}
\setlength{\biblabelsep}{0pt}
\defbibheading{pubtype}{\cvsubsection{#1}}
\renewcommand{\bibsetup}{\vspace*{-\baselineskip}}
\AtEveryBibitem{\iffieldundef{doi}{}{\clearfield{url}}}
`

function fixture(source = sample): LatexProject {
  const files = [
    ['pubs-num.tex', pubs], ['pubs-authoryear.tex', pubs.replace('style=ieee', 'style=apa6')], ['sample.tex', source], ['sample.bib', bibliography],
    ['altacv.cls', String.raw`% Original class fixture, intentionally not used by the browser copy.
\ProvidesClass{altacv}\LoadClass{extarticle}\RequirePackage{xcolor,fontawesome5,tikz}`],
    ['CHANGELOG.md', '# Original changes\r\n'], ['README.md', '# Original instructions\r\n'], ['LICENSE.md', 'LaTeX Project Public License 1.3 or later\r\n'],
    ['nicethings_icons_readme.txt', 'Original icon redistribution restrictions\r\n'], ['latexmkrc', '$hash_calc_ignore_pattern{tex} = "timestamp";\r\n'],
  ].map(([path, content], index) => ({ id: `source-${index}`, path, content }))
  // Tiny byte fixtures, never redistributions of the original licensed PNGs.
  const assets = ['Globe_High.png', 'Yacht_High.png', 'Suitcase_High.png'].map((path, index) => ({ id: `image-${index}`, path,
    mediaType: 'image/png' as const, blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index + 1])], { type: 'image/png' }) }))
  return validateLatexProject({ version: LATEX_PROJECT_VERSION, id: 'original-altacv', title: 'My original AltaCV', revision: 7, mainFile: null, engine: 'xelatex',
    files, assets, templateId: null, templateVersion: null, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-02T00:00:00.000Z' })
}

const active = (source: string) => source.replace(/(^|[^\\])(?:\\\\)*%[^\r\n]*/gu, '$1')
const mainSource = (project: LatexProject) => project.files.find((file) => file.path === project.mainFile)!.content
const styleSource = (project: LatexProject) => project.files.at(-1)!.content

test('only actual uncommented AltaCV documents are offered, never publication fragments or macro examples', () => {
  const project = fixture()
  assert.equal(findAltaCvEntry(project), project.files.find((file) => file.path === 'sample.tex'))
  const inert = ['% \\documentclass{altacv}\n\\begin{document}Example\\end{document}',
    '\\documentclass{article}\\begin{document}Example\\end{document}', pubs,
    '\\newcommand{\\example}{\\documentclass{altacv}}\\begin{document}Example\\end{document}',
    '\\documentclass{altacv}\\cvsection{Incomplete fragment}', '\\\\documentclass{altacv}\\begin{document}Escaped command\\end{document}']
  for (const content of inert) assert.equal(findAltaCvEntry({ ...project, files: [{ id: 'test', path: 'test.tex', content }] }), null)
  assert.equal(findAltaCvEntry({ ...project, files: [{ id: 'test', path: 'sample.sty', content: sample }] }), null)
  const escapedPercent = fixture(sample.replace('\\documentclass[10pt,a4paper,withhyper]{altacv}', '\\% literal percent\n\\documentclass [10pt,a4paper] {altacv}'))
  assert.equal(findAltaCvEntry(escapedPercent)?.path, 'sample.tex')
})

test('an independent marked copy preserves all 13 entries, original IDs, exact source and image Blob bytes', async () => {
  const original = fixture('\ufeff' + sample.replaceAll('\n', '\r\n')), sources = original.files.map((file) => ({ ...file }))
  const bytes = await Promise.all(original.assets.map((asset) => asset.blob.arrayBuffer()))
  original.files.forEach(Object.freeze); original.assets.forEach(Object.freeze)
  Object.freeze(original.files); Object.freeze(original.assets); Object.freeze(original)
  const copy = createAltaCvBrowserProject(original)
  assert.notEqual(copy.id, original.id)
  assert.equal(copy.revision, 1)
  assert.equal(copy.engine, 'pdflatex')
  assert.equal(copy.templateId, 'altacv-browser')
  assert.equal(copy.templateVersion, 2)
  assert.equal(copy.mainFile, 'smilepdf-browser/main.tex')
  assert.equal(original.mainFile, null)
  assert.equal(original.engine, 'xelatex')
  assert.equal(original.revision, 7)
  assert.equal(copy.files.length + copy.assets.length, 15)
  assert.deepEqual(original.files, sources)
  assert.deepEqual(copy.files.slice(0, sources.length), sources)
  assert.notEqual(copy.files[0], original.files[0])
  for (let i = 0; i < original.assets.length; i++) {
    assert.notEqual(copy.assets[i], original.assets[i])
    assert.equal(copy.assets[i].blob, original.assets[i].blob)
    assert.deepEqual(await copy.assets[i].blob.arrayBuffer(), bytes[i])
    assert.deepEqual(await original.assets[i].blob.arrayBuffer(), bytes[i])
    assert.equal(copy.assets[i].id, original.assets[i].id)
  }
  assert.equal(validateLatexProject(copy), copy)
  assert.ok(mainSource(copy).startsWith('\ufeff%%%%%%%%%%%%%%%%%\r\n'))
  assert.equal(findAltaCvEntry(copy), null)
  assert.throws(() => createAltaCvBrowserProject(copy), LatexProjectError)
})

test('new main and style paths avoid existing case-insensitive file and asset namespace collisions', () => {
  const original = fixture()
  original.files.push({ id: 'collision-0', path: 'SmilePDF-Browser/keep.txt', content: 'Keep this' },
    { id: 'collision-1', path: 'smilepdf-browser-1/main.tex', content: 'Keep this too' })
  original.assets.push({ ...original.assets[0], id: 'collision-2', path: 'SMILEPDF-BROWSER-2/keep.png' })
  const copy = createAltaCvBrowserProject(original, 'sample.tex')
  assert.equal(copy.mainFile, 'smilepdf-browser-3/main.tex')
  assert.equal(copy.files.at(-1)?.path, 'smilepdf-browser-3/altacv-browser.sty')
  assert.match(mainSource(copy), /\\usepackage\{smilepdf-browser-3\/altacv-browser\}/u)
  assert.match(styleSource(copy), /\\ProvidesPackage\{smilepdf-browser-3\/altacv-browser\}/u)
  assert.equal(new Set([...copy.files, ...copy.assets].map((file) => file.path.toLowerCase())).size, copy.files.length + copy.assets.length)
})

test('adapted main has no active native fonts, biblatex/Biber, xcolor, FontAwesome, TikZ or paracol requirements', () => {
  const copy = createAltaCvBrowserProject(fixture()), source = active(mainSource(copy)), style = active(styleSource(copy))
  assert.match(source, /\\documentclass\[10pt,a4paper\]\{article\}/u)
  assert.doesNotMatch(source, /\\usepackage\[T1\]\{fontenc\}/u)
  assert.match(style, /\\ifPDFTeX/u)
  assert.match(style, /\\RequirePackage\[T1\]\{fontenc\}/u)
  assert.ok(style.indexOf('\\RequirePackage{lmodern}') < style.indexOf('\\RequirePackage[T1]{fontenc}'))
  assert.match(style, /\\setmainfont\{Latin Modern Roman\}/u)
  assert.match(style, /\\setsansfont\{Latin Modern Roman\}/u)
  assert.match(style, /\\setmonofont\{Latin Modern Roman\}/u)
  assert.match(source, /\\geometry\{left=1.25cm,right=1.25cm,top=1.5cm,bottom=1.5cm,columnsep=1.2cm\}/u)
  assert.doesNotMatch(source, /\\(?:setmainfont|setsansfont|setmonofont|newfontfamily|iftutex|addbibresource|printbibliography|colorlet|columnratio|switchcolumn)\b/u)
  assert.doesNotMatch(source, /\\(?:usepackage|RequirePackage)(?:\[[^\]]*\])?\{[^}]*\b(?:biblatex|paracol|xcolor|tikz|fontawesome5|lato|roboto|fontspec)\b/u)
  assert.doesNotMatch(source, /\\(?:begin|end)\{paracol\}/u)
  assert.match(source, /\\begin\{multicols\}\{2\}/u)
  assert.equal([...source.matchAll(/\\columnbreak\b/gu)].length, 2)
  const requirements = [...style.matchAll(/\\RequirePackage(?:\[[^\]]*\])?\{([^}]+)\}/gu)].flatMap((match) => match[1].split(','))
  assert.deepEqual(requirements, ['iftex', 'lmodern', 'fontenc', 'fontspec', 'color', 'graphicx', 'multicol', 'enumitem', 'etoolbox', 'xparse', 'hyperref'])
  assert.doesNotMatch(style, /\\(?:newcommand|providecommand|def)\s*\{?\\fa[A-Za-z]/u)
  assert.match(mainSource(copy), /browser-compatible COPY/u)
  assert.match(mainSource(copy), /grouping, sorting and own-author highlighting are not reproduced/u)
})

test('older exported copies repair generated fonts as one revision without changing writing, original files or image bytes', () => {
  for (const fonts of ['\\usepackage{lmodern}\n\\usepackage[T1]{fontenc}\n', '\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}\n']) {
    const current = createAltaCvBrowserProject(fixture())
    const oldFiles = current.files.map((file) => file.path === current.mainFile
      ? { ...file, content: file.content.replace('\\usepackage{geometry}', fonts + '\\usepackage{geometry}') }
      : file.path.endsWith('/altacv-browser.sty')
        ? { ...file, content: file.content.replace('support, version 2.', 'support, version 1.').replace(/% SmilePDF managed fonts v2:[\s\S]*?\\fi\n/u, '') }
        : file)
    const legacy = validateLatexProject({ ...current, templateVersion: 1, engine: 'lualatex', files: oldFiles })
    const before = mainSource(legacy).slice(mainSource(legacy).indexOf('\\begin{document}'))
    const fixed = repairAltaCvBrowserProject(legacy)
    assert.equal(fixed.id, legacy.id)
    assert.equal(fixed.revision, legacy.revision + 1)
    assert.equal(fixed.templateVersion, 2)
    assert.equal(fixed.engine, 'lualatex')
    assert.equal(fixed.mainFile, legacy.mainFile)
    assert.equal(mainSource(fixed).slice(mainSource(fixed).indexOf('\\begin{document}')), before)
    assert.deepEqual(fixed.files.slice(0, 10), legacy.files.slice(0, 10))
    assert.deepEqual(fixed.assets, legacy.assets)
    assert.match(styleSource(fixed), /\\setsansfont\{Latin Modern Roman\}/u)
    assert.equal(repairAltaCvBrowserProject(fixed), fixed)
    const custom = { ...legacy, files: legacy.files.map((file) => file.path === legacy.mainFile ? { ...file, content: file.content.replace('\\usepackage{geometry}', '\\usepackage{fontspec}\n\\setmainfont{User Font}\n\\usepackage{geometry}') } : file) }
    assert.equal(repairAltaCvBrowserProject(custom), custom, 'Never rewrite a custom font choice')
  }
})

test('actual sample writing, braced wheel commas, half rating, duplicate achievements and four-group referees survive', () => {
  const copy = createAltaCvBrowserProject(fixture()), source = mainSource(copy)
  for (const [from, until] of [['\\name{Your Name Here}', '\\columnratio{0.6}'], ['\\cvsection{Experience}', '\\newpage'],
    ['\\cvsection{Publications}', '\\printbibliography['], ['\\cvsection{My Life Philosophy}', '\\end{paracol}']]) {
    const originalSlice = sample.slice(sample.indexOf(from), sample.indexOf(until))
    assert.ok(source.includes(originalSlice), `Untouched sample writing beginning ${from}`)
  }
  const headings = (text: string) => [...text.matchAll(/\\cvsection\{([^}]+)\}/gu)].map((match) => match[1])
  assert.deepEqual(headings(source), ['Experience', 'Projects', 'A Day of My Life', 'Publications', 'My Life Philosophy', 'Most Proud of', 'Strengths', 'Languages', 'Education', 'Referees'])
  assert.ok(source.includes(address))
  assert.ok(source.includes('6/8em/accent!30/{Sleep,\\\\beautiful sleep}'))
  assert.ok(source.includes('\\cvskill{German}{3.5}'))
  assert.equal(source.split('Another achievement').length - 1, 2)
  assert.equal(source.split('Job description 1').length - 1, 2)
  const style = styleSource(copy)
  assert.ok(style.includes('\\textcolor{accent}{#2/5}'))
  assert.ok(style.includes('\\clist_map_inline:nn {#4}'))
  assert.ok(style.includes('#1/#2/#3/#4\\q_stop'))
  assert.ok(style.includes('\\NewDocumentCommand{\\cvref}{m m m g}'))
  assert.ok(style.includes('\\newcommand{\\mynames}[1]{}'))
  assert.ok(style.includes('\\csdef{#2}##1##2'))
  assert.ok(style.includes('[#4##1]'))
  assert.ok(style.includes('\\href{#4}{\\nolinkurl{#3}}'))
  for (const macro of ['name', 'tagline', 'photoR', 'photoL', 'personalinfo', 'makecvheader', 'email', 'phone', 'mailaddress', 'location', 'homepage', 'twitter', 'xtwitter', 'linkedin', 'github', 'orcid', 'printinfo', 'NewInfoField', 'cvsection', 'cvsubsection', 'cvevent', 'divider', 'cvtag', 'cvskill', 'cvachievement', 'cvref', 'mynames']) assert.ok(style.includes(`{\\${macro}}`), macro)
})

test('publications retain the original BibTeX data and use a single real combined classic bibliography', () => {
  const original = fixture(), copy = createAltaCvBrowserProject(original), source = mainSource(copy), code = active(source)
  assert.equal(copy.files.find((file) => file.path === 'sample.bib')?.content, bibliography)
  assert.equal([...bibliography.matchAll(/@(?:article|book|inproceedings)\{/gu)].length, 4)
  assert.ok(bibliography.includes('year = {2008}'))
  assert.ok(bibliography.includes('A Non-Existant Paper'))
  assert.ok(bibliography.includes('Proceedings of the 72nd AmaZing Conference'))
  assert.equal([...code.matchAll(/\\bibliographystyle\{plain\}/gu)].length, 1)
  assert.equal([...code.matchAll(/\\bibliography\{sample\}/gu)].length, 1)
  assert.match(code, /\\nocite\{\*\}/u)
  for (const title of ['Books', 'Journal Articles', 'Conference Proceedings']) assert.ok(source.includes(title))
  assert.equal([...source.matchAll(/% \\printbibliography\[/gu)].length, 3)
  assert.ok(source.includes('\\faFile*[regular]'))
  assert.ok(source.includes('all original publication groups are combined using real classic BibTeX'))
})

test('nested originals and multiple bibliography resources keep paths, bytes and root-resolved classic references', () => {
  const original = fixture(sample.replace('\\addbibresource{sample.bib}', '\\addbibresource[location=local]{sample.bib}\n\\addbibresource{more.bib}'))
  original.files = original.files.map((file) => ({ ...file, path: `original/${file.path}` }))
  original.assets = original.assets.map((asset) => ({ ...asset, path: `original/${asset.path}` }))
  original.files.push({ id: 'more', path: 'original/more.bib', content: '@book{extra,title={Another original},year={2024}}\r\n' })
  const copy = createAltaCvBrowserProject(original, 'original/sample.tex')
  assert.match(mainSource(copy), /\\bibliography\{original\/sample,original\/more\}/u)
  assert.match(mainSource(copy), /\\graphicspath\{\{original\/\}\}/u)
  assert.deepEqual(copy.files.slice(0, original.files.length), original.files)
  assert.deepEqual(copy.assets, original.assets)
})

test('selected AltaCV entry is preferred and an explicit different entry remains an independent source copy', () => {
  const original = fixture()
  original.files.push({ id: 'second', path: 'second.tex', content: '\\documentclass{altacv}\\begin{document}Different original writing\\end{document}' })
  original.mainFile = 'second.tex'
  assert.equal(findAltaCvEntry(original)?.path, 'second.tex')
  assert.ok(mainSource(createAltaCvBrowserProject(original)).includes('Different original writing'))
  assert.ok(mainSource(createAltaCvBrowserProject(original, 'sample.tex')).includes('Your Name Here'))
})

for (const [label, source] of [
  ['non-AltaCV class', sample.replace('\\documentclass[10pt,a4paper,withhyper]{altacv}', '\\documentclass[10pt,a4paper,withhyper]{article}')],
  ['missing document end', sample.replace('\\end{document}', '')],
  ['unbalanced writing', sample.replace('Wonderful Research', '{Wonderful Research')],
  ['custom preamble source', sample.replace('\\input{pubs-num}', '\\input{custom-formatting}')],
  ['unavailable body font', sample.replace('\\makecvheader', '\\setmainfont{Lato}\\makecvheader')],
  ['unsupported body package', sample.replace('\\makecvheader', '\\usepackage{tikz}\\makecvheader')],
  ['three columns', sample.replace('\\begin{paracol}{2}', '\\begin{paracol}{3}')],
  ['unfinished columns', sample.replace('\\end{paracol}', '')],
  ['mismatched list environment', sample.replace('\\end{itemize}', '\\end{quote}')],
  ['indexed column switch', sample.replace('\\switchcolumn', '\\switchcolumn[1]')],
  ['malformed chart entry', sample.replace('8/8em/accent!60/Daytime job', '8/Daytime job')],
  ['native command hidden in a chart label', sample.replace('8/8em/accent!60/Daytime job', '8/8em/accent!60/{\\setmainfont{Lato}Daytime job}')],
  ['missing bibliography resource', sample.replace('\\addbibresource{sample.bib}', '')],
  ['missing original bib file', sample.replace('\\addbibresource{sample.bib}', '\\addbibresource{missing.bib}')],
  ['remote bibliography', sample.replace('\\addbibresource{sample.bib}', '\\addbibresource{https://example.com/sample.bib}')],
  ['complex geometry', sample.replace('left=1.25cm', 'left=\\custommargin')],
  ['executable trailing source', sample + '\\input{extra}'],
]) {
  test(`unsupported or malformed ${label} is refused without source loss`, () => {
    const original = fixture(source), before = original.files.map((file) => ({ ...file }))
    assert.throws(() => createAltaCvBrowserProject(original, 'sample.tex'), LatexProjectError)
    assert.deepEqual(original.files, before)
    assert.equal(original.id, 'original-altacv')
    assert.equal(original.mainFile, null)
  })
}

test('fragments, unknown entry paths and insufficient project capacity are refused, not dropped to fit', () => {
  const original = fixture()
  for (const path of ['pubs-num.tex', 'sample.bib', 'missing.tex']) assert.throws(() => createAltaCvBrowserProject(original, path), LatexProjectError)
  while (original.files.length + original.assets.length < 31) original.files.push({ id: `extra-${original.files.length}`, path: `extra-${original.files.length}.txt`, content: 'Keep every file' })
  const before = original.files.map((file) => ({ ...file }))
  assert.throws(() => createAltaCvBrowserProject(original), (error: unknown) => error instanceof LatexProjectError && error.code === 'file_limit')
  assert.deepEqual(original.files, before)
})
