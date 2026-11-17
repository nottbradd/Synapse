import { isTauri } from "@tauri-apps/api/core";
import { SWARM } from "./geometry";
import { createReturnOverlay } from "./overlay";
import { graphPresentation } from "./presentation";
import { observeLayout } from "./observe";
import { returnSuppressed, suppressReturn } from "./suppression";
export interface ReturnState {
  ready: boolean;
  enabled: boolean;
  reduced: boolean;
  blocked: boolean;
}
export class ReturnController {
  private root: HTMLElement | null = null;
  private state: ReturnState = {
    ready: false,
    enabled: true,
    reduced: false,
    blocked: false,
  };
  private focused = false;
  private seen = false;
  private away: number | null = null;
  private last = -Infinity;
  private lastInput = -Infinity;
  private composing = false;
  private stable = 0;
  private raf = 0;
  private deadline = 0;
  private started: number | null = null;
  private overlay?: ReturnType<typeof createReturnOverlay>;
  private stopLayout?: () => void;
  private detachEvents?: () => void;
  constructor(
    private startupDone: () => boolean,
    private native = isTauri(),
  ) {}
  attach(root: HTMLElement) {
    this.detachEvents?.();
    this.root = root;
    const cleanups: (() => void)[] = [];
    const on = (target: EventTarget, name: string, fn: EventListener) => {
      target.addEventListener(name, fn, { capture: true, passive: true });
      cleanups.push(() => target.removeEventListener(name, fn, true));
    };
    const input = () => {
      this.lastInput = performance.now();
      this.finish("interaction");
    };
    for (const e of [
      "pointerdown",
      "keydown",
      "beforeinput",
      "input",
      "wheel",
      "touchstart",
      "scroll",
    ])
      on(window, e, input);
    on(window, "compositionstart", () => {
      this.composing = true;
      input();
    });
    on(window, "compositionend", () => {
      this.composing = false;
      this.lastInput = performance.now();
    });
    on(window, "synapse-decoration-suppressed", () => {
      this.away = null;
      this.finish("suppressed");
    });
    on(window, "focus", () => {
      if (!this.native) this.foreground(true);
    });
    on(window, "blur", () => {
      if (!this.native) this.foreground(false);
      else this.finish("dom-background");
    });
    on(document, "visibilitychange", () => {
      if (document.hidden) {
        if (!this.native) this.foreground(false);
        this.finish("hidden");
      } else if (!this.native) this.foreground(document.hasFocus());
    });
    if (!this.native) this.foreground(document.hasFocus() && !document.hidden);
    const detach = () => {
      cleanups.splice(0).forEach((fn) => fn());
      this.finish("unmount");
      this.root = null;
    };
    this.detachEvents = detach;
    return detach;
  }
  update(state: ReturnState) {
    if (this.state.blocked && !state.blocked) suppressReturn(400);
    this.state = state;
    if (!state.ready || !state.enabled || state.reduced || state.blocked) {
      this.away = null;
      this.finish("preference-or-modal");
    }
  }
  foreground(value: boolean) {
    if (value === this.focused && this.seen) return;
    const now = performance.now(),
      previous = this.focused;
    this.focused = value;
    if (!value) {
      if (previous && this.seen) this.away = now;
      this.finish("background");
      return;
    }
    const first = !this.seen;
    this.seen = true;
    const absence = this.away === null ? 0 : now - this.away;
    this.away = null;
    if (
      first ||
      absence < SWARM.away ||
      now - this.last < SWARM.cooldown ||
      !this.eligible()
    )
      return;
    this.stable = window.setTimeout(() => {
      this.stable = 0;
      if (this.eligible()) this.start();
    }, SWARM.stable);
  }
  private eligible() {
    return (
      !!this.root &&
      this.focused &&
      !document.hidden &&
      this.startupDone() &&
      this.state.ready &&
      this.state.enabled &&
      !this.state.reduced &&
      !this.state.blocked &&
      !this.composing &&
      performance.now() - this.lastInput > SWARM.stable &&
      !returnSuppressed() &&
      !this.root.querySelector('[aria-modal="true"],dialog[open]')
    );
  }
  private start() {
    try {
      const root = this.root!;
      const elements = Array.from(
        root.querySelectorAll<HTMLElement>(
          ".sidebar,.graph-controls,.editor-header,.graph-heading,.welcome h1",
        ),
      ).slice(0, 4);
      const chrome = elements
        .map((e) => e.getBoundingClientRect())
        .filter(
          (r) =>
            r.width > 10 &&
            r.height > 10 &&
            r.x >= 0 &&
            r.y >= 0 &&
            r.bottom <= innerHeight,
        );
      const graph = graphPresentation(root);
      if (!chrome.length && !graph?.edges.length) return;
      this.started = this.last = performance.now();
      performance.mark("synapse.return:start", {
        detail: {
          edges: Math.min(3, graph?.edges.length ?? 0),
          chrome: chrome.length,
        },
      });
      this.overlay = createReturnOverlay(chrome, graph);
      this.stopLayout = observeLayout(root, elements, (reason) =>
        this.finish(reason),
      );
      this.deadline = window.setTimeout(
        () => this.finish("deadline"),
        SWARM.returnDeadline,
      );
      const draw = (now: number) => {
        this.raf = 0;
        if (!this.overlay || this.started === null) return;
        if (!this.eligible() || (graph && !graph.valid())) {
          this.finish("invalidated");
          return;
        }
        if (now - this.started >= SWARM.returnEnd) {
          this.finish("complete");
          return;
        }
        try {
          this.overlay.draw(now - this.started);
          this.raf = requestAnimationFrame(draw);
        } catch {
          this.finish("error");
        }
      };
      this.raf = requestAnimationFrame(draw);
    } catch {
      this.finish("error");
    }
  }
  finish(reason: string) {
    clearTimeout(this.stable);
    this.stable = 0;
    clearTimeout(this.deadline);
    this.deadline = 0;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.stopLayout?.();
    this.stopLayout = undefined;
    this.overlay?.remove();
    this.overlay = undefined;
    if (this.started !== null) {
      performance.mark(`synapse.return:finish:${reason}`);
      performance.measure(
        "synapse.return",
        "synapse.return:start",
        `synapse.return:finish:${reason}`,
      );
      this.started = null;
    }
  }
}
