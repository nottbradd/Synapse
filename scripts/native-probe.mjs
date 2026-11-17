// Passive diagnostics for the installed synthetic-vault session. No UI input.
export async function startProbe(page) {
  await page.evaluate(() => {
    window.nativeAcceptance?.stop?.();
    const q = (window.nativeAcceptance = {
      frames: [],
      events: [],
      native: [],
      audio: 0,
    });
    const snapshot = () => ({
      at: performance.now(),
      focused: document.hasFocus(),
      hidden: document.hidden,
      gate:
        document
          .querySelector("[data-swarm-gate]")
          ?.getAttribute("data-swarm-gate") ?? null,
      concealed: document.querySelectorAll(
        '[data-swarm-hidden="true"],[data-swarm-surface-hidden="true"]',
      ).length,
      startup: document.querySelectorAll(".swarm-startup").length,
      returning: document.querySelectorAll(".swarm-return").length,
      cursors: document.querySelectorAll(".swarm-cursor").length,
      opacity: (() => {
        const e = document.querySelector(
          ".brand [data-swarm='text'],.welcome h1",
        );
        return e ? getComputedStyle(e).opacity : null;
      })(),
    });
    q.originalAudio = window.AudioContext;
    window.AudioContext = new Proxy(window.AudioContext, {
      construct(target, args, receiver) {
        q.audio++;
        return Reflect.construct(target, args, receiver);
      },
    });
    const record = (e) => {
      q.events.push({ kind: e.type, key: e.key, ...snapshot() });
    };
    const events = [
      "focus",
      "blur",
      "visibilitychange",
      "pointerdown",
      "keydown",
      "beforeinput",
      "input",
      "compositionstart",
    ];
    events.forEach((name) =>
      (name === "visibilitychange" ? document : window).addEventListener(
        name,
        record,
        true,
      ),
    );
    const frame = () => {
      // Keep recent evidence even if the operator takes a while to return.
      // Trim in batches so this passive observer does not shift on every frame.
      if (q.frames.length >= 18000) q.frames.splice(0, 6000);
      q.frames.push(snapshot());
      q.raf = requestAnimationFrame(frame);
    };
    q.raf = requestAnimationFrame(frame);
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      const at = performance.now();
      try {
        const [focused, visible] = await Promise.all([
          window.__TAURI_INTERNALS__.invoke("plugin:window|is_focused", {
            label: "main",
          }),
          window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", {
            label: "main",
          }),
        ]);
        const last = q.native.at(-1);
        if (!last || last.focused !== focused || last.visible !== visible)
          q.native.push({ at, received: performance.now(), focused, visible });
      } finally {
        pending = false;
      }
    };
    q.timer = setInterval(poll, 50);
    void poll();
    q.stop = () => {
      cancelAnimationFrame(q.raf);
      clearInterval(q.timer);
      events.forEach((name) =>
        (name === "visibilitychange" ? document : window).removeEventListener(
          name,
          record,
          true,
        ),
      );
      window.AudioContext = q.originalAudio;
    };
  });
}
export async function stopProbe(page) {
  return page.evaluate(() => {
    const q = window.nativeAcceptance;
    q.stop();
    return {
      frames: q.frames,
      events: q.events,
      native: q.native,
      audio: q.audio,
      timeOrigin: performance.timeOrigin,
      marks: performance
        .getEntriesByType("mark")
        .filter((e) => e.name.startsWith("synapse."))
        .map((e) => ({ name: e.name, at: e.startTime, detail: e.detail })),
      measures: performance
        .getEntriesByType("measure")
        .filter((e) => e.name.startsWith("synapse."))
        .map((e) => e.toJSON()),
      gate:
        document
          .querySelector("[data-swarm-gate]")
          ?.getAttribute("data-swarm-gate") ?? null,
      concealed: document.querySelectorAll(
        '[data-swarm-hidden="true"],[data-swarm-surface-hidden="true"]',
      ).length,
      overlays: document.querySelectorAll(".swarm-overlay").length,
      controllers: Object.fromEntries(
        Object.getOwnPropertySymbols(globalThis)
          .filter((s) =>
            [
              "synapse.startup.controller",
              "synapse.return.controller",
            ].includes(s.description),
          )
          .map((s) => [
            s.description,
            Object.fromEntries(
              Object.entries(globalThis[s]).filter(([k]) =>
                [
                  "done",
                  "consumed",
                  "granted",
                  "nativeFocused",
                  "visible",
                  "suspended",
                  "readyAt",
                  "started",
                  "focused",
                  "seen",
                  "away",
                  "raf",
                  "timer",
                  "stable",
                  "deadline",
                ].includes(k),
              ),
            ),
          ]),
      ),
    };
  });
}
