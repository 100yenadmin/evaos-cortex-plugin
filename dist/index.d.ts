/**
 * cortex — OpenClaw plugin bridging to Cortex HTTP API.
 *
 * Design principles:
 *   - HTTP-only: pure fetch() to Cortex, no Python subprocesses
 *   - Lazy injection: only inject memories when query seems memory-relevant
 *   - Non-blocking capture: agent_end fires and forgets, never blocks gateway
 *   - Token budget: hard cap on injected content (default 2000 tokens ~8000 chars)
 *   - Graceful degradation: Cortex down → log warning, continue
 *   - Session wake/sleep: non-blocking lifecycle calls
 *   - Lane guards: skip injection/capture for heartbeat, boot, subagent, cron lanes
 *   - Junk filter: drop trivial/noisy messages before capture
 *
 * Hooks:
 *   before_agent_start → POST /api/v1/memories/retrieve  → prependContext
 *   agent_end          → POST /api/v1/memories/remember   → fire-and-forget
 *   session_start      → POST /api/v1/sessions/wake
 *   session_end        → POST /api/v1/sessions/sleep
 *
 * Tools: cortex_search, cortex_remember, cortex_forget, cortex_ask,
 *        cortex_list_contradictions, cortex_resolve_contradiction,
 *        cortex_add_commitment, cortex_update_commitment, cortex_list_commitments,
 *        cortex_add_open_loop, cortex_resolve_open_loop, cortex_list_open_loops
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
interface EvaMemoryConfig {
    cortexUrl: string;
    apiKey: string;
    ownerId: string;
    autoRecall: boolean;
    autoCapture: boolean;
    shadowMode: boolean;
    retrievalBudget: number;
    maxInjectionChars: number;
    maxInjectedMemories: number;
    minRelevanceScore: number;
    retrievalMode: string;
    recencyFilterMinutes: number;
    injectCornerstones: boolean;
}
declare function parseConfig(raw: unknown): EvaMemoryConfig;
declare const cortexPlugin: {
    id: string;
    name: string;
    description: string;
    kind: "memory";
    configSchema: {
        parse: typeof parseConfig;
        jsonSchema: {
            type: string;
            additionalProperties: boolean;
            properties: {
                cortexUrl: {
                    type: string;
                };
                apiKey: {
                    type: string;
                };
                ownerId: {
                    type: string;
                };
                autoRecall: {
                    type: string;
                };
                autoCapture: {
                    type: string;
                };
                shadowMode: {
                    type: string;
                    description: string;
                };
                retrievalBudget: {
                    type: string;
                };
                maxInjectionChars: {
                    type: string;
                };
                maxInjectedMemories: {
                    type: string;
                    description: string;
                };
                minRelevanceScore: {
                    type: string;
                    description: string;
                };
                retrievalMode: {
                    type: string;
                    enum: string[];
                    description: string;
                };
                recencyFilterMinutes: {
                    type: string;
                    description: string;
                };
            };
            required: never[];
        };
    };
    register(api: OpenClawPluginApi): void;
};
export default cortexPlugin;
//# sourceMappingURL=index.d.ts.map