import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "supabase/migrations");
const files = readdirSync(root).filter((name) => name.endsWith(".sql")).sort();
const active = new Set();
const errors = [];

for (const file of files) {
  const sql = readFileSync(join(root, file), "utf8");
  const events = [];
  const pattern = /(DROP\s+POLICY\s+IF\s+EXISTS|CREATE\s+POLICY)\s+"([^"]+)"\s+ON\s+([\w.]+)/gi;
  for (const match of sql.matchAll(pattern)) {
    events.push({ index: match.index, operation: match[1].toUpperCase(), key: `${match[3]}.${match[2]}` });
  }

  for (const event of events.sort((a, b) => a.index - b.index)) {
    if (event.operation.startsWith("DROP")) {
      active.delete(event.key);
    } else if (active.has(event.key)) {
      errors.push(`${file}: policy recreated without DROP POLICY IF EXISTS: ${event.key}`);
    } else {
      active.add(event.key);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Validated ${files.length} ordered migrations; policy recreation is retry-safe.`);
}
