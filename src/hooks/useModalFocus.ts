import { useEffect, useRef } from "react";
// Keep keyboard focus inside the topmost dialog and return it on dismissal.
export function useModalFocus(active: string) {
  // React autofocus runs before effects. Remember the last outside focus event
  // so mounting an auto-focused input cannot replace the actual dialog opener.
  const outside = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const remember = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLElement &&
        !event.target.closest(".overlay")
      )
        outside.current = event.target;
    };
    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, []);
  useEffect(() => {
    if (!active) return;
    const previous =
      outside.current ??
      (document.activeElement instanceof HTMLElement &&
      !document.activeElement.closest(".overlay")
        ? document.activeElement
        : null);
    const overlays = document.querySelectorAll<HTMLElement>(".overlay");
    const modal = overlays[overlays.length - 1];
    if (!modal) return;
    const elements = () =>
      Array.from(
        modal.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ).filter((e) => e.offsetParent !== null);
    (
      modal.querySelector<HTMLElement>(
        'input:not([type="checkbox"]):not(:disabled)',
      ) ?? elements()[0]
    )?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const choices = elements();
      const first = choices[0],
        last = choices[choices.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
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
