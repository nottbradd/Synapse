//! The desktop holds only its revocable device credential. The owner key never enters this crate.
use crate::{
    ai::{self, Context, Generate},
    device::{self, Device, Provider},
    errors::{Error, Result},
    study,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Credential {
    origin: String,
    device: String,
    token: String,
    member: Option<String>,
}
impl Drop for Credential {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.token.zeroize();
    }
}
fn credential_error() -> Error {
    Error::new(
        "credentials",
        "Synapse AI device access could not be read or saved in Windows Credential Manager",
    )
}
#[cfg(target_os = "windows")]
fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(
        if test_endpoint().is_some() {
            "com.synapse.study.qa.hosted"
        } else {
            "com.synapse.study.hosted"
        },
        "Synapse AI device",
    )
    .map_err(|_| credential_error())
}
fn read() -> Result<Option<Credential>> {
    #[cfg(target_os = "windows")]
    {
        match entry()?.get_password() {
            Ok(value) => {
                let value = Zeroizing::new(value);
                let c: Credential = serde_json::from_str(&value).map_err(|_| credential_error())?;
                if !valid_token(&c.token) || study::uuid(&c.device).is_err() {
                    return Err(credential_error());
                }
                Ok(Some(c))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(credential_error()),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err(credential_error())
    }
}
fn write(credential: &Credential) -> Result<()> {
    let value = Zeroizing::new(serde_json::to_string(credential).map_err(|_| credential_error())?);
    #[cfg(target_os = "windows")]
    {
        entry()?
            .set_password(&value)
            .map_err(|_| credential_error())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = value;
        Err(credential_error())
    }
}
fn remove() -> Result<()> {
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
fn valid_token(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn origin(value: &str, local: bool) -> Option<String> {
    let url = reqwest::Url::parse(value).ok()?;
    if (!local && url.scheme() != "https")
        || (local && (url.scheme() != "http" || url.host_str() != Some("127.0.0.1")))
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return None;
    }
    Some(url.as_str().trim_end_matches('/').to_string())
}
fn test_endpoint() -> Option<String> {
    #[cfg(all(debug_assertions, feature = "test-api"))]
    {
        return std::env::var("SYNAPSE_TEST_HOSTED_URL")
            .ok()
            .and_then(|s| origin(&s, true));
    }
    #[cfg(not(all(debug_assertions, feature = "test-api")))]
    None
}
pub fn endpoint() -> Result<String> {
    test_endpoint().or_else(|| option_env!("SYNAPSE_AI_URL").and_then(|s| origin(s, false)))
        .ok_or_else(|| Error::new("hosted_unavailable", "Synapse AI is not configured in this build. Saved study material and manual drafts are available."))
}
pub fn testing() -> bool {
    test_endpoint().is_some()
}
pub fn connected() -> bool {
    read()
        .ok()
        .flatten()
        .is_some_and(|c| c.member.is_some() && endpoint().is_ok_and(|e| e == c.origin))
}
pub fn error(reason: &str) -> Error {
    let message = match reason {
        "daily_allowance" => "Your daily Synapse AI allowance is used. Check the reset time in Settings; your personal key will not be used automatically.",
        "shared_budget" => "The shared Synapse AI budget cannot cover this request. The owner must review the service budget. Your personal key will not be used automatically.",
        "rate_limit" => "Synapse AI allows a limited number of generations each minute. Wait for the retry time shown in Settings.",
        "generation_active" => "A generation for your account is still active or awaiting confirmation, possibly on another device. If this persists, ask the owner to review it.",
        "service_paused" => "The owner has paused Synapse AI. Saved study material and local reminders remain available.",
        "service_expired" => "The Synapse AI service period has ended. The owner must review funding and explicitly extend it.",
        "revoked" => "Synapse AI access for this account or device is disabled or revoked. Contact the owner.",
        "invalid_invite" => "This invitation is expired, already used, or invalid. Ask the owner for an invitation for your existing account.",
        "enrollment_closed" | "seats_full" => "Synapse AI enrollment is currently closed or at capacity. Contact the owner.",
        "already_submitted" => "This generation was already submitted. It was not sent to OpenAI again. An interrupted draft cannot be recovered; a new explicit generation uses another allowance.",
        "invalid_request" | "too_large" => "This selection exceeds a Synapse AI task limit or is invalid. Use up to 10 quiz questions or 20 flashcards and fewer or shorter source notes.",
        "invalid_output" => "Synapse AI returned an invalid or incomplete draft. Nothing was saved; the attempt still counts toward your allowance.",
        _ => "Synapse AI is unavailable. No personal key was used. Saved study material, editing and local reminders remain available.",
    };
    // Never return raw upstream messages, request bodies or credential diagnostics.
    Error::new("hosted", message)
}
async fn call(
    device: &Device,
    credential: &Credential,
    route: &str,
    body: Value,
    cancel: &CancellationToken,
) -> Result<Value> {
    let service = endpoint()?;
    if credential.origin != service {
        return Err(error("revoked"));
    }
    let bearer = Zeroizing::new(format!("{}.{}", credential.device, credential.token));
    post_to(
        &device.client,
        &format!("{service}/v1/{route}"),
        &bearer,
        body,
        cancel,
    )
    .await
}
async fn post_to(
    client: &reqwest::Client,
    url: &str,
    bearer: &str,
    body: Value,
    cancel: &CancellationToken,
) -> Result<Value> {
    let request = async {
        let mut response = client
            .post(url)
            .bearer_auth(bearer)
            .json(&body)
            .send()
            .await
            .map_err(|_| error("service_unavailable"))?;
        let success = response.status().is_success();
        let mut bytes = vec![];
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| error("service_unavailable"))?
        {
            if bytes.len() + chunk.len() > 262144 {
                return Err(error("invalid_output"));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value: Value =
            serde_json::from_slice(&bytes).map_err(|_| error("service_unavailable"))?;
        if !success {
            return Err(error(
                value["error"].as_str().unwrap_or("service_unavailable"),
            ));
        }
        Ok(value)
    };
    tokio::select! { biased; _ = cancel.cancelled() => Err(ai::cancelled()), value = request => value }
}
fn credential(device: &Device) -> Result<Credential> {
    if !device.get()?.hosted_consent {
        return Err(Error::new(
            "hosted_consent",
            "Read and accept the Synapse AI data notice in Settings first.",
        ));
    }
    read()?.filter(|c| c.member.is_some()).ok_or_else(|| {
        Error::new(
            "hosted_enrollment",
            "Activate Synapse AI with your invitation in Settings, or start a manual draft.",
        )
    })
}
pub async fn enroll(device: &Device, invitation: String, consent: bool) -> Result<()> {
    if !consent {
        return Err(Error::new(
            "hosted_consent",
            "Accept the Synapse AI data notice before activation.",
        ));
    }
    let invitation = Zeroizing::new(invitation);
    if !valid_token(invitation.trim()) {
        return Err(error("invalid_invite"));
    }
    let service = endpoint()?;
    let mut c = match read()? {
        Some(c) if c.origin == service => c,
        Some(_) => {
            return Err(Error::new(
                "hosted_enrollment",
                "Forget the previous service credential before activating this service.",
            ))
        }
        None => {
            let mut random = Zeroizing::new([0u8; 32]);
            getrandom::fill(&mut *random).map_err(|_| credential_error())?;
            Credential {
                origin: service,
                device: study::id(),
                token: random.iter().map(|v| format!("{v:02x}")).collect(),
                member: None,
            }
        }
    };
    // Persist before submitting so a lost enrollment response can reuse the same credential.
    write(&c)?;
    let response = call(
        device,
        &c,
        "enroll",
        json!({"invite":invitation.trim()}),
        &CancellationToken::new(),
    )
    .await?;
    let member = response["member"]
        .as_str()
        .filter(|v| study::uuid(v).is_ok())
        .ok_or_else(|| error("service_unavailable"))?;
    if response["device"].as_str() != Some(&c.device) {
        return Err(error("service_unavailable"));
    }
    c.member = Some(member.into());
    write(&c)?;
    device.update(|config| {
        config.hosted_consent = true;
        config.provider = Provider::Synapse;
        Ok(())
    })
}
pub async fn status(device: &Device) -> Result<Value> {
    call(
        device,
        &credential(device)?,
        "status",
        json!({}),
        &CancellationToken::new(),
    )
    .await
}
pub async fn forget(device: &Device) -> Result<()> {
    // Explicitly revoke on the server before deleting locally. Offline forgetting is separate.
    if let Some(c) = read()? {
        call(device, &c, "forget", json!({}), &CancellationToken::new()).await?;
    }
    remove()?;
    device.update(|c| {
        c.hosted_consent = false;
        Ok(())
    })
}
pub fn forget_local(device: &Device) -> Result<()> {
    remove()?;
    device.update(|c| {
        c.hosted_consent = false;
        Ok(())
    })
}
pub fn payload(request: &Generate, context: &Context, config: &device::Config) -> Value {
    json!({"request_id":request.request_id,"kind":request.kind,"prompt":request.prompt,"count":request.count,
        "timezone":config.timezone,"current_subject_id":context.location.subject_id,
        "sources":context.sources.iter().map(|s|json!({"id":s.source.id,"title":s.source.title,"subject_id":s.source.subject_id,"content":s.content})).collect::<Vec<_>>()})
}
pub async fn generate(
    device: &Device,
    request: &Generate,
    context: &Context,
    cancel: &CancellationToken,
) -> Result<Value> {
    let config = device.get()?;
    if request.kind == ai::Kind::Quiz && request.count > 10 {
        return Err(error("too_large"));
    }
    call(
        device,
        &credential(device)?,
        "generate",
        payload(request, context, &config),
        cancel,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Duration,
    };
    fn server(status: u16, body: String, delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = [0; 8192];
                let _ = stream.read(&mut bytes);
                std::thread::sleep(delay);
                let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len());
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{address}/v1/generate")
    }
    #[tokio::test(flavor = "current_thread")]
    async fn mocked_gateway_transport_redacts_failures_and_never_retries_or_uses_a_personal_key() {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let cancel = CancellationToken::new();
        let url = server(
            429,
            json!({"error":"daily_allowance","message":"sk-owner-secret private note"}).to_string(),
            Duration::ZERO,
        );
        let e = post_to(&client, &url, "synthetic-device-only", json!({}), &cancel)
            .await
            .unwrap_err();
        assert!(e.message.contains("daily"));
        assert!(!e.message.contains("sk-owner-secret"));
        let url = server(
            200,
            json!({"accounting":"reserved","usage":null}).to_string(),
            Duration::ZERO,
        );
        let received = post_to(&client, &url, "synthetic-device-only", json!({}), &cancel)
            .await
            .unwrap();
        assert_eq!(received["accounting"], "reserved");
        let url = server(200, "x".repeat(262145), Duration::ZERO);
        assert!(
            post_to(&client, &url, "synthetic-device-only", json!({}), &cancel)
                .await
                .is_err()
        );
        let cancel = CancellationToken::new();
        cancel.cancel();
        let e = post_to(
            &client,
            "http://127.0.0.1:1/v1/generate",
            "synthetic-device-only",
            json!({}),
            &cancel,
        )
        .await
        .unwrap_err();
        assert_eq!(e.code, "cancelled");
    }
    #[tokio::test(flavor = "current_thread")]
    async fn mocked_gateway_timeout_and_invalid_json_publish_no_result() {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(30))
            .build()
            .unwrap();
        let cancel = CancellationToken::new();
        let url = server(
            200,
            json!({"ok":true}).to_string(),
            Duration::from_millis(150),
        );
        assert!(
            post_to(&client, &url, "synthetic-device-only", json!({}), &cancel)
                .await
                .is_err()
        );
        let url = server(200, "private provider failure".into(), Duration::ZERO);
        let e = post_to(&client, &url, "synthetic-device-only", json!({}), &cancel)
            .await
            .unwrap_err();
        assert!(!e.message.contains("private provider"));
    }
    #[test]
    fn origins_cannot_smuggle_credentials_paths_or_plaintext_transport() {
        for url in [
            "http://example.com",
            "https://key@example.com",
            "https://example.com?key=x",
            "https://example.com/v1",
            "https://example.com/#token",
        ] {
            assert!(origin(url, false).is_none());
        }
        assert_eq!(
            origin("https://synapse.example/", false).as_deref(),
            Some("https://synapse.example")
        );
        assert!(origin("http://localhost:1234", true).is_none());
        assert!(origin("http://127.0.0.1:1234", true).is_some());
    }
    #[test]
    fn remote_errors_never_reflect_supplied_text_or_suggest_automatic_fallback() {
        let e = error("private note sk-private-token");
        assert!(!e.message.contains("sk-private"));
        assert!(e.message.contains("No personal key"));
        assert!(error("daily_allowance")
            .message
            .contains("not be used automatically"));
    }
}
