import type { LatexSourceTemplate } from './templates.ts'

// Gallery starters added for the Mr. Resume home page. Every source here builds
// with the pinned browser engine's core and profile groups only (no package
// download), and each has an as-is compiler fixture in browser/smoke.mjs.
// Sample writing is fictional and marked for replacement, like the originals.

const compactMain = String.raw`% Original SmilePDF source template, version 1.
% Compact one-page resume. Replace the example writing with your own.
% Plain single-column reading order; this is not an ATS score or certification.
\documentclass[10pt,a4paper]{article}
\usepackage{lmodern}
\usepackage[T1]{fontenc}
\usepackage[a4paper,margin=14mm]{geometry}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage{tabularx}
\usepackage[hidelinks]{hyperref}
\pdfgentounicode=1
\input{glyphtounicode}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\tabcolsep}{0pt}
\titleformat{\section}{\scshape\large}{}{0pt}{}[\titlerule]
\titlespacing*{\section}{0pt}{8pt}{4pt}
\setlist[itemize]{leftmargin=12pt,nosep,topsep=2pt}
\newcommand{\entry}[4]{\begin{tabular*}{\linewidth}{@{}l@{\extracolsep{\fill}}r@{}}\textbf{#1} & #2\\ \textit{#3} & \textit{#4}\end{tabular*}\par}
\begin{document}
\begin{center}
{\LARGE\bfseries Nadia Karim}\par\smallskip
Software engineer \textbar{} Chattogram, Bangladesh \textbar{}
\href{mailto:nadia@example.com}{nadia@example.com} \textbar{}
\href{https://example.com}{example.com}
\end{center}

\section{Experience}
\entry{Software Engineer}{2022 -- Present}{Example Systems Ltd}{Dhaka}
\begin{itemize}
  \item Built and maintained payment reconciliation services used by three teams.
  \item Reduced failed nightly jobs by adding monitoring and retry policies.
\end{itemize}
\entry{Junior Developer}{2020 -- 2022}{Sample Labs}{Chattogram}
\begin{itemize}
  \item Delivered internal tools for inventory and reporting.
\end{itemize}

\section{Projects}
\entry{Open data dashboard}{2023}{Personal project}{example.com/dashboard}
\begin{itemize}
  \item Visualised public transport data for a city volunteer group.
\end{itemize}

\section{Education}
\entry{BSc in Computer Science and Engineering}{2016 -- 2020}{Example University}{CGPA 3.6 of 4}

\section{Skills}
\textbf{Languages:} Python, TypeScript, SQL\par
\textbf{Tools:} PostgreSQL, Docker, Git, Linux
\end{document}
`

const modernMain = String.raw`% Original SmilePDF source template, version 1.
% Modern professional resume set in Latin Modern Sans with one accent colour.
% Replace the example writing with your own.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{lmsans10-regular.otf}[BoldFont=lmsans10-bold.otf,ItalicFont=lmsans10-oblique.otf,BoldItalicFont=lmsans10-boldoblique.otf]
\usepackage[a4paper,margin=16mm]{geometry}
\usepackage{color}
\usepackage{titlesec}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\definecolor{accent}{RGB}{46,92,110}
\definecolor{muted}{RGB}{90,96,104}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\titleformat{\section}{\color{accent}\large\bfseries}{}{0pt}{}[{\color{accent}\titlerule[1pt]}]
\titlespacing*{\section}{0pt}{12pt}{6pt}
\setlist[itemize]{leftmargin=14pt,nosep,topsep=3pt}
\newcommand{\role}[3]{\textbf{#1}\hfill{\color{muted}#2}\par{\color{accent}#3}\par}
\begin{document}
{\fontsize{26}{30}\selectfont\bfseries Farhan Chowdhury}\par\medskip
{\color{accent}\large Marketing manager}\par\smallskip
{\color{muted}Dhaka, Bangladesh \quad \href{mailto:farhan@example.com}{farhan@example.com} \quad +880 1700 000000}

\section*{Summary}
Marketing manager with seven years of campaign and brand experience for consumer products.
Replace this summary with your own focus and the role you are applying for.

\section*{Experience}
\role{Marketing Manager}{2021 -- Present}{Example Foods Ltd}
\begin{itemize}
  \item Led a five-person team across digital and retail campaigns.
  \item Introduced monthly reporting that tied spend to sales by region.
\end{itemize}
\role{Brand Executive}{2018 -- 2021}{Sample Retail}
\begin{itemize}
  \item Planned seasonal launches with sales and supply-chain partners.
\end{itemize}

\section*{Education}
\role{MBA, Marketing}{2016 -- 2018}{Example Business School}

\section*{Skills}
Campaign planning \textbullet{} Market research \textbullet{} Budgeting \textbullet{} Team leadership
\end{document}
`

const sidebarMain = String.raw`% Original SmilePDF source template, version 1.
% Sidebar resume: a tinted left column beside the main column, one page.
% Two columns read in source order; prefer a single-column template for strict ATS portals.
\documentclass[10pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{lmsans10-regular.otf}[BoldFont=lmsans10-bold.otf,ItalicFont=lmsans10-oblique.otf,BoldItalicFont=lmsans10-boldoblique.otf]
\usepackage[a4paper,margin=12mm]{geometry}
\usepackage{color}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\definecolor{accent}{RGB}{64,84,68}
\definecolor{rail}{RGB}{236,241,236}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\fboxsep}{5mm}
\setlist[itemize]{leftmargin=12pt,nosep,topsep=2pt}
\newcommand{\railhead}[1]{\par\medskip{\color{accent}\bfseries\MakeUppercase{#1}}\par\smallskip}
\newcommand{\mainhead}[1]{\par\bigskip{\color{accent}\large\bfseries #1}\par\vspace{2pt}{\color{accent}\rule{\linewidth}{0.8pt}}\par\smallskip}
\begin{document}
\noindent\colorbox{rail}{\begin{minipage}[t][\dimexpr\textheight-2\fboxsep\relax][t]{\dimexpr0.30\textwidth-2\fboxsep\relax}
{\Large\bfseries Rina Das}\par\smallskip
{\color{accent}Data analyst}
\railhead{Contact}
Sylhet, Bangladesh\par
\href{mailto:rina@example.com}{rina@example.com}\par
+880 1800 000000
\railhead{Skills}
SQL\par Python and pandas\par Power BI\par Survey design
\railhead{Languages}
Bangla (native)\par English (fluent)
\railhead{Certificates}
Example Data Analytics Certificate, 2023
\end{minipage}}\hfill
\begin{minipage}[t]{0.65\textwidth}
\mainhead{Profile}
Data analyst who turns field and sales data into decisions people can act on.
Replace this profile with your own focus.
\mainhead{Experience}
\textbf{Data Analyst}\hfill 2022 -- Present\par
{\color{accent}Example Health Services}
\begin{itemize}
  \item Built weekly dashboards for twelve district offices.
  \item Automated data cleaning that previously took two days each month.
\end{itemize}
\medskip
\textbf{Research Assistant}\hfill 2020 -- 2022\par
{\color{accent}Sample Policy Institute}
\begin{itemize}
  \item Supported household surveys and prepared tables for reports.
\end{itemize}
\mainhead{Education}
\textbf{BSS in Economics}\hfill 2016 -- 2020\par
Example University
\mainhead{Selected project}
\textbf{School attendance study} -- cleaned and analysed attendance records for a local NGO.
\end{minipage}
\end{document}
`

const internationalMain = String.raw`% Original SmilePDF source template, version 1.
% International CV: dates in a left column, classic European order.
% Replace the example writing with your own.
\documentclass[11pt,a4paper]{article}
\usepackage{lmodern}
\usepackage[T1]{fontenc}
\usepackage[a4paper,margin=18mm]{geometry}
\usepackage{color}
\usepackage{tabularx}
\usepackage[hidelinks]{hyperref}
\pdfgentounicode=1
\input{glyphtounicode}
\definecolor{accent}{RGB}{49,89,168}
\definecolor{muted}{RGB}{95,99,104}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\newlength{\datecol}\setlength{\datecol}{0.22\textwidth}
\newcommand{\cvsection}[1]{\par\bigskip\noindent\makebox[\datecol][r]{\color{accent}\rule[0.6ex]{0.8\datecol}{1.2pt}}\hspace{5mm}{\color{accent}\Large #1}\par\smallskip}
\newcommand{\cventry}[4]{\noindent\begin{tabularx}{\textwidth}{@{}>{\raggedleft\arraybackslash}p{\datecol}@{\hspace{5mm}}X@{}}\leavevmode\textcolor{muted}{\small #1} & \textbf{#2}, \textit{#3}\newline #4\end{tabularx}\par\smallskip}
\newcommand{\cvitem}[2]{\noindent\begin{tabularx}{\textwidth}{@{}>{\raggedleft\arraybackslash}p{\datecol}@{\hspace{5mm}}X@{}}\leavevmode\textcolor{muted}{\small #1} & #2\end{tabularx}\par}
\begin{document}
\noindent\hspace{\datecol}\hspace{5mm}{\fontsize{24}{28}\selectfont Tanvir Hossain}\par
\noindent\hspace{\datecol}\hspace{5mm}{\color{muted}\large Civil engineer}\par\medskip
\cvitem{Address}{Khulna, Bangladesh}
\cvitem{Email}{\href{mailto:tanvir@example.com}{tanvir@example.com}}
\cvitem{Phone}{+880 1900 000000}

\cvsection{Experience}
\cventry{2021 -- Present}{Site Engineer}{Example Construction Ltd}{Supervised structural works for a six-storey residential project and coordinated weekly progress reports.}
\cventry{2019 -- 2021}{Assistant Engineer}{Sample Consultants}{Prepared quantity estimates and checked contractor drawings.}

\cvsection{Education}
\cventry{2015 -- 2019}{BSc in Civil Engineering}{Example University of Engineering}{Thesis on low-cost flood-resilient housing.}

\cvsection{Languages}
\cvitem{Bangla}{Native}
\cvitem{English}{Professional working proficiency}

\cvsection{Computer skills}
\cvitem{Design}{AutoCAD, ETABS}
\cvitem{Office}{Spreadsheets, project scheduling}
\end{document}
`

const biodataMain = String.raw`% Original SmilePDF source template, version 1.
% Bangla biodata. Unicode Bangla with explicit HarfBuzz shaping (LuaLaTeX).
% Follow the vacancy notice; this is a general outline, not an official form.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\usepackage{polyglossia}
\setdefaultlanguage{bengali}
\setotherlanguage{english}
\setmainfont[Script=Bengali,Renderer=HarfBuzz]{Noto Sans Bengali}
\newfontfamily\englishfont{Latin Modern Roman}
\newfontfamily\bengalifont[Script=Bengali,Renderer=HarfBuzz]{Noto Sans Bengali}
\usepackage[a4paper,margin=18mm]{geometry}
\usepackage{tabularx}
\usepackage[hidelinks]{hyperref}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\renewcommand{\arraystretch}{1.35}
\newcommand{\biohead}[1]{\par\bigskip{\large\bfseries #1}\par\vspace{2pt}\hrule\par\smallskip}
\begin{document}
\begin{center}{\LARGE\bfseries জীবনবৃত্তান্ত}\end{center}
\medskip
\begin{minipage}[t]{0.72\textwidth}
{\Large\bfseries রাকিব হাসান}\par\medskip
আবেদিত পদ: সহকারী কর্মকর্তা\par
মোবাইল: \textenglish{+880 1700 000000}\par
ইমেইল: \textenglish{\href{mailto:rakib@example.com}{rakib@example.com}}
\end{minipage}\hfill
\fbox{\parbox[c][34mm][c]{28mm}{\centering\small পাসপোর্ট সাইজ ছবি}}

\biohead{ব্যক্তিগত তথ্য}
\begin{tabularx}{\linewidth}{@{}p{0.3\linewidth}@{ : }X@{}}
পিতার নাম & আব্দুল হাসান\\
মাতার নাম & সালমা বেগম\\
জন্ম তারিখ & \textenglish{01-01-1999}\\
স্থায়ী ঠিকানা & গ্রাম, উপজেলা, জেলা\\
\end{tabularx}

\biohead{শিক্ষাগত যোগ্যতা}
\begin{tabularx}{\linewidth}{|X|X|c|c|}
\hline
\textbf{পরীক্ষা} & \textbf{বোর্ড / বিশ্ববিদ্যালয়} & \textbf{সাল} & \textbf{ফলাফল}\\ \hline
এসএসসি & ঢাকা বোর্ড & \textenglish{2014} & \textenglish{GPA 5.00}\\ \hline
এইচএসসি & ঢাকা বোর্ড & \textenglish{2016} & \textenglish{GPA 4.83}\\ \hline
স্নাতক & উদাহরণ বিশ্ববিদ্যালয় & \textenglish{2020} & \textenglish{CGPA 3.40}\\ \hline
\end{tabularx}

\biohead{অভিজ্ঞতা}
সহকারী, উদাহরণ লিমিটেড (\textenglish{2021--2024})। হিসাব ও নথি ব্যবস্থাপনার দায়িত্ব।

\biohead{কম্পিউটার দক্ষতা ও ভাষা}
অফিস অ্যাপ্লিকেশন, বাংলা ও ইংরেজি টাইপিং। ভাষা: বাংলা ও \textenglish{English}।

\biohead{রেফারেন্স}
অনুমতি নিয়ে এক বা দুইজন রেফারেন্সের নাম, পদবি ও যোগাযোগ লিখুন।
\end{document}
`

const letterMain = String.raw`% Original SmilePDF source template, version 1.
% Cover letter that pairs with the English resume starters.
% Replace the example writing with your own.
\documentclass[11pt,a4paper]{article}
\usepackage{fontspec}
\setmainfont{lmroman10-regular.otf}[BoldFont=lmroman10-bold.otf,ItalicFont=lmroman10-italic.otf,BoldItalicFont=lmroman10-bolditalic.otf]
\usepackage[a4paper,margin=24mm]{geometry}
\usepackage{color}
\usepackage[hidelinks]{hyperref}
\definecolor{accent}{RGB}{47,74,109}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\parskip}{9pt}
\begin{document}
{\color{accent}\LARGE\bfseries Sadia Islam}\par
Dhaka, Bangladesh \textbullet{} \href{mailto:sadia@example.com}{sadia@example.com} \textbullet{} +880 1600 000000\par
{\color{accent}\rule{\linewidth}{0.8pt}}

1 January 2026

Hiring Manager\\
Example Bank PLC\\
Motijheel, Dhaka

\textbf{Application for the position of Management Trainee Officer}

Dear Hiring Manager,

I am writing to apply for the Management Trainee Officer position advertised on your careers page.
Replace this opening with the role, where you found it and why this organisation matters to you.

During my internship at Sample Finance, I prepared customer account summaries and supported the branch team during audits.
Use this paragraph for one or two examples that match the role.

I would welcome the opportunity to discuss how I can contribute. Thank you for your time and consideration.

Sincerely,\par
\medskip
Sadia Islam
\end{document}
`

// Jake Gutierrez's resume (MIT), adapted only where the pinned browser engine
// lacks a package. Upstream writing and layout commands are unchanged.
const jakesLicense = String.raw`MIT License

Copyright (c) 2020 Jake Gutierrez

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

const jakesMain = String.raw`%-------------------------
% Resume in Latex
% Author : Jake Gutierrez
% Based off of: https://github.com/sb2nov/resume
% License : MIT (see LICENSE-jakes-resume.txt)
% Source: https://github.com/jakegut/resume at 3e64a933141a7cda3a328f0743f73a201628a4ba
% Adapted by SmilePDF for the browser compiler: fullpage -> geometry,
% fancyhdr -> \pagestyle{empty}; latexsym, marvosym and babel removed. Layout unchanged.
%------------------------

\documentclass[letterpaper,11pt]{article}

\usepackage[letterpaper,margin=0.5in]{geometry}
\usepackage{titlesec}
\usepackage[usenames,dvipsnames]{color}
\usepackage{verbatim}
\usepackage{enumitem}
\usepackage[hidelinks]{hyperref}
\usepackage{tabularx}
\input{glyphtounicode}

\pagestyle{empty}

\urlstyle{same}

\raggedbottom
\raggedright
\setlength{\tabcolsep}{0in}

% Sections formatting
\titleformat{\section}{
  \vspace{-4pt}\scshape\raggedright\large
}{}{0em}{}[\color{black}\titlerule \vspace{-5pt}]

% Ensure that generate pdf is machine readable/ATS parsable
\pdfgentounicode=1

%-------------------------
% Custom commands
\newcommand{\resumeItem}[1]{
  \item\small{
    {#1 \vspace{-2pt}}
  }
}

\newcommand{\resumeSubheading}[4]{
  \vspace{-2pt}\item
    \begin{tabular*}{0.97\textwidth}[t]{l@{\extracolsep{\fill}}r}
      \textbf{#1} & #2 \\
      \textit{\small#3} & \textit{\small #4} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubSubheading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \textit{\small#1} & \textit{\small #2} \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeProjectHeading}[2]{
    \item
    \begin{tabular*}{0.97\textwidth}{l@{\extracolsep{\fill}}r}
      \small#1 & #2 \\
    \end{tabular*}\vspace{-7pt}
}

\newcommand{\resumeSubItem}[1]{\resumeItem{#1}\vspace{-4pt}}

\renewcommand\labelitemii{$\vcenter{\hbox{\tiny$\bullet$}}$}

\newcommand{\resumeSubHeadingListStart}{\begin{itemize}[leftmargin=0.15in, label={}]}
\newcommand{\resumeSubHeadingListEnd}{\end{itemize}}
\newcommand{\resumeItemListStart}{\begin{itemize}}
\newcommand{\resumeItemListEnd}{\end{itemize}\vspace{-5pt}}

%-------------------------------------------
%%%%%%  RESUME STARTS HERE  %%%%%%%%%%%%%%%%%%%%%%%%%%%%


\begin{document}

\begin{center}
    \textbf{\Huge \scshape Jake Ryan} \\ \vspace{1pt}
    \small 123-456-7890 $|$ \href{mailto:x@x.com}{\underline{jake@su.edu}} $|$ 
    \href{https://linkedin.com/in/...}{\underline{linkedin.com/in/jake}} $|$
    \href{https://github.com/...}{\underline{github.com/jake}}
\end{center}


%-----------EDUCATION-----------
\section{Education}
  \resumeSubHeadingListStart
    \resumeSubheading
      {Southwestern University}{Georgetown, TX}
      {Bachelor of Arts in Computer Science, Minor in Business}{Aug. 2018 -- May 2021}
    \resumeSubheading
      {Blinn College}{Bryan, TX}
      {Associate's in Liberal Arts}{Aug. 2014 -- May 2018}
  \resumeSubHeadingListEnd


%-----------EXPERIENCE-----------
\section{Experience}
  \resumeSubHeadingListStart

    \resumeSubheading
      {Undergraduate Research Assistant}{June 2020 -- Present}
      {Texas A\&M University}{College Station, TX}
      \resumeItemListStart
        \resumeItem{Developed a REST API using FastAPI and PostgreSQL to store data from learning management systems}
        \resumeItem{Developed a full-stack web application using Flask, React, PostgreSQL and Docker to analyze GitHub data}
        \resumeItem{Explored ways to visualize GitHub collaboration in a classroom setting}
      \resumeItemListEnd

    \resumeSubheading
      {Information Technology Support Specialist}{Sep. 2018 -- Present}
      {Southwestern University}{Georgetown, TX}
      \resumeItemListStart
        \resumeItem{Communicate with managers to set up campus computers used on campus}
        \resumeItem{Assess and troubleshoot computer problems brought by students, faculty and staff}
        \resumeItem{Maintain upkeep of computers, classroom equipment, and 200 printers across campus}
    \resumeItemListEnd

    \resumeSubheading
      {Artificial Intelligence Research Assistant}{May 2019 -- July 2019}
      {Southwestern University}{Georgetown, TX}
      \resumeItemListStart
        \resumeItem{Explored methods to generate video game dungeons based off of \emph{The Legend of Zelda}}
        \resumeItem{Developed a game in Java to test the generated dungeons}
        \resumeItem{Contributed 50K+ lines of code to an established codebase via Git}
        \resumeItem{Conducted  a human subject study to determine which video game dungeon generation technique is enjoyable}
        \resumeItem{Wrote an 8-page paper and gave multiple presentations on-campus}
        \resumeItem{Presented virtually to the World Conference on Computational Intelligence}
      \resumeItemListEnd

  \resumeSubHeadingListEnd


%-----------PROJECTS-----------
\section{Projects}
    \resumeSubHeadingListStart
      \resumeProjectHeading
          {\textbf{Gitlytics} $|$ \emph{Python, Flask, React, PostgreSQL, Docker}}{June 2020 -- Present}
          \resumeItemListStart
            \resumeItem{Developed a full-stack web application using with Flask serving a REST API with React as the frontend}
            \resumeItem{Implemented GitHub OAuth to get data from user’s repositories}
            \resumeItem{Visualized GitHub data to show collaboration}
            \resumeItem{Used Celery and Redis for asynchronous tasks}
          \resumeItemListEnd
      \resumeProjectHeading
          {\textbf{Simple Paintball} $|$ \emph{Spigot API, Java, Maven, TravisCI, Git}}{May 2018 -- May 2020}
          \resumeItemListStart
            \resumeItem{Developed a Minecraft server plugin to entertain kids during free time for a previous job}
            \resumeItem{Published plugin to websites gaining 2K+ downloads and an average 4.5/5-star review}
            \resumeItem{Implemented continuous delivery using TravisCI to build the plugin upon new a release}
            \resumeItem{Collaborated with Minecraft server administrators to suggest features and get feedback about the plugin}
          \resumeItemListEnd
    \resumeSubHeadingListEnd


%-----------PROGRAMMING SKILLS-----------
\section{Technical Skills}
 \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
     \textbf{Languages}{: Java, Python, C/C++, SQL (Postgres), JavaScript, HTML/CSS, R} \\
     \textbf{Frameworks}{: React, Node.js, Flask, JUnit, WordPress, Material-UI, FastAPI} \\
     \textbf{Developer Tools}{: Git, Docker, TravisCI, Google Cloud Platform, VS Code, Visual Studio, PyCharm, IntelliJ, Eclipse} \\
     \textbf{Libraries}{: pandas, NumPy, Matplotlib}
    }}
 \end{itemize}


%-------------------------------------------
\end{document}
`

export const galleryLatexTemplates: readonly LatexSourceTemplate[] = [
  { id: 'compact-source', version: 1, name: 'Compact one-page', detail: 'Dense single-column resume in Latin Modern with ruled small-caps headings.', engine: 'pdflatex',
    requirements: 'pdfLaTeX; Latin Modern (lmodern); geometry, titlesec, enumitem, tabularx, hyperref.', files: [{ path: 'main.tex', content: compactMain }] },
  { id: 'modern-source', version: 1, name: 'Modern professional', detail: 'Latin Modern Sans with one accent colour, ruled headings and a confident name.', engine: 'xelatex',
    requirements: 'XeLaTeX; Latin Modern Sans; fontspec, geometry, color, titlesec, enumitem, hyperref.', files: [{ path: 'main.tex', content: modernMain }] },
  { id: 'sidebar-source', version: 1, name: 'Sidebar resume', detail: 'Tinted contact and skills rail beside the main column, on one page.', engine: 'xelatex',
    requirements: 'XeLaTeX; Latin Modern Sans; fontspec, geometry, color, enumitem, hyperref.', files: [{ path: 'main.tex', content: sidebarMain }] },
  { id: 'international-source', version: 1, name: 'International CV', detail: 'European-style CV with dates in a left column and accent section bars.', engine: 'pdflatex',
    requirements: 'pdfLaTeX; Latin Modern (lmodern); geometry, color, tabularx, hyperref.', files: [{ path: 'main.tex', content: internationalMain }] },
  { id: 'bd-biodata-source', version: 1, name: 'Bangla biodata', detail: 'Bangla biodata with a photo frame, personal table and education grid.', engine: 'lualatex',
    requirements: 'LuaHBTeX; Noto Sans Bengali and Latin Modern Roman; fontspec, polyglossia, geometry, tabularx, hyperref.', files: [{ path: 'main.tex', content: biodataMain }] },
  { id: 'letter-source', version: 1, name: 'Cover letter', detail: 'One-page cover letter in Latin Modern that pairs with the resume starters.', engine: 'xelatex',
    requirements: 'XeLaTeX; Latin Modern Roman; fontspec, geometry, color, hyperref.', files: [{ path: 'main.tex', content: letterMain }] },
  { id: 'jakes-resume', version: 1, name: "Jake's Resume (adapted)", detail: 'The widely used single-column software resume by Jake Gutierrez, MIT licensed.', engine: 'pdflatex',
    requirements: 'pdfLaTeX; Computer Modern; latexsym, geometry, titlesec, color, verbatim, enumitem, hyperref, tabularx.',
    files: [{ path: 'main.tex', content: jakesMain }, { path: 'LICENSE-jakes-resume.txt', content: jakesLicense }] },
]
