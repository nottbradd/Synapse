import { useCallback, useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { message } from "../types";
import type { StudyView } from "../study";
export function useStudy(root?: string) {
  const [result, setResult] = useState<{
    root: string;
    view?: StudyView;
    error?: string;
  }>();
  const serial = useRef(0);
  const refresh = useCallback(async () => {
    if (!root || !isTauri()) return;
    const request = ++serial.current;
    try {
      const view = await invoke<StudyView>("study_list", { vaultRoot: root });
      if (request === serial.current) setResult({ root, view });
    } catch (e) {
      if (request === serial.current) setResult({ root, error: message(e) });
    }
  }, [root]);
  useEffect(() => {
    let active = true;
    void refresh();
    const unlisten = listen<string>("study-changed", (e) => {
      if (e.payload === root) void refresh();
    });
    const unerror = listen<string>("study-error", (e) => {
      if (active && root)
        setResult((previous) => ({ ...previous, root, error: e.payload }));
    });
    return () => {
      active = false;
      void unlisten.then((f) => f());
      void unerror.then((f) => f());
    };
  }, [refresh, root]);
  return {
    view: result?.root === root ? result?.view : undefined,
    error: result?.root === root ? result?.error : undefined,
    refresh,
  };
}
