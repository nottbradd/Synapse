import { invoke, isTauri } from "@tauri-apps/api/core";
import { createOverlay } from "./overlay";
import { SWARM, snapshot, type Target } from "./geometry";
import { graphPresentation, type GraphPresentation } from "./presentation";
import { makePlan, type Plan } from "./plan";
import { observeLayout } from "./observe";
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
  visible?: boolean;
}
const nativeClaim = () =>
  isTauri()
    ? invoke<Claim>("claim_startup")
    : Promise.resolve({
        id: "browser-session",
        foreground: true,
        visible: true,
        granted: true,
      });
const seen = new Set<string>(),
  storageKey = "synapse.startup.launch";
function remember(id: string) {
  let prior = seen.has(id);
  try {
    prior ||= sessionStorage.getItem(storageKey) === id;
    sessionStorage.setItem(storageKey, id);
  } catch {
    /* Native claim remains authoritative. */
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
  private claiming = false;
  private granted = false;
  private consumed = false;
  private nativeFocused: boolean | undefined = isTauri() ? false : undefined;
  private visibilityRevision = 0;
  private visible = !document.hidden;
  private suspended = false;
  private readyAt: number | null = null;
  private started: number | null = null;
  private raf = 0;
  private timer = 0;
  private cleanups: (() => void)[] = [];
  private stopLayout?: () => void;
  private overlay?: ReturnType<typeof createOverlay>;
  private targets: Target[] = [];
  private graph?: GraphPresentation;
  private plan?: Plan;
  private hidden = new Map<
    HTMLElement,
    { attribute: string; previous: string | null }
  >();
  constructor(private claim = nativeClaim) {}
  get settled() {
    return this.done;
  }
  foreground(value: boolean) {
    ++this.visibilityRevision;
    this.nativeFocused = value;
    if (value) {
      this.visible = true;
      if (this.done) {
        if (!this.consumed) this.requestClaim();
        return;
      }
      if (this.suspended) this.resume();
      this.arm();
      this.requestClaim();
      this.wake();
    } else if (this.started !== null) this.finish("background");
  }
  attach(root: HTMLElement, beforePaint = true) {
    if (this.done) return () => {};
    this.root = root;
    if (!beforePaint || root.dataset.swarmPresented === "true") {
      this.finish("already-visible");
      return () => {};
    }
    const on = (target: EventTarget, event: string, fn: EventListener) => {
      target.addEventListener(event, fn, { capture: true, passive: true });
      this.cleanups.push(() => target.removeEventListener(event, fn, true));
    };
    for (const name of [
      "pointerdown",
      "keydown",
      "touchstart",
      "wheel",
      "scroll",
      "beforeinput",
      "compositionstart",
    ])
      on(window, name, () => this.finish("interaction"));
    on(document, "focusin", (e) => {
      if (e.target !== document.body && e.target !== root) this.finish("focus");
    });
    on(window, "focus", () => {
      // A native window event can be absent on WebView2. DOM focus only wakes
      // preparation; the Rust claim still decides whether we may animate.
      ++this.visibilityRevision;
      this.visible = true;
      this.resume();
      this.arm();
      this.requestClaim();
      this.wake();
    });
    on(window, "blur", () => {
      if (this.started !== null) this.finish("background");
    });
    on(document, "visibilitychange", () => {
      ++this.visibilityRevision;
      if (document.hidden) {
        if (this.started !== null) this.finish("background");
        else this.suspend();
      } else {
        this.visible = true;
        this.resume();
        this.requestClaim();
        this.wake();
      }
    });
    on(window, "synapse-decoration-suppressed", () =>
      this.finish("native-dialog"),
    );
    on(root, "animationend", (e) => {
      if (
        (e as AnimationEvent).animationName === "swarm-gate-safety" &&
        !this.overlay
      )
        this.finish("readiness-budget");
    });
    this.arm();
    return () => {
      if (this.started !== null) {
        this.finish("unmount");
        return;
      }
      this.root = null;
      this.release();
      queueMicrotask(() => {
        if (!this.root) this.finish("unmount", root);
      });
    };
  }
  update(state: StartupState) {
    this.state = state;
    if (this.done) return;
    if (state.reduced || !state.enabled || state.blocked) {
      this.finish("preference-or-modal");
      return;
    }
    if (this.started !== null && !state.ready) {
      this.finish("restoration");
      return;
    }
    this.arm();
  }
  private arm() {
    if (this.done || !this.root || !this.state.ready || this.started !== null)
      return;
    if (this.readyAt === null) {
      this.readyAt = performance.now();
      performance.mark("synapse.startup:ready");
      this.root.dataset.swarmGate = "preparing";
    }
    if (document.hidden || !this.visible) {
      this.suspend();
      this.requestClaim();
      return;
    }
    if (this.suspended) return;
    clearTimeout(this.timer);
    const remaining = SWARM.prepare - (performance.now() - this.readyAt);
    if (remaining <= 0) {
      this.finish("readiness-budget");
      return;
    }
    this.timer = window.setTimeout(
      () => this.finish("readiness-budget"),
      remaining,
    );
    this.requestClaim();
    this.wake();
  }
  private suspend() {
    if (this.done || this.started !== null) return;
    this.suspended = true;
    this.visible = false;
    clearTimeout(this.timer);
    this.timer = 0;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.root && this.readyAt !== null)
      this.root.dataset.swarmGate = "hidden";
  }
  private resume() {
    if (this.done || !this.suspended) return;
    this.suspended = false;
    this.visible = true;
    if (this.root && this.readyAt !== null) {
      this.readyAt = performance.now();
      this.root.dataset.swarmGate = "preparing";
      this.arm();
    }
  }
  private requestClaim() {
    if (this.claiming || this.consumed || (!this.state.ready && !this.done))
      return;
    this.claiming = true;
    const revision = this.visibilityRevision;
    void this.claim()
      .then((c) => {
        this.claiming = false;
        if (!c.foreground && revision !== this.visibilityRevision) {
          // A hidden-window reply may arrive after the real focus transition.
          // Recheck instead of putting a now-visible workspace back on hold.
          this.requestClaim();
          return;
        }
        if (c.foreground) {
          this.consumed = true;
          const prior = remember(c.id);
          if (this.done) return;
          if (!c.granted || prior) {
            this.finish("already-presented");
            return;
          }
          this.granted = true;
          this.nativeFocused = true;
          this.visible = true;
          this.resume();
          this.wake();
        } else if (!this.done && (c.visible === false || document.hidden))
          this.suspend();
      })
      .catch(() => {
        this.claiming = false;
        this.finish("claim-error");
      });
  }
  private wake() {
    if (
      !this.done &&
      this.root &&
      this.state.ready &&
      !this.suspended &&
      !document.hidden &&
      this.granted &&
      !this.raf
    )
      this.raf = requestAnimationFrame(this.frame);
  }
  private precedence() {
    const active = document.activeElement;
    return (
      this.state.blocked ||
      !!this.root?.querySelector('[aria-modal="true"],dialog[open]') ||
      (active instanceof HTMLElement &&
        active.matches("input,textarea,[contenteditable='true'],.cm-content"))
    );
  }
  private conceal(element: HTMLElement, attribute = "data-swarm-hidden") {
    this.hidden.set(element, {
      attribute,
      previous: element.getAttribute(attribute),
    });
    element.setAttribute(attribute, "true");
  }
  private reveal(element: HTMLElement) {
    const own = this.hidden.get(element);
    if (!own) return;
    if (element.getAttribute(own.attribute) === "true") {
      if (own.previous === null) element.removeAttribute(own.attribute);
      else element.setAttribute(own.attribute, own.previous);
    }
    this.hidden.delete(element);
  }
  private frame = (now: number) => {
    this.raf = 0;
    if (this.done || !this.root) return;
    try {
      if (document.hidden || this.nativeFocused === false) {
        this.finish("background");
        return;
      }
      if (this.precedence()) {
        this.finish("modal-or-editor");
        return;
      }
      if (!this.overlay) {
        if (this.readyAt === null || now - this.readyAt >= SWARM.prepare) {
          this.finish("readiness-budget");
          return;
        }
        if (document.fonts.status !== "loaded") {
          this.wake();
          return;
        }
        const graph = graphPresentation(this.root);
        if (
          !graph &&
          this.root.querySelector(".graph-surface") &&
          now - this.readyAt < 180
        ) {
          this.wake();
          return;
        }
        this.graph = graph?.nodes.length ? graph : undefined;
        this.targets = snapshot(this.root);
        if (document.fonts.status !== "loaded") {
          this.targets = [];
          this.wake();
          return;
        }
        this.plan = makePlan(this.targets, this.graph, innerWidth, innerHeight);
        if (!this.targets.length && !this.graph) {
          this.finish("empty");
          return;
        }
        if (performance.now() - this.readyAt >= SWARM.prepare) {
          this.finish("layout-budget");
          return;
        }
        this.started = performance.now();
        clearTimeout(this.timer);
        performance.mark("synapse.startup:start", {
          detail: {
            targets: this.targets.length,
            agents: this.plan.agents.length,
            nodes: this.graph?.nodes.length ?? 0,
            edges: this.graph?.edges.length ?? 0,
            duration: this.plan.duration,
            preparation: this.started - this.readyAt,
          },
        });
        for (const t of this.targets)
          this.conceal(
            t.element,
            t.kind === "surface"
              ? "data-swarm-surface-hidden"
              : "data-swarm-hidden",
          );
        if (this.graph) this.conceal(this.graph.element);
        this.overlay = createOverlay(
          this.targets,
          this.graph,
          this.plan,
          (i) => this.reveal(this.targets[i].element),
          () => {
            if (this.graph) this.reveal(this.graph.element);
          },
        );
        delete this.root.dataset.swarmGate;
        this.stopLayout = observeLayout(
          this.root,
          [
            ...this.targets.map((t) => t.element),
            ...(this.graph ? [this.graph.element] : []),
          ],
          (reason) => this.finish(reason),
        );
        this.timer = window.setTimeout(
          () => this.finish("deadline"),
          Math.max(0, SWARM.deadline - (performance.now() - this.started)),
        );
      }
      if (this.graph && !this.graph.valid()) {
        this.finish("graph-invalidated");
        return;
      }
      if (
        this.targets.some(
          (t) =>
            t.kind === "text" &&
            t.element.textContent?.trim() !== t.text.join(""),
        )
      ) {
        this.finish("content-change");
        return;
      }
      const elapsed = now - this.started!;
      if (elapsed >= this.plan!.duration) {
        this.finish("complete");
        return;
      }
      this.overlay.draw(Math.max(0, elapsed));
      this.wake();
    } catch {
      this.finish("error");
    }
  };
  private release() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    clearTimeout(this.timer);
    this.timer = 0;
    this.stopLayout?.();
    this.stopLayout = undefined;
    this.cleanups.splice(0).forEach((fn) => {
      try {
        fn();
      } catch {
        /* Continue releasing. */
      }
    });
  }
  finish(reason: string, detachedRoot?: HTMLElement) {
    if (this.done) return;
    this.done = true;
    this.release();
    for (const element of this.hidden.keys()) this.reveal(element);
    const root = this.root ?? detachedRoot;
    if (root) {
      delete root.dataset.swarmGate;
      root.dataset.swarmPresented = "true";
    }
    this.overlay?.remove();
    this.overlay = undefined;
    this.targets = [];
    this.plan = undefined;
    this.graph = undefined;
    this.root = null;
    performance.mark(`synapse.startup:finish:${reason}`);
    if (this.started !== null)
      performance.measure(
        "synapse.startup",
        "synapse.startup:start",
        `synapse.startup:finish:${reason}`,
      );
    this.requestClaim();
  }
}
const key = Symbol.for("synapse.startup.controller"),
  shared = globalThis as unknown as Record<symbol, StartupController>;
export const startup = (shared[key] ??= new StartupController());
