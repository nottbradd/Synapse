import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "./components/Markdown";
import { formatInterval } from "./hooks/useRatingPreviews";
import type { NotePresentation } from "./types";

const block = (
  body: string,
  source: string,
  question: string,
  answer: string,
  from = 0,
) => ({
  content_id: `${question}:${answer}`,
  question,
  answer,
  start: body.indexOf(source, from),
  end: body.indexOf(source, from) + source.length,
});
const render = (presentation: NotePresentation) =>
  renderToStaticMarkup(
    <Markdown
      text={presentation.body}
      presentation={presentation}
      onWiki={() => {}}
    />,
  );
describe("canonical recall presentation", () => {
  it("conceals answers and preserves surrounding Markdown and document references", () => {
    const body =
      "# Note\n\nBefore [reference][ref].\n\nQ: **Question**\nA: Secret $x^2$\n\nAfter [reference][ref].\n\n[ref]: https://example.com\n";
    const html = render({
      body,
      recalls: [
        block(
          body,
          "Q: **Question**\nA: Secret $x^2$",
          "**Question**",
          "Secret $x^2$",
        ),
      ],
    });
    expect(html).toContain("<strong>Question</strong>");
    expect(html).not.toContain("Secret");
    expect(html).not.toContain("A:");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
    expect(html.match(/title="https:\/\/example.com"/g)).toHaveLength(2);
  });
  it("replaces adjacent occurrences and keeps list containers intact", () => {
    const body =
      "- Intro\n\n  Q: Why?\n  A: Because\n\nOutside\nTerm :: Definition\nOther :: Second answer";
    const html = render({
      body,
      recalls: [
        block(body, "Q: Why?\n  A: Because", "Why?", "Because"),
        block(body, "Term :: Definition", "Term", "Definition"),
        block(body, "Other :: Second answer", "Other", "Second answer"),
      ],
    });
    expect(html.match(/class="recall-block"/g)).toHaveLength(3);
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("Outside");
    expect(html).not.toContain("Because");
    expect(html).not.toContain("Definition");
    expect(html).not.toContain("Second answer");
  });
  it("does not recognise cards or recursively hide Review answers without explicit metadata", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text="Q: Visible\nA: The review owns this reveal\n\nTerm :: Definition"
        onWiki={() => {}}
      />,
    );
    expect(html).toContain("The review owns this reveal");
    expect(html).toContain("Definition");
    expect(html).not.toContain("recall-block");
  });
});
it("formats scheduler output without calculating a scheduling rule", () => {
  expect([60, 43200, 86400, 345600, 103680].map(formatInterval)).toEqual([
    "1 min",
    "12 hr",
    "1 day",
    "4 days",
    "1.2 days",
  ]);
});
