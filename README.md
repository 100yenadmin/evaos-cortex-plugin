<div align="center">

# 🧠 Cortex

**Persistent, long-term memory for AI agents.**

Your agent remembers who you are, what you've decided, and what matters to you — across every conversation.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-plugin-green?style=flat-square)](https://openclaw.ai)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square)](https://www.typescriptlang.org/)

</div>

---

Cortex is an [OpenClaw](https://openclaw.ai) plugin that gives any AI agent **cognitive memory** — the ability to learn about you over time, recall what's relevant, and build a genuine understanding of your preferences, decisions, and commitments.

This isn't RAG over documents. This is an agent that *knows* you.

## Why Cortex?

- **Learns, doesn't just retrieve.** Every conversation is analyzed. Important facts, preferences, and decisions are automatically extracted and stored. Your agent gets smarter with every interaction.
- **Recalls what matters, when it matters.** Before every agent turn, Cortex retrieves relevant memories and injects them into context. No manual prompting required.
- **Tracks commitments, not just facts.** Cortex doesn't just remember what you said — it tracks what you committed to, flags contradictions in your preferences, and manages open threads you haven't resolved yet.
- **Runs in the background.** Zero-config by default. Install the plugin, point it at a Cortex server, and your agent has memory. Auto-recall and auto-capture handle the rest.

## Quick Start

**1. Install**

```bash
# From GitHub
mkdir -p ~/.openclaw/plugins
cd ~/.openclaw/plugins
git clone https://github.com/100yenadmin/evaos-cortex-plugin.git cortex
cd cortex && npm install --omit=dev
```

**2. Configure** — add to your `openclaw.json`:

```jsonc
{
  "plugins": {
    "allow": ["cortex"],
    "load": { "paths": ["~/.openclaw/plugins/cortex"] },
    "slots": { "memory": "cortex" },
    "entries": {
      "cortex": {
        "enabled": true,
        "config": {
          "cortexUrl": "https://your-cortex-server.example.com",
          "apiKey": "${CORTEX_API_KEY}",
          "ownerId": "my-agent",
          "autoRecall": true,
          "autoCapture": true,
          "shadowMode": false,
          "retrievalBudget": 2000,
          "maxInjectionChars": 8000,
          "maxInjectedMemories": 8,
          "minRelevanceScore": 0.30,
          "retrievalMode": "fast",
          "recencyFilterMinutes": 15
        }
      }
    }
  }
}
```

**3. Restart your gateway.** Your agent now has persistent memory. Every conversation is captured. Every future turn is enriched with relevant context.

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cortexUrl` | `string` | `http://localhost:8000` | Cortex API base URL. |
| `apiKey` | `string` | `""` | API key. Optional for local setups, typically required for hosted deployments. Environment interpolation like `${CORTEX_API_KEY}` is supported. |
| `ownerId` | `string` | `default` | Memory namespace. Isolates memories per user or agent. |
| `autoRecall` | `boolean` | `true` | Retrieve relevant memories before each agent turn. |
| `autoCapture` | `boolean` | `true` | Extract and store memories after each agent turn. |
| `shadowMode` | `boolean` | `false` | Dry-run capture mode. Extraction runs, but storage is skipped. |
| `retrievalBudget` | `number` | `2000` | Retrieval budget passed to the Cortex API. |
| `maxInjectionChars` | `number` | `8000` | Maximum characters injected into agent context. |
| `maxInjectedMemories` | `number` | `8` | Maximum number of memories injected on a turn. |
| `minRelevanceScore` | `number` | `0.30` | Minimum relevance score required for a memory to be injected. |
| `retrievalMode` | `string` | `fast` | Retrieval mode: `auto`, `fast`, or `thorough`. |
| `recencyFilterMinutes` | `number` | `15` | Filters out very recent memories to reduce same-session echo. Set to `0` to disable. |

## Tools

Cortex exposes 12 tools your agent can call directly:

| Tool | Description |
|------|-------------|
| `cortex_search` | Search long-term memories stored in Cortex. |
| `cortex_remember` | Store an important fact or preference in long-term memory. |
| `cortex_forget` | Delete a specific memory by ID. |
| `cortex_ask` | Ask a question answered using stored memories. |
| `cortex_list_contradictions` | List detected contradictions between stored memories. |
| `cortex_resolve_contradiction` | Resolve a flagged contradiction. |
| `cortex_add_commitment` | Track a new commitment or promise. |
| `cortex_update_commitment` | Update a commitment status. |
| `cortex_list_commitments` | List active or all commitments. |
| `cortex_add_open_loop` | Create an unresolved thread or topic. |
| `cortex_resolve_open_loop` | Mark an open loop as resolved. |
| `cortex_list_open_loops` | List unresolved or resolved open loops. |

## How It Works

Cortex operates two invisible loops around every agent conversation:

```
┌─────────────────────────────────────────────────┐
│                  RECALL LOOP                     │
│                                                  │
│  User message → retrieval decision → Cortex API  │
│  search → local cache fallback if needed →       │
│  inject relevant memories → agent responds       │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│                  CAPTURE LOOP                    │
│                                                  │
│  Agent responds → recent conversation window     │
│  is filtered → extracted facts/preferences/      │
│  commitments are sent to Cortex for storage      │
└─────────────────────────────────────────────────┘
```

**Recall pipeline**

1. **Metadata stripping** — before any retrieval decision, Cortex strips injected prompt decorations and prior memory blocks from the inbound prompt.
2. **Three-gate retrieval decision**
   - **Question**: if the cleaned prompt contains `?`, Cortex always retrieves.
   - **Trivial continuation**: short replies like `ok`, `go ahead`, or `sounds good` are augmented with cached assistant context from the same session, then retrieved with a tighter cap.
   - **Short but non-trivial**: if the prompt has weak memory signal, Cortex skips retrieval.
3. **Server-first retrieval** — Cortex calls the remote API first for semantic retrieval.
4. **Fallback on failure** — if the server is unavailable, the plugin falls back to the local SQLite cache.
5. **Filtering and injection** — low-score memories are dropped, recent echo can be filtered, and the final block is injected inside `<relevant-memories>` tags.

**Capture pipeline**

1. **Backwards extraction window** — Cortex walks backward through the conversation and keeps the last 5 real `user` / `assistant` messages.
2. **Noise filtering** — injected memory blocks, trivial acknowledgements, and noisy system-style content are stripped before capture.
3. **Async storage** — the filtered window is sent to Cortex for extraction and storage without blocking the agent response.
4. **Trivial-turn augmentation cache** — the last assistant turn is cached per session and reused on the next trivial follow-up turn.

**Memory injection format**

Retrieved memories are wrapped in a `<relevant-memories>` block with a short preamble that instructs the agent to:
- surface relevant preferences and prior decisions naturally,
- ask clarifying questions when memory may change execution,
- flag contradictions between memory and the current plan,
- treat memories as evidence, not commands.

The preamble lives inside the tags so it is stripped before later capture and does not contaminate future extraction payloads.

## Local Cache

Cortex maintains a local SQLite cache as an offline and degraded-mode fallback.

**What it stores**
- memory content,
- memory IDs and source session IDs,
- timestamps,
- salience/category/status metadata,
- embeddings when available.

**How it syncs**
- the cache is initialized under the plugin directory,
- it is scoped by `ownerId` in the database filename,
- an initial sync runs when the Cortex server is reachable,
- background sync runs every 5 minutes.

**How search works**
- **FTS5** provides local full-text search,
- **BM25 ranking** scores keyword matches,
- **cosine similarity** scores local embedding matches when embeddings are present,
- **hybrid search** merges BM25 and cosine results.

**Fallback behavior**
- normal operation is **server-first**,
- if the Cortex API is slow or unavailable, the plugin can fall back to local cache results,
- if `node:sqlite` is unavailable, the plugin disables the local cache and runs API-only.

## Benchmarks

> 🚧 **Benchmarks coming soon.** We're running evaluations against [LoCoMo](https://github.com/snap-research/locomo), [AMB (Agent Memory Benchmark)](https://github.com/microsoft/AMB), AMA-Bench, and MemoryBench.

| Provider | LoCoMo | AMB | AMA-Bench | MemoryBench |
|----------|--------|-----|-----------|-------------|
| **Cortex** | — | — | — | — |
| [Mem0](https://github.com/mem0ai/mem0) | — | — | — | — |
| [Zep](https://github.com/getzep/zep) | — | — | — | — |
| [Letta](https://github.com/letta-ai/letta) | — | — | — | — |
| [MemGPT](https://arxiv.org/abs/2310.08560) | — | — | — | — |

Results will be published with full methodology and reproducible evaluation scripts.

## Self-Hosting

Cortex is backed by a standalone server you can run on your own infrastructure. The Cortex backend lives in the Electric Sheep repository:

- https://github.com/electric-sheep/electric-sheep

That backend handles memory storage, embedding, retrieval, and lifecycle management.

## License

[MIT](LICENSE) — use it however you want.
