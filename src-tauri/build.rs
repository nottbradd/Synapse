fn main() {
    println!("cargo:rerun-if-env-changed=SYNAPSE_AI_URL");
    if let Ok(url) = std::env::var("SYNAPSE_AI_URL") {
        assert!(
            url.starts_with("https://")
                && !url.contains('@')
                && !url.contains('?')
                && !url.contains('#'),
            "SYNAPSE_AI_URL must be a public HTTPS service origin, never a credential"
        );
    }
    tauri_build::build()
}
