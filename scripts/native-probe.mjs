// Passive diagnostics for the installed synthetic-vault session. No UI input.
export async function startProbe(page) {
  await page.evaluate(() => {
    window.nativeAcceptance?.stop?.();
    const q = (window.nativeAcceptance = {
      frames: [],
      events: [],
      native: [],
      audio: 0,
      audioStarts: [],
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
    const audioSources = [AudioBufferSourceNode, OscillatorNode].map((type) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        type.prototype,
        "start",
      );
      const start = type.prototype.start;
      type.prototype.start = function (...args) {
        q.audioStarts.push({ kind: type.name, at: performance.now() });
        return Reflect.apply(start, this, args);
      };
      return { type, descriptor };
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
      const sample = snapshot();
      q.frames.push(sample);
      if (sample.startup && !q.schedule) {
        const plan = globalThis[Symbol.for("synapse.startup.controller")]?.plan;
        if (plan)
          q.schedule = {
            orbitEnd: plan.orbitEnd,
            constructionEnd: plan.constructionEnd,
            duration: plan.duration,
            centre: plan.centre,
            scale: plan.scale,
            actors: plan.agents.map(
              ({ id, name, radius, speed, departure, gone }) => ({
                id,
                name,
                radius,
                speed,
                departure,
                gone,
              }),
            ),
            tasks: plan.tasks.map(
              ({
                id,
                kind,
                agent,
                start,
                work,
                end,
                typing,
                anchor,
                destination,
              }) => ({
                id,
                kind,
                agent,
                start,
                work,
                end,
                characters: typing.length,
                anchor,
                destination,
              }),
            ),
          };
      }
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
      for (const { type, descriptor } of audioSources) {
        if (descriptor)
          Object.defineProperty(type.prototype, "start", descriptor);
        else delete type.prototype.start;
      }
    };
  });
}
export async function stopProbe(page) {
  return page.evaluate(() => {
    const q = window.nativeAcceptance;
    q.stop();
    return {
      frames: q.frames,
      schedule: q.schedule,
      events: q.events,
      native: q.native,
      audio: q.audio,
      audioStarts: q.audioStarts,
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
