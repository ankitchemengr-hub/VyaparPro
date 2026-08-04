import { useEffect, useRef } from "react";

// Makes the phone/browser Back button close an open dialog instead of
// navigating the underlying page away. Without this, a Dialog/AlertDialog
// isn't a real history entry, so pressing Back while one is open (e.g. the
// product-image zoom on Catalog) falls through to the browser's own history
// and lands on whatever page was open before — Dashboard, Menu, wherever —
// instead of just dismissing the popup, on every role and every dialog.
//
// While open, pushes one extra same-URL history entry. A real Back press
// pops it (fires popstate) and we close the dialog instead of navigating.
// If the dialog closes normally (X button, save, click-outside) we pop that
// same entry ourselves so a later Back press isn't wasted on a leftover
// step.
export function useBackButtonClose(open: boolean, onOpenChange?: (open: boolean) => void) {
  const pushedRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    window.history.pushState({ __dialogTrap: true }, "");
    pushedRef.current = true;

    const onPopState = () => {
      pushedRef.current = false;
      onOpenChange?.(false);
    };
    window.addEventListener("popstate", onPopState);

    return () => {
      window.removeEventListener("popstate", onPopState);
      if (pushedRef.current) {
        pushedRef.current = false;
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
