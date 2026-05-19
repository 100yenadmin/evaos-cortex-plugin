# Cortex Core Plugin Tools

The plugin exposes core Cortex memory, entity, and graph features only through
explicit Cortex HTTP tools. Hosted deployments should keep `ownerIdMode` set to
`server_resolved` so Cortex resolves the effective owner from the request. The
tools do not expose per-call `owner_id` parameters.

## Entity And Graph Tools

| tool | purpose |
|------|---------|
| `cortex_entities_list` | List or search owner-resolved entities. |
| `cortex_entity_detail` | Fetch one entity with aliases, claims, and relationships. |
| `cortex_graph_query` | Fetch the owner-resolved entity relationship graph. |

Use `cortex_entities_list` before `cortex_entity_detail` or a centered
`cortex_graph_query` when you need a stable entity ID. Graph output is raw
Cortex JSON so agents preserve node IDs, relationship labels, counts, and any
route diagnostics returned by Cortex.

These tools are read-only. They do not write to plugin storage and they do not
send `X-Owner-Id`.
