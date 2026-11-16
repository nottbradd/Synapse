import { MODEL } from "../protocol.mjs";
export function result(body) {
  const input = JSON.parse(body.input[1].content);
  const source = input.sources[0];
  let draft;
  if (input.task === "quiz")
    draft = {
      title: "Momentum practice",
      questions: Array.from({ length: input.count }, (_, i) => ({
        kind: i % 2 ? "short_answer" : "multiple_choice",
        prompt: `Momentum question ${i + 1}`,
        options:
          i % 2 ? [] : ["Mass times velocity", "Mass times acceleration"],
        correct_index: i % 2 ? null : 0,
        answer: "Mass times velocity",
        explanation: "Linear momentum is the product of mass and velocity.",
        sources: [source.id],
      })),
    };
  else if (input.task === "flashcards")
    draft = {
      title: "Momentum flashcards",
      cards: Array.from({ length: input.count }, (_, i) => ({
        question: `Momentum definition ${i + 1}?`,
        answer: "Mass times velocity.",
        sources: [source.id],
      })),
    };
  else
    draft = {
      title: "Revise momentum",
      local_at: new Date(Date.parse(input.reference_time) + 86400000)
        .toISOString()
        .slice(0, 16),
      timezone: input.timezone,
      repetition: "none",
      source_id: source?.id ?? null,
      subject_id: source?.subject_id ?? input.current_subject_id,
      fold: null,
      clarification: null,
    };
  return {
    id: "resp_local_mock",
    model: MODEL,
    status: "completed",
    usage: {
      input_tokens: 200,
      output_tokens: 100,
      input_tokens_details: { cached_tokens: 0 },
    },
    output: [
      {
        type: "message",
        content: [{ type: "output_text", text: JSON.stringify(draft) }],
      },
    ],
  };
}
export async function mockUpstream(url, init) {
  if (url !== "https://api.openai.com/v1/responses")
    throw Error("Unexpected mock route");
  return Response.json(result(JSON.parse(init.body)));
}
