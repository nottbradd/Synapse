interface FocusWindow {
  isFocused(): Promise<boolean>;
  listen(event: string, handler: () => void): Promise<() => void>;
  onFocusChanged(
    handler: (event: { payload: boolean }) => void,
  ): Promise<() => void>;
}

// WebView2 can emit DOM focus without a corresponding Tauri window event.
// Reconcile on those transitions using native state, never a polling loop.
export function attachNativeFocus(
  nativeWindow: FocusWindow,
  notify: (focused: boolean) => void,
  dom: EventTarget = window,
  visibility: EventTarget = document,
  shown: () => void = () => {},
) {
  let alive = true;
  let revision = 0;
  let previous: boolean | undefined;
  const publish = (focused: boolean) => {
    if (!alive || focused === previous) return;
    previous = focused;
    notify(focused);
  };
  const reconcile = () => {
    if (!alive) return;
    const request = ++revision;
    void nativeWindow.isFocused().then(
      (focused) => {
        if (alive && request === revision) publish(focused);
      },
      () => {
        /* Keep the last authoritative state; startup also rechecks its claim. */
      },
    );
  };
  const unlisten = nativeWindow.onFocusChanged(({ payload }) => {
    ++revision;
    publish(payload);
  });
  const unlistenShown = nativeWindow.listen("synapse-window-shown", () => {
    if (!alive) return;
    shown();
    reconcile();
  });
  void unlisten.then(reconcile, reconcile);
  dom.addEventListener("focus", reconcile);
  dom.addEventListener("blur", reconcile);
  visibility.addEventListener("visibilitychange", reconcile);
  reconcile();
  return () => {
    alive = false;
    ++revision;
    dom.removeEventListener("focus", reconcile);
    dom.removeEventListener("blur", reconcile);
    visibility.removeEventListener("visibilitychange", reconcile);
    void unlisten.then(
      (remove) => remove(),
      () => {},
    );
    void unlistenShown.then(
      (remove) => remove(),
      () => {},
    );
  };
}
