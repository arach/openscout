export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return el instanceof HTMLInputElement
    || el instanceof HTMLTextAreaElement
    || el instanceof HTMLSelectElement
    || (el?.isContentEditable ?? false);
}

/** Skip global/list shortcuts while typing or a modal owns focus. */
export function isModalShortcutContext(): boolean {
  return Boolean(
    document.querySelector(".kb-help-backdrop")
    || document.querySelector("[data-command-palette-open='true']")
    || document.querySelector("[role='dialog'][aria-modal='true']"),
  );
}

export function nextListIndex(current: number, length: number, delta: number): number {
  if (length <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return Math.max(0, Math.min(length - 1, current + delta));
}