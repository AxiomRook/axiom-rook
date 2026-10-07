import { ChatGPTError, providerError } from './chatgpt-errors.js';
import { fetchSafe, readJson, requestJson, RESOURCE } from './chatgpt-auth.js';
import { buildExternalContext } from './context.js';
import { activeRegistration } from './chatgpt-store.js';

const slugPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
export const MANUAL_TEST_PROMPT = 'This is a manually initiated Axiom Rook connection test using synthetic input. Say exactly: Axiom Rook connection test completed.';

export function filterModels(body) {
  if (!Array.isArray(body?.models)) throw new ChatGPTError('provider_error');
  return body.models.filter(model => model.visibility === 'list').map(model => {
    if (!slugPattern.test(model.slug) || typeof model.display_name !== 'string' || !model.display_name.trim()
      || model.display_name.length > 200 || /[\x00-\x1f\x7f]/.test(model.display_name)) throw new ChatGPTError('provider_error');
    return { slug: model.slug, display_name: model.display_name };
  });
}

export function manualResponseBody(model, records = []) {
  if (!slugPattern.test(model)) throw new ChatGPTError('model_required');
  let approved;
  try { approved = buildExternalContext(records); } catch { throw new ChatGPTError('invalid_input'); }
  const context = JSON.stringify(approved);
  if (context.length > 100000) throw new ChatGPTError('invalid_input');
  const input = [];
  if (approved.length) input.push({ role: 'developer', content: `Operator-approved Axiom Rook continuity records, including explicit history where provided:\n${context}` });
  input.push({ role: 'user', content: MANUAL_TEST_PROMPT });
  // Construct the supported body from scratch: callers cannot spread preview-incompatible parameters into it.
  return { model, input, store: false, stream: true };
}

function failureFromEvent(event) {
  const error = providerError(event.response ?? { error: event.error ?? event }, undefined, undefined);
  return error.code === 'provider_error' ? new ChatGPTError('stream_failed') : error;
}

export async function consumeResponseStream(response) {
  if (!response.ok) {
    let body;
    try { body = await readJson(response); } catch { throw new ChatGPTError('provider_error', { status: response.status }); }
    throw providerError(body, response.status, response.headers.get('openai-request-id') ?? response.headers.get('x-request-id'));
  }
  if (!response.body || !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) throw new ChatGPTError('invalid_stream');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', output = '', size = 0;
  const handle = block => {
    const lines = block.split(/\r\n|\n|\r/);
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
    if (!data || data === '[DONE]') return null;
    let event;
    try { event = JSON.parse(data); } catch { throw new ChatGPTError('invalid_stream'); }
    if (!event || typeof event.type !== 'string') throw new ChatGPTError('invalid_stream');
    if (event.type === 'response.output_text.delta') {
      if (typeof event.delta !== 'string') throw new ChatGPTError('invalid_stream');
      output += event.delta; if (output.length > 1000000) throw new ChatGPTError('invalid_stream');
    } else if (event.type === 'response.failed' || event.type === 'error') throw failureFromEvent(event);
    else if (event.type === 'response.incomplete') throw new ChatGPTError('stream_incomplete');
    else if (event.type === 'response.completed') {
      if (event.response?.status !== 'completed') throw new ChatGPTError('invalid_stream');
      if (event.response.output !== undefined && (!Array.isArray(event.response.output) || event.response.output.some(item => !item || (item.type === 'message' && (!Array.isArray(item.content)
        || item.content.some(part => !part || (part.type === 'output_text' && typeof part.text !== 'string'))))))) throw new ChatGPTError('invalid_stream');
      const finalText = event.response.output?.flatMap(item => item.type === 'message' && Array.isArray(item.content)
        ? item.content.filter(part => part.type === 'output_text').map(part => part.text) : []).join('');
      const text = finalText || output;
      if (text.length > 1000000) throw new ChatGPTError('invalid_stream');
      return { completed: true, text };
    }
    return null;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4 * 1024 * 1024) throw new ChatGPTError('invalid_stream');
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1024 * 1024) throw new ChatGPTError('invalid_stream');
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const result = handle(block); if (result) return result;
      }
    }
    // A terminal event without its final blank line is still a complete SSE message at EOF.
    buffer += decoder.decode();
    if (buffer.trim()) { const result = handle(buffer); if (result) return result; }
    throw new ChatGPTError('stream_interrupted');
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError('stream_interrupted');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export class ChatGPTClient {
  constructor(auth) { this.auth = auth; this.store = auth.store; this.fetch = auth.fetch; }
  async catalog(registration) {
    const body = await requestJson(this.fetch, `${RESOURCE}/models`, { headers: { Authorization: `Bearer ${registration.tokens.access_token}` } });
    return filterModels(body);
  }
  async models() {
    return this.store.withLock(async state => this.catalog(await this.auth.ensureAccess(state)));
  }
  async selectModel(slug) {
    if (!slugPattern.test(slug)) throw new ChatGPTError('model_required');
    return this.store.withLock(async state => {
      const registration = await this.auth.ensureAccess(state), models = await this.catalog(registration);
      if (!models.some(model => model.slug === slug)) throw new ChatGPTError('model_unavailable');
      registration.selected_model = slug; await this.store.write(state); return { selectedModel: slug };
    });
  }
  async test({ manual = false, records = [] } = {}) {
    if (manual !== true) throw new ChatGPTError('manual_only');
    // Validate consent filtering before a catalog request or any inference request.
    const initialBody = manualResponseBody('validation-only', records);
    return this.store.withLock(async state => {
      if (!activeRegistration(state).selected_model) throw new ChatGPTError('model_required');
      const registration = await this.auth.ensureAccess(state), models = await this.catalog(registration);
      if (!models.some(model => model.slug === registration.selected_model)) throw new ChatGPTError('model_unavailable');
      const body = { ...initialBody, model: registration.selected_model };
      const response = await fetchSafe(this.fetch, `${RESOURCE}/responses`, {
        method: 'POST', headers: { Authorization: `Bearer ${registration.tokens.access_token}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(180000)
      });
      const result = await consumeResponseStream(response);
      return { model: registration.selected_model, ...result };
    });
  }
}
