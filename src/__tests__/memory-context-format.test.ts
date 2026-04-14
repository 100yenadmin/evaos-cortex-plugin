import assert from "node:assert/strict";
import { formatMemoryContext, parseEvaMemoryConfig, preprocessClaims } from "../index";

function item(overrides: Record<string, any>) {
  return {
    source: "api",
    item_id: "00000000",
    content: "default content",
    score: 0.5,
    created_at: "2026-04-01T00:00:00Z",
    metadata: {
      salience: "medium",
      category: "decisions",
    },
    ...overrides,
  };
}

{
  const processed = preprocessClaims([
    item({ item_id: "old-item", content: "Andrew decided to prioritize temporal schema", score: 0.72, created_at: "2026-04-10T00:00:00Z" }),
    item({ item_id: "new-item", content: "Andrew decided to prioritize temporal schema", score: 0.78, created_at: "2026-04-14T00:00:00Z" }),
  ], {
    showConflicts: true,
    showRelations: true,
    dedup: true,
  });
  assert.equal(processed.length, 1);
  assert.equal(processed[0]?.duplicateCount, 2);
  assert.equal(processed[0]?.item.item_id, "new-item");
}

{
  const processed = preprocessClaims([
    item({ item_id: "older1234", content: "Andrew decided to prioritize temporal schema", created_at: "2026-04-10T00:00:00Z" }),
    item({ item_id: "newer1234", content: "Andrew decided to prioritize memorybench", created_at: "2026-04-14T00:00:00Z" }),
  ], {
    showConflicts: true,
    showRelations: true,
    dedup: true,
  });
  assert.equal(processed.length, 2);
  assert.equal(processed[1]?.conflictWithId, undefined);
}

{
  const processed = preprocessClaims([
    item({ item_id: "a1234567", content: "Andrew decided to prioritize temporal schema", created_at: "2026-04-14T00:00:00Z" }),
    item({ item_id: "b1234567", content: "Andrew plans to implement temporal schema next", created_at: "2026-04-13T00:00:00Z" }),
  ], {
    showConflicts: true,
    showRelations: true,
    dedup: true,
  });
  assert.equal(processed[1]?.relationHint, "Related to above, may be an update");
}

{
  const processed = preprocessClaims([
    item({ item_id: "older", content: "Older distinct memory", created_at: "2026-04-08T00:00:00Z", score: 0.9 }),
    item({ item_id: "newer", content: "Newer distinct memory", created_at: "2026-04-14T00:00:00Z", score: 0.5 }),
  ], {
    showConflicts: true,
    showRelations: true,
    dedup: true,
  });
  assert.equal(processed[0]?.item.item_id, "newer");
  assert.equal(processed[1]?.item.item_id, "older");
}

{
  const items = [
    item({ item_id: "4ff4823b999", content: "Andrew decided to prioritize temporal schema", score: 0.78, created_at: "2026-04-10T00:00:00Z", metadata: { salience: "high", category: "decisions" } }),
    item({ item_id: "1c60ea4b999", content: "Andrew plans to implement temporal schema as next build priority", score: 0.72, created_at: "2026-04-14T00:00:00Z", metadata: { salience: "high", category: "decisions" } }),
    item({ item_id: "a8f1170d999", content: "Andrew decided to prioritize memorybench first", score: 0.65, created_at: "2026-04-08T00:00:00Z", metadata: { salience: "medium", category: "episodic" } }),
  ];
  const formatted = formatMemoryContext(items, 8000, items.length, 8, 0.25, {
    injectionFormat: "v2",
    showConflicts: true,
    showRelations: true,
    dedup: true,
  });
  assert.match(formatted, /\[2026-04-14\].*1c60ea4b/);
  assert.match(formatted, /↳ Related to above/);
  assert.match(formatted, /⚠️ Conflicts with: \{1c60ea4b\}/);
}

{
  const items = [
    item({ item_id: "dup111111", content: "Andrew decided to prioritize temporal schema", score: 0.78, created_at: "2026-04-14T00:00:00Z", metadata: { salience: "high", category: "decisions" } }),
    item({ item_id: "dup222222", content: "Andrew decided to prioritize temporal schema", score: 0.74, created_at: "2026-04-13T00:00:00Z", metadata: { salience: "high", category: "decisions" } }),
  ];
  const formatted = formatMemoryContext(items, 8000, items.length, 8, 0.25, {
    injectionFormat: "v2",
    showConflicts: true,
    showRelations: true,
    dedup: true,
  });
  assert.match(formatted, /\[seen 2x\]/);
}

{
  const items = [item({ item_id: "v1itemid", content: "Flat memory line", score: 0.9, created_at: "2026-04-14T00:00:00Z" })];
  const formatted = formatMemoryContext(items, 8000, items.length, 8, 0.25, {
    injectionFormat: "v1",
    showConflicts: true,
    showRelations: true,
    dedup: true,
  });
  assert.match(formatted, /Long-term memories from your Cortex memory system/);
  assert.match(formatted, /\[1 of 1 memories shown/);
  assert.match(formatted, /- \[v1itemid\] \[2026-04-14\] \[medium\/decisions\] Flat memory line/);
  assert.doesNotMatch(formatted, /\[90%\]/);
  assert.doesNotMatch(formatted, /\{v1itemid\}/);
  assert.doesNotMatch(formatted, /↳/);
  assert.doesNotMatch(formatted, /\[seen/);
  assert.doesNotMatch(formatted, /⚠️/);
}

{
  const cfg = parseEvaMemoryConfig({
    injectionHardFloor: Number.NaN,
    injectionCriticalThreshold: Number.POSITIVE_INFINITY,
    injectionTechnicalThreshold: -1,
    injectionPersonalThreshold: 2,
  });
  const items = [item({ content: "Lower-score casual memory", score: 0.44, metadata: { salience: "medium", category: "personal" } })];
  const kept = preprocessClaims(items, { showConflicts: true, showRelations: true, dedup: true });
  assert.equal(kept.length, 1);
  const formatted = formatMemoryContext(items, 8000, items.length, 8, 0.25, {
    injectionFormat: "v2",
    showConflicts: true,
    showRelations: true,
    dedup: true,
  });
  assert.match(formatted, /Long-term memories from your Cortex memory system/);
  assert.match(formatted, /\[1 of 1 memories shown/);
  assert.match(formatted, /Lower-score casual memory/);
  assert.equal(cfg.injectionFormat, "v1");
}

{
  const cfg = parseEvaMemoryConfig({ injectionFormat: "v2", showConflicts: false, showRelations: false, dedup: false });
  assert.equal(cfg.injectionFormat, "v2");
  assert.equal(cfg.showConflicts, false);
  assert.equal(cfg.showRelations, false);
  assert.equal(cfg.dedup, false);
}

console.log("memory-context-format tests passed");
