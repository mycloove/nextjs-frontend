# Mr.Resume LaTeX Editor: Browser WASM বাস্তবায়ন ও সংস্করণ প্রকাশের নিয়ম

## ১. বর্তমান অবস্থা (2026-11-03)

এটি আগের উন্নয়ন পরিকল্পনার হালনাগাদ বাস্তবায়ন-রেকর্ড। Browser-local compile, grouped assets, explicit package consent, isolated engine cache এবং truthful preparation states এখন module-local code-এ বাস্তবায়িত। **Implementation complete মানে নতুন engine release, বাস্তব device performance, browser storage durability বা E2E যাচাই complete নয়।** এই পরিবর্তনে engine version/dependency বদলানো হয়নি।

বর্তমান candidate: public root `/mr-resume/latex/busytex-v1/`, `profileVersion` = `browser-busytex-v1-tl2023-4499aa69-r5`, BusyTeX commit `4499aa69fd3cf77ad86a47287d9a5193cf5ad993`, TeX Live 2023.0, Emscripten 3.1.43। নির্দিষ্ট engine versions এবং binary/source input pins `browser/provision.mjs`, `manifest.json`, `provenance.json` এবং `source-offer.json`-এ রয়েছে।

| আগের ধাপ / gap | বাস্তবায়নের অবস্থা | বর্তমান প্রমাণ ও সীমা |
|---|---|---|
| ধাপ ১ / G1: ছোট প্রথম asset set | সম্পন্ন, candidate r5 | ৬টি আসল group; নির্বাচিত engine-এর core + profile files-ই নেওয়া হয়। Exact manifest arithmetic নিচে; বাস্তব transfer timing মাপা হয়নি। |
| ধাপ ২ / G2: engine cache | সম্পন্ন | `engineAssetStore.ts`; save/load SHA-256, source-pinned manifest restore, bounded retention এবং honest clear failure। Adapter unit tests বাস্তব browser durability প্রমাণ করে না। |
| ধাপ ৩ / G3: on-demand package groups | সম্পন্ন, সীমিত inventory | একমাত্র deployed optional group `math`। Literal dependency discovery এবং real-engine missing-package response explicit consent চায়; arbitrary CTAN/per-file fetch নেই। |
| ধাপ ৪ / G5: memory warning | সম্পন্ন | উপলব্ধ `navigator.deviceMemory` তথ্য দিয়ে advisory warning; API না থাকলে memory measurement বা সফল compile-এর ভান নেই। 512 MiB WASM reserve-এর সঙ্গে অতিরিক্ত preparation/PDF memory লাগে। |
| ধাপ ৫ / G4: version bump/source finalization | সম্পন্ন, নথিভুক্ত | নিচের immutable-release checklist, exact generated manifest pin এবং source/license coverage checks। ঐতিহাসিক second release directory বানানো হয়নি। |
| ধাপ ৬: progress/consent/cache states | সম্পন্ন, LaTeX UI integration | Decoded response bytes, SHA-verified bytes ও verified-cache reuse আলাদা; clear ব্যর্থ হলে success দেখানো হয় না। Actual visual/mobile rendering ও E2E প্রমাণ এই পরিবর্তনের দাবি নয়। |

সব বাস্তবায়ন `features/mr-resume/latex/**` এবং module-specific `public/mr-resume/latex/**`-এ সীমিত। Regular editor, shared `next.config.ts`/CSP, shared dependencies, native compiler ও অন্য features অপরিবর্তিত। ভবিষ্যতে shared reach লাগলে root `CLAUDE.md` এবং module-impact-guard অনুযায়ী আগে অনুমোদন লাগবে।

## ২. বাস্তব pipeline ও নিরাপত্তা

1. `manifest.json?profile=<version>`-এর exact bytes source-side `browserManifestPin.ts`-এর size/SHA-256 দিয়ে স্বাধীনভাবে যাচাই হয়। Online fetch এবং fresh transport-এর IndexedDB restore দুই পথেই যাচাই; cached metadata-র নিজের hash-কে trust root ধরা হয় না।
2. Manifest schema v1-এর পাঁচ legacy top-level pins রাখা হয়েছে। Optional additive `groups` থাকলে loader worker + JS + WASM এবং নির্বাচিত engine-এর core/profile groups নেয়; legacy snapshot/index তখন প্রথম compile-এর asset set-এ আসে না।
3. Missing package group consent `profileVersion + group + group-pin hash`-এর জন্য। প্রকল্পের মূল source, selected main, assets এবং revision capture করে compile করা হয়; package download নিজে source বদলায় না। Consent storage/digest-এর await শেষেও একই project, revision, exact source, runtime ও active workspace আবার যাচাই হয়; dismissed/stale request worker শুরু করতে পারে না। Runtime বদলানোর আগে Auto Compile opt-in reset হয়, এবং UI native upload consent-ও reset করে। Unlisted package সৎ refusal দেয়; `tcolorbox`/`mdframed` synthetic test fixtures, deployed package নয়।
4. Asset transport শুধু same-origin exact public pin list-এর GET: `credentials: omit`, `redirect: error`, bounded bytes ও independent SHA checks। Worker compressed archive এবং প্রতিটি indexed member পুনরায় যাচাই করে; regular ustar files, no links/traversal/case aliases, মোট 96 MiB expanded data এবং 6000 files limit মানে।
5. Worker TeX execution-এর আগে `fetch`, `importScripts`, XHR, WebSocket/EventSource এবং socket imports বন্ধ করে। Shell escape, native filesystem, remote package resolution, dynamic format/font generation নেই। Parent supplied verified buffers ব্যবহার করে; project source/filename/log/PDF bytes asset requests-এ থাকে না।
6. সর্বোচ্চ তিন TeX pass ও এক classic BibTeX8 pass; final PDF independent structure/pages/original-byte SHA verification-এর পরে proof হয়। Browser Biber/biblatex ও SyncTeX সমর্থন করে না। Native runtime নির্বাচন এবং upload consent স্পষ্ট; automatic native switch বা silent bibliography/font substitution নেই। AltaCV-এর ঘোষিত browser-compatible copy আলাদা project, মূল source অপরিবর্তিত।

**CSP-এর সত্য অবস্থা:** global `next.config.ts`-এর CSP হলো `object-src 'none'; base-uri 'self'; frame-ancestors 'none'`; কোনো `connect-src` endpoint hard-list নেই। আগের পরিকল্পনার "CSP endpoint hard-list update" বক্তব্য বাস্তবায়িত দাবি নয়। Shared CSP ইচ্ছাকৃতভাবে বদলানো হয়নি; same-origin exact pin list ও module worker network shutdown-ই এই কাজের privacy/network boundary।

বর্তমান সীমা: 1 MiB source, 3 MiB source+assets, 32 project files; PDF 3 MiB / 32 pages, log 128 KiB; engine preparation 300 seconds, compile/verification deadline 30 seconds, প্রতি worker এক compile। Bengali/Noto/HarfBuzz glyph coverage থাকলেও complex Bangla extraction/search/ATS fidelity সর্বজনীন বলে দাবি করা হয় না।

Progress-এর received counter হলো Fetch-এর decoded response-body bytes; compressed wire `Content-Length` বা physical network download নয়। HTTP cache reuse পৃথকভাবে মাপা হয় না। Verified/cache counters শুধু independently checked asset bytes গোনে; engine progress-এর 100% মানে TeX/PDF verification শেষ নয়। Stream সরাসরি pinned-size buffer-এ লেখা হয়, বড় chunk list ও দ্বিতীয় assembly buffer ধরে রাখা হয় না।

## ৩. Exact Manifest Arithmetic

এই সংখ্যা final manifest-এর `bytes` যোগ করে পাওয়া; measured network transfer, HTTP compression, wall-clock time, memory benchmark বা বাস্তব second-compile zero-network ফল নয়। Manifest metadata নিজে আলাদা 8,714 bytes; response headers/HTTP cache timing এই runtime totals-এর অংশ নয়।

| Asset selection | Unique runtime pins | Exact bytes |
|---|---:|---:|
| Legacy top-level bundle | 5 | 71,506,455 |
| pdfLaTeX required: runtime + core + pdflatex | 7 | 53,373,036 |
| XeLaTeX required: runtime + core + xelatex + unicode | 9 | 56,747,387 |
| LuaLaTeX required: runtime + core + lualatex + unicode | 9 | 59,068,079 |
| Optional math increment: archive + index | 2 | 133,631 |
| pdfLaTeX with approved math | 9 | 53,506,667 |
| XeLaTeX with approved math | 11 | 56,881,018 |
| LuaLaTeX with approved math | 11 | 59,201,710 |
| All legacy + grouped runtime pins | 17 | 112,307,514 |

| Group | Original files | Archive bytes | Index bytes | Expanded ustar bytes |
|---|---:|---:|---:|---:|
| core | 2,828 | 15,717,965 | 917,278 | 33,231,872 |
| pdflatex | 1 | 6,032,608 | 388 | 6,479,360 |
| xelatex | 1 | 6,270,766 | 384 | 8,716,288 |
| lualatex | 1 | 8,591,445 | 397 | 11,872,256 |
| unicode | 593 | 2,933,161 | 203,036 | 15,164,928 |
| math | 30 | 124,330 | 9,301 | 561,152 |

Group archives মিলে unchanged legacy snapshot-এর 3,454 original files-এর disjoint partition। Original member bytes/hash/source/upstreamPath অপরিবর্তিত; grouped expanded bytes 76,025,856, legacy archive expanded bytes 76,020,736। পার্থক্য শুধু ছয় tar-এর আলাদা terminator blocks। `ls-R` পুরো fixed inventory index করে এবং core-এ থাকে; optional files absent হলে lookup auto-download শুরু করে না।

Final manifest pin: `manifest.json`, **8,714 LF bytes**, SHA-256 `32f0ec22898a821ed9dbc97552c9a299c647b2b32faaae1c1bdbf7fbd5bcb388`। TS pin নিজ manifest asset list, worker constants বা provisioning archive-এ নেই; তাই hash cycle নেই।

## ৪. Source Offer ও সীমা

- Same-origin ordered pinned archives-এ BusyTeX, TeX Live engine/library, Expat ও Fontconfig-এর upstream sources এবং binary rebuild recipe রাখা হয়েছে। BusyTeX wrapper MIT হলেও statically linked binary GPL/LGPL ও অন্য component-specific licenses বহন করে; binary-কে MIT-only বলা হয় না।
- Existing `sources/tex-packages-source.tar.gz` basic release archive-এর preserved `/source/` subtree এবং মূল TeX Live license files রাখে। এটি সব supplemental package বা font-development source-এর complete upstream archive বলে দাবি নয়।
- `sources/tex-supplemental-runtime-source.tar.gz` ৮টি বাস্তব package-এর 293 exact unmodified shipped runtime files রাখে: enumitem, titlesec, fontspec, polyglossia, makecmds, xkeyval, xunicode, xltxtra। Archive 300,133 bytes, SHA-256 `387bd20d62ee39c755c656b52dea417c6d40600ca657aa5aabe5ca1ba7329ad9`। Original TeX/Lua/config/map files এবং compiled `.tec`-এর shipped `.map` inputs অন্তর্ভুক্ত।
- Supplemental index প্রতিটি file-এর size/SHA/supplier/upstreamPath, আসল containing group, pinned release JS/data inputs এবং exact original embedded copyright/license lines রেকর্ড করে। `provenance.groupSources` ও `source-offer.packageCoverage.groups` ছয় group-এর vendor/supplement/generated source এবং license references একই pins দিয়ে যুক্ত করে। কোনো group-কে blanket MIT/LPPL license দেওয়া হয় না; original per-file/package terms প্রযোজ্য।
- **Original-input correction:** pinned BusyTeX `ubuntu_package_preload.py` Ubuntu Lunar file lists ব্যবহার করে `build/texlive-full` থেকে directories নির্বাচন করে। `.data` files-ই এখানে exact immediate inputs; `.deb` naming বা current Ubuntu package metadata দিয়ে byte provenance অনুমান করা হয় না। Archived recipe files-এর exact hashes এবং original TL ISO / historical Ubuntu selector URLs supplemental index-এ আছে।
- Full ISO-এর bytes/hash, exact Debian/Ubuntu `.deb`/`.dsc`/`orig`/`debian` source inputs, supplemental complete upstream `.dtx`/`.ins`/documentation এবং full font-development sources এখানে locally established নয়। অনুপস্থিত hash বা archive বানানো/দাবি করা হয়নি। Future release/source-license review-তে matching original inputs সংগ্রহ ও যাচাই করে license-required coverage পূরণ করতে হবে; raw shipped `.sty`/Lua files আর পূর্ণ generated-source archive এক জিনিস নয়।
- `sources/browser-provisioning-source.tar.gz` current provisioning/build-format/smoke scripts, exact deployed worker এবং required `features/mr-resume/components/fonts/latin-modern/LICENSE.txt` input রাখে। Archive ও ছয় member-এর exact pins offer-এ আছে; focused test freshness cross-check করে। Archived smoke harness application TS modules, frontend npm dependencies ও `Mr.Resume/AltaCV_Template.zip`-এর ওপর নির্ভর করে, standalone নয়।

## ৫. Maintainership: Future Version Bump Checklist

এই ধাপগুলো **future engine-version release-এর নিয়ম**, এই turn-এ engine rebuild/TeX execution-এর অনুমতি বা সেগুলো চালানোর দাবি নয়। সব candidate edits module-local রাখতে হবে; immutable publication-এর আগে review শেষ করতে হবে।

1. **Version/root সিদ্ধান্ত আগে:** নতুন BusyTeX/TeX Live/vendor/worker change-এর জন্য নতুন immutable `profileVersion` এবং public root নির্ধারণ করুন। Published root-এর manifest/worker/binary/group/source bytes কখনো in-place overwrite করবেন না; `?profile=`/`?sha256=` query immutable path-এর বিকল্প নয়। Generator `staticDirectory`, parent loader root/version এবং worker root/version একসঙ্গে নতুন root-এর সঙ্গে মিলিয়ে প্রকাশ করতে হবে।
2. **Upstream inputs ও dependencies পুনর্মূল্যায়ন:** BusyTeX commit/release, TeX Live commit/snapshot, engine versions, Emscripten ABI/toolchain, JS/WASM sizes/hashes, source archive parts/whole hashes, fonts/licenses এবং format provenance যাচাই করুন। `keepRuntime`, latex/lua/supplemental sets, package dependencies, AMS/CM/LM shared outlines/maps, Unicode loader/fonts এবং classic BibTeX support পুনর্মূল্যায়ন করুন; আগের whitelist নতুন engine-এ নিরাপদ/যথেষ্ট ধরে নেবেন না। Missing source-input pins বা licensing coverage release blocker হলে আগে তা মেটান।
3. **Authorized reproducible preparation:** আলাদা absolute temporary cache-এ pinned acquisition করুন। Upstream binary rebuild প্রয়োজন হলে archived BusyTeX recipe ও native generator prerequisites ব্যবহার করুন। Browser LuaHB format শুধু pinned real WASM `build-format.mjs --generate <cache>` দিয়ে fixed source epoch-এ rebuild করুন; native `.fmt`/Lua bytecode substitute নয়। তারপর `provision.mjs --build <cache>` দিয়ে candidate asset snapshot তৈরি করুন। এটি future explicit authorization-এ TeX-executing work; বর্তমান finalization কেবল existing pinned format পুনরায় ব্যবহার করেছে।
4. **Partition/index gate:** প্রতিটি selected engine format ঠিক একবার, সব legacy member ঠিক এক group-এ, সব optional package basename আসল indexed `.sty`/`.cls`, no overlap/link/traversal/case/file-directory alias নিশ্চিত করুন। Dependencies যেন optional unapproved group-এ সাইলেন্টভাবে লুকিয়ে না থাকে। Whole fixed tree-এর `ls-R` index regenerate/verify করুন; cumulative 96 MiB / 6000-file worker limit, optional 12 MiB archive limit, unique manifest asset counts এবং 256 MiB budget মানুন।
5. **Source/notices/pin finalization:** worker bytes স্থির করার পরে final local `provision.mjs --manifest` বা `--groups` চালান। দুই mode একই local-only finalization করে: groups/indexes + LF manifest, supplemental sources/embedded evidence, current provisioning source, offer/notices/distribution pins, সবশেষে exact manifest TS pin। Vendor input mismatch সাইলেন্ট repin হয় না। TS pin source archive/manifest/worker-এ ঢোকাবেন না। Script/worker/license input পরে বদলালে আবার finalization চালাতে হবে; stale source pin রেখে publish নয়।
6. **Focused code gates:** changed module-এর focused units, typecheck ও scoped lint সফল হতে হবে; declared source/asset pins ও source freshness cross-check করুন। এর ফল runtime-engine test, UI visual test বা real browser storage test-এর সমতুল্য নয়।
7. **Separate real-engine release prerequisite:** future engine-version release-এর আগে তিন advertised engine-এ actual WASM smoke ও template/corpus regression পৃথকভাবে অনুমোদন নিয়ে চালাতে হবে। Required/approved math selection, every profile format, bundled fonts, Bangla/HarfBuzz limitations, Career ও explicit AltaCV copy, original ZIP/main/multifile/assets/labels/classic bibliography, refusal/integrity/cancellation/privacy যাচাই করতে হবে। Harness-এর matching TS/npm/template inputs লাগবে; source archive-কে standalone test suite ধরে নেবেন না। নতুন engine-এর measured compatibility ছাড়া release complete বলা যাবে না।
8. **Release retention:** নতুন app/manifest প্রকাশের সময় current **এবং immediately previous published version**-এর সম্পূর্ণ immutable roots/assets/source offers/notices serve রাখুন। Retention শুধু IndexedDB labels রাখা নয়; পুরোনো app/cache-কে তার original paths থেকে pinned bytes পেতে দিতে হবে। Rollback previous root-এ যেতে পারবে, পুরোনো bytes rewrite করে নয়। Original projects/sources/checkpoints/history/PDF proofs reformat, replace বা migrate-as-new-source করবেন না; নতুন compile হলে নতুন proof, পুরোনো PDF bytes অপরিবর্তিত।
9. **Bounded cache সত্যতা:** store usage/incoming-version অনুযায়ী সবচেয়ে সাম্প্রতিক দুই version-এর **সব currently cached assets** রাখে যখন combined 256 MiB logical asset payload / 1024-record caps-এ ফিট করে; storage pressure-এ newest working set-কে অগ্রাধিকার দিয়ে eviction হতে পারে। Store per-asset cap 128 MiB; loader/worker manifest asset cap 96 MiB; package consent records bounded 512। IndexedDB metadata/disk overhead ও পৃথক HTTP cache এই logical payload budget-এর অংশ নয়। Browser quota/private mode/disk eviction/reset এই retention কমাতে পারে; never a durability guarantee। `versions`/`incompleteVersions` presence/removal summaries, complete offline compiler-এর প্রমাণ নয়। Offline readiness-এর জন্য independently pinned metadata এবং selected engine + approved group-এর প্রতিটি asset load/hash যাচাই লাগবে।

Engine cache একটি offline website/app-shell cache নয়। Offline compile-এর সময় app code ও independent PDF-verification worker chunk-ও আগে থেকে ব্যবহারযোগ্য থাকতে হবে; engine IndexedDB এগুলো store করে না। Already-loaded page-এর cached engine path unit-tested, কিন্তু browser reload/durability/full offline execution এখানে বাস্তব browser-এ মাপা হয়নি।

বর্তমান tree-তে candidate r5 এবং additive schema-এর জন্য legacy পাঁচ top-level pins আছে; এটিকে "দুটি published versions পাশাপাশি আছে" বলা যাবে না। আগে কখনো প্রকাশিত না হওয়া files থেকে fake historical release directory বানানোর দরকার নেই। প্রথম প্রকৃত পরবর্তী release-এ পূর্বের published r5 root-এর সব bytes/source offers অপরিবর্তিত রেখে নতুন root additiveভাবে serve করতে হবে।

## ৬. এই পরিবর্তনের Verification Boundary

Asset/source finalization implementation command (source inspected, local-only):

```powershell
node features/mr-resume/latex/browser/provision.mjs --manifest
```

Asset/source focused verification command, `nextjs-frontend` থেকে:

```powershell
node --experimental-strip-types --test --test-reporter=spec features/mr-resume/latex/browserAssets.test.ts
```

এই finalization-এর ফল: **9 passed, 0 failed**, 0 skipped/cancelled। কেবল non-failing `MODULE_TYPELESS_PACKAGE_JSON` warning ছিল; shared `package.json` বদলানো হয়নি।

Focused test-এর coverage: exact final LF manifest/TS pin; সব legacy/group/distribution bytes/hashes; ordered full binary-source archive parts; canonical tar/member hashes/partition equality/aliases/limits; real optional package basenames ও `ls-R`; selected engine arithmetic; fresh provisioning archive + required license; actual supplemental members, embedded notices, recorded source recipe এবং group source/license pin coherency। এটি static parsers, filesystem reads, hashes ও gzip inspection; TeX/WASM execution নয়।

চূড়ান্ত focused LaTeX unit suite, `nextjs-frontend` থেকে:

```powershell
npm run test:mr-resume:latex
```

ফল: **263 passed, 0 failed**, 0 skipped/cancelled। Script শুধু `features/mr-resume/latex/*.test.ts` ও `server/*.test.ts` চালায়; browser/E2E `.mjs` harness চালায় না। এতে cache, loader, consent/memory states, source/ZIP/checkpoint/PDF integrity, module-owned native proxy contracts ও light/dark token contrast regression অন্তর্ভুক্ত।

Cache-এর independent code review ও production-adapter/in-process IndexedDB-double re-check: **46 passed, 0 failed**। Corrupt sibling/flagged-anchor cleanup-এর warning propagation regression-ও আলাদা reviewer পুনরায় যাচাই করেছে; কোনো blocking finding অবশিষ্ট নেই। Browser transaction activity-window conformance বা disk durability এর দ্বারা প্রমাণিত নয়।

Frontend `npm run typecheck` pass; `npm run lint -- features/mr-resume/latex public/mr-resume/latex/busytex-v1` clean। Full `npm run lint`-এ 0 errors এবং অন্য modules-এর 21 unrelated warnings আছে; সেগুলো এই scope-এ বদলানো হয়নি।

এখানে E2E, Playwright, browser/WASM smoke, TeX execution, full builds বা unrelated test suites চালানো হয়নি। Real IndexedDB timing, cross-tab behavior, private-mode quotas, actual offline full compilation, mobile/light-dark rendering এবং download timing measured নয়। Future engine-version smoke/corpus gate উপরের checklist-এ আলাদা prerequisite হিসেবেই রাখা হয়েছে।

## ৭. অক্ষত নীতি

- Browser compile source/filename/image/log/PDF upload করে না; native upload শুধু explicit runtime/consent-এ। Static bandwidth cost আছে, তাই "$0" universal operating-cost guarantee নয়।
- No silent package/font/bibliography substitution, no automatic native switch, no source/PDF rewrite on engine upgrade। Explicit AltaCV browser-compatible copy মূল project-এর বিকল্প original নয়।
- Biber/biblatex, browser SyncTeX, shell escape/externalization, arbitrary/full TeX Live ও third-party runtime CDN/per-file lazy fetch এই কাজের বাইরে।
- Engine-cache clear শুধু engine assets ও package permissions মুছে; project database/Regular/retained PDFs নয়। HTTP cache আলাদা; clear success কেবল committed clear-এর পরে, offline availability কখনো প্রতিশ্রুত নয়।
- Existing user edits/untracked assets এবং অন্য owners-এর কাজ preserve করা হয়েছে; এই finalization-এ staging, commits, dependency/engine bump বা shared/native/Regular পরিবর্তন নেই।
