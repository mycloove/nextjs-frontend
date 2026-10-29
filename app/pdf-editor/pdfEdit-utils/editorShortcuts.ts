type EditableElementLike = Pick<HTMLElement, 'tagName' | 'isContentEditable'> & {
  closest?: (selector: string) => Element | null;
  getAttribute?: (name: string) => string | null;
};

export function isEditableShortcutTarget(target: EventTarget | null) {
  if (!target || typeof target !== 'object' || !('tagName' in target)) return false;
  const element = target as unknown as EditableElementLike;
  const tagName = element.tagName.toUpperCase();
  return tagName === 'INPUT'
    || tagName === 'TEXTAREA'
    || tagName === 'SELECT'
    || element.isContentEditable
    || Boolean(element.closest?.('[contenteditable="true"], [role="textbox"]'));
}

export function isDeleteShortcut(event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>) {
  return (event.key === 'Delete' || event.key === 'Backspace')
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey;
}

/** Resolve once, so an object arrow cannot also navigate the document. */
export function resolvePdfEditorShortcut(
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'defaultPrevented' | 'isComposing' | 'target'>,
  context: { modalOpen: boolean; fabricTextEditing: boolean; hasObjectSelection: boolean },
) {
  if (event.defaultPrevented || event.isComposing) return null;
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  const target = event.target as unknown as EditableElementLike | null;
  if (context.modalOpen) {
    const tag = target?.tagName?.toUpperCase();
    const type = target?.getAttribute?.('type')?.toLowerCase() ?? 'text';
    const editsInModal = !!target?.closest?.('[aria-modal="true"]')
      && (target.isContentEditable || tag === 'TEXTAREA'
        || (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'hidden'].includes(type)));
    // Mobile Chromium can apply native Undo to the last textarea even when a
    // modal button now has focus. Do not let it mutate the obscured document.
    return !editsInModal && ((!event.altKey && modifier && ['z', 'y'].includes(key)) || isDeleteShortcut(event)) ? 'suppress' : null;
  }
  if (context.fabricTextEditing || isEditableShortcutTarget(event.target)) return null;
  if (event.altKey) return null;
  if (modifier) {
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    const commands = {
      y: 'redo', c: 'copy', v: 'paste', k: 'commands', f: 'search', s: 'export',
      '+': 'zoom-in', '=': 'zoom-in', '-': 'zoom-out',
    } as const;
    return commands[key as keyof typeof commands] ?? null;
  }
  if (key === 'escape') return 'escape';
  if (target && (['BUTTON', 'A', 'SUMMARY'].includes(target.tagName?.toUpperCase())
    || target.closest?.('button, a[href], summary, [role="tab"], [role="slider"], [role="separator"], [role="spinbutton"], [role="menuitem"]'))) return null;
  if (key === '?') return 'help';
  if (isDeleteShortcut(event)) return 'delete';
  if (context.hasObjectSelection) {
    const nudges = { arrowleft: 'nudge-left', arrowright: 'nudge-right', arrowup: 'nudge-up', arrowdown: 'nudge-down' } as const;
    if (key in nudges) return nudges[key as keyof typeof nudges];
  }
  const navigation = {
    arrowleft: 'page-prev', arrowright: 'page-next', home: 'page-first', end: 'page-last',
    '1': 'fit-page', '2': 'fit-width', '3': 'actual-size',
  } as const;
  return navigation[key as keyof typeof navigation] ?? null;
}
