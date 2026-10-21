type EditableElementLike = Pick<HTMLElement, 'tagName' | 'isContentEditable'> & {
  closest?: (selector: string) => Element | null;
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
