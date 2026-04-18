"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const index_1 = require("../index");
(0, node_test_1.describe)("classifyTurnForMemory", () => {
    (0, node_test_1.it)("blocks synthetic PLAN_DECISION prompts", () => {
        const result = (0, index_1.classifyTurnForMemory)("[PLAN_DECISION]: approved", undefined, {
            sessionKey: "agent:main:main",
        });
        strict_1.default.equal(result.allow, false);
        strict_1.default.equal(result.reason, "synthetic-prompt");
    });
    (0, node_test_1.it)("blocks QUESTION_ANSWER prompts", () => {
        const result = (0, index_1.classifyTurnForMemory)("[QUESTION_ANSWER]: yes", undefined, {
            sessionKey: "agent:main:main",
        });
        strict_1.default.equal(result.allow, false);
    });
    (0, node_test_1.it)("blocks heartbeat control prompts", () => {
        const result = (0, index_1.classifyTurnForMemory)("Read HEARTBEAT.md if it exists", undefined, {
            sessionKey: "agent:main:main",
        });
        strict_1.default.equal(result.allow, false);
    });
    (0, node_test_1.it)("accepts real user turns", () => {
        const result = (0, index_1.classifyTurnForMemory)("real user question about memory behavior", undefined, {
            sessionKey: "agent:main:main",
        });
        strict_1.default.equal(result.allow, true);
        strict_1.default.equal(result.reason, "real-user-turn");
    });
    (0, node_test_1.it)("blocks synthetic latest user turns from transcript messages", () => {
        const result = (0, index_1.classifyTurnForMemory)(undefined, [
            { role: "user", content: "[PLAN_DECISION]: approved" },
            { role: "assistant", content: "got it" },
        ], {
            sessionKey: "agent:main:main",
        });
        strict_1.default.equal(result.allow, false);
        strict_1.default.equal(result.reason, "synthetic-user-turn");
    });
});
(0, node_test_1.describe)("extractMessages", () => {
    (0, node_test_1.it)("filters synthetic control turns while preserving real conversation", () => {
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
    });
    (0, node_test_1.it)("drops a final synthetic user message", () => {
        const messages = (0, index_1.extractMessages)([
            { role: "user", content: "real question" },
            { role: "assistant", content: "real answer" },
            { role: "user", content: "[PLAN_DECISION]: approved" },
        ]);
        strict_1.default.deepEqual(messages, [
            { role: "user", content: "real question" },
            { role: "assistant", content: "real answer" },
        ]);
    });
});
(0, node_test_1.describe)("isMemoryRelevant", () => {
    (0, node_test_1.it)("rejects synthetic plan-control prompts", () => {
        strict_1.default.equal((0, index_1.isMemoryRelevant)("[PLAN_DECISION]: approved"), false);
    });
    (0, node_test_1.it)("keeps normal Cortex-related questions relevant", () => {
        strict_1.default.equal((0, index_1.isMemoryRelevant)("What did we decide about the Cortex plugin?"), true);
    });
});
//# sourceMappingURL=turn-gating.test.js.map