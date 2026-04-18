import assert from "node:assert/strict";
import { createGBrainShadowEvent, getGBrainShadowLogPath, parseEvaMemoryConfig } from "../index";

{
  const cfg = parseEvaMemoryConfig({
    gbrainShadowEnabled: true,
    gbrainShadowProviderBaseUrl: "https://minimax.example/v1",
    gbrainShadowModel: "MiniMax-M2.7-full",
    gbrainShadowMaxPromptChars: 12,
  });
  assert.equal(cfg.gbrainShadowEnabled, true);
  assert.equal(cfg.gbrainShadowProviderBaseUrl, "https://minimax.example/v1");
  assert.equal(cfg.gbrainShadowModel, "MiniMax-M2.7-full");
}

{
  const event = createGBrainShadowEvent({
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
  assert.equal(event.phase, "recall");
  assert.equal(event.mode, "observe");
  assert.equal(event.provider.model, "MiniMax-M2.7");
  assert.equal(event.wouldInjectCount, 3);
  assert.match(event.promptPreview ?? "", /^This prompt is/);
}

{
  const event = createGBrainShadowEvent({
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
  assert.equal(event.conversationPreview?.length, 2);
  assert.equal(event.conversationPreview?.[0]?.role, "user");
  assert.ok((event.conversationPreview?.[0]?.content.length ?? 0) <= 80);
}

{
  const logPath = getGBrainShadowLogPath("owner-a");
  assert.match(logPath, /gbrain-shadow-owner-a\.jsonl$/);
}

console.log("gbrain-shadow tests passed");
