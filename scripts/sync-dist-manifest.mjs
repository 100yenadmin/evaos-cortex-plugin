import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("openclaw.plugin.json", "utf8"));

writeFileSync(
  "dist/openclaw.plugin.json",
  `${JSON.stringify({ ...manifest, main: "index.js" }, null, 2)}\n`,
);
