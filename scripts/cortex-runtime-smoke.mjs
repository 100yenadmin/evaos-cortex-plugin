#!/usr/bin/env node

const cortexUrl = (process.env.CORTEX_URL || "http://localhost:8000").replace(/\/+$/, "");
const apiKey = process.env.CORTEX_API_KEY || "";
const ownerId = process.env.CORTEX_OWNER_ID || "";
const requireData = process.env.CORTEX_RUNTIME_SMOKE_REQUIRE_DATA === "1";
const smokeQuery = process.env.CORTEX_RUNTIME_SMOKE_QUERY || "cortex";
const explicitEntityId = process.env.CORTEX_SMOKE_ENTITY_ID || "";
const companyBrainAccountId = process.env.COMPANY_BRAIN_ACCOUNT_ID || "";
const companyBrainAccountKey = process.env.COMPANY_BRAIN_ACCOUNT_KEY || "";
const companyBrainSourceScope = process.env.COMPANY_BRAIN_SOURCE_SCOPE || "";
const defaultRequestTimeoutMs = Number(process.env.CORTEX_RUNTIME_SMOKE_TIMEOUT_MS || "15000");

function headers() {
  const result = { "Content-Type": "application/json" };
  if (apiKey) result["X-API-Key"] = apiKey;
  return result;
}

function withOwner(params) {
  if (ownerId) params.set("owner_id", ownerId);
  return params;
}

async function request(stage, path, options = {}) {
  const { timeoutMs = defaultRequestTimeoutMs, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${cortexUrl}${path}`, {
      ...fetchOptions,
      headers: { ...headers(), ...(fetchOptions.headers || {}) },
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${stage} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${stage} HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return { status: response.status, body };
}

function listFrom(body, keys) {
  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  if (Array.isArray(body)) return body;
  return [];
}

function firstId(items) {
  const item = items.find((candidate) => candidate && typeof candidate === "object");
  return item?.id || item?.entity_id || item?.canonical_id || "";
}

function pushStage(stages, stage, details = {}) {
  stages.push({ stage, status: "passed", ...details });
}

async function runCoreStages(stages) {
  const search = await request("memory_search", "/api/v1/memories/search", {
    method: "POST",
    body: JSON.stringify({
      ...(ownerId ? { owner_id: ownerId } : {}),
      query: smokeQuery,
      limit: 3,
    }),
  });
  const searchItems = listFrom(search.body, ["items", "results", "memories"]);
  if (requireData && searchItems.length === 0) throw new Error("memory_search returned no data");
  pushStage(stages, "memory_search", { items: searchItems.length });

  const entityParams = withOwner(new URLSearchParams({ per_page: "5" }));
  const entities = await request("entities_list", `/api/v1/entities?${entityParams}`);
  const entityItems = listFrom(entities.body, ["entities", "items"]);
  if (requireData && entityItems.length === 0) throw new Error("entities_list returned no data");
  pushStage(stages, "entities_list", { items: entityItems.length });

  const entityId = explicitEntityId || firstId(entityItems);
  if (entityId) {
    const detailParams = withOwner(new URLSearchParams());
    const suffix = detailParams.toString() ? `?${detailParams}` : "";
    await request("entity_detail", `/api/v1/entities/${encodeURIComponent(entityId)}${suffix}`);
    pushStage(stages, "entity_detail", { entity_id: entityId });
  } else {
    pushStage(stages, "entity_detail", { skipped: "no entity id available" });
  }

  const graphParams = withOwner(new URLSearchParams({ max_nodes: "25" }));
  const graph = await request("graph_query", `/api/v1/graph?${graphParams}`);
  const nodes = listFrom(graph.body, ["nodes"]);
  if (requireData && nodes.length === 0) throw new Error("graph_query returned no nodes");
  pushStage(stages, "graph_query", { nodes: nodes.length });
}

async function runCompanyBrainStages(stages) {
  const params = withOwner(new URLSearchParams({ limit: "5", offset: "0" }));
  if (companyBrainAccountKey) params.set("account_key", companyBrainAccountKey);
  if (companyBrainSourceScope) params.set("source_scope", companyBrainSourceScope);
  const accounts = await request("company_brain_accounts_list", `/api/v1/company-brain/accounts?${params}`);
  const accountItems = listFrom(accounts.body, ["accounts", "items"]);
  if (requireData && accountItems.length === 0) throw new Error("company_brain_accounts_list returned no accounts");
  pushStage(stages, "company_brain_accounts_list", {
    total: accounts.body?.total ?? accountItems.length,
    source_scope: companyBrainSourceScope || undefined,
  });

  const resolvedAccountId = companyBrainAccountId || firstId(accountItems);
  if (!resolvedAccountId) {
    pushStage(stages, "company_brain_account_detail", { skipped: "no account id available" });
    return;
  }

  const briefParams = withOwner(new URLSearchParams({ facts_limit: "5", facts_offset: "0" }));
  await request("company_brain_account_brief", `/api/v1/company-brain/accounts/${encodeURIComponent(resolvedAccountId)}/brief?${briefParams}`);
  pushStage(stages, "company_brain_account_brief", { account_id: resolvedAccountId });

  const timelineParams = withOwner(new URLSearchParams({ limit: "5", offset: "0" }));
  await request("company_brain_account_timeline", `/api/v1/company-brain/accounts/${encodeURIComponent(resolvedAccountId)}/timeline?${timelineParams}`);
  pushStage(stages, "company_brain_account_timeline", { account_id: resolvedAccountId });

  await request("company_brain_query", "/api/v1/company-brain/query", {
    method: "POST",
    body: JSON.stringify({
      ...(ownerId ? { owner_id: ownerId } : {}),
      account_id: resolvedAccountId,
      intent: "follow_ups",
      question: "Who needs follow-up?",
      limit: 3,
    }),
  });
  pushStage(stages, "company_brain_query", { account_id: resolvedAccountId });
}

async function main() {
  const stages = [];
  await runCoreStages(stages);
  await runCompanyBrainStages(stages);
  console.log(JSON.stringify({
    ok: true,
    cortex_url: cortexUrl,
    owner_configured: Boolean(ownerId),
    require_data: requireData,
    stages,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message || error) }, null, 2));
  process.exitCode = 1;
});
