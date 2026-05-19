import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseEvaMemoryConfig,
  shouldSendConfiguredOwner,
  withConfiguredOwner,
} from "../index";

{
  const cfg = parseEvaMemoryConfig({ ownerId: "company-acme" });
  assert.equal(cfg.ownerId, "company-acme");
  assert.equal(cfg.ownerIdMode, "server_resolved");
  assert.equal(shouldSendConfiguredOwner(cfg.ownerId, cfg.ownerIdMode), false);
}

{
  const cfg = parseEvaMemoryConfig({ ownerId: "company-acme", ownerIdMode: "configured" });
  assert.equal(cfg.ownerIdMode, "configured");
  assert.equal(shouldSendConfiguredOwner(cfg.ownerId, cfg.ownerIdMode), true);
  assert.deepEqual(
    withConfiguredOwner({ query: "status" }, cfg.ownerId, cfg.ownerIdMode),
    { query: "status", owner_id: "company-acme" },
  );
}

{
  const body = withConfiguredOwner({ query: "status" }, "company-acme", "server_resolved");
  assert.deepEqual(body, { query: "status" });
}

{
  const source = fs.readFileSync("src/index.ts", "utf8");
  const genericOwnerScopedTools = [
    ["cortex_ask", "ask"],
    ["cortex_list_contradictions", "listContradictions"],
    ["cortex_resolve_contradiction", "resolveContradiction"],
    ["cortex_add_commitment", "addCommitment"],
    ["cortex_update_commitment", "updateCommitment"],
    ["cortex_list_commitments", "listCommitments"],
    ["cortex_insights", "listInsights"],
    ["cortex_entities_list", "listEntities"],
    ["cortex_entity_detail", "getEntityDetail"],
    ["cortex_graph_query", "queryGraph"],
    ["cortex_add_open_loop", "addOpenLoop"],
    ["cortex_resolve_open_loop", "resolveOpenLoop"],
    ["cortex_list_open_loops", "listOpenLoops"],
  ];
  for (const [toolName, clientMethod] of genericOwnerScopedTools) {
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

console.log("owner-context tests passed");
