"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const index_1 = require("../index");
{
    const cfg = (0, index_1.parseEvaMemoryConfig)({ ownerId: "company-acme" });
    strict_1.default.equal(cfg.ownerId, "company-acme");
    strict_1.default.equal(cfg.ownerIdMode, "server_resolved");
    strict_1.default.equal((0, index_1.shouldSendConfiguredOwner)(cfg.ownerId, cfg.ownerIdMode), false);
}
{
    const cfg = (0, index_1.parseEvaMemoryConfig)({ ownerId: "company-acme", ownerIdMode: "configured" });
    strict_1.default.equal(cfg.ownerIdMode, "configured");
    strict_1.default.equal((0, index_1.shouldSendConfiguredOwner)(cfg.ownerId, cfg.ownerIdMode), true);
    strict_1.default.deepEqual((0, index_1.withConfiguredOwner)({ query: "status" }, cfg.ownerId, cfg.ownerIdMode), { query: "status", owner_id: "company-acme" });
}
{
    const body = (0, index_1.withConfiguredOwner)({ query: "status" }, "company-acme", "server_resolved");
    strict_1.default.deepEqual(body, { query: "status" });
}
{
    const source = node_fs_1.default.readFileSync("src/index.ts", "utf8");
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
        strict_1.default.notEqual(start, -1, `${toolName} registration should exist`);
        const nextRegistration = source.indexOf("api.registerTool", start + 1);
        const block = source.slice(start, nextRegistration === -1 ? source.length : nextRegistration);
        strict_1.default.equal(/\bowner_id\b/.test(block), false, `${toolName} schema and execute block must not expose caller-supplied owner_id`);
        strict_1.default.equal(new RegExp(`client\\.${clientMethod}\\([^)]*owner_id`).test(block), false, `${toolName} execute path must not pass caller-supplied owner_id`);
    }
}
console.log("owner-context tests passed");
//# sourceMappingURL=owner-context.test.js.map