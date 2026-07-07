export const NEW_CHAT_SHORTCUT_LABEL = "Cmd+Opt+N";
export const NEW_CHAT_SHORTCUT_KEYS = ["⌘", "⌥", "N"] as const;

type NewChatShortcutEvent = {
  key: string;
  code?: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
};

function isNKey(event: NewChatShortcutEvent): boolean {
  return event.key.toLowerCase() === "n" || event.code === "KeyN";
}

export function isNewChatShortcut(event: NewChatShortcutEvent): boolean {
  return (
    isNKey(event) &&
    Boolean(event.metaKey || event.ctrlKey) &&
    Boolean(event.altKey) &&
    !event.shiftKey
  );
}
