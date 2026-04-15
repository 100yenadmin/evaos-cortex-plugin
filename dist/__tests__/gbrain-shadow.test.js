"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const index_1 = require("../index");
{
    const cfg = (0, index_1.parseEvaMemoryConfig)({
        gbrainShadowEnabled: true,
        gbrainShadowProviderBaseUrl: "https://minimax.example/v1",
        gbrainShadowModel: "MiniMax-M2.7-full",
        gbrainShadowMaxPromptChars: 12,
    });
    strict_1.default.equal(cfg.gbrainShadowEnabled, true);
    strict_1.default.equal(cfg.gbrainShadowProviderBaseUrl, "https://minimax.example/v1");
    strict_1.default.equal(cfg.gbrainShadowModel, "MiniMax-M2.7-full");
}
{
    const event = (0, index_1.createGBrainShadowEvent)({
        phase: "recall",
        sessionId: "sess-1",
        providerBaseUrl: "https://api.minimax.io/v1",
        model: "MiniMax-M2.7",
        prompt: "This prompt is intentionally longer than the clamp",
        maxPromptChars: 16,
        status: "simulated",
        note: "observe only",
        wouldInjectCount: 3,
    });
    strict_1.default.equal(event.phase, "recall");
    strict_1.default.equal(event.mode, "observe");
    strict_1.default.equal(event.provider.model, "MiniMax-M2.7");
    strict_1.default.equal(event.wouldInjectCount, 3);
    strict_1.default.match(event.promptPreview ?? "", /^This prompt is/);
}
{
    const event = (0, index_1.createGBrainShadowEvent)({
        phase: "capture",
        sessionId: "sess-2",
        providerBaseUrl: "https://api.minimax.io/v1",
        model: "MiniMax-M2.7",
        conversation: [
            { role: "user", content: "hello there, this is a longish message" },
            { role: "assistant", content: "reply with some additional details" },
        ],
        maxPromptChars: 20,
        status: "simulated",
        note: "capture preview",
    });
    strict_1.default.equal(event.conversationPreview?.length, 2);
    strict_1.default.equal(event.conversationPreview?.[0]?.role, "user");
    strict_1.default.ok((event.conversationPreview?.[0]?.content.length ?? 0) <= 80);
}
{
    const logPath = (0, index_1.getGBrainShadowLogPath)("owner-a");
    strict_1.default.match(logPath, /gbrain-shadow-owner-a\.jsonl$/);
}
console.log("gbrain-shadow tests passed");
//# sourceMappingURL=gbrain-shadow.test.js.map