import ReactMarkdown, { type Components } from "react-markdown";
import { createContext, useContext, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { markdownBody, remarkWiki } from "../wiki";
import type { Root, RootContent } from "mdast";
import type { NotePresentation, RecallBlock } from "../types";
import { remarkRecall } from "../recall";
const ReadingContext = createContext<{
  presentation?: NotePresentation;
  onWiki: (raw: string) => void;
}>({ onWiki: () => {} });
// A stable renderer preserves reveal state across ordinary parent refreshes.
const RecallSection: NonNullable<Components["section"]> = ({
  node,
  children,
}) => {
  const { presentation, onWiki } = useContext(ReadingContext);
  const index = Number(node?.properties?.["data-recall-index"]);
  const block = presentation?.recalls[index];
  return block ? (
    <Recall
      key={`${block.content_id}:${block.start}`}
      block={block}
      onWiki={onWiki}
    />
  ) : (
    <section>{children}</section>
  );
};
const plain = (node: RootContent): string =>
  "value" in node
    ? String(node.value)
    : "children" in node
      ? node.children.map((n) => plain(n as RootContent)).join("")
      : "";
export function omitLeadingTitle(title?: string) {
  return () => (tree: Root) => {
    const first = tree.children[0];
    if (
      title &&
      first?.type === "heading" &&
      first.depth === 1 &&
      plain(first).trim().normalize() === title.trim().normalize()
    )
      tree.children.shift();
  };
}
export default function Markdown({
  text,
  onWiki,
  omitTitle,
  presentation,
}: {
  text: string;
  onWiki: (raw: string) => void;
  omitTitle?: string;
  presentation?: NotePresentation;
}) {
  return (
    <div className="markdown select-text">
      <ReadingContext.Provider value={{ presentation, onWiki }}>
        <ReactMarkdown
          remarkPlugins={[
            remarkGfm,
            remarkMath,
            remarkRecall(presentation),
            remarkWiki,
            omitLeadingTitle(omitTitle),
          ]}
          rehypePlugins={[[rehypeKatex, { trust: false, strict: "warn" }]]}
          skipHtml
          components={{
            section: RecallSection,
            a: ({ href, children }) =>
              href?.startsWith("#wiki:") ? (
                <button
                  className="wiki-link"
                  onClick={() => onWiki(decodeURIComponent(href.slice(6)))}
                >
                  {children}
                </button>
              ) : (
                <span className="external-link" title={href}>
                  {children}
                </span>
              ),
            img: ({ alt }) => (
              <span className="muted">[Image: {alt || "attachment"}]</span>
            ),
          }}
        >
          {presentation?.body ?? markdownBody(text)}
        </ReactMarkdown>
      </ReadingContext.Provider>
    </div>
  );
}

function Recall({
  block,
  onWiki,
}: {
  block: RecallBlock;
  onWiki: (raw: string) => void;
}) {
  const [revealed, setRevealed] = useState(false),
    id = useId();
  return (
    <section className="recall-block" aria-label="Recall">
      <div className="recall-question">
        <Markdown text={block.question} onWiki={onWiki} />
      </div>
      <button
        className="recall-toggle"
        aria-expanded={revealed}
        aria-controls={id}
        onClick={() => setRevealed((v) => !v)}
      >
        {revealed ? "Hide answer" : "Reveal answer"}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <div id={id} className="recall-answer" hidden={!revealed}>
        {revealed && <Markdown text={block.answer} onWiki={onWiki} />}
      </div>
    </section>
  );
}
