"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const index_1 = require("../index");
const manifest = JSON.parse(node_fs_1.default.readFileSync("openclaw.plugin.json", "utf8"));
for (const toolName of [
    "cortex_entities_list",
    "cortex_entity_detail",
    "cortex_graph_query",
]) {
    strict_1.default.ok(manifest.tools.includes(toolName), `manifest is missing ${toolName}`);
}
{
    const cfg = (0, index_1.parseEvaMemoryConfig)({ ownerId: "company-acme" });
    strict_1.default.equal(cfg.ownerIdMode, "server_resolved");
}
{
    const rendered = (0, index_1.formatCortexToolResult)("Cortex entities", {
        entities: [
            {
                id: "ent_assistant",
                name: "assistant",
                entity_type: "agent",
                claim_count: 12,
            },
        ],
        total: 1,
        errors: [],
    });
    strict_1.default.match(rendered, /Cortex entities:/);
    strict_1.default.match(rendered, /"id": "ent_assistant"/);
    strict_1.default.match(rendered, /"claim_count": 12/);
}
{
    strict_1.default.equal((0, index_1.formatCortexToolResult)("Cortex graph", null), "Cortex graph failed: Cortex returned no result.");
}
{
    const source = node_fs_1.default.readFileSync("src/index.ts", "utf8");
    const coreReadTools = [
        ["cortex_entities_list", "listEntities"],
        ["cortex_entity_detail", "getEntityDetail"],
        ["cortex_graph_query", "queryGraph"],
    ];
    for (const [toolName, clientMethod] of coreReadTools) {
        const start = source.indexOf(`name: "${toolName}"`);
        strict_1.default.notEqual(start, -1, `${toolName} registration should exist`);
        const nextRegistration = source.indexOf("api.registerTool", start + 1);
        const block = source.slice(start, nextRegistration === -1 ? source.length : nextRegistration);
        strict_1.default.equal(/\bowner_id\b/.test(block), false, `${toolName} schema and execute block must not expose caller-supplied owner_id`);
        strict_1.default.equal(new RegExp(`client\\.${clientMethod}\\([^)]*owner_id`).test(block), false, `${toolName} execute path must not pass caller-supplied owner_id`);
    }
}
console.log("core-entity-graph-tools tests passed");
//# sourceMappingURL=core-entity-graph-tools.test.js.map