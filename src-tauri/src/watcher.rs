use crate::{commands::Inner, vault};
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex, Weak,
    },
    time::Duration,
};
use tauri::Emitter;
pub struct Guard {
    _watcher: RecommendedWatcher,
    stop: Arc<AtomicBool>,
}
impl Drop for Guard {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}
pub fn start(
    root: &Path,
    state: Weak<Mutex<Inner>>,
    app: tauri::AppHandle,
) -> crate::errors::Result<Guard> {
    let (tx, rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let _ = tx.send(event);
    })
    .map_err(|e| crate::errors::Error::new("watcher", e))?;
    watcher
        .watch(root, RecursiveMode::Recursive)
        .map_err(|e| crate::errors::Error::new("watcher", e))?;
    let root = root.to_owned();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    std::thread::spawn(move || {
        while !stopped.load(Ordering::Relaxed) {
            let event = match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(e) => e,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => break,
            };
            let relevant = match event {
                Ok(e) => {
                    !matches!(e.kind, notify::EventKind::Access(_))
                        && e.paths.iter().any(|p| {
                            p.extension().is_some_and(|e| e.eq_ignore_ascii_case("md"))
                                || p.file_name().is_some_and(|n| n == "flashcards.json")
                                || p.is_dir()
                                || matches!(
                                    e.kind,
                                    notify::EventKind::Remove(_)
                                        | notify::EventKind::Modify(
                                            notify::event::ModifyKind::Name(_)
                                        )
                                )
                        })
                }
                Err(e) => {
                    let _ = app.emit("watcher-error", e.to_string());
                    false
                }
            };
            if !relevant {
                continue;
            }
            // A bounded quiet period coalesces editor save/rename bursts.
            for _ in 0..8 {
                if rx.recv_timeout(Duration::from_millis(150)).is_err() {
                    break;
                }
            }
            if stopped.load(Ordering::Relaxed) {
                break;
            }
            let Some(state) = state.upgrade() else {
                break;
            };
            let Ok(mut inner) = state.lock() else {
                break;
            };
            if inner.root.as_ref() != Some(&root) {
                break;
            }
            match vault::scan(&root) {
                Ok(snapshot) => {
                    let signature = serde_json::to_string(&snapshot).unwrap_or_default();
                    if signature != inner.signature {
                        inner.signature = signature;
                        inner.snapshot = Some(snapshot.clone());
                        let _ = app.emit("vault-changed", snapshot);
                    }
                }
                Err(e) => {
                    let _ = app.emit("watcher-error", e.message);
                }
            }
        }
    });
    Ok(Guard {
        _watcher: watcher,
        stop,
    })
}
