import { LATEX_PROJECT_VERSION, type LatexEngine, type LatexProject } from './types.ts'
import { newLatexId, validateLatexProject } from './project.ts'

export type LatexSourceTemplate = { id: string; version: number; name: string; detail: string; engine: LatexEngine; requirements: string; files: { path: string; content: string }[] }
export const templateNotice = 'Original SmilePDF source templates, version 1. You may edit and redistribute these sources with your resume. Native fonts and TeX packages are separate dependencies.'
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
  { id: 'career-source', version: 1, name: 'Career resume', detail: 'A single-column resume with a small, editable style file.', engine: 'lualatex',
    requirements: 'LuaLaTeX; Latin Modern Roman; fontspec, geometry, enumitem, titlesec, hyperref.', files: [
      { path: 'main.tex', content: String.raw`% Original SmilePDF source template, version 1.
% Replace the example writing. This is source, not an ATS certification.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{Latin Modern Roman}
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
  { id: 'academic-source', version: 1, name: 'Academic CV', detail: 'Research, teaching and a real local bibliography in references.bib.', engine: 'lualatex',
    requirements: 'LuaLaTeX; Latin Modern Roman; biblatex with biber; fontspec and resume.sty dependencies.', files: [
      { path: 'main.tex', content: String.raw`% Original SmilePDF source template, version 1.
% Bibliography uses the local references.bib and the compiler's bounded biber step.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{Latin Modern Roman}
\usepackage{resume}
\usepackage[backend=biber,style=numeric,sorting=ydnt]{biblatex}
\addbibresource{references.bib}
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
\printbibliography[heading=none]

\section*{Service and methods}
Community accessibility workshops; qualitative analysis; prototyping; statistics.
\end{document}
` }, { path: 'resume.sty', content: style }, { path: 'references.bib', content: String.raw`% Original SmilePDF example bibliography. Replace with your actual publications.
@article{ahmed2025example,
  author = {Ahmed, Samira and Rahman, Ayesha},
  title = {An Example Study of Accessible Multilingual Services},
  journaltitle = {Fictional Journal for Template Demonstration},
  date = {2025},
  volume = {1},
  pages = {1--10},
  note = {Fictional example, not a real publication}
}
` },
    ] },
  { id: 'bangla-source', version: 1, name: 'Bangla / mixed-script', detail: 'Unicode Bangla writing with explicit HarfBuzz shaping and English spans.', engine: 'lualatex',
    requirements: 'LuaHBTeX; Noto Sans Bengali and Latin Modern Roman; fontspec, polyglossia, geometry, enumitem, hyperref.', files: [
      { path: 'main.tex', content: String.raw`% Original SmilePDF source template, version 1.
% Unicode and joiners are preserved. LuaLaTeX must use the pinned native fonts.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{bengali}
\setotherlanguage{english}
\setmainfont{Latin Modern Roman}
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
]

export function createTemplateProject(id = 'career-source', now = new Date().toISOString()): LatexProject {
  const template = latexSourceTemplates.find((item) => item.id === id)
  if (!template) throw new Error('Unknown source template')
  return validateLatexProject({ version: LATEX_PROJECT_VERSION, id: newLatexId(), title: template.name, revision: 1, mainFile: 'main.tex', engine: template.engine,
    files: template.files.map((file) => ({ ...file, id: newLatexId() })), assets: [], templateId: template.id, templateVersion: template.version, createdAt: now, updatedAt: now })
}
