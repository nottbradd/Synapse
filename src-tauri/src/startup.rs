use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

// Showing a hidden WebView2 window need not change its already-focused DOM or
// produce a window focus event. Notify readiness explicitly, without claiming
// that Windows granted focus. The frontend still queries native focus/visibility.
pub fn show(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    use tauri::Emitter;
    #[cfg(windows)]
    tint_caption(window);
    window.show()?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    window.emit("synapse-window-shown", ())
}

#[cfg(windows)]
fn tint_caption(window: &tauri::WebviewWindow) {
    use tauri::Manager;
    use windows::Win32::{
        Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_COLOR_DEFAULT},
        UI::{
            Accessibility::{HCF_HIGHCONTRASTON, HIGHCONTRASTW},
            WindowsAndMessaging::{SystemParametersInfoW, SPI_GETHIGHCONTRAST},
        },
    };

    let background = window
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == window.label())
        .and_then(|config| config.background_color);
    let (Some(background), Ok(hwnd)) = (background, window.hwnd()) else {
        return;
    };
    let mut contrast = HIGHCONTRASTW {
        cbSize: std::mem::size_of::<HIGHCONTRASTW>() as u32,
        ..Default::default()
    };
    // SPI fills this sized structure synchronously. Leave contrast themes in Windows' control.
    let queried = unsafe {
        SystemParametersInfoW(
            SPI_GETHIGHCONTRAST,
            contrast.cbSize,
            Some((&raw mut contrast).cast()),
            Default::default(),
        )
    };
    let colour = if queried.is_ok() && !contrast.dwFlags.contains(HCF_HIGHCONTRASTON) {
        u32::from_le_bytes([background.0, background.1, background.2, 0])
    } else {
        DWMWA_COLOR_DEFAULT
    };
    // DWM copies the COLORREF during the call. Older Windows retains the native light theme.
    unsafe {
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_CAPTION_COLOR,
            (&raw const colour).cast(),
            std::mem::size_of_val(&colour) as u32,
        );
    }
}

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
    visible: bool,
}
impl Launch {
    fn claim(&self, foreground: bool, visible: bool) -> Claim {
        Claim {
            id: self.id.clone(),
            foreground,
            visible,
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
    let visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true);
    launch.claim(visible && window.is_focused().unwrap_or(false), visible)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_first_foreground_claim_wins_for_the_entire_native_process() {
        let launch = Launch::default();
        assert!(!launch.claim(false, false).visible);
        assert!(!launch.claim(false, true).granted);
        assert!(launch.claim(true, true).granted);
        assert!(!launch.claim(true, true).granted);
        assert!(!launch.claim(false, false).granted);
        let next = Launch::default();
        assert_ne!(launch.id, next.id);
        assert!(next.claim(true, true).granted);
    }
}
