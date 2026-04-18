import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyTurnForMemory, extractMessages, isMemoryRelevant } from "../index";

describe("classifyTurnForMemory", () => {
  it("blocks synthetic PLAN_DECISION prompts", () => {
    const result = classifyTurnForMemory("[PLAN_DECISION]: approved", undefined, {
      sessionKey: "agent:main:main",
    });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "synthetic-prompt");
  });

  it("blocks QUESTION_ANSWER prompts", () => {
    const result = classifyTurnForMemory("[QUESTION_ANSWER]: yes", undefined, {
      sessionKey: "agent:main:main",
    });
    assert.equal(result.allow, false);
  });

  it("blocks heartbeat control prompts", () => {
    const result = classifyTurnForMemory("Read HEARTBEAT.md if it exists", undefined, {
      sessionKey: "agent:main:main",
    });
    assert.equal(result.allow, false);
  });

  it("accepts real user turns", () => {
    const result = classifyTurnForMemory("real user question about memory behavior", undefined, {
      sessionKey: "agent:main:main",
    });
    assert.equal(result.allow, true);
    assert.equal(result.reason, "real-user-turn");
  });

  it("blocks synthetic latest user turns from transcript messages", () => {
    const result = classifyTurnForMemory(undefined, [
      { role: "user", content: "[PLAN_DECISION]: approved" },
      { role: "assistant", content: "got it" },
    ], {
      sessionKey: "agent:main:main",
    });
    assert.equal(result.allow, false);
    assert.equal(result.reason, "synthetic-user-turn");
  });
});

describe("extractMessages", () => {
  it("filters synthetic control turns while preserving real conversation", () => {
    const messages = extractMessages([
      { role: "user", content: "[PLAN_DECISION]: approved" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "(session bootstrap)" },
      { role: "user", content: "please remember I prefer short replies" },
      { role: "assistant", content: "Noted." },
    ]);
    assert.deepEqual(messages, [
      { role: "assistant", content: "ok" },
      { role: "user", content: "please remember I prefer short replies" },
      { role: "assistant", content: "Noted." },
    ]);
  });

  it("drops a final synthetic user message", () => {
    const messages = extractMessages([
      { role: "user", content: "real question" },
      { role: "assistant", content: "real answer" },
      { role: "user", content: "[PLAN_DECISION]: approved" },
    ]);
    assert.deepEqual(messages, [
      { role: "user", content: "real question" },
      { role: "assistant", content: "real answer" },
    ]);
  });
});

describe("isMemoryRelevant", () => {
  it("rejects synthetic plan-control prompts", () => {
    assert.equal(isMemoryRelevant("[PLAN_DECISION]: approved"), false);
  });

  it("keeps normal Cortex-related questions relevant", () => {
    assert.equal(isMemoryRelevant("What did we decide about the Cortex plugin?"), true);
  });
});
