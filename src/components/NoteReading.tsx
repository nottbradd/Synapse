import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { message, type NotePresentation } from "../types";
import Markdown from "./Markdown";

export default function NoteReading({
  text,
  title,
  onWiki,
}: {
  text: string;
  title?: string;
  onWiki: (raw: string) => void;
}) {
  const [result, setResult] = useState<{
    source: string;
    data?: NotePresentation;
    error?: string;
  }>();
  useEffect(() => {
    let active = true;
    invoke<NotePresentation>("present_note", { content: text }).then(
      (data) => {
        if (active) setResult({ source: text, data });
      },
      (error) => {
        if (active) setResult({ source: text, error: message(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [text]);
  // Never flash raw answers while the read-only presentation request is pending.
  if (result?.source !== text)
    return (
      <p className="muted" role="status">
        Loading note…
      </p>
    );
  if (!result.data)
    return (
      <p className="error" role="alert">
        {result.error}
      </p>
    );
  return (
    <Markdown
      text={text}
      onWiki={onWiki}
      omitTitle={title}
      presentation={result.data}
    />
  );
}
