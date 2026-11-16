import { invoke, isTauri } from "@tauri-apps/api/core";
import { createOverlay } from "./overlay";
import {
  SWARM,
  clamp,
  curve,
  smooth,
  snapshot,
  type Point,
  type Target,
} from "./geometry";
export interface StartupState {
  ready: boolean;
  reduced: boolean;
  enabled: boolean;
  blocked: boolean;
}
interface Claim {
  id: string;
  foreground: boolean;
  granted: boolean;
}
const nativeClaim = () =>
  isTauri()
    ? invoke<Claim>("claim_startup")
    : Promise.resolve({
        id: "browser-session",
        foreground: true,
        granted: true,
      });
const storageKey = "synapse.startup.launch";
const seen = new Set<string>();
function remember(id: string) {
  let prior = seen.has(id);
  try {
    prior ||= sessionStorage.getItem(storageKey) === id;
    sessionStorage.setItem(storageKey, id);
  } catch {
    /* Native claim + in-memory fallback. */
  }
  seen.add(id);
  return prior;
}
export class StartupController {
  private root: HTMLElement | null = null;
  private state: StartupState = {
    ready: false,
    reduced: false,
    enabled: true,
    blocked: false,
  };
  private done = false;
  private started: number | null = null;
  private prepared = 0;
  private granted = false;
  private claiming = false;
  private raf = 0;
  private timer = 0;
  private cleanups: (() => void)[] = [];
  private overlay?: ReturnType<typeof createOverlay>;
  private targets: Target[] = [];
  private hidden = new Map<HTMLElement, string | null>();
  private origin: Point = { x: 50, y: 35 };
  private dpr = 1;
  private nativeFocused: boolean | undefined = isTauri() ? false : undefined;
  constructor(private claim = nativeClaim) {}
  foreground(value: boolean) {
    this.nativeFocused = value;
    if (value) this.wake();
    else if (this.granted) this.finish("background");
  }
  attach(root: HTMLElement) {
    if (this.done) return () => {};
    this.root = root;
    if (!this.done) {
      const on = (target: EventTarget, event: string, fn: EventListener) => {
        target.addEventListener(event, fn, { capture: true, passive: true });
        this.cleanups.push(() => target.removeEventListener(event, fn, true));
      };
      const interrupt = () => {
        // Consume a foreground opportunity even if interaction beats first RAF.
        if (this.started === null && !this.claiming)
          void this.claim().catch(() => {});
        this.finish("interaction");
      };
      for (const event of ["pointerdown", "keydown", "touchstart", "wheel"])
        on(window, event, interrupt);
      on(document, "focusin", (e) => {
        if (e.target !== document.body && e.target !== root) interrupt();
      });
      on(window, "focus", () => this.wake());
      on(window, "blur", () => {
        if (this.started !== null) this.finish("background");
      });
      on(document, "visibilitychange", () => {
        if (document.hidden && this.started !== null) this.finish("background");
        else this.wake();
      });
      on(window, "resize", () => {
        if (this.overlay) this.finish("resize");
      });
      if (window.visualViewport)
        on(window.visualViewport, "resize", () => {
          if (this.overlay) this.finish("viewport");
        });
      this.wake();
      if (this.started !== null) {
        this.timer = window.setTimeout(
          () => this.finish("deadline"),
          Math.max(0, SWARM.deadline - (performance.now() - this.started)),
        );
      }
    }
    return () => {
      this.root = null;
      if (this.overlay) this.finish("unmount");
      else {
        this.release();
        // React 19 may run its Strict Mode effect probe after the first RAF.
        // No content is hidden yet. Allow its synchronous reattachment while
        // preserving the original clock and in-flight native claim.
        queueMicrotask(() => {
          if (!this.root && this.started !== null) this.finish("unmount");
        });
      }
    };
  }
  update(state: StartupState) {
    this.state = state;
    if (
      this.started !== null &&
      (state.reduced || !state.enabled || state.blocked)
    )
      this.finish("preference-or-modal");
  }
  private wake = () => {
    if (
      !this.done &&
      this.root &&
      !this.raf &&
      this.nativeFocused !== false &&
      !document.hidden &&
      document.hasFocus()
    )
      this.raf = requestAnimationFrame(this.frame);
  };
  private frame = (now: number) => {
    this.raf = 0;
    if (this.done || !this.root) return;
    try {
      if (
        document.hidden ||
        !document.hasFocus() ||
        this.nativeFocused === false
      ) {
        if (this.started !== null) this.finish("background");
        return;
      }
      if (this.started === null) {
        this.started = now;
        performance.mark("synapse.startup:foreground");
        this.timer = window.setTimeout(
          () => this.finish("deadline"),
          SWARM.deadline,
        );
        this.claiming = true;
        void this.claim()
          .then((c) => {
            this.claiming = false;
            if (this.done) return;
            if (!c.foreground) {
              clearTimeout(this.timer);
              this.started = null;
              // Wait for actual foreground; no hidden animation or focus request.
              cancelAnimationFrame(this.raf);
              this.raf = 0;
              return;
            }
            if (!c.granted || remember(c.id)) this.finish("already-presented");
            else if (this.nativeFocused === false) this.finish("background");
            else this.granted = true;
          })
          .catch(() => this.finish("claim-error"));
      }
      const elapsed = now - this.started;
      if (elapsed >= SWARM.end) {
        this.finish("complete");
        return;
      }
      if (this.state.reduced || !this.state.enabled) {
        this.finish("motion-disabled");
        return;
      }
      if (this.state.blocked || this.precedence()) {
        this.finish("modal-or-editor");
        return;
      }
      if (!this.overlay) {
        if (elapsed > SWARM.prepare) {
          this.finish("readiness-budget");
          return;
        }
        if (
          this.granted &&
          this.state.ready &&
          document.fonts.status === "loaded"
        ) {
          this.targets = snapshot(this.root);
          // Measuring/creating the overlay also belongs to preparation.
          if (
            performance.now() - this.started > SWARM.prepare ||
            !this.targets.length
          ) {
            this.finish("layout-budget");
            return;
          }
          const brand =
            this.targets.find((t) =>
              t.element.matches(".brand, .welcome h1"),
            ) ?? this.targets[0];
          this.origin = { x: brand.rect.x + 12, y: brand.rect.y + 12 };
          this.prepared = performance.now();
          this.dpr = window.devicePixelRatio;
          this.overlay = createOverlay(
            this.targets,
            1150 - (this.prepared - this.started),
          );
          this.prepared = performance.now();
          if (this.prepared - this.started > SWARM.prepare) {
            this.finish("overlay-budget");
            return;
          }
          this.overlay.element.style.animationDuration = `${1150 - (this.prepared - this.started)}ms`;
          for (const t of this.targets) {
            this.hidden.set(
              t.element,
              t.element.getAttribute("data-swarm-hidden"),
            );
            t.element.setAttribute("data-swarm-hidden", "true");
          }
          performance.mark("synapse.startup:snapshot", {
            detail: { targets: this.targets.length },
          });
          this.observe();
        }
      }
      if (this.overlay) {
        if (window.devicePixelRatio !== this.dpr) {
          this.finish("dpr");
          return;
        }
        this.draw(now);
      }
      this.wake();
    } catch {
      this.finish("error");
    }
  };
  private precedence() {
    const active = document.activeElement;
    return (
      !!this.root?.querySelector('[aria-modal="true"], dialog[open]') ||
      (active instanceof HTMLElement &&
        active.matches(
          "input, textarea, [contenteditable='true'], .cm-content",
        ))
    );
  }
  private observe() {
    const sizes = new Map<Element, { width: number; height: number }>();
    const resize = new ResizeObserver((entries) => {
      for (const e of entries) {
        const old = sizes.get(e.target),
          next = e.contentRect;
        if (
          old &&
          (Math.abs(old.width - next.width) > 1 ||
            Math.abs(old.height - next.height) > 1)
        ) {
          this.finish("layout");
          return;
        }
        sizes.set(e.target, { width: next.width, height: next.height });
      }
    });
    for (const t of this.targets) resize.observe(t.element);
    this.cleanups.push(() => resize.disconnect());
    const mutation = new MutationObserver(() => {
      if (
        this.precedence() ||
        this.targets.some(
          (t) =>
            !t.element.isConnected ||
            (t.kind === "text" &&
              t.element.textContent?.trim() !== t.text.join("")),
        )
      )
        this.finish("content-change");
    });
    mutation.observe(this.root!, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["hidden", "aria-modal", "role"],
    });
    this.cleanups.push(() => mutation.disconnect());
    const fontChange = () => this.finish("fonts");
    document.fonts.addEventListener("loading", fontChange);
    document.fonts.addEventListener("loadingdone", fontChange);
    this.cleanups.push(() => {
      document.fonts.removeEventListener("loading", fontChange);
      document.fonts.removeEventListener("loadingdone", fontChange);
    });
    const resolution = matchMedia(`(resolution: ${this.dpr}dppx)`);
    const dprChange = () => this.finish("dpr");
    resolution.addEventListener("change", dprChange);
    this.cleanups.push(() =>
      resolution.removeEventListener("change", dprChange),
    );
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      const layout = new PerformanceObserver((list) => {
        // Construction marks deliberately grow. Only shifts of the actual
        // application invalidate its snapshot, never our decorative copy.
        if (
          list
            .getEntries()
            .some(
              (e) =>
                e.startTime > this.prepared &&
                (
                  e as PerformanceEntry & { sources?: { node?: Node }[] }
                ).sources?.some((s) => s.node && this.root?.contains(s.node)),
            )
        )
          this.finish("layout-shift");
      });
      layout.observe({ type: "layout-shift" });
      this.cleanups.push(() => layout.disconnect());
    }
  }
  private reveal(t: Target) {
    if (!this.hidden.has(t.element)) return;
    const previous = this.hidden.get(t.element);
    if (t.element.getAttribute("data-swarm-hidden") === "true") {
      if (previous === null) t.element.removeAttribute("data-swarm-hidden");
      else t.element.setAttribute("data-swarm-hidden", previous!);
    }
    this.hidden.delete(t.element);
  }
  private draw(now: number) {
    const overlay = this.overlay!,
      start = this.prepared + SWARM.gather;
    const buildEnd = this.started! + SWARM.buildEnd;
    const waves = Math.ceil(this.targets.length / SWARM.agents),
      slot = (buildEnd - start) / waves;
    const exit = clamp((now - buildEnd) / (SWARM.end - SWARM.buildEnd));
    overlay.cursors.forEach((cursor, agent) => {
      let position = {
        x: this.origin.x + (agent % 3) * 16,
        y: this.origin.y + Math.floor(agent / 3) * 18,
      };
      let mode = "pointer";
      if (now < start) {
        position = curve(
          { x: position.x - 38 + agent * 8, y: position.y + 35 },
          position,
          (now - this.prepared) / SWARM.gather,
          6,
        );
      } else
        for (let i = agent; i < this.targets.length; i += SWARM.agents) {
          const target = this.targets[i],
            mark = overlay.marks[i],
            wave = Math.floor(i / SWARM.agents);
          const progress = (now - start - wave * slot) / slot;
          if (progress < 0) break;
          const corner = { x: target.rect.x, y: target.rect.y },
            end = {
              x: corner.x + target.rect.width,
              y: corner.y + target.rect.height,
            };
          if (progress < 0.22) {
            position = curve(
              position,
              corner,
              progress / 0.22,
              agent % 2 ? 18 : -18,
            );
            break;
          }
          const build = clamp((progress - 0.22) / 0.62);
          mode = target.kind === "text" ? "text" : "crosshair";
          position = curve(corner, end, build, 0);
          if (progress < 0.94) {
            mark.style.opacity = "1";
            if (target.kind === "text") {
              mark.textContent = target.text
                .slice(0, Math.ceil(build * target.text.length))
                .join("");
              position = {
                x: corner.x + target.rect.width * build,
                y: corner.y + target.rect.height * 0.5,
              };
            } else {
              mark.style.width = `${Math.max(1, target.rect.width * smooth(build))}px`;
              mark.style.height = `${Math.max(1, target.rect.height * smooth(build))}px`;
              mark.classList.toggle("swarm-handles", build > 0.92);
            }
            break;
          }
          this.reveal(target);
          mark.style.opacity = "0";
          mode = "pointer";
        }
      cursor.dataset.mode = mode;
      cursor.style.transform = `translate3d(${position.x + exit * 20}px,${position.y - exit * 12}px,0)`;
      cursor.style.opacity = `${1 - smooth(exit)}`;
    });
  }
  private release() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.timer);
    this.timer = 0;
    this.cleanups.splice(0).forEach((fn) => {
      try {
        fn();
      } catch {
        /* One failed observer cannot strand the others. */
      }
    });
  }
  finish(reason: string) {
    if (this.done) return;
    this.done = true;
    this.release();
    this.targets.forEach((t) => this.reveal(t));
    this.overlay?.remove();
    this.overlay = undefined;
    this.targets = [];
    this.hidden.clear();
    this.root = null;
    if (this.started !== null) {
      performance.mark(`synapse.startup:finish:${reason}`);
      performance.measure(
        "synapse.startup",
        "synapse.startup:foreground",
        `synapse.startup:finish:${reason}`,
      );
    }
  }
}
// Survives Strict Mode, HMR and multiple App renders; Rust survives full reload.
const key = Symbol.for("synapse.startup.controller"),
  shared = globalThis as unknown as Record<symbol, StartupController>;
export const startup = (shared[key] ??= new StartupController());
