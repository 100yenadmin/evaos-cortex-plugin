"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const index_1 = require("../index");
const baseCfg = {
    injectionHardFloor: 0.50,
    injectionCriticalThreshold: 0.75,
    injectionTechnicalThreshold: 0.60,
    injectionPersonalThreshold: 0.45,
};
function mem(content, score, category = "misc") {
    return {
        source: "api",
        item_id: `${Math.random()}`,
        content,
        score,
        metadata: { category },
    };
}
{
    const mode = (0, index_1.detectInjectionMode)("MemoryBench bench-20260411-023449 is still active");
    strict_1.default.equal(mode, "critical");
    const items = [
        mem("LoCoMo benchmark run bench-20260411-023449 is still active", 0.82, "episodic"),
    ];
    const kept = (0, index_1.screenInjectionCandidates)(items, "LoCoMo bench-20260411-023449 is dead", baseCfg, undefined);
    strict_1.default.equal(kept.length, 0);
}
{
    const items = [
        mem("Eva said I love you for the first time", 0.69, "personal"),
    ];
    const kept = (0, index_1.screenInjectionCandidates)(items, "git commit and cortex debug", baseCfg, undefined);
    strict_1.default.equal(kept.length, 0);
}
{
    const items = [
        mem("High-confidence personal note", 0.70, "personal"),
    ];
    const kept = (0, index_1.screenInjectionCandidates)(items, "git branch fix cortex debug", baseCfg, undefined);
    strict_1.default.equal(kept.length, 1);
}
{
    const items = [
        mem("Lower-score casual memory", 0.44, "personal"),
    ];
    const kept = (0, index_1.screenInjectionCandidates)(items, "what should we do next?", baseCfg, undefined);
    strict_1.default.equal(kept.length, 0);
}
console.log("injection-screening tests passed");
//# sourceMappingURL=injection-screening.test.js.map