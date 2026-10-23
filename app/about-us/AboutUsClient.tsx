'use client'

/*
  About: "The next chapter".

  Concept: a living document folio, showing why a file is a beginning rather
  than an endpoint. Editorial minimalism is the base; the folio is the one
  tactile accent. The category's globe, vanity counters, autoplay carousel,
  and interchangeable feature cards do not explain this product's work.

  The exhibit changes only when the visitor chooses a direction. It is an
  explicitly illustrative specimen, never a simulated conversion result.
  Tabs support roving focus and arrow/Home/End keys; reduced motion keeps the
  same content without the page-settle animation. No timers or scroll handlers.

  Ownership: this route's JSX and CSS Module only. Marketing chrome, brand
  artwork, tool availability, storage keys, and all tool contracts stay intact.
*/

import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import Link from 'next/link'

import MyclooveWordmark from '@/components/brand/mycloove/MyclooveWordmark'
import HomeFooter from '@/components/HomeFooter'
import Topbar2 from '@/components/Topbar2'
import { toolIdForHref } from '@/lib/usage/catalog'
import { useToolAvailability } from '@/lib/usage/useToolAvailability'

import styles from './AboutUs.module.css'
import '../home.css'

type ToolGroup = 'Convert' | 'Extract' | 'Edit' | 'Ask AI' | 'Advanced'
type ToolFilter = 'All' | ToolGroup
type ChapterId = 'convert' | 'extract' | 'edit' | 'understand'

type AboutTool = {
  href: string
  label: string
  desc: string
  group: ToolGroup
}

const tools: AboutTool[] = [
  { href: '/image-to-pdf', label: 'Images to PDF', desc: 'Bring a collection of images into one document.', group: 'Convert' },
  { href: '/pdf-to-images', label: 'PDF to Images', desc: 'Take individual pages out into the visual world.', group: 'Convert' },
  { href: '/pdf-to-word', label: 'PDF to Word', desc: 'Give a fixed document an editable next chapter.', group: 'Convert' },
  { href: '/word-to-pdf', label: 'Word to PDF', desc: 'Turn a working draft into a document ready to share.', group: 'Convert' },
  { href: '/mr-markdown', label: 'Mr. Markdown', desc: 'From PDF to Markdown, with a workspace to keep writing.', group: 'Convert' },
  { href: '/markdown-to-pdf', label: 'Markdown to PDF', desc: 'Publish your writing as a PDF, with Bangla font support.', group: 'Convert' },
  { href: '/merge-pdf', label: 'Merge PDF', desc: 'Bring separate documents together in the right order.', group: 'Convert' },
  { href: '/split-pdf', label: 'Split PDF', desc: 'Keep the pages you need. Give them a file of their own.', group: 'Convert' },
  { href: '/rotate-pdf', label: 'Rotate PDF', desc: 'Put the whole document, or selected pages, the right way up.', group: 'Convert' },
  { href: '/compress-pdf', label: 'Compress PDF', desc: 'Reduce a PDF structurally without rasterizing its text.', group: 'Convert' },
  { href: '/image-to-text', label: 'Image to Text', desc: 'Recover usable words from photographs and scans.', group: 'Extract' },
  { href: '/bijoy-converter', label: 'Bijoy to Unicode', desc: 'Bring legacy Bangla text into a modern, searchable script.', group: 'Extract' },
  { href: '/pdf-editor', label: 'PDF Editor', desc: 'Work on the document itself, then preview your export.', group: 'Edit' },
  { href: '/image-editor', label: 'Image Editor', desc: 'Crop, resize, and compress on a focused editing canvas.', group: 'Edit' },
  { href: '/ai-analyzer', label: 'AI Analyzer', desc: 'Find summaries, answers, and useful threads in a document.', group: 'Ask AI' },
  { href: '/document-ai', label: 'Document AI', desc: 'A reading space for questions, with your document beside you.', group: 'Ask AI' },
  { href: '/batch-process', label: 'Batch Process', desc: 'Repeat a useful workflow across a collection of files.', group: 'Advanced' },
  { href: '/fasta-tools', label: 'FASTA Tools', desc: 'Inspect and work with biological sequences.', group: 'Advanced' },
]

const groups: ToolFilter[] = ['All', 'Convert', 'Extract', 'Edit', 'Ask AI', 'Advanced']

const chapters: {
  id: ChapterId
  label: string
  group: ToolGroup
  input: string
  output: string
  title: string
  desc: string
}[] = [
  { id: 'convert', label: 'Convert', group: 'Convert', input: 'PDF', output: 'DOCX', title: 'A new format. The same idea.', desc: 'Because the format you receive is not always the one you need.' },
  { id: 'extract', label: 'Extract', group: 'Extract', input: 'SCAN', output: 'TEXT', title: 'Words, no longer trapped.', desc: 'Bring the writing inside an image back into the work you can do.' },
  { id: 'edit', label: 'Edit', group: 'Edit', input: 'DRAFT', output: 'REVISED', title: 'Small changes. A better document.', desc: 'A page turned, a detail corrected, an image made ready to share.' },
  { id: 'understand', label: 'Ask AI', group: 'Ask AI', input: 'PAGES', output: 'IDEAS', title: 'Find the thread in the pages.', desc: 'Read with questions. Make room for the parts that matter.' },
]

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {diagonal ? <path d="M6 18 18 6M6 6h12v12" /> : <path d="M4 12h16m-6-6 6 6-6 6" />}
    </svg>
  )
}

function DocumentFolio({ onExplore }: { onExplore: (group: ToolGroup) => void }) {
  const [active, setActive] = useState<ChapterId>('convert')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeIndex = chapters.findIndex((chapter) => chapter.id === active)
  const chapter = chapters[activeIndex]

  const moveTab = (event: KeyboardEvent<HTMLButtonElement>) => {
    let next = activeIndex
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % chapters.length
    else if (event.key === 'ArrowLeft') next = (activeIndex - 1 + chapters.length) % chapters.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = chapters.length - 1
    else return
    event.preventDefault()
    setActive(chapters[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className={styles.folio}>
      <div className={styles.folioHeading}>
        <span className={styles.folioLabel}>The living folio</span>
        <span className={styles.exhibitLabel}>An interactive exhibit</span>
      </div>

      <div className={styles.folioTabs} role="tablist" aria-label="What could your document become?">
        {chapters.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => { tabRefs.current[index] = node }}
            id={`folio-tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={active === item.id}
            aria-controls="folio-panel"
            tabIndex={active === item.id ? 0 : -1}
            onClick={() => setActive(item.id)}
            onFocus={() => setActive(item.id)}
            onKeyDown={moveTab}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id="folio-panel" className={styles.folioPanel} role="tabpanel" aria-labelledby={`folio-tab-${active}`} tabIndex={0}>
        <div className={styles.folioScene} data-mode={active} aria-hidden="true">
          <span className={styles.sceneCross} />
          <div className={styles.sourceLabel}><span>From</span><strong>{chapter.input}</strong></div>
          <div className={styles.sheetStack}>
            <div className={styles.sheetBack} />
            <div className={styles.sheetMiddle} />
            <div className={styles.specimen} key={active}>
              <div className={styles.specimenTop}><span>mycloove / field notes</span><span>01</span></div>
              <div className={styles.specimenTitle}>The next<br />chapter.</div>
              <div className={styles.specimenRule} />
              {active === 'understand' ? (
                <div className={styles.sampleInsight}>
                  <span className={styles.sampleKicker}>A question worth asking</span>
                  <p>What can this document become?</p>
                  <div className={styles.insightThread}><span /><span /><span /></div>
                  <span className={styles.insightCaption}>Read. Connect. Understand.</span>
                </div>
              ) : (
                <div className={styles.sampleWriting}>
                  <p>Good ideas deserve<br />a useful {active === 'edit' ? <><s>file.</s> <mark>form.</mark></> : 'form.'}</p>
                  <p>Something you can edit.<br />Something you can share.</p>
                  <div className={styles.sampleLines}><span /><span /><span /></div>
                  {active === 'extract' && <span className={styles.extractionMark}>Text, recovered</span>}
                  {active === 'edit' && <span className={styles.editMark}>A considered revision <span /></span>}
                </div>
              )}
              <div className={styles.specimenBottom}><span>Keep the idea moving.</span><span className={styles.pageClasp}><i /><i /></span></div>
            </div>
          </div>
          <div className={styles.resultLabel}><span>To</span><strong>{chapter.output}</strong><Arrow /></div>
        </div>

        <div className={styles.folioReadout}>
          <div className={styles.readoutCopy}>
            <h3>{chapter.title}</h3>
            <p>{chapter.desc}</p>
          </div>
          <a href="#tool-library" className={styles.explorePath} onClick={() => onExplore(chapter.group)}>
            Explore {chapter.label === 'Ask AI' ? 'AI tools' : chapter.label.toLowerCase() + ' tools'}<Arrow />
          </a>
        </div>
      </div>
      <p className={styles.exhibitNote}>Illustrative preview. No file is processed here.</p>
    </div>
  )
}

export default function AboutUsClient({ fontClass = '' }: { fontClass?: string }) {
  const { enabled, status } = useToolAvailability()
  const [filter, setFilter] = useState<ToolFilter>('All')
  const openTools = tools.filter((tool) => {
    const toolId = toolIdForHref(tool.href)
    return !toolId || enabled(toolId)
  })
  const shownTools = openTools.filter((tool) => filter === 'All' || tool.group === filter)

  const handleSectionLink = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null
    if (!link) return
    const target = event.currentTarget.querySelector<HTMLElement>(link.hash)
    if (!target) return
    event.preventDefault()
    if (window.location.hash !== link.hash) window.history.pushState(null, '', link.hash)
    // The root has smooth scrolling; honor reduced motion locally, without
    // changing the shared root rule or stealing focus from another route.
    target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    target.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true })
  }

  return (
    <div className="home-page">
      <Topbar2 openFileHref="/#heroFile" />

      <main id="main-content" className={`${styles.page} ${fontClass}`} onClick={handleSectionLink}>
        <div className={styles.shell}>
          <div className={styles.pageMasthead}>
            <p>The mycloove story <span lang="bn">/ আমাদের কথা</span></p>
            <span>Made for what comes next</span>
          </div>

          <section className={styles.hero} aria-labelledby="about-title">
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}><span />Documents, with possibility.</p>
              <h1 id="about-title" className={styles.title}>A file is only<br />the <span>beginning.</span></h1>
              <p className={styles.lede}>The report you need to edit. The scan you need to read. The idea you need to share.</p>
              <p className={styles.heroDescription}>mycloove gives your documents a useful next chapter. Thoughtful tools for the work on the other side of the file.</p>
              <div className={styles.heroActions}>
                <a href="#tool-library" className={styles.buttonPrimary} onClick={() => setFilter('All')}>Explore our tools<Arrow /></a>
                <a href="#our-story" className={styles.textLink}>Why we build<Arrow diagonal /></a>
              </div>
              <div className={styles.heroFootnote}><span>PDFs / Images / Words / Ideas</span><span className={styles.footnoteRule} /></div>
            </div>
            <DocumentFolio onExplore={setFilter} />
          </section>

          <nav className={styles.chapterNav} aria-label="About page sections">
            <span>Inside the story</span>
            <a href="#our-story">The perspective</a>
            <a href="#our-identity">The identity</a>
            <a href="#tool-library">The instruments</a>
            <a href="#our-standards">The care</a>
          </nav>

          <section id="our-story" className={styles.story} aria-labelledby="story-title">
            <div className={styles.sectionRail}><span className={styles.sectionLabel}>Our perspective</span><span className={styles.railRule} /></div>
            <div className={styles.storyGrid}>
              <h2 id="story-title" className={styles.storyTitle} tabIndex={-1}>The important part<br />isn&apos;t the file.<br /><span>It&apos;s what you do with it.</span></h2>
              <div className={styles.storyBody}>
                <p>A document often arrives in the wrong form: an uneditable PDF, words trapped in a photograph, a file that needs one small change before you can send it.</p>
                <p>We build for that moment. A focused place to convert, recover, refine, and understand the material already in your hands.</p>
                <div className={styles.storyNote}><span className={styles.noteClasp} aria-hidden="true"><i /><i /></span><p>Less time working around the file.<br /><strong>More time working on what matters.</strong></p></div>
              </div>
            </div>
          </section>

          <section id="our-identity" className={styles.identity} aria-labelledby="identity-title">
            <div className={styles.identityBrand}>
              <span className={styles.sectionLabel}>A name with a point of view</span>
              <MyclooveWordmark size="xl" className={styles.identityWordmark} />
              <div className={styles.nameDefinitions}><p><strong>clove</strong><span>A small beginning.</span></p><p><strong>cleave</strong><span>To join. To part.</span></p></div>
            </div>
            <div className={styles.identityCopy}>
              <h2 id="identity-title" tabIndex={-1}>Small name.<br />Open possibilities.</h2>
              <p>A small bud. A word that means both joining and parting. Our name holds the same possibilities as a document: bring pages together, take them apart, let something new emerge.</p>
              <p>The two O&apos;s form a clasp in our wordmark. Two small shapes, held together. A quiet signature for a collection of tools built with the same care.</p>
            </div>
          </section>

          <section id="tool-library" className={styles.library} aria-labelledby="library-title">
            <div className={styles.sectionRail}><span className={styles.sectionLabel}>The instruments</span><span className={styles.railRule} /></div>
            <div className={styles.sectionHeading}>
              <h2 id="library-title" tabIndex={-1}>Different jobs.<br /><span>The same attention to detail.</span></h2>
              <p>Not one tool stretched to do everything. A considered collection, each with a clear job to do.</p>
            </div>

            <div className={styles.libraryToolbar}>
              <div className={styles.filters} role="group" aria-label="Filter tools by purpose">
                {groups.map((group) => (
                  <button key={group} type="button" aria-pressed={filter === group} onClick={() => setFilter(group)}>
                    {group === 'All' ? 'All tools' : group}
                  </button>
                ))}
              </div>
              <p className={styles.libraryStatus} role="status">
                {status === 'loading' ? 'Checking availability...' : status === 'error' ? 'Availability not verified' : `${shownTools.length} ${shownTools.length === 1 ? 'tool' : 'tools'} in view`}
              </p>
            </div>
            {status === 'error' && <p className={styles.availabilityNote}>The collection is shown below. Each tool confirms its current availability when you open it.</p>}

            {shownTools.length ? (
              <ul className={styles.toolList}>
                {shownTools.map((tool) => (
                  <li key={tool.href}>
                    <Link href={tool.href} prefetch={false} className={styles.toolLink}>
                      <span className={styles.toolNumber} aria-hidden="true">{String(tools.indexOf(tool) + 1).padStart(2, '0')}</span>
                      <span className={styles.toolCopy}><span className={styles.toolCategory}>{tool.group}</span><span className={styles.toolTitle}>{tool.label}</span><span className={styles.toolDescription}>{tool.desc}</span></span>
                      <span className={styles.toolArrow}><Arrow diagonal /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.emptyTools}><h3>No tools are currently available{filter !== 'All' ? ` in ${filter.toLowerCase()}` : ''}.</h3><p>Choose another category or <Link href="/contact-us">contact us</Link> for help.</p></div>
            )}
          </section>

          <section id="our-standards" className={styles.standards} aria-labelledby="standards-title">
            <div className={styles.standardsIntro}>
              <span className={styles.sectionLabel}>The care behind the tools</span>
              <h2 id="standards-title" tabIndex={-1}>Care is a way<br />of working.</h2>
              <p>The small decisions are the product.<br />These are the ones we come back to.</p>
              <div className={styles.languageNote}><span lang="bn">আপনার কাজ। আপনার ভাষা।</span><span>Your work. Your language.</span></div>
            </div>
            <div className={styles.principles}>
              <details open>
                <summary><h3>Useful before impressive.</h3><span className={styles.disclosure} aria-hidden="true" /></summary>
                <div className={styles.principleBody}><p>A clear job, a considered workspace, a useful result. We would rather remove a distraction than add another feature you have to work around.</p></div>
              </details>
              <details>
                <summary><h3>Bangla belongs from the beginning.</h3><span className={styles.disclosure} aria-hidden="true" /></summary>
                <div className={styles.principleBody}><p>Dedicated Bijoy-to-Unicode conversion and Bangla font support are part of the collection. Working in your language should not mean working around your tools.</p></div>
              </details>
              <details>
                <summary><h3>Clear limits. No hidden finish line.</h3><span className={styles.disclosure} aria-hidden="true" /></summary>
                <div className={styles.principleBody}><p>Tools are free within the current fair-use allowance. The active limits belong in the workspace, not in a surprise at the end.</p><Link href="/pricing" className={styles.inlineLink}>How the allowance works<Arrow /></Link></div>
              </details>
              <details>
                <summary><h3>Your files deserve a clear explanation.</h3><span className={styles.disclosure} aria-hidden="true" /></summary>
                <div className={styles.principleBody}><p>Different features handle files differently. Our privacy policy explains document processing, retention, and account information so you can choose an appropriate workflow.</p><Link href="/privacy" className={styles.inlineLink}>Read our privacy policy<Arrow /></Link></div>
              </details>
              <details>
                <summary><h3>No account to begin.</h3><span className={styles.disclosure} aria-hidden="true" /></summary>
                <div className={styles.principleBody}><p>Start with core tools as a guest. Sign in when you need account features or connected publishing. No card is required to get started.</p></div>
              </details>
            </div>
          </section>

          <section className={styles.closing} aria-labelledby="closing-title">
            <div><span className={styles.sectionLabel}>Still being written</span><h2 id="closing-title">Your work shapes<br />our next chapter.</h2></div>
            <div className={styles.closingBody}><p>A missing tool. A difficult document. A small detail that could be better. Tell us what would make your work easier.</p><Link href="/contact-us" className={styles.buttonPrimary}>Talk to mycloove<Arrow diagonal /></Link></div>
          </section>
        </div>
      </main>

      <HomeFooter />
    </div>
  )
}
