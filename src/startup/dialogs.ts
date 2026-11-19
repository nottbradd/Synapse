import {
  open as nativeOpen,
  save as nativeSave,
} from "@tauri-apps/plugin-dialog";
import { withNativeDialog } from "./suppression";
export const open = (options: Parameters<typeof nativeOpen>[0]) =>
  withNativeDialog(() => nativeOpen(options));
export const save = (options: Parameters<typeof nativeSave>[0]) =>
  withNativeDialog(() => nativeSave(options));
