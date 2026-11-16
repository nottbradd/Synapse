import { describe, it, expect } from "vitest";
import { resolveWiki, wikiTarget, markdownBody } from "./wiki";
import type { Note } from "./types";
const notes: Note[] = ["a.md", "Physics/a.md", "b.md"].map((id) => ({
  id,
  title: id.split("/").pop()!.slice(0, -3),
  subject: "general",
  subject_id: "subject",
  neuron_id: "neuron",
  revision: "",
  neighbors: 0,
}));
describe("Wiki navigation", () => {
  it("resolves explicit root links even with duplicate short names", () =>
    expect(resolveWiki("./a", "b.md", notes).map((n) => n.id)).toEqual([
      "a.md",
    ]));
  it("keeps ambiguous short names ambiguous", () =>
    expect(resolveWiki("a", "b.md", notes)).toHaveLength(2));
  it("resolves explicit paths and aliases", () =>
    expect(resolveWiki("Physics/a#Section|Label", "b.md", notes)[0].id).toBe(
      "Physics/a.md",
    ));
  it("normalizes paths and heading-only links", () => {
    expect(wikiTarget("Physics\\a.md#Section|Label")).toBe("Physics/a");
    expect(resolveWiki("#Heading", "b.md", notes)[0].id).toBe("b.md");
  });
  it("hides YAML only in preview", () =>
    expect(markdownBody("---\r\ntitle: hello\r\n---\r\n# Note")).toBe(
      "# Note",
    ));
});
