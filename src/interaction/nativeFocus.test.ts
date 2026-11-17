import { expect, it, vi } from "vitest";
import { attachNativeFocus } from "./nativeFocus";

it("recovers missed native focus events and coalesces native/DOM notifications", async () => {
  const dom = new EventTarget(),
    visibility = new EventTarget(),
    notify = vi.fn();
  let focused = false;
  let nativeEvent: (event: { payload: boolean }) => void = () => {};
  const remove = vi.fn();
  const api = {
    isFocused: vi.fn(async () => focused),
    onFocusChanged: async (callback: typeof nativeEvent) => {
      nativeEvent = callback;
      return remove;
    },
  };
  const detach = attachNativeFocus(api, notify, dom, visibility);
  await new Promise((resolve) => setTimeout(resolve, 0));
  focused = true;
  dom.dispatchEvent(new Event("focus"));
  await Promise.resolve();
  nativeEvent({ payload: true });
  visibility.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();
  focused = false;
  dom.dispatchEvent(new Event("blur"));
  await Promise.resolve();
  expect(notify.mock.calls.map(([value]) => value)).toEqual([
    false,
    true,
    false,
  ]);
  detach();
  await Promise.resolve();
  const count = api.isFocused.mock.calls.length;
  dom.dispatchEvent(new Event("focus"));
  expect(api.isFocused).toHaveBeenCalledTimes(count);
  expect(remove).toHaveBeenCalledOnce();
});

it("ignores stale native queries and results after unmount", async () => {
  const dom = new EventTarget(),
    visibility = new EventTarget(),
    notify = vi.fn();
  const pending: ((value: boolean) => void)[] = [];
  let nativeEvent: (event: { payload: boolean }) => void = () => {};
  const detach = attachNativeFocus(
    {
      isFocused: () => new Promise<boolean>((resolve) => pending.push(resolve)),
      onFocusChanged: async (callback) => {
        nativeEvent = callback;
        return () => {};
      },
    },
    notify,
    dom,
    visibility,
  );
  await Promise.resolve();
  nativeEvent({ payload: true });
  pending.splice(0).forEach((resolve) => resolve(false));
  await Promise.resolve();
  expect(notify.mock.calls).toEqual([[true]]);
  dom.dispatchEvent(new Event("blur"));
  detach();
  pending.splice(0).forEach((resolve) => resolve(false));
  await Promise.resolve();
  expect(notify.mock.calls).toEqual([[true]]);
});
