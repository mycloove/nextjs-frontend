'use client'

import type { Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import styles from './MrResumeStudio.module.css'
import { Glyph } from './MrResumeStudioControls'

type SectionItem = { id: string; title: string; detail: string; group: 'Core' | 'Additional' }

type ResumeSectionPanelProps = {
  active: string
  enabled: string[]
  dragging: { id: string } | null
  content: Record<string, string>
  title: (id: string) => string
  t: (value: string) => string
  selectSection: (id: string, focus?: boolean) => void
  dropMarker: (id: string) => ReactNode
  dragHandle: (id: string, onCanvas?: boolean) => ReactNode
  addRef: RefObject<HTMLButtonElement | null>
  libraryOpen: boolean
  setLibraryOpen: Dispatch<SetStateAction<boolean>>
  catalog: SectionItem[]
  addSection: (id: string) => void
  addCustomSection: () => void
  startFresh: () => void
  confirmFresh: boolean
  /** Document-wide starting structures; the outline above arranges within one. */
  templateLibrary: ReactNode
}

export default function ResumeSectionPanel({
  active, enabled, dragging, content, title, selectSection, dropMarker, dragHandle,
  t, addRef, libraryOpen, setLibraryOpen, catalog, addSection, addCustomSection, startFresh, confirmFresh, templateLibrary,
}: ResumeSectionPanelProps) {
  return (
    <aside className={styles.leftPanel} aria-label={t('Resume sections')}>
      <div className={styles.panelHeading}><div className={styles.panelHeadingTopline}><span className={styles.eyebrow}>{t('YOUR OUTLINE')}</span><p>{t('Arrange your story')}</p></div><div className={styles.headingRow}><h1>{t('Document sections')}</h1><span className={styles.count}>{enabled.length - 1}</span></div></div>
      <div className={styles.outlineScroll} data-sort-scroll="outline">
        <div className={`${styles.profileRow} ${active === 'profile' ? styles.outlineActive : ''}`}><span className={styles.lockIcon}><Glyph name="lock" /></span><button type="button" className={styles.outlineSelect} onClick={() => selectSection('profile', true)} aria-pressed={active === 'profile'}><b>{title('profile')}</b><small>{t('Document header, fixed at top')}</small></button></div>
        <div className={styles.outlineLabel}><span>{t('READING ORDER')}</span><span>{t('Drag to arrange')}</span></div>
        <ol className={styles.outlineList} aria-label={t('Section order')}>
          {enabled.filter((id) => id !== 'profile').map((id, index) => <li key={id} className={`${styles.outlineRow} ${active === id ? styles.outlineActive : ''} ${dragging?.id === id ? styles.dragOrigin : ''}`} data-sort-id={id} data-outline-section={id} data-flip-key={`outline:${id}`}>
            {dropMarker(id)}{dragHandle(id)}
            <button type="button" className={styles.outlineSelect} onClick={() => selectSection(id, true)} aria-pressed={active === id}><span className={styles.outlineNumber}>{String(index + 1).padStart(2, '0')}</span><span><b>{title(id) || t('Untitled section')}</b><small>{active === id ? t('Selected for editing') : content[id].trim() ? t('Content added') : t('Ready to write')}</small></span><Glyph name="chevron" /></button>
          </li>)}
        </ol>
        <p id="reorder-instructions" className={styles.srOnly}>{t('Drag a handle to move a section before or after another. With a handle focused, use Arrow Up or Arrow Down. Escape cancels a drag.')}</p>
        <button ref={addRef} type="button" className={styles.addSection} aria-expanded={libraryOpen} aria-controls="section-library" onClick={() => setLibraryOpen((value) => !value)}><Glyph name="plus" />{t('Add section')}</button>
        {libraryOpen && <div id="section-library" className={styles.sectionLibrary} role="region" aria-label={t('Section library')} onKeyDown={(event) => { if (event.key === 'Escape') { setLibraryOpen(false); addRef.current?.focus() } }}>
          <div className={styles.libraryHeading}><h2>{t('Add to your document')}</h2><button type="button" className={styles.iconButton} aria-label={t('Close section library')} onClick={() => { setLibraryOpen(false); addRef.current?.focus() }}><Glyph name="close" /></button></div>
          {(['Core', 'Additional'] as const).map((group) => {
            const available = catalog.filter((section) => section.group === group && !enabled.includes(section.id))
            return available.length > 0 && <div className={styles.libraryGroup} key={group}><h3>{t(`${group} sections`)}</h3>{available.map((section) => <button type="button" key={section.id} className={styles.libraryItem} onClick={() => addSection(section.id)} aria-label={`${t('Add')} ${title(section.id) || t('Untitled section')}`}><span><b>{title(section.id) || t('Untitled section')}</b><small>{t(section.detail)}</small></span><Glyph name="plus" /></button>)}</div>
          })}
          <button type="button" className={styles.customSection} onClick={addCustomSection}><Glyph name="edit" /><span><b>{t('Custom section')}</b><small>{t('Any heading. Your own content.')}</small></span><Glyph name="plus" /></button>
        </div>}
        {templateLibrary}
        <div className={styles.outlineHint}><Glyph name="grip" /><p>{t('Drag a handle, or use the move controls in the section editor.')}</p></div>
      </div>
      <div className={styles.leftFoot}><Glyph name="lock" /><p><b>{t('Sample content.')}</b><span>{t('Replace it with your own.')}</span></p><button type="button" className={styles.freshDraft} onClick={startFresh} title={confirmFresh ? t('Clears the saved draft and resets the document') : t('Clear this draft and start over')}>{confirmFresh ? t('Clear draft?') : t('Start fresh')}</button></div>
    </aside>
  )
}
