import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SHORTCUTS, type ShortcutGroup } from "@/lib/keyboard/shortcuts";

const GROUP_ORDER: ShortcutGroup[] = ["Global", "Navigation", "Billing"];

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Press <kbd className="rounded border px-1 font-mono text-[11px]">?</kbd> any time to reopen this.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {GROUP_ORDER.map((group) => (
            <div key={group}>
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              <div className="space-y-1">
                {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                  <div key={s.label} className="flex items-center justify-between gap-4 text-sm">
                    <span>{s.label}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k, i) => (
                        <kbd
                          key={i}
                          className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] leading-none"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">On Mac, use ⌘ in place of Ctrl.</p>
      </DialogContent>
    </Dialog>
  );
}
