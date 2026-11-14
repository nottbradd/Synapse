use crate::{
    errors::{Error, Result},
    subjects::{self, Subject},
};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub subject: Subject,
    #[serde(default)]
    pub subject_id: String,
    #[serde(default)]
    pub neuron_id: String,
    pub revision: String,
    pub neighbors: usize,
}
#[derive(Debug, Clone, Serialize)]
pub struct Document {
    pub id: String,
    pub content: String,
    pub revision: String,
}
#[derive(Default, Deserialize)]
struct Frontmatter {
    title: Option<String>,
    subject: Option<String>,
}
pub fn hash(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}
pub fn body(content: &str) -> Result<(&str, &str)> {
    let content_no_bom = content.trim_start_matches('\u{feff}');
    if content_no_bom
        .lines()
        .next()
        .is_some_and(|l| l.trim_end() == "---")
    {
        let first = content_no_bom
            .find('\n')
            .ok_or_else(|| Error::new("frontmatter", "Unclosed YAML frontmatter"))?
            + 1;
        let mut offset = first;
        for line in content_no_bom[first..].split_inclusive('\n') {
            if matches!(line.trim_end(), "---" | "...") {
                return Ok((
                    &content_no_bom[first..offset],
                    &content_no_bom[offset + line.len()..],
                ));
            }
            offset += line.len();
        }
        return Err(Error::new("frontmatter", "Unclosed YAML frontmatter"));
    }
    Ok(("", content))
}
pub fn parse(id: &str, content: &str) -> Result<Note> {
    let (yaml, _) = body(content)?;
    let meta: Frontmatter = if yaml.is_empty() {
        Frontmatter::default()
    } else {
        serde_yaml_ng::from_str(yaml).map_err(|e| Error::new("frontmatter", e))?
    };
    let subject = meta
        .subject
        .as_deref()
        .and_then(subjects::recognized)
        .or_else(|| {
            id.split_once('/')
                .and_then(|(folder, _)| subjects::recognized(folder))
        })
        .unwrap_or_default();
    let fallback = id
        .rsplit('/')
        .next()
        .unwrap_or(id)
        .trim_end_matches(".md")
        .trim_end_matches(".MD");
    Ok(Note {
        id: id.into(),
        title: meta
            .title
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| fallback.into()),
        subject,
        subject_id: String::new(),
        neuron_id: String::new(),
        revision: hash(content),
        neighbors: 0,
    })
}
// Preserve byte offsets and line breaks while excluding syntax regions from extraction.
pub fn prose(content: &str, exclude_math: bool) -> String {
    let mut bytes = content.as_bytes().to_vec();
    let mut block = None;
    for (event, range) in Parser::new_ext(content, Options::ENABLE_MATH).into_offset_iter() {
        let erase = match event {
            Event::Start(Tag::CodeBlock(_)) | Event::Start(Tag::HtmlBlock) => {
                block = Some(range.start);
                None
            }
            Event::End(TagEnd::CodeBlock) | Event::End(TagEnd::HtmlBlock) => {
                block.take().map(|s| s..range.end)
            }
            Event::Code(_) | Event::InlineHtml(_) | Event::Html(_) => Some(range),
            Event::InlineMath(_) | Event::DisplayMath(_) if exclude_math => Some(range),
            _ => None,
        };
        if let Some(range) = erase {
            for b in &mut bytes[range] {
                if *b != b'\n' && *b != b'\r' {
                    *b = b' ';
                }
            }
        }
    }
    String::from_utf8(bytes).expect("masked UTF-8 spans")
}
