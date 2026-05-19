import assert from "node:assert/strict";
import fs from "node:fs";
import { formatCortexToolResult, parseEvaMemoryConfig } from "../index";

const manifest = JSON.parse(fs.readFileSync("openclaw.plugin.json", "utf8"));

for (const toolName of [
  "cortex_entities_list",
  "cortex_entity_detail",
  "cortex_graph_query",
]) {
  assert.ok(manifest.tools.includes(toolName), `manifest is missing ${toolName}`);
}

{
  const cfg = parseEvaMemoryConfig({ ownerId: "company-acme" });
  assert.equal(cfg.ownerIdMode, "server_resolved");
}

{
  const rendered = formatCortexToolResult("Cortex entities", {
    entities: [
      {
        id: "ent_assistant",
        name: "assistant",
        entity_type: "agent",
        claim_count: 12,
      },
    ],
    total: 1,
    errors: [],
  });
  assert.match(rendered, /Cortex entities:/);
  assert.match(rendered, /"id": "ent_assistant"/);
  assert.match(rendered, /"claim_count": 12/);
}

{
  assert.equal(
    formatCortexToolResult("Cortex graph", null),
    "Cortex graph failed: Cortex returned no result.",
  );
}

{
  const source = fs.readFileSync("src/index.ts", "utf8");
  const coreReadTools = [
    ["cortex_entities_list", "listEntities"],
    ["cortex_entity_detail", "getEntityDetail"],
    ["cortex_graph_query", "queryGraph"],
  ];
  for (const [toolName, clientMethod] of coreReadTools) {
    const start = source.indexOf(`name: "${toolName}"`);
    assert.notEqual(start, -1, `${toolName} registration should exist`);
    const nextRegistration = source.indexOf("api.registerTool", start + 1);
    const block = source.slice(start, nextRegistration === -1 ? source.length : nextRegistration);
    assert.equal(
      /\bowner_id\b/.test(block),
      false,
      `${toolName} schema and execute block must not expose caller-supplied owner_id`,
    );
    assert.equal(
      new RegExp(`client\\.${clientMethod}\\([^)]*owner_id`).test(block),
      false,
      `${toolName} execute path must not pass caller-supplied owner_id`,
    );
  }
}

console.log("core-entity-graph-tools tests passed");
