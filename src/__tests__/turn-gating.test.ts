import assert from "node:assert/strict";
import { classifyTurnForMemory, extractMessages, isMemoryRelevant } from "../index";

{
  const result = classifyTurnForMemory("[PLAN_DECISION]: approved", undefined, {
    sessionKey: "agent:main:main",
  });
  assert.equal(result.allow, false);
  assert.equal(result.reason, "synthetic-prompt");
}

{
  const result = classifyTurnForMemory("[QUESTION_ANSWER]: yes", undefined, {
    sessionKey: "agent:main:main",
  });
  assert.equal(result.allow, false);
}

{
  const result = classifyTurnForMemory("Read HEARTBEAT.md if it exists", undefined, {
    sessionKey: "agent:main:main",
  });
  assert.equal(result.allow, false);
}

{
  const result = classifyTurnForMemory("real user question about memory behavior", undefined, {
    sessionKey: "agent:main:main",
  });
  assert.equal(result.allow, true);
  assert.equal(result.reason, "real-user-turn");
}

{
  const result = classifyTurnForMemory(undefined, [
    { role: "user", content: "[PLAN_DECISION]: approved" },
    { role: "assistant", content: "got it" },
  ], {
    sessionKey: "agent:main:main",
  });
  assert.equal(result.allow, false);
  assert.equal(result.reason, "synthetic-user-turn");
}

{
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
}

{
  assert.equal(isMemoryRelevant("[PLAN_DECISION]: approved"), false);
  assert.equal(isMemoryRelevant("What did we decide about the Cortex plugin?"), true);
}

console.log("turn-gating tests passed");
