import type { Root, RootContent } from "mdast";
import type { NotePresentation } from "./types";

// Recognition and UTF-16 source ranges come only from the canonical Rust parser.
// Reparse the surrounding fragments in the same Markdown processor, preserving
// list/quote containers and document-wide reference definitions.
export function remarkRecall(presentation?: NotePresentation) {
  return function (this: { parse: (text: string) => unknown }) {
    const parse = this.parse.bind(this);
    return (tree: Root) => {
      if (!presentation) return;
      const used = new Set<number>();
      const fragment = (start: number, end: number) => {
        if (end <= start) return [];
        const root = parse(presentation.body.slice(start, end)) as Root;
        const shift = (node: {
          position?: Root["position"];
          children?: unknown[];
        }) => {
          if (node.position) {
            node.position.start.offset =
              (node.position.start.offset ?? 0) + start;
            node.position.end.offset = (node.position.end.offset ?? 0) + start;
          }
          node.children?.forEach((child) => shift(child as typeof node));
        };
        shift(root);
        return root.children;
      };
      const replace = (parent: {
        children: RootContent[];
        position?: Root["position"];
      }) => {
        for (const child of parent.children) {
          if (child.type === "blockquote") replace(child);
          if (child.type === "list") child.children.forEach(replace);
        }
        for (let index = presentation.recalls.length - 1; index >= 0; index--) {
          if (used.has(index)) continue;
          const block = presentation.recalls[index];
          if (
            parent !== tree &&
            (block.start < (parent.position?.start.offset ?? 0) ||
              block.end > (parent.position?.end.offset ?? 0))
          )
            continue;
          const matches = parent.children
            .map((n, i) => ({ n, i }))
            .filter(
              ({ n }) =>
                n.position &&
                (n.position.start.offset ?? 0) < block.end &&
                (n.position.end.offset ?? 0) > block.start,
            );
          if (!matches.length) continue;
          const first = matches[0],
            last = matches.at(-1)!;
          const marker: RootContent = {
            type: "paragraph",
            children: [],
            data: {
              hName: "section",
              hProperties: { "data-recall-index": index },
            },
          };
          parent.children.splice(
            first.i,
            last.i - first.i + 1,
            ...fragment(first.n.position!.start.offset!, block.start),
            marker,
            ...fragment(block.end, last.n.position!.end.offset!),
          );
          used.add(index);
        }
      };
      replace(tree);
    };
  };
}
