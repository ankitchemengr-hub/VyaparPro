import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/use-auth";
import { NAV_SHORTCUTS } from "./shortcuts";

interface Options {
  onTogglePalette: () => void;
  onOpenHelp: () => void;
}

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

// One window-level keydown listener for the app-wide shortcuts. Mounted once
// from AppLayout. Modifier combos (Ctrl+K, Alt+<key>) fire even while a field
// is focused; the bare "?" help key does not.
export function useGlobalShortcuts({ onTogglePalette, onOpenHelp }: Options) {
  const [, setLocation] = useLocation();
  const { hasRole } = useAuth();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onTogglePalette();
        return;
      }

      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        onOpenHelp();
        return;
      }

      if (e.key === "F1" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        const billing = NAV_SHORTCUTS.find((s) => s.path === "/billing");
        if (billing && (!billing.roles || hasRole(billing.roles as any))) {
          e.preventDefault();
          setLocation("/billing");
        }
        return;
      }

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        const match = NAV_SHORTCUTS.find((s) => s.code === e.code);
        if (match && (!match.roles || hasRole(match.roles as any))) {
          e.preventDefault();
          setLocation(match.path);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onTogglePalette, onOpenHelp, setLocation, hasRole]);
}
