import { useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { MOTION } from "../interaction/motion";
export default function TransitionTitle({ text }: { text: string }) {
  const root = useRef<HTMLSpanElement>(null),
    previous = useRef(text),
    old = useRef("");
  if (previous.current !== text) {
    old.current = previous.current;
    previous.current = text;
  }
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const [prior, next] = Array.from(el.children) as HTMLElement[];
    el.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    prior.style.visibility = old.current && !reduced ? "visible" : "hidden";
    if (!old.current || reduced) return;
    const a = prior.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(-3px)" },
      ],
      { duration: MOTION.titleDuration, fill: "forwards", easing: "ease-out" },
    );
    const b = next.animate(
      [
        { opacity: 0, transform: "translateY(3px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: MOTION.titleDuration, easing: "ease-out" },
    );
    return () => {
      a.cancel();
      b.cancel();
    };
  }, [text, reduced]);
  return (
    <span className="title-transition" ref={root}>
      <span aria-hidden="true">{old.current}</span>
      <span>{text}</span>
    </span>
  );
}
