// Explicit loopback-only fixture. Production wrangler.jsonc never imports this entrypoint.
import { createWorker, reply } from "../worker.mjs";
import { mockUpstream } from "./mock.mjs";
const worker = createWorker({ upstream: mockUpstream });
export default {
  fetch(request, env, ctx) {
    if (!["127.0.0.1", "localhost"].includes(new URL(request.url).hostname))
      return reply({ error: "local_fixture_only" }, 403);
    return worker.fetch(
      request,
      { ...env, OPENAI_SERVICE_KEY: "synthetic-local-only" },
      ctx,
    );
  },
};
