import { useCallback, useEffect, useRef, useState } from "react";
import { isEditableTarget, isModalShortcutContext, nextListIndex } from "../../lib/keyboard-nav-core.ts";

type UseBrokerLedgerKeyboardInput = {
  enabled: boolean;
  rowCount: number;
  onActivateRow: (index: number) => void;
  onClearSelection?: () => void;
};

export function useBrokerLedgerKeyboard({
  enabled,
  rowCount,
  onActivateRow,
  onClearSelection,
}: UseBrokerLedgerKeyboardInput) {
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const rowRefs = useRef<Map<number, HTMLElement>>(new Map());

  useEffect(() => {
    if (focusedIndex < 0 || focusedIndex >= rowCount) return;
    const node = rowRefs.current.get(focusedIndex);
    node?.scrollIntoView({ block: "nearest" });
    node?.focus();
  }, [focusedIndex, rowCount]);

  useEffect(() => {
    if (focusedIndex >= rowCount) {
      setFocusedIndex(rowCount > 0 ? rowCount - 1 : -1);
    }
  }, [focusedIndex, rowCount]);

  const registerRowRef = useCallback((index: number, node: HTMLElement | null) => {
    if (node) rowRefs.current.set(index, node);
    else rowRefs.current.delete(index);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onKey = (event: KeyboardEvent) => {
      if (!document.querySelector(".sys-broker-page")) return;
      if (isEditableTarget(event.target) || isModalShortcutContext()) return;
      if (rowCount === 0) return;

      if (event.key === "Escape") {
        if (onClearSelection) {
          event.preventDefault();
          onClearSelection();
          setFocusedIndex(-1);
        }
        return;
      }

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        setFocusedIndex((current) => nextListIndex(current, rowCount, 1));
        return;
      }
      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setFocusedIndex((current) => nextListIndex(current, rowCount, -1));
        return;
      }
      if (event.key === "Home" || (event.key === "g" && !event.shiftKey)) {
        event.preventDefault();
        setFocusedIndex(0);
        return;
      }
      if (event.key === "End" || event.key === "G") {
        event.preventDefault();
        setFocusedIndex(rowCount - 1);
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        const index = focusedIndex < 0 ? 0 : focusedIndex;
        event.preventDefault();
        setFocusedIndex(index);
        onActivateRow(index);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, focusedIndex, onActivateRow, onClearSelection, rowCount]);

  const getRowFocusProps = useCallback((index: number) => ({
    tabIndex: focusedIndex === index ? 0 as const : -1 as const,
    ref: (node: HTMLElement | null) => registerRowRef(index, node),
    onFocus: () => setFocusedIndex(index),
  }), [focusedIndex, registerRowRef]);

  return { focusedIndex, setFocusedIndex, getRowFocusProps };
}