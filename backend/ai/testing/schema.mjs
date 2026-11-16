import { readFile } from "node:fs/promises";
export async function migrate(db) {
  const sql = await readFile(
    new URL("../migrations/0001_synapse.sql", import.meta.url),
    "utf8",
  );
  for (const statement of sql.split(/^-- next\r?$/m))
    await db.prepare(statement.trim()).run();
}
