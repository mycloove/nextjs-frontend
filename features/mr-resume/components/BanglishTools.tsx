'use client'

import { useId, useState, useSyncExternalStore } from 'react'
import { convertWord } from './banglish'
import { isValidSpellingChoice, type SpellingChoice } from './banglishLearn'
import { Glyph } from './MrResumeStudioControls'
import styles from './MrResumeStudio.module.css'

const GUIDE_KEY = 'mr-resume:banglish-guide:v1'
const ONBOARDING_KEY = 'mr-resume:banglish-onboarding:v1'
function subscribePreferences(listener: () => void) {
  const changed = (event: StorageEvent) => { if (event.key === GUIDE_KEY || event.key === ONBOARDING_KEY || event.key === null) listener() }
  window.addEventListener('storage', changed)
  return () => window.removeEventListener('storage', changed)
}
function preferenceSnapshot() {
  try { return `${window.localStorage.getItem(GUIDE_KEY) === 'open' ? 'open' : 'closed'}|${window.localStorage.getItem(ONBOARDING_KEY) === 'seen' ? 'seen' : 'new'}` }
  catch { return 'closed|new' }
}
const serverPreferences = () => null
const typingExamples = [
  ['T / Th', '\u099f / \u09a0'], ['D / Dh', '\u09a1 / \u09a2'], ['N', '\u09a3'],
  ['Sh', '\u09b7'], ['R / Rh', '\u09a1\u09bc / \u09a2\u09bc'], ['rri', '\u098b'],
  ['ng', '\u0982'], ['^', '\u0981'], [',,', '\u09cd'],
]

export default function BanglishTools({ enabled, phonetic, onPhoneticChange, learned, choices, onLearn, onForget, onClear, onExport, t }: {
  enabled: boolean
  phonetic: boolean
  onPhoneticChange: (value: boolean) => void
  learned: Readonly<Record<string, string>>
  choices: SpellingChoice[]
  onLearn: (source: string, reading: string) => void
  onForget: (source: string) => void
  onClear: () => void
  onExport: () => void
  t: (value: string) => string
}) {
  const preferences = useSyncExternalStore(subscribePreferences, preferenceSnapshot, serverPreferences)
  const [openOverride, setOpen] = useState<boolean | null>(null)
  const [seenOverride, setSeen] = useState<boolean | null>(null)
  const ready = preferences !== null
  const open = openOverride ?? preferences?.startsWith('open') ?? false
  const seen = seenOverride ?? preferences?.endsWith('seen') ?? true
  const [demo, setDemo] = useState('dhaka unibersity')
  const [source, setSource] = useState('')
  const [reading, setReading] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [search, setSearch] = useState('')
  const id = `banglish-guide-${useId()}`

  function finishDemo() {
    setSeen(true)
    try { window.localStorage.setItem(ONBOARDING_KEY, 'seen') } catch { /* Optional preference only. */ }
  }

  function toggleGuide() {
    const next = !open
    setOpen(next)
    try { window.localStorage.setItem(GUIDE_KEY, next ? 'open' : 'closed') } catch { /* Optional preference only. */ }
  }

  if (!enabled) return null
  const demoOutput = demo.split(/(\s+)/u).map((word) => convertWord(word, { learned, force: phonetic }) ?? word).join('')
  const validCorrection = isValidSpellingChoice(source.trim(), reading.trim())
  const query = search.trim().toLowerCase().normalize('NFC')
  const matchingChoices = choices.filter((choice) => choice.source.includes(query) || choice.reading.normalize('NFC').includes(query))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)).slice(0, 50)

  return <section className={styles.typingTools} aria-label={t('Banglish typing tools')}>
    <div className={styles.typingModeSettings}>
      <span className={styles.contentLabel}>{t('Typing style')}</span>
      <div className={styles.segmented} role="group" aria-label={t('Typing style')}>
        <button type="button" className={!phonetic ? styles.segmentActive : ''} aria-pressed={!phonetic} onClick={() => onPhoneticChange(false)}>{t('Smart')}</button>
        <button type="button" className={phonetic ? styles.segmentActive : ''} aria-pressed={phonetic} onClick={() => onPhoneticChange(true)}>{t('Phonetic')}</button>
      </div>
      <p className={styles.helperText}>{t(phonetic ? 'Phonetic mode follows letter keys exactly, including T, Sh and R. Emails, links and numbers stay untouched.' : 'Smart mode uses your spellings and resume vocabulary, keeping common English terms unchanged.')}</p>
    </div>
    {ready && !seen && <div className={styles.typingDemo}>
      <div className={styles.typingDemoHeading}><h3>{t('Write Banglish. See Bangla.')}</h3><button type="button" className={styles.iconButton} aria-label={t('Dismiss typing demo')} onClick={finishDemo}><Glyph name="close" /></button></div>
      <label htmlFor={`${id}-demo`} className={styles.contentLabel}>{t('Try it here, without changing your resume')}</label>
      <input id={`${id}-demo`} className={styles.textInput} value={demo} maxLength={100} autoCapitalize="off" spellCheck={false} onChange={(event) => setDemo(event.target.value)} />
      <output className={styles.typingDemoOutput} htmlFor={`${id}-demo`} lang="bn">{demoOutput}</output>
      <p>{t('This is a practice suggestion. In your resume, Space completes a word. Your own spelling always has the final say.')}</p>
      <button type="button" className={styles.guideLink} onClick={finishDemo}>{t('Continue writing')}</button>
    </div>}
    <div className={styles.typingToolsHeading}><button type="button" className={styles.guideLink} aria-expanded={open} aria-controls={id} onClick={toggleGuide}><Glyph name="type" />{t('Typing guide')}</button><span>{Object.keys(learned).length} {t('remembered spellings')}</span></div>
    {open && <div id={id} className={styles.typingGuide}>
      <p>{t('Use phonetic capitals for precise letters. Familiar names use the name bank; suggestions let you choose another spelling.')}</p>
      <dl className={styles.typingExamples}>{typingExamples.map(([latin, bangla]) => <div key={latin}><dt><kbd>{latin}</kbd></dt><dd lang="bn">{bangla}</dd></div>)}</dl>
      <p>{t('Space completes a word. Arrows and Enter choose a reading. Alt+1–3 selects directly; plain digits stay digits. Backspace restores Banglish. Ctrl+Alt+B toggles typing.')}</p>
      <form className={styles.spellingFeedback} onSubmit={(event) => {
        event.preventDefault()
        if (!validCorrection) return
        onLearn(source.trim(), reading.trim())
        setSource('')
        setReading('')
      }}>
        <h3>{t('Teach your preferred spelling')}</h3>
        <label htmlFor={`${id}-source`}>{t('Banglish spelling')}</label><input id={`${id}-source`} className={styles.textInput} value={source} maxLength={40} autoCapitalize="off" spellCheck={false} onChange={(event) => setSource(event.target.value)} placeholder="rahman" />
        <label htmlFor={`${id}-reading`}>{t('Correct Bengali spelling')}</label><input id={`${id}-reading`} className={styles.textInput} lang="bn" value={reading} maxLength={80} spellCheck={false} onChange={(event) => setReading(event.target.value)} placeholder={'\u09b0\u09b9\u09ae\u09be\u09a8'} />
        <button type="submit" className={styles.bijoyConvert} disabled={!validCorrection}>{t('Save spelling')}</button>
      </form>
      {choices.length > 0 && <div className={styles.spellingChoices}><h3>{t('Frequent spelling choices')}</h3>
        <label className={styles.spellingSearch} htmlFor={`${id}-search`}>{t('Search remembered spellings')}<input id={`${id}-search`} type="search" className={styles.textInput} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        {matchingChoices.map((choice) => <div key={choice.source}><code>{choice.source}</code><span lang="bn">{choice.reading}</span><small>{choice.count} {t('choices')}</small><button type="button" className={styles.guideLink} aria-label={`${t('Forget spelling')}: ${choice.source}`} onClick={() => onForget(choice.source)}>{t('Forget spelling')}</button></div>)}
        {!matchingChoices.length && <p>{t('No matching spellings.')}</p>}
      </div>}
      <p>{t('Banglish conversion and spelling choices stay on this device. Spellings may contain personal names; export only if you want to share them.')}</p>
      <div className={styles.spellingActions}><button type="button" className={styles.guideLink} onClick={onExport} disabled={!Object.keys(learned).length}>{t('Export spelling choices')}</button><button type="button" className={styles.guideLink} onClick={() => {
        if (!confirmClear) { setConfirmClear(true); return }
        onClear()
        setConfirmClear(false)
      }} disabled={!Object.keys(learned).length}>{t(confirmClear ? 'Confirm clear spellings' : 'Clear spellings')}</button></div>
      <p className={styles.helperText}>{t('Clearing spellings does not delete your draft.')}</p>
    </div>}
  </section>
}
