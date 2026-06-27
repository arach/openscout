export type ComposeShortcutEvent = {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  nativeEvent?: {
    isComposing?: boolean;
  };
};

export function isComposerSendShortcut(event: ComposeShortcutEvent): boolean {
  return (
    event.key === "Enter" &&
    Boolean(event.metaKey || event.ctrlKey) &&
    !event.nativeEvent?.isComposing
  );
}
