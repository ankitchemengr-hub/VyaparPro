import type { KeyboardEvent } from "react";

// Spread onto a non-button element (a Card, a table row, a dropzone) that has
// an onClick, so the keyboard can reach and fire it too: Tab to focus, then
// Enter or Space to activate. Without this, `<div onClick>` is mouse-only.
//
//   <Card {...clickableProps(() => setOpen(v => !v))} aria-expanded={open}>
export function clickableProps(onActivate: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      // Only when the focused element itself is the trigger — never on a
      // keypress that bubbled up from a nested button / tab / input.
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
