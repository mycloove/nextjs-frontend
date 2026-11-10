import { LATEX_PROJECT_VERSION, type LatexEngine, type LatexProject } from './types.ts'
import { newLatexId, validateLatexProject } from './project.ts'
import { galleryLatexTemplates } from './galleryTemplates.ts'

export type LatexSourceTemplate = { id: string; version: number; name: string; detail: string; engine: LatexEngine; requirements: string; files: { path: string; content: string }[] }
export const templateNotice = 'Original SmilePDF versioned source templates. You may edit and redistribute these sources with your resume. Compiler fonts and TeX packages are separate dependencies.'
// Third-party starters carry their own license file; the SmilePDF notice above
// must never be stamped onto them (projectArchive.ts reads this set).
export const thirdPartyTemplateIds: ReadonlySet<string> = new Set(['jakes-resume'])
const style = String.raw`% Original SmilePDF source template, version 1.
% You may edit and redistribute this source with your resume.
\NeedsTeXFormat{LaTeX2e}
\ProvidesPackage{resume}[2026/10/29 SmilePDF career typography]
\RequirePackage{geometry}
\RequirePackage{enumitem}
\RequirePackage{titlesec}
\RequirePackage{hyperref}
\geometry{a4paper,margin=18mm}
\setlength{\parindent}{0pt}
\setlength{\parskip}{5pt}
\setlist[itemize]{leftmargin=*,nosep,topsep=3pt}
\titleformat{\section}{\large\bfseries}{}{0pt}{}[\titlerule]
\titlespacing*{\section}{0pt}{12pt}{6pt}
\hypersetup{hidelinks,pdfcreator={SmilePDF LaTeX workspace}}
\newcommand{\resumeentry}[3]{\textbf{#1}\hfill #2\par #3\par}
`

export const latexSourceTemplates: readonly LatexSourceTemplate[] = [
  { id: 'career-source', version: 2, name: 'Career resume', detail: 'Browser-compatible single-column resume with an editable style file.', engine: 'xelatex',
    requirements: 'XeLaTeX; Latin Modern Roman; fontspec, geometry, enumitem, titlesec, hyperref.', files: [
      { path: 'main.tex', content: String.raw`% Original SmilePDF source template, version 1.
% Replace the example writing. This is source, not an ATS certification.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{lmroman10-regular.otf}
\usepackage{resume}
\begin{document}
{\LARGE\bfseries Ayesha Rahman}\par
Product designer \textbullet{} Dhaka, Bangladesh\par
\href{mailto:hello@example.com}{hello@example.com} \textbullet{}
\href{https://example.com}{example.com}

\section*{Profile}
Product designer focused on making essential services clear and useful.
Replace this introduction with your own experience and direction.

\section*{Experience}
\resumeentry{Senior Product Designer, Northstar Studio}{2022--Present}{Dhaka, Bangladesh}
\begin{itemize}
  \item Redesigned onboarding with research and engineering partners.
  \item Established accessible interaction patterns across four product teams.
\end{itemize}
\resumeentry{Product Designer, Fieldwork Labs}{2019--2022}{Dhaka, Bangladesh}
\begin{itemize}
  \item Shaped research-led experiences from prototype to production.
\end{itemize}

\section*{Education}
\resumeentry{BFA, Visual Communication}{2015--2019}{University of Dhaka}

\section*{Selected project}
\textbf{Accessibility audit toolkit}\par
Designed a practical checklist and reporting flow for community teams.

\section*{Skills}
Product strategy; interaction design; prototyping; design systems; user research.
\end{document}
` }, { path: 'resume.sty', content: style },
    ] },
  { id: 'academic-source', version: 2, name: 'Academic CV', detail: 'Browser-compatible research CV with a classic BibTeX bibliography.', engine: 'xelatex',
    requirements: 'XeLaTeX; Latin Modern Roman; classic BibTeX; fontspec and resume.sty dependencies.', files: [
      { path: 'main.tex', content: String.raw`% Original SmilePDF source template, version 1.
% Classic BibTeX uses the local references.bib in the browser compiler.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{lmroman10-regular.otf}
\usepackage{resume}
\begin{document}
{\LARGE\bfseries Samira Ahmed}\par
Human-computer interaction researcher \textbullet{} Dhaka, Bangladesh\par
\href{mailto:research@example.com}{research@example.com}

\section*{Research interests}
Accessible digital services, participatory design and multilingual interaction.

\section*{Education}
\resumeentry{PhD candidate, Human-computer Interaction}{2023--Present}{Example University}
\resumeentry{MSc, Computer Science}{2020--2022}{Example University}

\section*{Research experience}
\resumeentry{Graduate Researcher}{2023--Present}{Inclusive Systems Lab}
\begin{itemize}
  \item Investigated accessible form completion in multilingual services.
  \item Designed and documented reproducible study protocols.
\end{itemize}

\section*{Teaching}
Teaching assistant, Interaction Design, 2024--2025.

\section*{Selected publications}
% This deliberately fictional entry demonstrates a real bibliography workflow.
\nocite{ahmed2025example}
\bibliographystyle{plain}
\bibliography{references}

\section*{Service and methods}
Community accessibility workshops; qualitative analysis; prototyping; statistics.
\end{document}
` }, { path: 'resume.sty', content: style }, { path: 'references.bib', content: String.raw`% Original SmilePDF example bibliography. Replace with your actual publications.
@article{ahmed2025example,
  author = {Ahmed, Samira and Rahman, Ayesha},
  title = {An Example Study of Accessible Multilingual Services},
   journal = {Fictional Journal for Template Demonstration},
   year = {2025},
  volume = {1},
  pages = {1--10},
  note = {Fictional example, not a real publication}
}
` },
    ] },
  { id: 'bangla-source', version: 2, name: 'Bangla / mixed-script', detail: 'Unicode Bangla writing with explicit HarfBuzz shaping and English spans.', engine: 'lualatex',
    requirements: 'LuaHBTeX; Noto Sans Bengali and Latin Modern Roman; fontspec, polyglossia, geometry, enumitem, hyperref.', files: [
      { path: 'main.tex', content: String.raw`% Original SmilePDF source template, version 2.
% Unicode and joiners are preserved. LuaLaTeX uses the pinned compiler fonts.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{bengali}
\setotherlanguage{english}
% Headings call \normalfont, so the main family must cover the default language.
\setmainfont[Script=Bengali,Renderer=HarfBuzz]{Noto Sans Bengali}
\newfontfamily\englishfont{Latin Modern Roman}
\newfontfamily\bengalifont[Script=Bengali,Renderer=HarfBuzz]{Noto Sans Bengali}
\usepackage[a4paper,margin=18mm]{geometry}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\setlength{\parindent}{0pt}
\setlength{\parskip}{6pt}
\setlist[itemize]{leftmargin=*,nosep}
\begin{document}
{\LARGE\bfseries আয়েশা রহমান}\par
পণ্য নকশাবিদ \textbullet{} ঢাকা, বাংলাদেশ\par
\textenglish{\href{mailto:hello@example.com}{hello@example.com}}

\section*{সংক্ষিপ্ত পরিচয়}
গবেষণা ও প্রযুক্তির সমন্বয়ে মানুষের জন্য সহজ এবং ব্যবহারযোগ্য সেবা তৈরি করি।
নিজের অভিজ্ঞতা, দক্ষতা এবং লক্ষ্যের কথা এখানে লিখুন।

\section*{কর্ম-অভিজ্ঞতা}
\textbf{সিনিয়র পণ্য নকশাবিদ}\hfill \textenglish{2022--Present}\par
\textenglish{Northstar Studio}, ঢাকা
\begin{itemize}
  \item গবেষণা এবং প্রকৌশল দলের সঙ্গে সেবা উন্নয়নে কাজ করেছি।
  \item বিভিন্ন পণ্য দলের জন্য প্রবেশগম্য নকশার নির্দেশনা তৈরি করেছি।
\end{itemize}

\section*{শিক্ষা}
দৃশ্য যোগাযোগে স্নাতক, ঢাকা বিশ্ববিদ্যালয়\hfill \textenglish{2015--2019}

\section*{দক্ষতা}
পণ্য পরিকল্পনা, ব্যবহারকারী গবেষণা, প্রোটোটাইপ এবং প্রবেশগম্য নকশা।

\section*{ভাষা}
বাংলা এবং \textenglish{English}।
\end{document}
` },
    ] },
  ...galleryLatexTemplates,
]

export function createTemplateProject(id = 'career-source', now = new Date().toISOString()): LatexProject {
  const template = latexSourceTemplates.find((item) => item.id === id)
  if (!template) throw new Error('Unknown source template')
  return validateLatexProject({ version: LATEX_PROJECT_VERSION, id: newLatexId(), title: template.name, revision: 1, mainFile: 'main.tex', engine: template.engine,
    files: template.files.map((file) => ({ ...file, id: newLatexId() })), assets: [], templateId: template.id, templateVersion: template.version, createdAt: now, updatedAt: now })
}

// Qualification describes the unchanged bundled starter, never an edited user
// project. Tests invalidate these records if its source or pinned runtime moves.
const qualifiedBrowserBuild = {
  checkedAt: '2026-11-04', runtime: 'browser',
  profileVersion: 'browser-busytex-v2-tl2023-4499aa69-altacv-r1',
  manifestSha256: '4a0cca5dcea6b297df5cc6caf0bbfa932267502e68f3c19d0dc9b44a55634196',
  workerSha256: 'a8ac2cece2aa5c4ab93a69fcb4cdfa9fcb77e12344b0b55abaf1e93813e2c8b5',
} as const
// Later starters are checked on the build that is pinned today (see browserManifestPin.ts).
const qualifiedCurrentBuild = {
  checkedAt: '2026-11-06', runtime: 'browser',
  profileVersion: 'browser-busytex-v2-tl2023-4499aa69-altacv-synctex-r2',
  manifestSha256: 'd1baeb97576d06164cfea2032de3b70e43184950fb0a890cbfb14f8c79e575a5',
  workerSha256: '0f2308e61c76784a045958292b44f202ddb7079e7640fc71d4bd711bb54fc974',
} as const
export const latexTemplateQualifications = [
  { ...qualifiedBrowserBuild, id: 'career-source', templateVersion: 2, engine: 'xelatex', fixture: 'career-template-as-is',
    sourceSha256: 'dacbe296f9656ce8b2d7a07200b59173ea8452e429346e4d9b0e86f3a85fbac4',
    checks: 'Unchanged English starter: real XeLaTeX, one-page PDF, heading text and embedded Latin Modern font checks.',
    limitation: 'This checks the bundled starter, not arbitrary edits, visual equality with Overleaf or an ATS score.' },
  { ...qualifiedBrowserBuild, id: 'academic-source', templateVersion: 2, engine: 'xelatex', fixture: 'academic-template-as-is',
    sourceSha256: '3468207ff11ee91e602c7a6aca23a4c33c28432821576141657b3574aad3b9d7',
    checks: 'Unchanged academic starter: real XeLaTeX, three TeX passes, one classic BibTeX pass and extracted publication text.',
    limitation: 'Classic BibTeX sentence casing is expected. This starter check is not qualification of every biblatex style or native deployment.' },
  { ...qualifiedBrowserBuild, id: 'bangla-source', templateVersion: 2, engine: 'lualatex', fixture: 'bangla-template-as-is',
    sourceSha256: '4fe5a840bc41eb18de50a055c01e60afd45b7c81304ba663269bfe99a1ef77d3',
    checks: 'Unchanged Bangla/English starter: real LuaHBTeX, one-page PDF and Noto Sans Bengali glyph/font coverage.',
    limitation: 'Complex Bangla cluster extraction in PDF.js is not fully faithful. Copy, search, reading-order and ATS compatibility are not certified.' },
  // Gallery starters, checked on the current pinned build (supplied assets, core + profile groups only).
  { ...qualifiedCurrentBuild, id: 'compact-source', templateVersion: 1, engine: 'pdflatex', fixture: 'compact-template-as-is',
    sourceSha256: 'e3ce5414e4b6b46e325b251322eb321381e3fce03eac0b689f896959e2e2ec0a',
    checks: 'Unchanged compact starter: real pdfLaTeX, one-page PDF, extracted section headings and embedded Latin Modern.',
    limitation: 'Checks the bundled starter only. Plain reading order is not an ATS score or certification.' },
  { ...qualifiedCurrentBuild, id: 'modern-source', templateVersion: 1, engine: 'xelatex', fixture: 'modern-template-as-is',
    sourceSha256: '2b84364756554a9226ff27ab57ab71facfa77d535a71557f64a053f5ccb4f685',
    checks: 'Unchanged modern starter: real XeLaTeX, one-page PDF, extracted headings and embedded Latin Modern Sans.',
    limitation: 'Checks the bundled starter only, not arbitrary edits or visual equality with other TeX installations.' },
  { ...qualifiedCurrentBuild, id: 'sidebar-source', templateVersion: 1, engine: 'xelatex', fixture: 'sidebar-template-as-is',
    sourceSha256: 'a7cbd2a975eb0f3e6e1791b84b7379ab9ef6ad279420f64e3bdaf4a5610e1426',
    checks: 'Unchanged sidebar starter: real XeLaTeX, one-page PDF with both columns extracted.',
    limitation: 'Two columns are extracted in source order; strict ATS portals may read columns differently.' },
  { ...qualifiedCurrentBuild, id: 'international-source', templateVersion: 1, engine: 'pdflatex', fixture: 'international-template-as-is',
    sourceSha256: '90725e0a96b2a102d76da8c73e8e093c0941f2536e4a40c63b242f7a89cd68e4',
    checks: 'Unchanged international starter: real pdfLaTeX, one-page PDF, extracted headings and embedded Latin Modern.',
    limitation: 'Checks the bundled starter only. The left date column is a table layout, not an ATS certification.' },
  { ...qualifiedCurrentBuild, id: 'bd-biodata-source', templateVersion: 1, engine: 'lualatex', fixture: 'bd-biodata-template-as-is',
    sourceSha256: 'c8a9fef2f778356540581e0e105479f499ea92823c9233cad02fc3fc22fd4dc9',
    checks: 'Unchanged Bangla biodata: real LuaHBTeX, one-page PDF and Noto Sans Bengali glyph/font coverage.',
    limitation: 'Bangla hyphenation patterns are not bundled (reported as a warning). Complex-cluster extraction, copy, search and ATS use are not certified.' },
  { ...qualifiedCurrentBuild, id: 'letter-source', templateVersion: 1, engine: 'xelatex', fixture: 'letter-template-as-is',
    sourceSha256: '13ab1cfcaeb75a9e7335aa9ace35c4addb8db8d06dc880d6f36316b8fc0fc399',
    checks: 'Unchanged cover letter: real XeLaTeX, one-page PDF, extracted salutation and embedded Latin Modern.',
    limitation: 'Checks the bundled starter only, not arbitrary edits.' },
  { ...qualifiedCurrentBuild, id: 'jakes-resume', templateVersion: 1, engine: 'pdflatex', fixture: 'jakes-resume-as-is',
    sourceSha256: '8f3010985dd18e7a8586f006de648c490aa58a66b31a1baa9c75ca0d617547e7',
    checks: 'Adapted MIT starter as bundled: real pdfLaTeX, one-page PDF and extracted section headings.',
    limitation: 'Package substitutions are listed in the source header. Visual equality with the upstream Overleaf build is not claimed.' },
] as const
