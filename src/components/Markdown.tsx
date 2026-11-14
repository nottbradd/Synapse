import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { markdownBody, remarkWiki } from "../wiki";
export default function Markdown({
  text,
  onWiki,
}: {
  text: string;
  onWiki: (raw: string) => void;
}) {
  return (
    <div className="markdown select-text">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkWiki]}
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
