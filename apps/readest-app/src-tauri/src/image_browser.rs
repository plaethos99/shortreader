//! The browser window pictures are made in.
//!
//! Google Flow and Grok Imagine have no public API for making pictures, and
//! Google refuses sign-in inside embedded app webviews, so ShortReader opens
//! the site in a real Microsoft Edge or Google Chrome window with a profile of
//! its own (the reader's everyday profile, passwords and cookies are never
//! touched) and the DevTools protocol on a local port. The reader signs in
//! there once; the profile keeps the session. The app then drives the page
//! over that port (services/imagegen/core.ts).
//!
//! The site's address and port are fixed here, not taken from the page, so
//! the command can only ever open these two sites. Keep them in sync with
//! `SITES` in services/imagegen/core.ts.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn site(name: &str) -> Option<(&'static str, u16)> {
    match name {
        "flow" => Some(("https://flow.google.com/", 9434)),
        "imagine" => Some(("https://grok.com/imagine", 9460)),
        _ => None,
    }
}

fn find_browser() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "windows")]
    {
        for base in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
            if let Ok(dir) = std::env::var(base) {
                let dir = PathBuf::from(dir);
                candidates.push(dir.join(r"Microsoft\Edge\Application\msedge.exe"));
                candidates.push(dir.join(r"Google\Chrome\Application\chrome.exe"));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge".into());
        candidates.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome".into());
        if let Ok(home) = std::env::var("HOME") {
            let home = PathBuf::from(home);
            candidates.push(home.join("Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"));
            candidates.push(home.join("Applications/Google Chrome.app/Contents/MacOS/Google Chrome"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(path) = std::env::var("PATH") {
            for dir in std::env::split_paths(&path) {
                for name in [
                    "microsoft-edge",
                    "google-chrome",
                    "google-chrome-stable",
                    "chromium",
                    "chromium-browser",
                ] {
                    candidates.push(dir.join(name));
                }
            }
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

/// Open Google Flow ("flow") or Grok Imagine ("imagine") in its own browser
/// window with DevTools on the site's local port.
#[tauri::command]
pub async fn launch_image_browser(app: AppHandle, site_name: String) -> Result<(), String> {
    let (url, port) = site(&site_name).ok_or_else(|| format!("Unknown picture site {site_name}"))?;
    let browser = find_browser().ok_or_else(|| {
        "Pictures are made in Microsoft Edge or Google Chrome; neither was found on this computer."
            .to_string()
    })?;
    let profile = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("image-browser")
        .join(format!("{site_name}-profile"));
    std::fs::create_dir_all(&profile).map_err(|e| e.to_string())?;

    std::process::Command::new(browser)
        .arg(format!("--remote-debugging-port={port}"))
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        // Keeps the page working at full speed while its window is minimized
        // or behind others; a hidden tab is otherwise throttled to a crawl.
        .arg("--disable-background-timer-throttling")
        .arg("--disable-renderer-backgrounding")
        .arg("--disable-backgrounding-occluded-windows")
        .arg(url)
        .spawn()
        .map_err(|e| format!("Could not open the browser: {e}"))?;
    Ok(())
}
