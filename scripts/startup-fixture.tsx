// Browser-only lifecycle fixture, never imported by the production app.
import { StrictMode, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import type {
  StartupController,
  StartupState,
} from "../src/startup/controller";
export function mountStrict(
  controller: StartupController,
  target: HTMLElement,
  state: StartupState,
) {
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  function Fixture() {
    useLayoutEffect(() => {
      const detach = controller.attach(target);
      controller.update(state);
      return detach;
    }, []);
    return null;
  }
  root.render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
  return () => {
    root.unmount();
    host.remove();
  };
}
