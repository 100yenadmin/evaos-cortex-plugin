"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = __importDefault(require("node:fs"));
const rootManifest = JSON.parse(node_fs_1.default.readFileSync("openclaw.plugin.json", "utf8"));
const distManifest = JSON.parse(node_fs_1.default.readFileSync("dist/openclaw.plugin.json", "utf8"));
strict_1.default.deepEqual(distManifest.tools, rootManifest.tools);
strict_1.default.deepEqual(distManifest.configSchema, rootManifest.configSchema);
strict_1.default.equal(distManifest.main, "index.js");
for (const property of [
    "ownerIdMode",
    "companyBrainContextMode",
    "companyBrainContextAccountId",
    "companyBrainContextSearch",
    "companyBrainContextFactsLimit",
    "companyBrainContextEventsLimit",
    "companyBrainContextMaxChars",
]) {
    strict_1.default.ok(distManifest.configSchema.properties[property], `dist manifest is missing ${property}`);
}
strict_1.default.ok(distManifest.tools.includes("cortex_insights"), "dist manifest is missing cortex_insights");
for (const toolName of [
    "cortex_entities_list",
    "cortex_entity_detail",
    "cortex_graph_query",
]) {
    strict_1.default.ok(distManifest.tools.includes(toolName), `dist manifest is missing ${toolName}`);
}
console.log("plugin-manifest-parity tests passed");
//# sourceMappingURL=plugin-manifest-parity.test.js.map