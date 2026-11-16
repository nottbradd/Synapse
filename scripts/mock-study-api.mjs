// Explicit local mock used only by `tauri dev --features test-api` desktop QA.
// Release builds cannot read SYNAPSE_TEST_API_URL or use this transport.
import http from "node:http";
const port = 4318;
http
  .createServer(async (req, res) => {
    let bytes = "";
    for await (const part of req) {
      bytes += part;
      if (bytes.length > 128000) {
        res.writeHead(413).end();
        return;
      }
    }
    const body = JSON.parse(bytes);
    const data = Array.isArray(body.input)
      ? JSON.parse(body.input[1].content)
      : {};
    const request = data.request ?? "";
    const send = (status, value) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (request.includes("mock:slow"))
      await new Promise((r) => setTimeout(r, 2200));
    if (request.includes("mock:429"))
      return send(429, {
        error: { code: "rate_limit_exceeded", message: "Synthetic rate limit" },
      });
    const output = (value) => ({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(value) }],
        },
      ],
      usage: { input_tokens: 120, output_tokens: 400 },
    });
    if (request.includes("mock:refusal"))
      return send(200, {
        status: "completed",
        output: [
          { content: [{ type: "refusal", refusal: "Synthetic refusal" }] },
        ],
      });
    if (request.includes("mock:incomplete"))
      return send(200, { status: "incomplete", output: [] });
    const sources = data.sources ?? [],
      ids = sources.slice(0, 2).map((s) => s.id),
      count = data.count ?? 3;
    let draft;
    if (data.task === "quiz")
      draft = {
        title: "Momentum and its conservation",
        questions: Array.from({ length: count }, (_, i) =>
          i % 2 === 0
            ? {
                kind: "multiple_choice",
                prompt: `A ${i + 2} kg object moves at 3 m/s. What is its momentum?`,
                options: [
                  `${(i + 2) * 3} kg m/s`,
                  `${i + 5} kg m/s`,
                  `${i + 2} N`,
                  "Zero",
                ],
                correct_index: 0,
                answer: `${(i + 2) * 3} kg m/s`,
                explanation:
                  "Momentum is the product of mass and velocity: $p = mv$",
                sources: ids,
              }
            : {
                kind: "short_answer",
                prompt:
                  "Explain when the total momentum of a system is conserved",
                options: [],
                correct_index: null,
                answer:
                  "When the net external force is zero, the total momentum remains constant",
                explanation:
                  "Internal interactions exchange momentum without changing its total",
                sources: ids,
              },
        ),
      };
    else if (data.task === "flashcards")
      draft = {
        title: "Momentum recall",
        cards: Array.from({ length: count }, (_, i) => ({
          question:
            [
              "How is momentum calculated?",
              "When is total momentum conserved?",
              "What is impulse?",
              "What direction does momentum have?",
              "How does a longer collision time affect force?",
            ][i % 5] + (i >= 5 ? ` (${i + 1})` : ""),
          answer: [
            "$p = mv$",
            "When the net external force is zero",
            "Impulse is the change in momentum: $J = \\Delta p$",
            "The direction of the object's velocity",
            "For the same impulse, increasing time reduces the average force",
          ][i % 5],
          sources: ids,
        })),
      };
    else if (data.task === "reminder") {
      const parts = new Intl.DateTimeFormat("sv-SE", {
        timeZone: data.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      })
        .format(new Date(Date.now() + 120000))
        .replace(" ", "T");
      draft = {
        title: "Revise momentum",
        local_at: parts,
        timezone: data.timezone,
        repetition: "none",
        source_id: ids[0] ?? null,
        subject_id: sources[0]?.subject_id ?? data.current_subject_id ?? null,
        fold: null,
        clarification: request.includes("ambiguous")
          ? "Choose a specific date and time"
          : null,
      };
    } else draft = { ok: true };
    if (request.includes("mock:invalid-source"))
      draft.questions[0].sources = ["unselected.md"];
    console.log(
      JSON.stringify({
        mock: true,
        task: data.task ?? "connection",
        items: count,
        status: 200,
      }),
    );
    send(200, output(draft));
  })
  .listen(port, "127.0.0.1", () =>
    console.log(`Mock Responses API listening on 127.0.0.1:${port}`),
  );
