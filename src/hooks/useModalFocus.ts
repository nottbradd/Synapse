import { useEffect } from "react";
// Keep keyboard focus inside the topmost dialog and return it on dismissal.
export function useModalFocus(active: string) {
  useEffect(() => {
    if (!active) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const overlays = document.querySelectorAll<HTMLElement>(".overlay");
    const modal = overlays[overlays.length - 1];
    if (!modal) return;
    const elements = () =>
      Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        ),
      ).filter((e) => e.offsetParent !== null);
    elements()[0]?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const choices = elements();
      const first = choices[0],
        last = choices[choices.length - 1];
      if (!first) return;
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !modal.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trap, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
      previous?.focus();
    };
  }, [active]);
}
