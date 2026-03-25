# @evaos/cortex

Cortex memory engine plugin for OpenClaw — retrieval, storage, and lifecycle management.

Connects your OpenClaw gateway to a running [Cortex](https://github.com/100yenadmin/electric-sheep) instance, providing:
- **Auto-recall:** Relevant memories injected before each agent turn
- **Auto-capture:** Conversations stored to memory after each agent turn
- **Session lifecycle:** Wake/sleep calls to Cortex on session start/end
- **12 Cortex tools** exposed to the agent (`cortex_search`, `cortex_remember`, etc.)

---

## Requirements

- Node.js 22+ (uses `node:sqlite` for local caching)
- A running Cortex instance (local or hosted on Fly.io)
- OpenClaw gateway

---

## Installation

### Option A — From GitHub (private, for evaOS customer VMs)

```bash
cd ~/.openclaw/extensions
git clone https://github.com/100yenadmin/evaos-cortex-plugin.git cortex
cd cortex && npm install --omit=dev
```

Then register in your `openclaw.json`:
```json
{
  "plugins": {
    "entries": {
      "cortex": {
        "path": "~/.openclaw/extensions/cortex",
        "config": {
          "cortexUrl": "https://your-cortex.fly.dev",
          "apiKey": "your-api-key",
          "ownerId": "eva"
        }
      }
    }
  }
}
```

### Option B — From npm (once published)

```bash
openclaw plugins install @evaos/cortex
```

---

## Configuration

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cortexUrl` | string | — | Cortex API base URL (required) |
| `apiKey` | string | — | Cortex API key (required for production) |
| `ownerId` | string | — | Memory owner namespace (e.g. `"eva"`) |
| `autoRecall` | boolean | `true` | Auto-inject memories before agent turns |
| `autoCapture` | boolean | `true` | Auto-capture conversations to memory |
| `shadowMode` | boolean | `false` | Dry-run capture (extract but don't store) |
| `retrievalBudget` | number | `2000` | Max token budget for retrieved memories |
| `maxInjectionChars` | number | `8000` | Max characters injected into context |
| `retrievalMode` | string | `"fast"` | `auto` \| `fast` \| `thorough` |

---

## Available Tools

| Tool | Description |
|------|-------------|
| `cortex_search` | Search memories by query |
| `cortex_remember` | Store a new memory |
| `cortex_forget` | Delete a memory by ID |
| `cortex_ask` | Ask a question answered from stored memories |
| `cortex_list_contradictions` | List detected memory contradictions |
| `cortex_resolve_contradiction` | Resolve a flagged contradiction |
| `cortex_add_commitment` | Track a commitment or promise |
| `cortex_update_commitment` | Update commitment status |
| `cortex_list_commitments` | List active commitments |
| `cortex_add_open_loop` | Track an unresolved thread |
| `cortex_resolve_open_loop` | Mark an open loop as resolved |
| `cortex_list_open_loops` | List open threads |

---

## Building from Source

```bash
npm install
npm run build
# Output: dist/index.js
```

---

## How It Works

The plugin hooks into four OpenClaw lifecycle events:

- **`before_agent_start`** → POST `/api/v1/memories/retrieve` → prepends context block
- **`agent_end`** → POST `/api/v1/memories/remember` → fire-and-forget capture
- **`session_start`** → POST `/api/v1/sessions/wake`
- **`session_end`** → POST `/api/v1/sessions/sleep`

Retrieval uses lazy injection — memories are only fetched when the query appears memory-relevant. Lane guards skip injection/capture for heartbeat, boot, subagent, and cron lanes.

---

## License

MIT — © ElectricSheep Inc. / 100Yen Org
