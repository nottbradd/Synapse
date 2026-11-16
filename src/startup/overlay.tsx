import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Crosshair, MousePointer2, TextCursor } from "lucide-react";
import { subjects } from "../types";
import type { Target } from "./geometry";

export const colors = [
  ...subjects.slice(0, 4).map((s) => s.color),
  "#b9c8d4",
  "#7c90a0",
];
export function createOverlay(targets: Target[], fallbackMs: number) {
  const element = document.createElement("div");
  element.className = "swarm-overlay";
  element.setAttribute("aria-hidden", "true");
  element.style.animationDuration = `${Math.max(0, fallbackMs)}ms`;
  const react = createRoot(element);
  try {
    // Called from the controller's RAF, never during a React commit.
    flushSync(() =>
      react.render(
        <>
          {colors.map((color, i) => (
            <div className="swarm-cursor" key={i} style={{ color }}>
              <MousePointer2 className="swarm-pointer" size={17} />
              <Crosshair className="swarm-crosshair" size={16} />
              <TextCursor className="swarm-text-cursor" size={17} />
            </div>
          ))}
        </>,
      ),
    );
    const cursors = Array.from(
      element.querySelectorAll<HTMLElement>(".swarm-cursor"),
    );
    const marks = targets.map((t, i) => {
      const mark = document.createElement("div");
      mark.className = `swarm-mark swarm-${t.kind}`;
      mark.style.cssText = `left:${t.rect.x}px;top:${t.rect.y}px;width:${t.rect.width}px;height:${t.rect.height}px;color:${colors[i % colors.length]}`;
      if (t.kind === "text") {
        mark.style.font = t.font;
        mark.style.lineHeight = t.lineHeight;
        mark.style.letterSpacing = t.letterSpacing;
        mark.style.color = t.color;
      } else
        for (let corner = 0; corner < 4; corner++) {
          const handle = document.createElement("i");
          handle.className = `swarm-handle corner-${corner}`;
          mark.append(handle);
        }
      element.append(mark);
      return mark;
    });
    document.body.append(element);
    return {
      element,
      cursors,
      marks,
      remove: () => {
        element.remove();
        // The detached React icon root can safely unmount even when the app's
        // own commit triggered cleanup. The visible overlay is already gone.
        queueMicrotask(() => react.unmount());
      },
    };
  } catch (error) {
    element.remove();
    queueMicrotask(() => react.unmount());
    throw error;
  }
}
