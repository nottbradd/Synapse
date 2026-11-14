use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum Subject {
    Specialist,
    Methods,
    Physics,
    EnglishLanguage,
    #[default]
    General,
}
pub fn recognized(value: &str) -> Option<Subject> {
    match value
        .trim()
        .to_lowercase()
        .replace([' ', '_'], "-")
        .as_str()
    {
        "specialist" | "specialist-mathematics" | "spesh" => Some(Subject::Specialist),
        "methods" | "mathematical-methods" => Some(Subject::Methods),
        "physics" => Some(Subject::Physics),
        "english-language" | "englang" => Some(Subject::EnglishLanguage),
        "general" | "unassigned" => Some(Subject::General),
        _ => None,
    }
}
