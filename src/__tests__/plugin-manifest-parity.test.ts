import assert from "node:assert/strict";
import fs from "node:fs";

const rootManifest = JSON.parse(fs.readFileSync("openclaw.plugin.json", "utf8"));
const distManifest = JSON.parse(fs.readFileSync("dist/openclaw.plugin.json", "utf8"));

assert.deepEqual(distManifest.tools, rootManifest.tools);
assert.deepEqual(distManifest.configSchema, rootManifest.configSchema);
assert.equal(distManifest.main, "index.js");

for (const property of [
  "companyBrainContextMode",
  "companyBrainContextAccountId",
  "companyBrainContextSearch",
  "companyBrainContextFactsLimit",
  "companyBrainContextEventsLimit",
  "companyBrainContextMaxChars",
]) {
  assert.ok(
    distManifest.configSchema.properties[property],
    `dist manifest is missing ${property}`,
  );
}

assert.ok(
  distManifest.tools.includes("cortex_insights"),
  "dist manifest is missing cortex_insights",
);

console.log("plugin-manifest-parity tests passed");
