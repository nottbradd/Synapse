import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { markdownBody, remarkWiki } from "../wiki";
import type { Root, RootContent } from "mdast";
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
}: {
  text: string;
  onWiki: (raw: string) => void;
  omitTitle?: string;
}) {
  return (
    <div className="markdown select-text">
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          remarkMath,
          remarkWiki,
          omitLeadingTitle(omitTitle),
        ]}
        rehypePlugins={[[rehypeKatex, { trust: false, strict: "warn" }]]}
        skipHtml
        components={{
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
        {markdownBody(text)}
      </ReactMarkdown>
    </div>
  );
}
