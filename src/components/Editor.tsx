import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import {
  autocompletion,
  completionKeymap,
  type CompletionContext,
} from "@codemirror/autocomplete";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";
import type { Note } from "../types";
export default function Editor({
  value,
  onChange,
  notes,
  onSave,
}: {
  value: string;
  onChange: (s: string) => void;
  notes: Note[];
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<EditorView>(null);
  const live = useRef({ onChange, notes, onSave });
  live.current = { onChange, notes, onSave };
  useEffect(() => {
    const complete = (ctx: CompletionContext) => {
      const match = ctx.matchBefore(/\[\[[^\]\n]*/);
      if (!match) return null;
      const search = match.text.slice(2).toLowerCase();
      return {
        from: match.from + 2,
        filter: false,
        options: live.current.notes
          .filter((n) => `${n.title} ${n.id}`.toLowerCase().includes(search))
          .map((n) => ({
            label: n.id.replace(/\.md$/i, ""),
            displayLabel: n.title,
            detail: n.id,
            type: "text",
            apply: (
              editor: EditorView,
              _completion: unknown,
              from: number,
              to: number,
            ) => {
              const link =
                (n.id.includes("/") ? "" : "./") + n.id.replace(/\.md$/i, "");
              const close =
                editor.state.sliceDoc(to, to + 2) === "]]" ? to + 2 : to;
              editor.dispatch({
                changes: { from, to: close, insert: link + "]]" },
                selection: { anchor: from + link.length + 2 },
              });
            },
          })),
      };
    };
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          markdown(),
          syntaxHighlighting(defaultHighlightStyle),
          autocompletion({ override: [complete], defaultKeymap: false }),
          keymap.of([
            {
              key: "Mod-s",
              run: () => {
                live.current.onSave();
                return true;
              },
            },
            ...completionKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            "aria-label": "Markdown editor",
            spellcheck: "false",
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) live.current.onChange(u.state.doc.toString());
          }),
          EditorView.theme(
            {
              "&": {
                height: "100%",
                backgroundColor: "#111113",
                color: "#d4d4d8",
                fontSize: "13px",
              },
              ".cm-content": {
                fontFamily: "Consolas, monospace",
                padding: "20px 0",
                caretColor: "#fafafa",
              },
              ".cm-gutters": {
                backgroundColor: "#111113",
                color: "#52525b",
                border: "none",
              },
              ".cm-activeLine": { backgroundColor: "#ffffff04" },
              ".cm-activeLineGutter": { backgroundColor: "transparent" },
              ".cm-scroller": { overflow: "auto" },
              ".cm-tooltip": {
                background: "#27272a",
                border: "1px solid #3f3f46",
                color: "#fafafa",
              },
              ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
                background: "#3f3f46",
              },
              "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
                background: "#3f3f46",
              },
            },
            { dark: true },
          ),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // The editor is mounted per note; subsequent disk replacements use a transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value)
      v.dispatch({
        changes: { from: 0, to: v.state.doc.length, insert: value },
      });
  }, [value]);
  return <div ref={host} className="code-editor select-text" />;
}
