export function observeLayout(
  root: HTMLElement,
  elements: Element[],
  finish: (reason: string) => void,
) {
  const cleanups: (() => void)[] = [],
    at = performance.now();
  const sizes = new Map<Element, { width: number; height: number }>();
  const measured = [...new Set([root, ...elements])].map((element) => ({
    element,
    rect: element.getBoundingClientRect(),
  }));
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const old = sizes.get(e.target),
        r = e.contentRect;
      if (
        old &&
        (Math.abs(old.width - r.width) > 1 ||
          Math.abs(old.height - r.height) > 1)
      ) {
        finish("layout");
        return;
      }
      sizes.set(e.target, { width: r.width, height: r.height });
    }
  });
  [...new Set([root, ...elements])].forEach((e) => ro.observe(e));
  cleanups.push(() => ro.disconnect());
  const on = (target: EventTarget, name: string, reason: string) => {
    const fn = () => finish(reason);
    target.addEventListener(name, fn);
    cleanups.push(() => target.removeEventListener(name, fn));
  };
  on(window, "resize", "resize");
  if (window.visualViewport) on(window.visualViewport, "resize", "viewport");
  on(document.fonts, "loading", "fonts");
  on(document.fonts, "loadingdone", "fonts");
  on(matchMedia(`(resolution: ${devicePixelRatio}dppx)`), "change", "dpr");
  const mutation = new MutationObserver(() => {
    if (!root.isConnected || elements.some((e) => !e.isConnected))
      finish("content-change");
    else if (root.querySelector('[aria-modal="true"],dialog[open]'))
      finish("modal");
  });
  mutation.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-modal", "hidden", "open"],
  });
  cleanups.push(() => mutation.disconnect());
  if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
    const observer = new PerformanceObserver((list) => {
      if (
        list
          .getEntries()
          .some(
            (e) =>
              e.startTime > at &&
              (
                e as PerformanceEntry & { sources?: { node?: Node }[] }
              ).sources?.some((s) => s.node && root.contains(s.node)),
          ) &&
        measured.some(({ element, rect }) => {
          const current = element.getBoundingClientRect();
          return (
            Math.abs(current.x - rect.x) > 1 ||
            Math.abs(current.y - rect.y) > 1 ||
            Math.abs(current.width - rect.width) > 1 ||
            Math.abs(current.height - rect.height) > 1
          );
        })
      )
        finish("layout-shift");
    });
    observer.observe({ type: "layout-shift" });
    cleanups.push(() => observer.disconnect());
  }
  return () =>
    cleanups.splice(0).forEach((fn) => {
      try {
        fn();
      } catch {
        /* Remaining resources must still detach. */
      }
    });
}
