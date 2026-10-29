/**
 * Provider-agnostic LLM client with tool calling.
 *
 * LLM_PROVIDER = gemini | openai | groq | ollama | anthropic | sap-ai-core | none
 * LLM_MODEL    = optional model override
 *
 * Everything that speaks the OpenAI Chat Completions dialect (OpenAI, Gemini's
 * OpenAI-compatible endpoint, Groq, Ollama, SAP AI Core orchestration proxies)
 * goes through one code path; Anthropic has its own adapter.
 *
 * Neutral message format used by the rest of the app:
 *   { role: 'user' | 'assistant' | 'tool', content, toolCalls?: [{id,name,args}], toolCallId? }
 */
'use strict';
const cds = require('@sap/cds');
const LOG = cds.log('llm');

const PROVIDERS = {
  gemini:      { base: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY', model: 'gemini-2.5-flash' },
  openai:      { base: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', model: 'gpt-4o-mini' },
  groq:        { base: 'https://api.groq.com/openai/v1', keyEnv: 'GROQ_API_KEY', model: 'llama-3.3-70b-versatile' },
  ollama:      { base: (process.env.OLLAMA_URL || 'http://localhost:11434') + '/v1', keyEnv: null, model: 'llama3.1' },
  'sap-ai-core': { base: process.env.AICORE_OPENAI_URL, keyEnv: 'AICORE_TOKEN', model: 'gpt-4o' },
  anthropic:   { base: 'https://api.anthropic.com/v1', keyEnv: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-5' }
};

function resolveProvider() {
  let name = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (!name) name = Object.keys(PROVIDERS).find((p) => PROVIDERS[p].keyEnv && process.env[PROVIDERS[p].keyEnv]) || 'none';
  if (name === 'none' || !PROVIDERS[name]) return null;
  const p = PROVIDERS[name];
  const key = p.keyEnv ? process.env[p.keyEnv] : 'ollama';
  if (!key || !p.base) return null;
  return { name, base: p.base, key, model: process.env.LLM_MODEL || p.model };
}

const provider = resolveProvider();

function info() {
  return provider ? { provider: provider.name, model: provider.model, enabled: true } : { provider: 'offline', model: 'deterministic rules', enabled: false };
}

// ------------------------------------------------------------- OpenAI dialect
function toOpenAI(system, messages) {
  const out = system ? [{ role: 'system', content: system }] : [];
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({ role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args || {}) } })) });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function chatOpenAI({ system, messages, tools, json, temperature = 0.1, maxTokens = 1500 }) {
  const body = { model: provider.model, messages: toOpenAI(system, messages), temperature, max_tokens: maxTokens };
  if (tools?.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  if (json) body.response_format = { type: 'json_object' };
  const res = await fetch(`${provider.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${provider.key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`${provider.name} ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message || {};
  return {
    text: msg.content || '',
    toolCalls: (msg.tool_calls || []).map((t) => ({ id: t.id, name: t.function.name, args: safeJSON(t.function.arguments) || {} })),
    usage: data.usage
  };
}

// ------------------------------------------------------------- Anthropic
function toAnthropic(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({ role: 'assistant', content: [...(m.content ? [{ type: 'text', text: m.content }] : []), ...m.toolCalls.map((t) => ({ type: 'tool_use', id: t.id, name: t.name, input: t.args || {} }))] });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function chatAnthropic({ system, messages, tools, json, temperature = 0.1, maxTokens = 1500 }) {
  const body = {
    model: provider.model,
    max_tokens: maxTokens,
    temperature,
    system: json ? `${system || ''}\nRespond with a single valid JSON object only.` : system,
    messages: toAnthropic(messages)
  };
  if (tools?.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const res = await fetch(`${provider.base}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': provider.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000)
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return {
    text: data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n'),
    toolCalls: data.content.filter((c) => c.type === 'tool_use').map((c) => ({ id: c.id, name: c.name, args: c.input })),
    usage: data.usage
  };
}

async function chat(opts) {
  if (!provider) throw new Error('No LLM provider configured');
  const t0 = Date.now();
  const r = provider.name === 'anthropic' ? await chatAnthropic(opts) : await chatOpenAI(opts);
  LOG.debug(`${provider.name}/${provider.model} ${Date.now() - t0} ms`, r.usage || '');
  return r;
}

function safeJSON(s) {
  if (!s) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { /* fallthrough */ }
  const m = /\{[\s\S]*\}/.exec(s);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return null;
}

module.exports = { chat, info, enabled: () => !!provider, safeJSON };
