use crate::{
    errors::{Error, Result},
    notes, study, vault,
};
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use zeroize::Zeroizing;

pub const MODELS: [&str; 2] = ["gpt-5.4-mini", "gpt-5.4"];
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Synapse,
    Personal,
}
fn legacy_provider() -> Provider {
    Provider::Personal
}
#[derive(Clone, Default, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Usage {
    pub requests: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub last_request_at: Option<i64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub schema_version: u32,
    // Missing fields in an existing installation preserve its personal-key provider.
    #[serde(default = "legacy_provider")]
    pub provider: Provider,
    #[serde(default)]
    pub hosted_consent: bool,
    pub model: String,
    pub max_output_tokens: u32,
    pub timezone: String,
    pub background: bool,
    pub reminder_vaults: Vec<String>,
    pub usage: Usage,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            schema_version: 1,
            provider: Provider::Synapse,
            hosted_consent: false,
            model: MODELS[0].into(),
            max_output_tokens: 4096,
            timezone: "Australia/Sydney".into(),
            background: false,
            reminder_vaults: vec![],
            usage: Usage::default(),
        }
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettingsInput {
    pub model: String,
    pub max_output_tokens: u32,
    pub timezone: String,
    pub background: bool,
}
#[derive(Serialize)]
pub struct SettingsView {
    pub test_api: bool,
    pub provider: Provider,
    pub hosted_consent: bool,
    pub hosted_configured: bool,
    pub hosted_connected: bool,
    pub model: String,
    pub models: Vec<String>,
    pub max_output_tokens: u32,
    pub timezone: String,
    pub background: bool,
    pub key_present: bool,
    pub usage: Usage,
    pub error: Option<String>,
}
pub struct Device {
    pub config: Mutex<Config>,
    pub directory: PathBuf,
    pub config_error: Option<String>,
    pub client: reqwest::Client,
    pub started_at: i64,
}
impl Device {
    pub fn new(directory: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&directory)?;
        let directory = directory.canonicalize()?;
        let path = vault::contained(&directory, "device.json", false)?;
        let loaded = if path.exists() {
            if std::fs::metadata(&path)?.len() > 128 * 1024 {
                Err(study::invalid(
                    "Device settings exceed the size limit; original file preserved",
                ))
            } else {
                std::fs::read_to_string(&path)
                    .map_err(Error::from)
                    .and_then(|s| {
                        serde_json::from_str::<Config>(&s).map_err(|_| {
                            study::invalid("Device settings are invalid; original file preserved")
                        })
                    })
                    .and_then(|c| {
                        validate(&c)?;
                        Ok(c)
                    })
            }
        } else {
            let mut config = Config::default();
            // A saved credential can predate device.json. Do not change its billing provider.
            if test_api_url().is_some() || OsCredential.read().is_ok_and(|key| key.is_some()) {
                config.provider = Provider::Personal;
            }
            Ok(config)
        };
        let (config, config_error) = match loaded {
            Ok(c) => (c, None),
            Err(e) => (Config::default(), Some(e.message)),
        };
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|_| Error::new("network", "Unable to initialise the secure API connection"))?;
        Ok(Self {
            config: Mutex::new(config),
            directory,
            config_error,
            client,
            started_at: study::now(),
        })
    }
    pub fn get(&self) -> Result<Config> {
        if let Some(error) = &self.config_error {
            return Err(Error::new("config", error));
        }
        Ok(self
            .config
            .lock()
            .map_err(|_| study::invalid("Device settings are busy"))?
            .clone())
    }
    pub fn update(&self, f: impl FnOnce(&mut Config) -> Result<()>) -> Result<()> {
        if let Some(error) = &self.config_error {
            return Err(Error::new("config", error));
        }
        let mut config = self
            .config
            .lock()
            .map_err(|_| study::invalid("Device settings are busy"))?;
        let mut next = config.clone();
        f(&mut next)?;
        validate(&next)?;
        let path = vault::contained(&self.directory, "device.json", false)?;
        let revision = if path.exists() {
            Some(notes::hash(&std::fs::read_to_string(path)?))
        } else {
            None
        };
        vault::atomic_write(
            &self.directory,
            "device.json",
            &serde_json::to_string_pretty(&next)?,
            revision.as_deref(),
            false,
        )?;
        *config = next;
        Ok(())
    }
    pub fn register(&self, root: &std::path::Path) -> Result<()> {
        let value = root.to_string_lossy().to_string();
        self.update(|c| {
            if !c.reminder_vaults.contains(&value) {
                c.reminder_vaults.push(value);
            }
            Ok(())
        })
    }
    pub fn usage(&self, input: u64, output: u64) -> Result<()> {
        self.update(|c| {
            c.usage.requests = c.usage.requests.saturating_add(1);
            c.usage.input_tokens = c.usage.input_tokens.saturating_add(input);
            c.usage.output_tokens = c.usage.output_tokens.saturating_add(output);
            c.usage.last_request_at = Some(study::now());
            Ok(())
        })
    }
}
fn validate(c: &Config) -> Result<()> {
    if c.schema_version != 1
        || !MODELS.contains(&c.model.as_str())
        || !(512..=16_384).contains(&c.max_output_tokens)
        || c.reminder_vaults.len() > 100
    {
        return Err(study::invalid(
            "Unsupported model, settings version or output limit (512–16384 tokens)",
        ));
    }
    study::timezone(&c.timezone)?;
    Ok(())
}
// Only this module touches the OS credential store. No command returns this value.
pub trait CredentialStore {
    fn read(&self) -> Result<Option<Zeroizing<String>>>;
    fn write(&self, key: &str) -> Result<()>;
    fn remove(&self) -> Result<()>;
}
pub struct OsCredential;
fn credential_error() -> Error {
    Error::new("credentials", "Windows Credential Manager is unavailable. The key was not exposed or stored in ordinary settings.")
}
#[cfg(target_os = "windows")]
fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(
        if test_api_url().is_some() || crate::hosted::testing() {
            "com.synapse.study.qa"
        } else {
            "com.synapse.study"
        },
        "OpenAI API key",
    )
    .map_err(|_| credential_error())
}
impl CredentialStore for OsCredential {
    fn read(&self) -> Result<Option<Zeroizing<String>>> {
        #[cfg(target_os = "windows")]
        {
            match entry()?.get_password() {
                Ok(s) => Ok(Some(Zeroizing::new(s))),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(_) => Err(credential_error()),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err(credential_error())
        }
    }
    fn write(&self, key: &str) -> Result<()> {
        if key.len() < 16
            || key.len() > 512
            || !key.is_ascii()
            || key.chars().any(char::is_whitespace)
        {
            return Err(Error::new(
                "credentials",
                "Enter an API key without whitespace (16–512 characters)",
            ));
        }
        #[cfg(target_os = "windows")]
        {
            entry()?.set_password(key).map_err(|_| credential_error())
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err(credential_error())
        }
    }
    fn remove(&self) -> Result<()> {
        #[cfg(target_os = "windows")]
        {
            match entry()?.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(credential_error()),
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err(credential_error())
        }
    }
}
pub fn view(device: &Device) -> SettingsView {
    let c = device.config.lock().map(|c| c.clone()).unwrap_or_default();
    let key = OsCredential.read();
    SettingsView {
        test_api: test_api_url().is_some() || crate::hosted::testing(),
        provider: c.provider,
        hosted_consent: c.hosted_consent,
        hosted_configured: crate::hosted::endpoint().is_ok(),
        hosted_connected: crate::hosted::connected(),
        model: c.model,
        models: MODELS.iter().map(|s| s.to_string()).collect(),
        max_output_tokens: c.max_output_tokens,
        timezone: c.timezone,
        background: c.background,
        key_present: key.as_ref().is_ok_and(|k| k.is_some()),
        usage: c.usage,
        error: device
            .config_error
            .clone()
            .or_else(|| key.err().map(|e| e.message)),
    }
}
pub fn test_api_url() -> Option<String> {
    #[cfg(all(debug_assertions, feature = "test-api"))]
    {
        let value = std::env::var("SYNAPSE_TEST_API_URL").ok()?;
        let url = reqwest::Url::parse(&value).ok()?;
        if url.scheme() == "http"
            && url.host_str() == Some("127.0.0.1")
            && url.path() == "/v1/responses"
            && url.username().is_empty()
            && url.password().is_none()
        {
            return Some(value);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_settings_keep_personal_provider_and_all_other_preferences() {
        let mut previous = serde_json::to_value(Config::default()).unwrap();
        previous.as_object_mut().unwrap().remove("provider");
        previous.as_object_mut().unwrap().remove("hosted_consent");
        previous["max_output_tokens"] = 8192.into();
        previous["background"] = true.into();
        previous["usage"]["requests"] = 42.into();
        let migrated: Config = serde_json::from_value(previous).unwrap();
        assert_eq!(migrated.provider, Provider::Personal);
        assert!(!migrated.hosted_consent);
        assert_eq!(migrated.max_output_tokens, 8192);
        assert!(migrated.background);
        assert_eq!(migrated.usage.requests, 42);
        assert_eq!(Config::default().provider, Provider::Synapse);
    }
    #[test]
    fn explicit_provider_roundtrip_is_independent_of_personal_model_and_usage() {
        let config = Config {
            provider: Provider::Synapse,
            hosted_consent: true,
            model: MODELS[1].into(),
            ..Config::default()
        };
        let decoded: Config =
            serde_json::from_str(&serde_json::to_string(&config).unwrap()).unwrap();
        assert_eq!(decoded.provider, Provider::Synapse);
        assert_eq!(decoded.model, MODELS[1]);
        assert!(decoded.hosted_consent);
    }
}
