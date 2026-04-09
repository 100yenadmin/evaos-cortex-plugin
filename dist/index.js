"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const typebox_1 = require("@sinclair/typebox");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
// Dynamic require for node:sqlite (available in Node 22+, avoids TS import issues)
let NodeDatabaseSync;
try {
    NodeDatabaseSync = require("node:sqlite").DatabaseSync;
}
catch {
    // node:sqlite not available — cache will be disabled
}
// --- Config ---
function resolveEnv(value) {
    return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? "");
}
function parseConfig(raw) {
    const defaults = {
        cortexUrl: "http://localhost:8000",
        apiKey: "",
        ownerId: "default",
        autoRecall: true,
        autoCapture: true,
        shadowMode: false,
        retrievalBudget: 2000,
        maxInjectionChars: 8000,
        maxInjectedMemories: 8,
        minRelevanceScore: 0.25,
        retrievalMode: "fast",
        recencyFilterMinutes: 15,
        injectCornerstones: false,
    };
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return defaults;
    const c = raw;
    const VALID_MODES = ["auto", "fast", "thorough"];
    const parsedMode = typeof c.retrievalMode === "string" && VALID_MODES.includes(c.retrievalMode)
        ? c.retrievalMode
        : defaults.retrievalMode;
    return {
        cortexUrl: typeof c.cortexUrl === "string" ? resolveEnv(c.cortexUrl) : defaults.cortexUrl,
        apiKey: typeof c.apiKey === "string" ? resolveEnv(c.apiKey) : defaults.apiKey,
        ownerId: typeof c.ownerId === "string" && c.ownerId ? c.ownerId : defaults.ownerId,
        autoRecall: c.autoRecall !== false,
        autoCapture: c.autoCapture !== false,
        shadowMode: c.shadowMode === true,
        retrievalBudget: typeof c.retrievalBudget === "number" ? c.retrievalBudget : defaults.retrievalBudget,
        maxInjectionChars: typeof c.maxInjectionChars === "number" ? c.maxInjectionChars : defaults.maxInjectionChars,
        maxInjectedMemories: typeof c.maxInjectedMemories === "number" ? c.maxInjectedMemories : defaults.maxInjectedMemories,
        minRelevanceScore: typeof c.minRelevanceScore === "number" ? c.minRelevanceScore : defaults.minRelevanceScore,
        retrievalMode: parsedMode,
        recencyFilterMinutes: typeof c.recencyFilterMinutes === "number" ? c.recencyFilterMinutes : defaults.recencyFilterMinutes,
        injectCornerstones: c.injectCornerstones === true, // default false — cornerstones loaded from SOUL.md
    };
}
// --- HTTP Client ---
class CortexClient {
    baseUrl;
    apiKey;
    ownerId;
    warn;
    constructor(baseUrl, apiKey, ownerId, warnFn) {
        this.baseUrl = baseUrl;
        this.apiKey = apiKey;
        this.ownerId = ownerId;
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.warn = warnFn ?? console.warn;
    }
    headers() {
        const h = { "Content-Type": "application/json" };
        if (this.apiKey)
            h["X-API-Key"] = this.apiKey;
        // NOTE: X-Owner-Id intentionally NOT sent — server resolves ownership
        // from the API key via flyio-sync. Sending owner_id in headers would
        // allow identity spoofing in legacy auth mode.
        return h;
    }
    async post(path, body, timeoutMs = 5000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "POST",
                headers: this.headers(),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (res.headers.get("Deprecation") === "true") {
                const sunset = res.headers.get("Sunset") ?? "unknown";
                const link = res.headers.get("Link") ?? "";
                this.warn(`[cortex] WARNING: ${path} is deprecated (Sunset: ${sunset}).${link ? ` ${link}` : ""}`);
            }
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            clearTimeout(timer);
            return null;
        }
    }
    async get(path, timeoutMs = 5000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "GET",
                headers: this.headers(),
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            clearTimeout(timer);
            return null;
        }
    }
    async patch(path, body, timeoutMs = 5000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "PATCH",
                headers: this.headers(),
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            clearTimeout(timer);
            return null;
        }
    }
    async del(path, timeoutMs = 5000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: "DELETE",
                headers: this.headers(),
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!res.ok)
                return null;
            return (await res.json());
        }
        catch {
            clearTimeout(timer);
            return null;
        }
    }
    // --- Memory ---
    async retrieve(query, tokenBudget, mode = "auto") {
        // 2000ms timeout: allows for cold-start and first-embed latency.
        // For self-hosted Cortex (localhost or LAN) 200-800ms is typical.
        return this.post("/api/v1/memories/retrieve", {
            query,
            token_budget: tokenBudget,
            mode,
            owner_id: this.ownerId,
        }, 2000);
    }
    remember(conversation, sessionId, shadow = false) {
        const path = shadow ? "/api/v1/memories/remember?shadow=true" : "/api/v1/memories/remember";
        return this.post(path, { conversation, session_id: sessionId, source_session_id: sessionId, owner_id: this.ownerId }, 30000);
    }
    async search(query, limit = 10) {
        // API v1.2.0: field is "top_k" not "limit" (http-complete.md §POST /api/v1/memories/search)
        return this.post("/api/v1/memories/search", { query, owner_id: this.ownerId, top_k: limit });
    }
    async forget(memoryId) {
        return this.del(`/api/v1/memories/${encodeURIComponent(memoryId)}?owner_id=${encodeURIComponent(this.ownerId)}`);
    }
    // --- Sessions ---
    wake(sessionId) {
        // API v1.3.0 canonical: /api/v1/sessions/wake
        this.post("/api/v1/sessions/wake", { session_id: sessionId }).catch(() => { });
    }
    sleep(sessionId) {
        // API v1.3.0 canonical: /api/v1/sessions/sleep
        this.post("/api/v1/sessions/sleep", { session_id: sessionId }).catch(() => { });
    }
    // --- Dialectic ---
    async ask(question, ownerId, limit = 5) {
        return this.post("/api/v1/ask", { query: question, owner_id: ownerId ?? this.ownerId, max_steps: limit });
    }
    // --- Contradictions ---
    async listContradictions(ownerId) {
        const params = new URLSearchParams({ owner_id: ownerId ?? this.ownerId });
        return this.get(`/api/v1/contradictions?${params}`);
    }
    async resolveContradiction(id, resolution, ownerId) {
        return this.patch(`/api/v1/contradictions/${encodeURIComponent(id)}`, { resolution, owner_id: ownerId ?? this.ownerId });
    }
    // --- Commitments ---
    async addCommitment(description, dueAt, ownerId) {
        return this.post("/api/v1/commitments", { content: description, due_at: dueAt, owner_id: ownerId ?? this.ownerId });
    }
    async updateCommitment(commitmentId, commitmentStatus, ownerId) {
        return this.patch(`/api/v1/commitments/${encodeURIComponent(commitmentId)}`, { status: commitmentStatus, owner_id: ownerId ?? this.ownerId });
    }
    async listCommitments(ownerId, status) {
        const params = new URLSearchParams({ owner_id: ownerId ?? this.ownerId });
        if (status)
            params.set("status", status);
        return this.get(`/api/v1/commitments?${params}`);
    }
    // --- Open Loops ---
    async addOpenLoop(description, ownerId) {
        return this.post("/api/v1/open-loops", { content: description, owner_id: ownerId ?? this.ownerId });
    }
    async resolveOpenLoop(loopId, ownerId) {
        return this.patch(`/api/v1/open-loops/${encodeURIComponent(loopId)}`, { owner_id: ownerId ?? this.ownerId });
    }
    async listOpenLoops(ownerId, status) {
        const params = new URLSearchParams({ owner_id: ownerId ?? this.ownerId });
        if (status)
            params.set("status", status);
        return this.get(`/api/v1/open-loops?${params}`);
    }
    // --- Cornerstones ---
    async getCornerstones() {
        const params = new URLSearchParams({ owner_id: this.ownerId });
        return this.get(`/api/v1/cornerstones?${params}`, 3000);
    }
    // --- Health ---
    async health() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        try {
            const res = await fetch(`${this.baseUrl}/api/v1/health`, {
                headers: this.headers(),
                signal: controller.signal,
            });
            clearTimeout(timer);
            return res.ok;
        }
        catch {
            clearTimeout(timer);
            return false;
        }
    }
    // --- Bulk list (for cache sync) ---
    async listMemories(perPage = 200, page = 1, includeEmbeddings = false) {
        const params = new URLSearchParams({
            owner_id: this.ownerId,
            per_page: String(perPage),
            page: String(page),
            status: "active",
        });
        if (includeEmbeddings)
            params.set("include_embeddings", "true");
        return this.get(`/api/v1/memories?${params}`, 15000);
    }
}
// --- Local SQLite Memory Cache ---
class LocalMemoryCache {
    db; // DatabaseSync from node:sqlite
    constructor(dbPath) {
        // Ensure parent directory exists
        const dir = (0, node_path_1.dirname)(dbPath);
        if (!(0, node_fs_1.existsSync)(dir)) {
            (0, node_fs_1.mkdirSync)(dir, { recursive: true });
        }
        this.db = new NodeDatabaseSync(dbPath);
        this.db.exec("PRAGMA journal_mode=WAL");
        this.db.exec("PRAGMA synchronous=NORMAL");
        this.init();
    }
    init() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS cached_memories (
        item_id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        source_session_id TEXT,
        created_at TEXT,
        salience TEXT,
        category TEXT,
        status TEXT DEFAULT 'active',
        is_deleted INTEGER DEFAULT 0,
        score REAL DEFAULT 0,
        item_type TEXT,
        updated_at TEXT,
        synced_at TEXT,
        embedding BLOB,
        embedding_model TEXT
      )
    `);
        // Migration: add embedding columns if missing (existing DBs)
        try {
            this.db.exec("ALTER TABLE cached_memories ADD COLUMN embedding BLOB");
        }
        catch { /* column already exists */ }
        try {
            this.db.exec("ALTER TABLE cached_memories ADD COLUMN embedding_model TEXT");
        }
        catch { /* column already exists */ }
        // FTS5 virtual table for full-text search
        this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS cached_memories_fts USING fts5(
        content,
        content_rowid='rowid',
        tokenize='porter unicode61'
      )
    `);
        // Metadata key-value store
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache_meta (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
    }
    upsert(item) {
        const now = new Date().toISOString();
        // Decode base64 embedding to Buffer if present
        const embBuf = item.embedding ? Buffer.from(item.embedding, "base64") : null;
        const embModel = item.embedding_model ?? null;
        // Upsert main table (use prepared statement for BLOB binding)
        const stmt = this.db.prepare(`
      INSERT INTO cached_memories (item_id, content, source_session_id, created_at, salience, category, status, is_deleted, score, item_type, updated_at, synced_at, embedding, embedding_model)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        content=excluded.content, source_session_id=excluded.source_session_id,
        created_at=excluded.created_at, salience=excluded.salience, category=excluded.category,
        status=excluded.status, is_deleted=0, score=excluded.score, item_type=excluded.item_type,
        updated_at=excluded.updated_at, synced_at=excluded.synced_at,
        embedding=excluded.embedding, embedding_model=excluded.embedding_model
    `);
        stmt.run(item.item_id, item.content, item.source_session_id ?? "", item.created_at ?? "", item.metadata?.salience ?? "", item.metadata?.category ?? "", item.metadata?.status ?? "active", Number.isFinite(item.score) ? item.score : 0, item.item_type ?? "", now, now, embBuf, embModel);
        // Sync FTS — delete old entry if exists, then insert (prepared statements to avoid SQL injection)
        const rowid = this.db.prepare("SELECT rowid FROM cached_memories WHERE item_id = ?").get(item.item_id);
        if (rowid) {
            this.db.prepare("DELETE FROM cached_memories_fts WHERE rowid = ?").run(rowid.rowid);
            this.db.prepare("INSERT INTO cached_memories_fts (rowid, content) VALUES (?, ?)").run(rowid.rowid, item.content);
        }
    }
    upsertBatch(items) {
        this.db.exec("BEGIN TRANSACTION");
        try {
            for (const item of items) {
                this.upsert(item);
            }
            this.db.exec("COMMIT");
        }
        catch (err) {
            this.db.exec("ROLLBACK");
            throw err;
        }
    }
    search(query, limit) {
        if (!query || !query.trim())
            return [];
        // Sanitize query for FTS5: remove special chars, split into terms, join with spaces
        // Use OR between terms so multi-word queries aren't too restrictive
        const sanitized = query.replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean).join(" OR ");
        if (!sanitized)
            return [];
        try {
            const rows = this.db.prepare(`
        SELECT m.item_id, m.content, m.source_session_id, m.created_at, m.salience,
               m.category, m.status, m.score, m.item_type,
               rank
        FROM cached_memories_fts f
        JOIN cached_memories m ON f.rowid = m.rowid
        WHERE cached_memories_fts MATCH ? AND m.is_deleted = 0
        ORDER BY rank
        LIMIT ?
      `).all(sanitized, limit);
            return rows.map((r) => ({
                source: "local_cache",
                item_id: r.item_id,
                content: r.content,
                score: r.rank ?? 0, // FTS5 BM25 rank (negative, lower = better match)
                source_session_id: r.source_session_id || undefined,
                created_at: r.created_at || undefined,
                item_type: r.item_type || undefined,
                metadata: {
                    salience: r.salience || undefined,
                    category: r.category || undefined,
                    status: r.status || undefined,
                },
            }));
        }
        catch {
            // FTS5 query syntax error or empty table
            return [];
        }
    }
    markDeleted(itemId) {
        this.db.prepare("UPDATE cached_memories SET is_deleted = 1, updated_at = ? WHERE item_id = ?").run(new Date().toISOString(), itemId);
    }
    getLastSync() {
        const row = this.db.prepare("SELECT value FROM cache_meta WHERE key = 'last_sync'").get();
        return row?.value ?? null;
    }
    setLastSync(ts) {
        this.db.prepare("INSERT INTO cache_meta (key, value) VALUES ('last_sync', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(ts);
    }
    getCount() {
        const row = this.db.prepare("SELECT COUNT(*) as cnt FROM cached_memories WHERE is_deleted = 0").get();
        return row?.cnt ?? 0;
    }
    checkpoint() {
        this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    }
    /**
     * Brute-force cosine similarity search against locally cached embeddings.
     * At ~850 items (3.4MB), this runs in <1ms.
     */
    cosineSearch(queryEmbedding, limit) {
        const rows = this.db.prepare(`
      SELECT item_id, content, source_session_id, created_at, salience,
             category, status, score, item_type, embedding
      FROM cached_memories
      WHERE is_deleted = 0 AND embedding IS NOT NULL
    `).all();
        const scored = [];
        const qLen = Math.sqrt(queryEmbedding.reduce((s, v) => s + v * v, 0));
        if (qLen === 0)
            return [];
        for (const row of rows) {
            const blob = row.embedding;
            if (!blob || blob.byteLength < 4)
                continue;
            // Defensive copy: ensure 4-byte alignment for Float32Array (SQLite BLOB buffer may not be aligned)
            let docEmb;
            if (blob.byteOffset % 4 === 0) {
                docEmb = new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
            }
            else {
                const aligned = new Uint8Array(blob.byteLength);
                aligned.set(blob);
                docEmb = new Float32Array(aligned.buffer, 0, blob.byteLength / 4);
            }
            if (docEmb.length !== queryEmbedding.length)
                continue;
            let dot = 0, dLen = 0;
            for (let i = 0; i < docEmb.length; i++) {
                dot += queryEmbedding[i] * docEmb[i];
                dLen += docEmb[i] * docEmb[i];
            }
            dLen = Math.sqrt(dLen);
            if (dLen === 0)
                continue;
            const sim = dot / (qLen * dLen);
            scored.push({ row, sim });
        }
        scored.sort((a, b) => b.sim - a.sim);
        return scored.slice(0, limit).map(({ row, sim }) => ({
            source: "local_cache_cosine",
            item_id: row.item_id,
            content: row.content,
            score: sim,
            source_session_id: row.source_session_id || undefined,
            created_at: row.created_at || undefined,
            item_type: row.item_type || undefined,
            metadata: {
                salience: row.salience || undefined,
                category: row.category || undefined,
                status: row.status || undefined,
            },
        }));
    }
    /**
     * Hybrid search: merge FTS5 BM25 results with cosine similarity results.
     * α=0.3 for BM25, (1-α)=0.7 for cosine.
     */
    hybridSearch(query, queryEmbedding, limit) {
        const ALPHA = 0.3; // BM25 weight
        const SINGLE_SOURCE_PENALTY = 0.8;
        // Get FTS5 results
        const ftsResults = this.search(query, limit * 2);
        // If no embedding, fall back to FTS-only
        if (!queryEmbedding)
            return ftsResults.slice(0, limit);
        // Get cosine results
        const cosineResults = this.cosineSearch(queryEmbedding, limit * 2);
        // Normalize FTS scores (BM25 rank is negative, lower = better)
        // Convert to 0-1 range where 1 is best
        const ftsMap = new Map();
        if (ftsResults.length > 0) {
            // BM25 rank values are negative; more negative = more relevant
            // Normalize to [0, 1] range
            const ftsScores = ftsResults.map(r => r.score);
            const minFts = Math.min(...ftsScores);
            const maxFts = Math.max(...ftsScores);
            const ftsRange = maxFts - minFts || 1;
            for (const r of ftsResults) {
                // For BM25 rank (negative), lower is better, so invert
                const normScore = ftsRange === 0 ? 1.0 : 1.0 - (r.score - minFts) / ftsRange;
                ftsMap.set(r.item_id, { item: r, normScore });
            }
        }
        const cosineMap = new Map();
        for (const r of cosineResults) {
            // Cosine similarity is already 0-1 range
            cosineMap.set(r.item_id, { item: r, normScore: r.score });
        }
        // Merge
        const allIds = new Set([...ftsMap.keys(), ...cosineMap.keys()]);
        const merged = [];
        for (const id of allIds) {
            const ftsEntry = ftsMap.get(id);
            const cosEntry = cosineMap.get(id);
            let mergedScore;
            const item = (cosEntry?.item || ftsEntry?.item);
            if (ftsEntry && cosEntry) {
                // Both sources — weighted merge
                mergedScore = ALPHA * ftsEntry.normScore + (1 - ALPHA) * cosEntry.normScore;
            }
            else if (ftsEntry) {
                // FTS only — apply penalty
                mergedScore = ALPHA * ftsEntry.normScore * SINGLE_SOURCE_PENALTY;
            }
            else {
                // Cosine only — apply penalty
                mergedScore = (1 - ALPHA) * cosEntry.normScore * SINGLE_SOURCE_PENALTY;
            }
            merged.push({ item: { ...item, score: mergedScore, source: "local_cache_hybrid" }, mergedScore });
        }
        merged.sort((a, b) => b.mergedScore - a.mergedScore);
        return merged.slice(0, limit).map(m => m.item);
    }
    close() {
        try {
            this.checkpoint();
        }
        catch { /* ignore */ }
        try {
            this.db.close();
        }
        catch { /* ignore */ }
    }
}
/**
 * Embed a query string using Voyage-4-lite API.
 * Returns Float32Array or null on failure (graceful degradation).
 * Cost: ~$0.02/M tokens — negligible.
 */
async function embedQuery(text) {
    const apiKey = process.env.VOYAGE_API_KEY;
    if (!apiKey)
        return null;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000); // 2s timeout
        const resp = await fetch("https://api.voyageai.com/v1/embeddings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "voyage-4-lite",
                input: [text],
            }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok)
            return null;
        const data = (await resp.json());
        const embedding = data?.data?.[0]?.embedding;
        if (!Array.isArray(embedding) || embedding.length === 0)
            return null;
        return new Float32Array(embedding);
    }
    catch {
        // Timeout, network error, etc. — graceful degradation
        return null;
    }
}
// Background sync: fetch all active memories from server, upsert into local cache
async function syncMemoryCache(client, cache, logger) {
    try {
        let page = 1;
        let pages = 1;
        let synced = 0;
        let total = 0;
        do {
            const result = await client.listMemories(200, page, true);
            if (!result?.items?.length)
                break;
            total = result.total ?? 0;
            pages = result.pages ?? 1;
            // Normalize API response shape to RetrievedItem format (with embedding data)
            const normalized = result.items.map((raw) => ({
                source: "sync",
                item_id: raw.item_id || raw.id || "",
                content: raw.content || "",
                score: raw.score ?? 0,
                source_session_id: raw.source_session_id || "",
                created_at: raw.created_at || "",
                item_type: raw.item_type || raw.memory_type || "",
                metadata: {
                    salience: raw.metadata?.salience || raw.salience || "",
                    category: raw.metadata?.category || raw.category || "",
                    status: raw.metadata?.status || raw.status || "active",
                },
                embedding: raw.embedding || null,
                embedding_model: raw.embedding_model || null,
            }));
            cache.upsertBatch(normalized);
            synced += result.items.length;
            page++;
        } while (page <= pages);
        cache.setLastSync(new Date().toISOString());
        // Compact WAL to prevent bloat (WAL was 5.7× DB size without this)
        try {
            cache.checkpoint();
        }
        catch { /* ignore checkpoint errors */ }
        logger.info(`cortex: cache sync complete — ${synced} memories cached (total server: ${total})`);
    }
    catch (err) {
        logger.warn(`cortex: cache sync failed: ${String(err)}`);
    }
}
// --- Memory-relevance heuristic ---
const MEMORY_KEYWORDS = /\b(remember|forgot|recall|last time|previously|before|earlier|you said|you told|we discussed|we decided|my preference|my name|who am i|what do i|do you know|history|past|memory|memorize|don'?t forget)\b/i;
const TRIVIAL_PATTERNS = /^(hi|hello|hey|thanks|ok|yes|no|sure|bye|good morning|good night|👍|😊)[\s!?.]*$/i;
// Sub-agent completion events and runtime system events should not trigger memory retrieval
const SYSTEM_EVENT_PATTERNS = /\[Internal task completion event\]|<<<BEGIN_UNTRUSTED_CHILD_RESULT>>>|source: subagent|type: subagent task|^\[.*\] Exec (?:completed|failed)|^\[.*\] OpenClaw runtime context/m;
function isMemoryRelevant(prompt) {
    if (!prompt || prompt.length < 3)
        return false;
    if (TRIVIAL_PATTERNS.test(prompt.trim()))
        return false;
    // Skip sub-agent completion events and runtime system events
    if (SYSTEM_EVENT_PATTERNS.test(prompt))
        return false;
    // Short prompts without memory keywords → skip
    if (prompt.length < 40 && !MEMORY_KEYWORDS.test(prompt))
        return false;
    // Questions and longer prompts are worth checking
    return true;
}
function resolveHookRunKind(ctx) {
    if (ctx?.runKind)
        return ctx.runKind;
    const key = ctx?.sessionKey ?? "";
    if (!key)
        return "unknown";
    if (key.startsWith("hook:"))
        return "hook";
    if (key.includes(":subagent:"))
        return "subagent";
    if (key.includes(":cron:"))
        return "cron";
    if (key.includes(":isolated:"))
        return "isolated";
    return "main";
}
function isBootPrompt(prompt) {
    if (!prompt)
        return false;
    return /\bBOOT\.md\b/i.test(prompt) || /\bboot check\b/i.test(prompt) || /\bpost-restart\b/i.test(prompt);
}
function shouldSkipMemoryInjection(prompt, ctx) {
    const runKind = resolveHookRunKind(ctx);
    if (ctx?.isHeartbeat)
        return { skip: true, lane: "heartbeat" };
    if (runKind !== "main")
        return { skip: true, lane: runKind };
    if (isBootPrompt(prompt))
        return { skip: true, lane: "boot" };
    return { skip: false, lane: runKind };
}
// --- Conversational junk pre-filter ---
// Messages matching any of these patterns are dropped from the capture payload.
// They represent continuation prompts, retry messages, or engine noise — not
// real conversation worth storing in long-term memory.
const TRIVIAL_CAPTURE_PATTERNS = [
    /^continue$/i,
    /^continue where you left off/i,
    /^go on$/i,
    /^keep going$/i,
    /^go ahead$/i,
    /^please continue$/i,
    /^the previous model attempt failed/i,
    /^Continue where you left off\. The previous model/i,
    /^\[.*\]\s*continue$/i, // timestamped "continue" like "[Sun 2026-03-15 20:50 GMT+7] continue"
    /^\[.*\]\s*got it continue/i, // timestamped "got it continue"
];
// --- Cornerstone Formatting ---
function formatCornerstones(cornerstones) {
    if (!cornerstones.length)
        return "";
    const lines = ["[CORNERSTONES — WHO I AM]"];
    for (const cs of cornerstones) {
        lines.push(`${cs.label}: ${cs.content}`);
    }
    return lines.join("\n");
}
// --- Context Formatting ---
/**
 * Filter out echo memories: items from the current session or created too recently.
 * This prevents the recall loop where memories extracted from THIS conversation
 * get injected right back into the next turn.
 */
function filterEchoMemories(items, currentSessionId, recencyFilterMinutes) {
    if (!currentSessionId && recencyFilterMinutes <= 0)
        return items;
    const now = Date.now();
    const recencyCutoffMs = recencyFilterMinutes > 0 ? recencyFilterMinutes * 60 * 1000 : 0;
    return items.filter((item) => {
        // Filter 1: exact session match (primary — works for memories with source_session_id)
        if (currentSessionId && item.source_session_id && item.source_session_id === currentSessionId) {
            return false;
        }
        // Filter 2: recency fallback (catches memories without source_session_id, e.g. pre-fix)
        if (recencyCutoffMs > 0 && item.created_at) {
            const createdMs = new Date(item.created_at).getTime();
            if (!isNaN(createdMs) && (now - createdMs) < recencyCutoffMs) {
                return false;
            }
        }
        return true;
    });
}
function formatMemoryContext(items, maxChars, maxCount = 8, minScore = 0.25) {
    if (!items.length)
        return "";
    // Filter by relevance score and cap count
    const relevant = items
        .filter(item => (item.score ?? 1.0) >= minScore)
        .slice(0, maxCount);
    if (!relevant.length)
        return "";
    const lines = ["<relevant-memories>"];
    let charCount = 0;
    let injectedCount = 0;
    let capHit = false;
    for (const item of relevant) {
        const tag = item.source === "cornerstone" ? " [cornerstone]" : "";
        // Build metadata prefix: [id] [date] [salience/category]
        const id = item.item_id ? `[${item.item_id.slice(0, 8)}]` : "";
        const date = item.created_at ? `[${item.created_at.slice(0, 10)}]` : "";
        const salience = item.metadata?.salience ?? "";
        const category = item.metadata?.category ?? "";
        const meta = [salience, category].filter(Boolean).join("/");
        const metaTag = meta ? `[${meta}]` : "";
        const prefix = [id, date, metaTag].filter(Boolean).join(" ");
        const line = prefix
            ? `- ${prefix} ${item.content}${tag}`
            : `- ${item.content}${tag}`;
        if (charCount + line.length > maxChars) {
            capHit = true;
            break;
        }
        lines.push(line);
        charCount += line.length;
        injectedCount++;
    }
    if (lines.length === 1)
        return ""; // Only header, no items fit
    if (capHit) {
        api.logger.info(`[cortex] memories-injected=${injectedCount}/${relevant.length} chars=${charCount}/${maxChars}`);
        lines.push(`[${injectedCount} of ${relevant.length} memories shown — use cortex_search for more]`);
    }
    lines.push("</relevant-memories>");
    return lines.join("\n");
}
// --- Message extraction (with junk filter) ---
function extractMessages(rawMessages) {
    const result = [];
    for (const msg of rawMessages.slice(-10)) {
        if (!msg || typeof msg !== "object")
            continue;
        const m = msg;
        if (m.role !== "user" && m.role !== "assistant")
            continue;
        let text = "";
        if (typeof m.content === "string") {
            text = m.content;
        }
        else if (Array.isArray(m.content)) {
            for (const block of m.content) {
                if (block && typeof block === "object" && "text" in block) {
                    const t = block.text;
                    if (typeof t === "string")
                        text += (text ? "\n" : "") + t;
                }
            }
        }
        // Strip previously injected memory context
        text = text
            .replace(/<relevant-memories>[\s\S]*?<\/relevant-memories>\s*/g, "")
            .trim();
        if (!text)
            continue;
        const role = m.role;
        // --- Junk filter: drop noise before it reaches Cortex ---
        // Skip assistant messages that are just raw JSON dumps (recall dumps being re-captured)
        if (role === "assistant" && /^\s*\[?\s*\{"\s*role/.test(text))
            continue;
        // Skip user messages matching trivial/continuation patterns
        if (role === "user" && TRIVIAL_CAPTURE_PATTERNS.some((p) => p.test(text)))
            continue;
        result.push({ role, content: text });
    }
    return result;
}
// --- Plugin Definition ---
const cortexPlugin = {
    id: "cortex",
    name: "Memory (Cortex)",
    description: "Cortex memory engine — retrieval, storage, and lifecycle management",
    kind: "memory",
    configSchema: {
        parse: parseConfig,
        jsonSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
                cortexUrl: { type: "string" },
                apiKey: { type: "string" },
                ownerId: { type: "string" },
                autoRecall: { type: "boolean" },
                autoCapture: { type: "boolean" },
                shadowMode: { type: "boolean", description: "Shadow mode — capture runs extraction but skips storage (dry-run)" },
                retrievalBudget: { type: "number" },
                maxInjectionChars: { type: "number" },
                maxInjectedMemories: { type: "number", description: "Max memories to inject per turn (default: 8)" },
                minRelevanceScore: { type: "number", description: "Min score to inject a memory (default: 0.25)" },
                retrievalMode: { type: "string", enum: ["auto", "fast", "thorough"], description: "Retrieval mode for memory search (default: auto)" },
                recencyFilterMinutes: { type: "number", description: "Filter out memories created within this many minutes to suppress echo (default: 15, 0 to disable)" },
            },
            required: [],
        },
    },
    register(api) {
        const cfg = parseConfig(api.pluginConfig);
        if (cfg.apiKey && !cfg.apiKey.startsWith("${")) {
            api.logger.warn("cortex: API key appears to be hardcoded in config. Consider using environment variable: apiKey: '${CORTEX_API_KEY}'");
        }
        const client = new CortexClient(cfg.cortexUrl, cfg.apiKey, cfg.ownerId, (msg) => api.logger.warn(msg));
        // --- Local memory cache ---
        let memoryCache = null;
        let syncInterval = null;
        const CACHE_SYNC_INTERVAL_MS = 300000; // 5 minutes
        if (NodeDatabaseSync) {
            try {
                // Resolve cache path relative to this plugin file
                const pluginDir = typeof __dirname === "string" ? __dirname : (0, node_path_1.dirname)(__filename);
                const cachePath = (0, node_path_1.join)(pluginDir, "cache", `memories-${cfg.ownerId || "default"}.db`);
                memoryCache = new LocalMemoryCache(cachePath);
                api.logger.info(`cortex: local memory cache initialized at ${cachePath} (${memoryCache.getCount()} entries)`);
            }
            catch (err) {
                api.logger.warn(`cortex: failed to initialize local cache: ${String(err)} — falling back to API-only`);
                memoryCache = null;
            }
        }
        else {
            api.logger.info("cortex: node:sqlite not available — local cache disabled");
        }
        // Security: warn if API key is hardcoded in config instead of env var
        if (cfg.apiKey && !cfg.apiKey.startsWith("${")) {
            api.logger.warn("cortex: API key appears to be hardcoded in config. Consider using environment variable: apiKey: '${CORTEX_API_KEY}'");
        }
        api.logger.info(`cortex: registered (cortex=${cfg.cortexUrl}, owner=${cfg.ownerId}, recall=${cfg.autoRecall}, capture=${cfg.autoCapture}, shadow=${cfg.shadowMode})`);
        // -------------------------------------------------------------------------
        // Tools
        // -------------------------------------------------------------------------
        api.registerTool({
            name: "cortex_search",
            label: "Cortex Search",
            description: "Search long-term memories stored in Cortex. Use when you need context about past decisions, preferences, or previously discussed topics.",
            parameters: typebox_1.Type.Object({
                query: typebox_1.Type.String({ description: "Search query" }),
                limit: typebox_1.Type.Optional(typebox_1.Type.Number({ description: "Max results (default: 10)" })),
            }),
            async execute(_toolCallId, params) {
                const { query, limit } = params;
                try {
                    const result = await client.search(query, limit ?? 10);
                    if (!result || !result.items?.length) {
                        return { content: [{ type: "text", text: "No memories found." }] };
                    }
                    const text = result.items
                        .map((item, i) => {
                        const content = item.content ?? item.text ?? "";
                        const id = item.id ?? item.memory_id ?? "";
                        const score = typeof item.score === "number" ? ` (${(Number(item.score) * 100).toFixed(0)}%)` : "";
                        const date = item.created_at ? ` [${String(item.created_at).slice(0, 10)}]` : "";
                        const salience = item.metadata?.salience ?? "";
                        const category = item.metadata?.category ?? "";
                        const meta = [salience, category].filter(Boolean).join("/");
                        const metaTag = meta ? ` [${meta}]` : "";
                        return `${i + 1}. ${content}${score}${date}${metaTag} (id: ${id})`;
                    })
                        .join("\n");
                    return { content: [{ type: "text", text: `Found ${result.items.length} memories:\n\n${text}` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Search failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_search" });
        api.registerTool({
            name: "cortex_remember",
            label: "Cortex Remember",
            description: "Store an important fact or preference in long-term memory via Cortex.",
            parameters: typebox_1.Type.Object({
                content: typebox_1.Type.String({ description: "Information to remember" }),
            }),
            async execute(_toolCallId, params) {
                const { content } = params;
                try {
                    client.remember([{ role: "user", content }]);
                    const preview = content.length > 100 ? content.slice(0, 100) + "…" : content;
                    return { content: [{ type: "text", text: `Sent to Cortex: "${preview}"` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Remember failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_remember" });
        api.registerTool({
            name: "cortex_forget",
            label: "Cortex Forget",
            description: "Delete a specific memory by ID. Use cortex_search first to find the ID.",
            parameters: typebox_1.Type.Object({
                memory_id: typebox_1.Type.String({ description: "Memory ID to delete" }),
            }),
            async execute(_toolCallId, params) {
                const { memory_id } = params;
                try {
                    const result = await client.forget(memory_id);
                    if (!result) {
                        return { content: [{ type: "text", text: `Failed to delete memory ${memory_id}` }] };
                    }
                    // Mark deleted in local cache too
                    if (memoryCache) {
                        try {
                            memoryCache.markDeleted(memory_id);
                        }
                        catch { /* ignore cache errors */ }
                    }
                    return { content: [{ type: "text", text: `Memory ${memory_id} deleted.` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Forget failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_forget" });
        api.registerTool({
            name: "cortex_ask",
            label: "Cortex Ask",
            description: "Ask a question answered using the user's stored memories. Returns an LLM-synthesized answer grounded in memory.",
            parameters: typebox_1.Type.Object({
                question: typebox_1.Type.String({ description: "Natural-language question to answer from memory" }),
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
                limit: typebox_1.Type.Optional(typebox_1.Type.Number({ description: "Max retrieval steps (default: 5)" })),
            }),
            async execute(_toolCallId, params) {
                const { question, owner_id, limit } = params;
                try {
                    const result = await client.ask(question, owner_id, limit ?? 5);
                    if (!result || !result.ok) {
                        return { content: [{ type: "text", text: "No answer found — Cortex returned no result." }] };
                    }
                    let text = result.answer;
                    if (result.sources?.length) {
                        const srcLines = result.sources
                            .map((s, i) => `${i + 1}. ${s.content ?? s.item_id ?? s.id ?? ""} (id: ${s.item_id ?? s.id ?? ""})`)
                            .join("\n");
                        text += `\n\nSources:\n${srcLines}`;
                    }
                    return { content: [{ type: "text", text }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Ask failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_ask" });
        api.registerTool({
            name: "cortex_list_contradictions",
            label: "Cortex List Contradictions",
            description: "List detected contradictions between stored memories. Use for memory hygiene audits.",
            parameters: typebox_1.Type.Object({
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
            }),
            async execute(_toolCallId, params) {
                const { owner_id } = params;
                try {
                    const result = await client.listContradictions(owner_id);
                    if (!result) {
                        return { content: [{ type: "text", text: "Failed to fetch contradictions." }] };
                    }
                    const items = result.items ?? result;
                    if (!Array.isArray(items) || !items.length) {
                        return { content: [{ type: "text", text: "No contradictions found." }] };
                    }
                    const text = items
                        .map((c, i) => `${i + 1}. [${c.id}] ${c.description ?? c.summary ?? JSON.stringify(c)}`)
                        .join("\n");
                    return { content: [{ type: "text", text: `Found ${items.length} contradiction(s):\n\n${text}` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `List contradictions failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_list_contradictions" });
        api.registerTool({
            name: "cortex_resolve_contradiction",
            label: "Cortex Resolve Contradiction",
            description: "Resolve a flagged memory contradiction by ID. Use cortex_list_contradictions first to get the ID.",
            parameters: typebox_1.Type.Object({
                id: typebox_1.Type.String({ description: "Contradiction ID to resolve" }),
                resolution: typebox_1.Type.String({ description: "Resolution explanation (e.g. 'newer memory is correct')" }),
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
            }),
            async execute(_toolCallId, params) {
                const { id, resolution, owner_id } = params;
                try {
                    const result = await client.resolveContradiction(id, resolution, owner_id);
                    if (!result) {
                        return { content: [{ type: "text", text: `Failed to resolve contradiction ${id}.` }] };
                    }
                    return { content: [{ type: "text", text: `Contradiction ${id} resolved.` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Resolve contradiction failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_resolve_contradiction" });
        api.registerTool({
            name: "cortex_add_commitment",
            label: "Cortex Add Commitment",
            description: "Track a new commitment or promise in Cortex. Use for accountability and follow-up.",
            parameters: typebox_1.Type.Object({
                description: typebox_1.Type.String({ description: "What was committed to" }),
                due_at: typebox_1.Type.Optional(typebox_1.Type.String({ description: "ISO 8601 due date/time (e.g. 2026-03-14T00:00:00Z)" })),
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
            }),
            async execute(_toolCallId, params) {
                const { description, due_at, owner_id } = params;
                try {
                    const result = await client.addCommitment(description, due_at, owner_id);
                    if (!result) {
                        return { content: [{ type: "text", text: "Failed to create commitment." }] };
                    }
                    const id = result.id ?? "";
                    return { content: [{ type: "text", text: `Commitment created${id ? ` (id: ${id})` : ""}: "${description}"` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Add commitment failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_add_commitment" });
        api.registerTool({
            name: "cortex_update_commitment",
            label: "Cortex Update Commitment",
            description: "Update the status of an existing commitment (e.g. mark as completed or cancelled).",
            parameters: typebox_1.Type.Object({
                id: typebox_1.Type.String({ description: "Commitment ID to update" }),
                status: typebox_1.Type.String({ description: "New status: completed or cancelled" }),
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
            }),
            async execute(_toolCallId, params) {
                const { id, status, owner_id } = params;
                try {
                    const result = await client.updateCommitment(id, status, owner_id);
                    if (!result) {
                        return { content: [{ type: "text", text: `Failed to update commitment ${id}.` }] };
                    }
                    return { content: [{ type: "text", text: `Commitment ${id} updated to "${status}".` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Update commitment failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_update_commitment" });
        api.registerTool({
            name: "cortex_list_commitments",
            label: "Cortex List Commitments",
            description: "List active or all commitments tracked in Cortex.",
            parameters: typebox_1.Type.Object({
                status: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Filter by status: active, completed, cancelled" })),
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
            }),
            async execute(_toolCallId, params) {
                const { status, owner_id } = params;
                try {
                    const result = await client.listCommitments(owner_id, status);
                    if (!result) {
                        return { content: [{ type: "text", text: "Failed to fetch commitments." }] };
                    }
                    const items = result?.commitments ?? (Array.isArray(result) ? result : []);
                    if (!items.length) {
                        return { content: [{ type: "text", text: "No commitments found." }] };
                    }
                    const text = items
                        .map((c, i) => {
                        const due = c.due_at ? ` (due: ${c.due_at})` : "";
                        return `${i + 1}. [${c.id}] [${c.status}] ${c.content ?? c.description}${due}`;
                    })
                        .join("\n");
                    return { content: [{ type: "text", text: `Found ${items.length} commitment(s):\n\n${text}` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `List commitments failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_list_commitments" });
        api.registerTool({
            name: "cortex_add_open_loop",
            label: "Cortex Add Open Loop",
            description: "Create an open loop (unresolved thread) in Cortex. Use to track topics or threads left unfinished.",
            parameters: typebox_1.Type.Object({
                description: typebox_1.Type.String({ description: "Description of the unresolved thread or topic" }),
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
            }),
            async execute(_toolCallId, params) {
                const { description, owner_id } = params;
                try {
                    const result = await client.addOpenLoop(description, owner_id);
                    if (!result) {
                        return { content: [{ type: "text", text: "Failed to create open loop." }] };
                    }
                    const id = result.id ?? "";
                    return { content: [{ type: "text", text: `Open loop created${id ? ` (id: ${id})` : ""}: "${description}"` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Add open loop failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_add_open_loop" });
        api.registerTool({
            name: "cortex_resolve_open_loop",
            label: "Cortex Resolve Open Loop",
            description: "Mark an open loop as resolved.",
            parameters: typebox_1.Type.Object({
                id: typebox_1.Type.String({ description: "Open loop ID to resolve" }),
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
            }),
            async execute(_toolCallId, params) {
                const { id, owner_id } = params;
                try {
                    const result = await client.resolveOpenLoop(id, owner_id);
                    if (!result) {
                        return { content: [{ type: "text", text: `Failed to resolve open loop ${id}.` }] };
                    }
                    return { content: [{ type: "text", text: `Open loop ${id} resolved.` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `Resolve open loop failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_resolve_open_loop" });
        api.registerTool({
            name: "cortex_list_open_loops",
            label: "Cortex List Open Loops",
            description: "List open (unresolved) threads tracked in Cortex.",
            parameters: typebox_1.Type.Object({
                status: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Filter by status: open, resolved" })),
                owner_id: typebox_1.Type.Optional(typebox_1.Type.String({ description: "Memory owner namespace (defaults to configured owner)" })),
            }),
            async execute(_toolCallId, params) {
                const { status, owner_id } = params;
                try {
                    const result = await client.listOpenLoops(owner_id, status);
                    if (!result) {
                        return { content: [{ type: "text", text: "Failed to fetch open loops." }] };
                    }
                    const items = result?.open_loops ?? (Array.isArray(result) ? result : []);
                    if (!items.length) {
                        return { content: [{ type: "text", text: "No open loops found." }] };
                    }
                    const text = items
                        .map((l, i) => `${i + 1}. [${l.id}] [${l.status}] ${l.content ?? l.description}`)
                        .join("\n");
                    return { content: [{ type: "text", text: `Found ${items.length} open loop(s):\n\n${text}` }] };
                }
                catch (err) {
                    return { content: [{ type: "text", text: `List open loops failed: ${String(err)}` }] };
                }
            },
        }, { name: "cortex_list_open_loops" });
        // -------------------------------------------------------------------------
        // Hooks
        // -------------------------------------------------------------------------
        // Auto-recall: inject cornerstones (always) + relevant memories (when relevant)
        // Lane guards prevent injection on heartbeat, boot, subagent, cron, isolated lanes.
        // Server-first: always call Cortex API (semantic embeddings). Local cache is fallback only.
        api.on("before_agent_start", async (event, ctx) => {
            const startMs = Date.now();
            const blocks = [];
            const laneDecision = shouldSkipMemoryInjection(event.prompt, ctx);
            if (laneDecision.skip) {
                api.logger.info(`cortex: skipping recall injection for lane=${laneDecision.lane}`);
                return;
            }
            // --- Fetch contextual memories (+ optional cornerstones) ---
            if (cfg.autoRecall) {
                const doRetrieve = event.prompt && isMemoryRelevant(event.prompt);
                const doCornerstones = cfg.injectCornerstones; // default false — cornerstones in SOUL.md
                // --- Memory retrieval (server-first, local fallback) ---
                let memoryItems = [];
                // usedCache removed — server-first architecture, local cache is fallback only
                let tokensUsed = 0;
                // Server-first architecture: Cortex API has semantic embeddings (Voyage-4-large),
                // local cache is keyword-only fallback for when server is slow/down.
                // Previous design tried cache-first with ≥3 threshold, which effectively
                // bypassed semantic search on every query. Fixed 2026-03-23.
                // If no cache or cache miss: fall back to API retrieval (original path)
                if (doRetrieve) {
                    // Fire cornerstones + API retrieve in parallel
                    const [cornerstonesResult, retrieveResult] = await Promise.allSettled([
                        doCornerstones ? client.getCornerstones() : Promise.resolve(null),
                        client.retrieve(event.prompt, cfg.retrievalBudget, cfg.retrievalMode),
                    ]);
                    // Process cornerstones
                    if (doCornerstones && cornerstonesResult.status === "fulfilled" && cornerstonesResult.value?.length) {
                        const csBlock = formatCornerstones(cornerstonesResult.value);
                        if (csBlock) {
                            blocks.push(csBlock);
                            api.logger.info(`cortex: loaded ${cornerstonesResult.value.length} cornerstones`);
                        }
                    }
                    else if (doCornerstones && cornerstonesResult.status === "rejected") {
                        api.logger.warn(`cortex: cornerstone fetch failed: ${String(cornerstonesResult.reason)}`);
                    }
                    // Process API results
                    if (retrieveResult.status === "fulfilled" && retrieveResult.value?.items?.length) {
                        const result = retrieveResult.value;
                        memoryItems = result.items;
                        tokensUsed = result.tokens_used ?? 0;
                        // Cache the API results for next time
                        if (memoryCache) {
                            try {
                                memoryCache.upsertBatch(result.items);
                            }
                            catch { /* ignore */ }
                        }
                    }
                    else if (retrieveResult.status === "rejected") {
                        api.logger.warn(`cortex: recall failed (${Date.now() - startMs}ms): ${String(retrieveResult.reason)}`);
                        // Server down — fall back to local cache if available
                        if (memoryCache) {
                            try {
                                const fallbackResults = memoryCache.search(event.prompt, 20);
                                if (fallbackResults.length) {
                                    memoryItems = fallbackResults;
                                    api.logger.info(`cortex: using local cache fallback (${fallbackResults.length} results)`);
                                }
                            }
                            catch { /* ignore fallback errors */ }
                        }
                    }
                }
                else if (!doRetrieve && doCornerstones) {
                    // No retrieval needed but cornerstones requested
                    const cornerstonesResult = await client.getCornerstones().catch(() => null);
                    if (cornerstonesResult?.length) {
                        const csBlock = formatCornerstones(cornerstonesResult);
                        if (csBlock) {
                            blocks.push(csBlock);
                            api.logger.info(`cortex: loaded ${cornerstonesResult.length} cornerstones`);
                        }
                    }
                }
                // Format and inject memories
                if (memoryItems.length) {
                    const filtered = filterEchoMemories(memoryItems, ctx.sessionKey, cfg.recencyFilterMinutes);
                    if (filtered.length < memoryItems.length) {
                        api.logger.info(`cortex: echo filter removed ${memoryItems.length - filtered.length} same-session/recent memories`);
                    }
                    const context = formatMemoryContext(filtered, cfg.maxInjectionChars, cfg.maxInjectedMemories, cfg.minRelevanceScore);
                    if (context) {
                        const elapsed = Date.now() - startMs;
                        if (elapsed <= 3000) {
                            blocks.push(context);
                            const source = "API";
                            api.logger.info(`cortex: injecting ${filtered.length} memories from ${source} (${tokensUsed} tokens, ${elapsed}ms)`);
                        }
                        else {
                            api.logger.warn(`cortex: retrieval took ${elapsed}ms, skipping memory injection (cornerstones still injected)`);
                        }
                    }
                }
            }
            if (blocks.length) {
                return { prependContext: blocks.join("\n\n") };
            }
        });
        // Auto-capture: store conversation after agent ends (fire and forget)
        // Applies junk pre-filter and lane guards before calling remember().
        if (cfg.autoCapture) {
            api.on("agent_end", (event, ctx) => {
                if (!event.success || !event.messages?.length)
                    return;
                // Skip noisy sessions (subagents, crons, isolated, heartbeats, boot checks)
                const key = ctx.sessionKey ?? "";
                if (key.includes(":subagent:") || key.includes(":cron:") || key.includes(":isolated:"))
                    return;
                const hookCtx = ctx;
                if (hookCtx.isHeartbeat)
                    return;
                const messages = extractMessages(event.messages);
                // Require at least 2 real messages — single-message captures are noise
                if (messages.length < 2)
                    return;
                const joined = messages.map((m) => m.content).join("\n");
                if (isBootPrompt(joined) || /HEARTBEAT_OK/i.test(joined) || /Read HEARTBEAT\.md if it exists/i.test(joined))
                    return;
                // Skip system events (sub-agent completions, exec notifications) — not worth extracting
                if (SYSTEM_EVENT_PATTERNS.test(joined))
                    return;
                // Fire and forget — no await, no blocking
                const capturePromise = client.remember(messages, ctx.sessionKey, cfg.shadowMode);
                if (capturePromise && typeof capturePromise.catch === "function") {
                    capturePromise.catch((err) => {
                        api.logger.warn(`cortex: capture failed: ${String(err)}`);
                    });
                }
                if (cfg.shadowMode) {
                    api.logger.info(`cortex: [shadow] captured ${messages.length} messages (session=${ctx.sessionKey})`);
                }
            });
        }
        // Session lifecycle (non-blocking)
        api.on("session_start", (event) => {
            client.wake(event.sessionId);
        });
        api.on("session_end", (event) => {
            client.sleep(event.sessionId);
        });
        // -------------------------------------------------------------------------
        // Service
        // -------------------------------------------------------------------------
        api.registerService({
            id: "cortex",
            async start() {
                const healthy = await client.health();
                if (healthy) {
                    api.logger.info(`cortex: Cortex is reachable at ${cfg.cortexUrl}`);
                }
                else {
                    api.logger.warn(`cortex: Cortex unreachable at ${cfg.cortexUrl} — will retry on first use`);
                }
                // Start background cache sync
                if (memoryCache && healthy) {
                    // Initial sync (non-blocking)
                    syncMemoryCache(client, memoryCache, api.logger).catch(() => { });
                    // Periodic sync every 5 minutes
                    syncInterval = setInterval(() => {
                        if (memoryCache) {
                            syncMemoryCache(client, memoryCache, api.logger).catch(() => { });
                        }
                    }, CACHE_SYNC_INTERVAL_MS);
                }
            },
            stop() {
                // Clean up sync interval and close cache
                if (syncInterval) {
                    clearInterval(syncInterval);
                    syncInterval = null;
                }
                if (memoryCache) {
                    memoryCache.close();
                    memoryCache = null;
                }
                api.logger.info("cortex: stopped");
            },
        });
        // -------------------------------------------------------------------------
        // CLI
        // -------------------------------------------------------------------------
        api.registerCli(({ program }) => {
            const cortex = program.command("cortex").description("Cortex memory commands");
            cortex
                .command("health")
                .description("Check Cortex connectivity")
                .action(async () => {
                const ok = await client.health();
                console.log(ok ? "✅ Cortex is healthy" : "❌ Cortex is unreachable");
                process.exitCode = ok ? 0 : 1;
            });
            cortex
                .command("search")
                .description("Search memories")
                .argument("<query>", "Search query")
                .option("--limit <n>", "Max results", "10")
                .action(async (query, opts) => {
                const result = await client.search(query, parseInt(opts.limit, 10));
                if (!result?.items?.length) {
                    console.log("No memories found.");
                    return;
                }
                console.log(JSON.stringify(result.items, null, 2));
            });
        }, { commands: ["cortex"] });
    },
};
exports.default = cortexPlugin;
//# sourceMappingURL=index.js.map