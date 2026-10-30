# Mr.Resume LaTeX Editor — UI/UX উন্নয়ন পরিকল্পনা

## ১. উদ্দেশ্য

LaTeX editor-কে আরও গোছানো, শেখা সহজ এবং পেশাদারভাবে ব্যবহারযোগ্য করা—যাতে নতুন ব্যবহারকারী সহজে source edit ও compile শুরু করতে পারেন, আর অভিজ্ঞ ব্যবহারকারী multi-file project ও PDF proof দক্ষতার সঙ্গে পরিচালনা করতে পারেন।

এই পরিকল্পনা Regular editor-এর সংগঠিত workflow-কে রেফারেন্স হিসেবে নেয়, কিন্তু LaTeX editor-এর নিজস্ব source-to-proof কাজের ধরন বজায় রাখে। Regular editor হলো resume তৈরির জায়গা; LaTeX editor হলো source সম্পাদনা, typeset করা এবং বাস্তব PDF যাচাই করার workbench।

## ২. বর্তমান অভিজ্ঞতার মূল্যায়ন

### Regular editor-এর শক্তি

- কাজের অঞ্চলগুলো স্পষ্ট: section ও template নিয়ন্ত্রণ, document preview, এবং প্রয়োজনমতো inspector/settings।
- উপরের অংশে document title, autosave, language, view ও export-এর মতো পরিচিত কাজগুলো রাখা হয়েছে।
- ব্যবহারকারী যে resume তৈরি করছেন, preview-তে সেটিই দেখা যায়; section নির্বাচন ও সম্পাদনার সম্পর্ক পরিষ্কার।

### LaTeX editor-এর বর্তমান সক্ষমতা

- Project-এ একাধিক source file ও image asset রাখা যায়।
- CodeMirror-এ source সম্পাদনা, file tab, outline, snippet, search/replace, line navigation ও diagnostics রয়েছে।
- Compile করে আসল PDF proof দেখা, page/zoom নিয়ন্ত্রণ এবং সমর্থিত ক্ষেত্রে source mapping ব্যবহার করা যায়।
- Project import/export, local checkpoint/history, compile log, engine নির্বাচন, privacy consent ও offline/error state রয়েছে।

### প্রধান UX সমস্যা

সক্ষমতার ঘাটতি নয়, বরং কাজগুলোর বিন্যাসই মূল সমস্যা। Project management, compiler settings, source tools, status message, proof controls এবং diagnostics একই সময়ে দৃশ্যমান নানা bar ও panel-এ ছড়িয়ে আছে। ফলে:

- নতুন ব্যবহারকারীর জন্য প্রথম কাজটি—template বেছে নেওয়া, source খোলা, নাকি compile—স্পষ্ট নয়।
- ঘন ঘন প্রয়োজন হয় না এমন project ও compiler controls মূল editing workspace-এর সঙ্গে প্রতিযোগিতা করে।
- Compile status, source revision, proof-এর revision এবং diagnostics কোথায় দেখা যাবে তা শিখে নিতে হয়।
- Source editing-এর প্রাসঙ্গিক controls এক জায়গায় থাকলেও তাদের অগ্রাধিকার ও grouping আরও পরিষ্কার করা যায়।

## ৩. নকশার ধারণা ও নীতি

**ধারণা: “Typesetting workbench” — source লেখা হয় এক পাশে, আর সেই source থেকে compile হওয়া বাস্তব PDF অন্য পাশে যাচাই করা হয়।**

নকশার ভিত্তি হবে সংযত, নির্ভুল এবং content-কেন্দ্রিক developer tool-এর ভাষা। LaTeX source-এর monospace পাঠযোগ্যতা ও PDF কাগজের মতো পরিষ্কার আলাদা থাকবে; অপ্রয়োজনীয় card, decoration বা রঙিন status chrome যোগ করা হবে না। বিদ্যমান Mr.Resume theme ও module-local token ব্যবহার করতে হবে; নতুন global palette বা অন্য feature-এর token টানা যাবে না।

প্রধান নীতিগুলো:

1. **কাজের স্তর অনুযায়ী hierarchy:** Project পরিচয়, source edit, proof দেখা এবং build সমস্যা—প্রতিটির আলাদা স্থান।
2. **Compile হলো প্রধান action:** অন্য export বা project action তার চেয়ে কম prominence পাবে।
3. **Status সঠিক প্রসঙ্গে:** Save state project-এর পাশে; cursor ও file তথ্য source-এর পাশে; revision তথ্য proof-এর পাশে; diagnostics build panel-এ।
4. **সত্যনিষ্ঠ অবস্থা:** পুরনো PDF-কে পুরনো source-এর proof বলেই দেখাতে হবে। অনুপলব্ধ diagnostics বা mapping অনুমান করে দেখানো যাবে না।
5. **Progressive disclosure:** Template, import, history ও কম ব্যবহৃত project action দরকারের সময় সহজে পাওয়া যাবে; নিয়মিত লেখার জায়গা দখল করবে না।

## ৪. প্রস্তাবিত বিন্যাস

### ৪.১ একটিমাত্র শীর্ষ project bar

- বাম দিকে `TeX / LaTeX` পরিচয়, Regular/LaTeX mode switch, project title এবং সংক্ষিপ্ত save state: যেমন `Saved r12`, `Saving`, `Unsaved changes`, `Session only`।
- ডান দিকে প্রধান `Compile` action ও shortcut, `Download PDF`, এবং `Export` menu থাকবে। চলমান compile হলে বর্তমান attempt/queue state সত্যভাবে দেখাতে হবে।
- PDF download-কে proof action হিসেবে চেনানো হবে এবং proof না থাকলে নিষ্ক্রিয় থাকবে।
- `.tex` ও Source ZIP-কে গৌণ export action হিসেবে একটি `Export` menu/group-এ রাখা যেতে পারে। ZIP-এর সঙ্গে কী অন্তর্ভুক্ত/অন্তর্ভুক্ত নয়—বর্তমান ব্যাখ্যা বজায় রাখতে হবে।

### ৪.২ Project rail ও source settings

আলাদা settings row যোগ না করে project ও file-সংক্রান্ত কাজ বাম rail-এ রাখুন:

- Project selector ও main-file selector, file count/list, `New file`, `Add file/image`, rename/delete, এবং Source outline।
- Templates, import, project duplication/removal, checkpoints/backups এবং `Copy current Regular source`-কে rail-এর গৌণ/collapsible group-এ রাখুন। Regular source copy যে নতুন independent LaTeX project তৈরি করে, সেটি action-এ স্পষ্ট করুন।

Compiler engine, Auto Compile ও Wrap controls Source header-এর `Settings` popover-এ রাখুন। Compile-এর consent/privacy notice যথাস্থানে truthful ও সহজে খুঁজে পাওয়া যাবে।

### ৪.৩ মূল workspace: Project rail, Source, PDF proof

**Project rail**

- প্রথমে project file count, project/main-file selector, file list এবং main file চিহ্নিত করুন; এরপর local image assets।
- `New file` ও `Add file/image`-কে দৃশ্যমান কিন্তু গৌণ action রাখুন।
- Source outline-কে file navigation-এর সঙ্গে সম্পর্কিত রাখুন এবং এটি best-effort—এই সীমা স্পষ্ট রাখুন।
- Templates, import, project duplication/removal, checkpoints/backups এবং preserved originals-কে collapsible/secondary group-এ রাখুন। প্রথমবার project তৈরি করা ব্যবহারকারী যেন template/import খুঁজে পান।
- Storage budget ও local-only persistence-এর তথ্য rail-এর নিচে সংক্ষিপ্তভাবে দেখান; জরুরি সতর্কতা হলে আলাদা status হিসেবে উন্নীত করুন।

**Source editor**

- উপরে খোলা file-এর tab ও main-file পরিচয়। অনেক file হলে tab row যেন ব্যবহারযোগ্য থাকে; overflow হলে বর্তমান file সহজে চেনা যায়।
- File tab-এর নিচে `Editable source`, revision এবং source-to-proof navigation-এর সংক্ষিপ্ত header।
- Undo/redo, Find/replace, Go to line, snippet, Fold/Unfold—একটি editing toolbar-এ grouping। ছোট viewport-এ toolbar horizontal scroll বা overflow menu ব্যবহার করতে পারে; controls বাদ দেওয়া যাবে না।
- CodeMirror-কে workspace-এর প্রধান কাজের ক্ষেত্র হিসেবে যথেষ্ট জায়গা দিন। Line/column status editor-এর নিচেই থাকবে।

**PDF proof**

- পরিষ্কার header: `Typeset proof`, revision ও current/stale পরিচয়। PDF page, zoom ও rotate controls proof-এর কাছেই থাকবে।
- Proof না থাকলে ব্যবহারকারীকে compile করতে বলুন এবং এটি যে আসল compiled PDF—HTML reconstruction নয়—তা সংক্ষেপে ব্যাখ্যা করুন।
- Source ও PDF-এর revision মিলে না গেলে দৃশ্যমান stale notice দেখান; source mapping তখন নিষ্ক্রিয় থাকার কারণও বোঝান।
- SyncTeX/source-map navigation পাওয়া গেলে সেটিকে সুবিধা হিসেবে দেখান, কিন্তু অবস্থান আনুমানিক হতে পারে—এই সীমা অক্ষুণ্ণ রাখুন।

Desktop ও laptop-এ rail, source ও proof—তিনটি pane-ই একই viewport-এ দৃশ্যমান থাকবে। পর্যাপ্ত জায়গায় divider টেনে source/proof অনুপাত বদলানো যাবে; মাঝারি প্রস্থে rail ও pane-এর ন্যূনতম ব্যবহারযোগ্য প্রস্থ অক্ষুণ্ণ রাখতে হবে। অতিরিক্ত উচ্চতার content pane-এর ভেতরে scroll করবে, যাতে পুরো editor viewport-এর বাইরে না যায়।

### ৪.৪ Build panel: Problems, Log, History

- `Problems`, `Log`, `History`-কে `Build`/`Compile details` panel-এ একত্রিত করুন; তিনটিই আলাদা view হিসেবে থাকবে।
- Compile error বা warning এলে Problems-কে চোখে পড়ার মতো করুন; প্রয়োজনে বর্তমান behavior অনুযায়ী panel খুলুন। Error-এ severity, file:line, message এবং উপলভ্য হলে help/code দেখান। Click করলে সংশ্লিষ্ট source line-এ যাওয়া যাবে।
- কোনো diagnostics না থাকলে “কোনো সমস্যা নেই” বা “এই view-এর জন্য diagnostics নেই”—যেটি সত্য, সেটিই দেখান; compile না হলে success বোঝাবেন না।
- Log-এ privacy, retention এবং request ID সংক্রান্ত বর্তমান ব্যাখ্যা রাখুন।
- History-তে restore করলে নতুন revision তৈরি হয় এবং আগে checkpoint হয়—এই বিষয়টি restore action-এর পাশে বোঝান।
- Panel বন্ধ থাকলে কেবল ছোট summary ও সমস্যা সংখ্যা দেখা যেতে পারে; এতে source/PDF-এর জায়গা বাড়বে।

## ৫. Responsive ও accessibility পরিকল্পনা

- **বড় পর্দা:** Rail + পাশাপাশি source/proof; divider 30–70% সীমার মধ্যে resize করা যায়।
- **মাঝারি পর্দা:** তিনটি pane দৃশ্যমান রেখে rail-এর প্রস্থ ও source/proof-এর অনুপাত সংযতভাবে কমান; controls যেন overlap বা অকারণে clip না হয়।
- **ছোট পর্দা:** বিদ্যমান Files, Source, Proof, Problems navigation বজায় রেখে আরও স্পষ্ট selected state ও জায়গা-সাশ্রয়ী header দিন। Primary compile action সবসময় সহজে পাওয়া চাই।
- সব control keyboard-এ ব্যবহারযোগ্য হবে; focus দৃশ্যমান, tab order যৌক্তিক এবং tab/tabpanel সম্পর্ক সঠিক থাকবে।
- রঙের পাশাপাশি text/icon/shape দিয়ে current, stale, error, warning ও save state বোঝাতে হবে।
- Light ও dark theme—দুটিতেই source, diagnostics, selection, focus ring, disabled state ও PDF stage যাচাই করতে হবে। Bangla/Indic glyph editor-এ বাস্তব operating size-এ পড়া যায় কি না দেখতে হবে।
- Motion থাকলে শুধু panel/view পরিবর্তন বুঝতে সাহায্য করবে; `prefers-reduced-motion`-এ তা কমাতে বা সরাতে হবে।

## ৬. ব্যবহারকারীর অবস্থা ও প্রতিক্রিয়া

পরিকল্পিত বিন্যাসে বর্তমান truthful states বজায় রেখে এগুলো স্পষ্ট করতে হবে:

- Project restore হচ্ছে, save হচ্ছে, save হয়েছে, save conflict হয়েছে, storage session-only।
- Compiler unavailable/offline, compile consent প্রয়োজন, compile queued/running/cancelling/recovering/failed।
- PDF নেই, rendering চলছে, PDF render ব্যর্থ, current proof, stale proof।
- Problems নেই, diagnostics পাওয়া গেছে, log/history অনুপস্থিত।
- Import/export চলছে বা ব্যর্থ; failure হলে কোন data অক্ষত আছে তা পরিষ্কার।

Status notice-গুলো একে অন্যের ওপর স্তূপ না করে severity ও সময়কাল অনুযায়ী সাজাতে হবে। জরুরি সমস্যা dismiss করলেও Problems view থেকে তা খুঁজে পাওয়া চাই।

## ৭. বাস্তবায়নের ধাপ

### ধাপ ১ — বর্তমান UI ও workflow-এর baseline

- নিয়মিত কাজের sequence নথিবদ্ধ করুন: project খোলা/তৈরি → file নির্বাচন → source edit → compile consent → compile → proof দেখা → error ঠিক করা → export/history।
- Desktop/tablet/mobile এবং light/dark theme-এ বর্তমান layout, overflow ও keyboard navigation পর্যালোচনা করুন।
- সব বিদ্যমান action ও states-এর inventory করুন, যাতে redesign-এ সক্ষমতা হারিয়ে না যায়।

### ধাপ ২ — Information architecture ও wireframe

- একক topbar, Project rail, Source settings, Source, PDF proof ও Build panel-এর hierarchy নির্ধারণ করুন।
- Desktop ও mobile-এর পৃথক wireframe তৈরি করুন।
- Empty, compile running, compile error, stale proof, offline এবং storage warning-এর state layout নির্ধারণ করুন।

### ধাপ ৩ — Module-local UI বাস্তবায়ন

- Mr.Resume-এর LaTeX component ও CSS Module-এর মধ্যেই পরিবর্তন সীমাবদ্ধ রাখুন, যদি বাস্তব পর্যালোচনায় shared dependency প্রয়োজন না হয়।
- Compile, privacy, save, proof revision, diagnostics ও history logic অপরিবর্তিত রেখে শুধু প্রয়োজনীয় grouping/placement বদলান।
- Accessibility ও theme behavior একই পরিবর্তনের অংশ হিসেবে সম্পন্ন করুন।

### ধাপ ৪ — Verification

- Frontend typecheck ও Mr.Resume-সংশ্লিষ্ট বিদ্যমান checks চালান।
- বাস্তব browser render-এ desktop, tablet এবং mobile; light ও dark—সব layout দেখুন।
- Keyboard-only ব্যবহার, focus visibility, responsive overflow এবং reduced-motion পরীক্ষা করুন।
- গুরুত্বপূর্ণ workflow হাতে যাচাই করুন: edit/undo, file switch, compile consent, compile failure থেকে source line-এ যাওয়া, stale proof, PDF download, ZIP export, history restore, Regular থেকে copy।
- কোনো shared file বা contract ছুঁলে module-impact-guard অনুযায়ী প্রভাবিত অন্য feature-গুলোর verification scope বাড়াতে হবে।

## ৮. সফলতার মানদণ্ড

- নতুন ব্যবহারকারী source খুঁজে বের করে compile ও proof দেখার পথ নিজে বুঝতে পারেন।
- Compile প্রধান action; export ও project maintenance-কে editing-এর সঙ্গে গুলিয়ে ফেলতে হয় না।
- Source file, editor tool, build সমস্যা এবং PDF proof—প্রতিটি তথ্য নিজস্ব প্রাসঙ্গিক স্থানে পাওয়া যায়।
- Desktop-এ source/proof দুটোই কার্যকরভাবে দেখা যায়; mobile-এ view বদলানো সহজ এবং control tap target যথেষ্ট বড়।
- কোনো status ভুলভাবে save, compile success, proof freshness বা source mapping-এর নিশ্চয়তা দেয় না।
- বিদ্যমান project, import/export, privacy, compiler, diagnostics, history ও Regular-editor bridge সক্ষমতা অক্ষত থাকে।

## ৯. Scope ও অনুমান

- এই নথি UI/UX পরিকল্পনা; এতে কোনো implementation করা হয়নি।
- Regular editor-কে কাঠামোগত রেফারেন্স ধরা হয়েছে, visual copy করার লক্ষ্য নয়। LaTeX-এর developer-oriented কাজের density প্রয়োজনমতো থাকবে।
- বিদ্যমান theme, module boundary এবং project architecture-ই implementation-এর ভিত্তি। Shared token বা অন্য module পরিবর্তন এই পরিকল্পনায় অন্তর্ভুক্ত নয়।
- নির্দিষ্ট color value, typography scale বা animation duration implementation-এর আগে বিদ্যমান Mr.Resume design tokens ও theme-এর সঙ্গে মিলিয়ে স্থির করতে হবে।
