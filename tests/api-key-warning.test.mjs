import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

async function loadPlugin() {
  const url = pathToFileURL(new URL('../dist/index.js', import.meta.url).pathname);
  url.searchParams.set('t', `${Date.now()}-${Math.random()}`);
  const mod = await import(url.href);
  return mod.default?.default ?? mod.default ?? mod;
}

function makeApi(pluginConfig, logger) {
  const base = { pluginConfig, logger };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => {};
    },
  });
}

test('does not warn when apiKey is provided via ${ENV_VAR} interpolation', async () => {
  process.env.CORTEX_API_KEY = 'secret-from-env';
  const warnings = [];
  const plugin = await loadPlugin();
  plugin.register(makeApi(
    { apiKey: '${CORTEX_API_KEY}', cortexUrl: 'http://localhost:8000' },
    { warn: (msg) => warnings.push(msg), info() {} },
  ));

  assert.equal(warnings.some((msg) => msg.includes('hardcoded in config')), false);
});

test('warns when apiKey is hardcoded directly in plugin config', async () => {
  const warnings = [];
  const plugin = await loadPlugin();
  plugin.register(makeApi(
    { apiKey: 'plain-secret', cortexUrl: 'http://localhost:8000' },
    { warn: (msg) => warnings.push(msg), info() {} },
  ));

  assert.equal(warnings.some((msg) => msg.includes('hardcoded in config')), true);
});
