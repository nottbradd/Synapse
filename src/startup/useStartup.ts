import { useLayoutEffect, useRef } from "react";
import { usePreferences } from "../interaction/preferences";
import { startup } from "./controller";
import "./startup.css";
export function useStartup(ready: boolean, reduced: boolean, blocked: boolean) {
  const root = useRef<HTMLElement>(null),
    { startupAnimation } = usePreferences();
  useLayoutEffect(() => startup.attach(root.current!), []);
  useLayoutEffect(
    () =>
      startup.update({ ready, reduced, enabled: startupAnimation, blocked }),
    [ready, reduced, startupAnimation, blocked],
  );
  return root;
}
