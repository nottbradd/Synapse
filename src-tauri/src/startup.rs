use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

pub struct Launch {
    id: String,
    consumed: AtomicBool,
}
impl Default for Launch {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            consumed: AtomicBool::new(false),
        }
    }
}
#[derive(Serialize)]
pub struct Claim {
    id: String,
    foreground: bool,
    granted: bool,
}
impl Launch {
    fn claim(&self, foreground: bool) -> Claim {
        Claim {
            id: self.id.clone(),
            foreground,
            granted: foreground
                && self
                    .consumed
                    .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                    .is_ok(),
        }
    }
}
// A frontend reload (including unavailable session storage) cannot replay an
// already presented launch. A background query never consumes the opportunity.
#[tauri::command]
pub fn claim_startup(window: tauri::WebviewWindow, launch: tauri::State<'_, Launch>) -> Claim {
    launch.claim(
        window.is_visible().unwrap_or(false)
            && window.is_focused().unwrap_or(false)
            && !window.is_minimized().unwrap_or(true),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_first_foreground_claim_wins_for_the_entire_native_process() {
        let launch = Launch::default();
        assert!(!launch.claim(false).granted);
        assert!(launch.claim(true).granted);
        assert!(!launch.claim(true).granted);
        assert!(!launch.claim(false).granted);
        let next = Launch::default();
        assert_ne!(launch.id, next.id);
        assert!(next.claim(true).granted);
    }
}
