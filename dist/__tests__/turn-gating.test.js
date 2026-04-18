"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const index_1 = require("../index");
{
    const result = (0, index_1.classifyTurnForMemory)("[PLAN_DECISION]: approved", undefined, {
        sessionKey: "agent:main:main",
    });
    strict_1.default.equal(result.allow, false);
    strict_1.default.equal(result.reason, "synthetic-prompt");
}
{
    const result = (0, index_1.classifyTurnForMemory)("[QUESTION_ANSWER]: yes", undefined, {
        sessionKey: "agent:main:main",
    });
    strict_1.default.equal(result.allow, false);
}
{
    const result = (0, index_1.classifyTurnForMemory)("Read HEARTBEAT.md if it exists", undefined, {
        sessionKey: "agent:main:main",
    });
    strict_1.default.equal(result.allow, false);
}
{
    const result = (0, index_1.classifyTurnForMemory)("real user question about memory behavior", undefined, {
        sessionKey: "agent:main:main",
    });
    strict_1.default.equal(result.allow, true);
    strict_1.default.equal(result.reason, "real-user-turn");
}
{
    const result = (0, index_1.classifyTurnForMemory)(undefined, [
        { role: "user", content: "[PLAN_DECISION]: approved" },
        { role: "assistant", content: "got it" },
    ], {
        sessionKey: "agent:main:main",
    });
    strict_1.default.equal(result.allow, false);
    strict_1.default.equal(result.reason, "synthetic-user-turn");
}
{
    const messages = (0, index_1.extractMessages)([
        { role: "user", content: "[PLAN_DECISION]: approved" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "(session bootstrap)" },
        { role: "user", content: "please remember I prefer short replies" },
        { role: "assistant", content: "Noted." },
    ]);
    strict_1.default.deepEqual(messages, [
        { role: "assistant", content: "ok" },
        { role: "user", content: "please remember I prefer short replies" },
        { role: "assistant", content: "Noted." },
    ]);
}
{
    strict_1.default.equal((0, index_1.isMemoryRelevant)("[PLAN_DECISION]: approved"), false);
    strict_1.default.equal((0, index_1.isMemoryRelevant)("What did we decide about the Cortex plugin?"), true);
}
console.log("turn-gating tests passed");
//# sourceMappingURL=turn-gating.test.js.map