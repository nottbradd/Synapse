import type { Note } from "./types";
import type { Root, Text, Link } from "mdast";
import { visit } from "unist-util-visit";
export const wikiTarget = (raw: string) =>
  raw
    .split("|")[0]
    .split("#")[0]
    .trim()
    .replaceAll("\\", "/")
    .replace(/\.md$/i, "");
export function resolveWiki(raw: string, source: string, notes: Note[]) {
  const key = wikiTarget(raw).toLowerCase();
  if (!key) return notes.filter((n) => n.id === source);
  return notes.filter((n) =>
    key.includes("/")
      ? n.id.replace(/\.md$/i, "").toLowerCase() === key.replace(/^\.\//, "")
      : n.id.split("/").pop()!.replace(/\.md$/i, "").toLowerCase() === key ||
        n.title.toLowerCase() === key,
  );
}
export function remarkWiki() {
  return (tree: Root) =>
    visit(tree, "text", (node: Text, index, parent) => {
      if (
        !parent ||
        index === undefined ||
        parent.type === "link" ||
        parent.type === "linkReference"
      )
        return;
      const pieces: (Text | Link)[] = [];
      let cursor = 0;
      for (const match of node.value.matchAll(/\[\[([^\]\n[]+)\]\]/g)) {
        pieces.push({
          type: "text",
          value: node.value.slice(cursor, match.index),
        });
        pieces.push({
          type: "link",
          url: `#wiki:${encodeURIComponent(match[1])}`,
          children: [
            {
              type: "text",
              value:
                match[1].split("|")[1] || match[1].split("#")[0] || match[1],
            },
          ],
        });
        cursor = match.index! + match[0].length;
      }
      if (!pieces.length) return;
      pieces.push({ type: "text", value: node.value.slice(cursor) });
      parent.children.splice(index, 1, ...pieces);
      return index + pieces.length;
    });
}
export function markdownBody(text: string) {
  return text
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, "")
    .replace(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, "");
}
