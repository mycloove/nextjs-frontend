'use client'

import { useEffect } from 'react'

/**
 * Clipboard-paste support for file tools.
 *
 * Users copy images straight from screenshots, chat apps and browsers and
 * expect Ctrl+V to land the file on the tool — a dropzone alone misses them.
 * The listener is window-level but deliberately skips pastes targeting text
 * inputs, so a user pasting text into any field never triggers an upload.
 */
export function usePasteFiles(onFiles: (files: File[]) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const isTextTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false
      if (target.isContentEditable) return true
      const tag = target.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    }

    const handlePaste = (event: ClipboardEvent) => {
      if (isTextTarget(event.target)) return
      const files = Array.from(event.clipboardData?.files ?? [])
      if (!files.length) return
      event.preventDefault()
      onFiles(files)
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onFiles, enabled])
}
