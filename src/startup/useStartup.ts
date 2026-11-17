import { useLayoutEffect, useRef } from "react";
import { usePreferences } from "../interaction/preferences";
import { startup } from "./controller";
import { ReturnController } from "./return";
import "./startup.css";
const key = Symbol.for("synapse.return.controller");
const shared = globalThis as unknown as Record<symbol, ReturnController>;
export const foregroundReturn = (shared[key] ??= new ReturnController(
  () => startup.settled,
));
export function foreground(value: boolean) {
  startup.foreground(value);
  foregroundReturn.foreground(value);
}
export function useStartup(ready: boolean, reduced: boolean, blocked: boolean) {
  const root = useRef<HTMLElement>(null),
    { startupAnimation, returnAnimation } = usePreferences();
  useLayoutEffect(() => startup.attach(root.current!), []);
  useLayoutEffect(() => foregroundReturn.attach(root.current!), []);
  useLayoutEffect(
    () =>
      startup.update({ ready, reduced, enabled: startupAnimation, blocked }),
    [ready, reduced, startupAnimation, blocked],
  );
  useLayoutEffect(
    () =>
      foregroundReturn.update({
        ready,
        reduced,
        enabled: returnAnimation,
        blocked,
      }),
    [ready, reduced, returnAnimation, blocked],
  );
  return root;
}
