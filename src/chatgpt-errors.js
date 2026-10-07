const messages = {
  invalid_config: 'Invalid local ChatGPT configuration.',
  unsafe_storage: 'ChatGPT credentials require a private local directory outside the repository.',
  storage_busy: 'The local ChatGPT session is in use. Try again after the other command finishes.',
  storage_failure: 'The private ChatGPT store could not be read or updated.',
  login_required: 'Sign in again with chatgpt-login for the selected account.',
  invalid_state: 'The sign-in callback could not be verified. Start a fresh login.',
  invalid_callback: 'The sign-in callback is invalid. Start a fresh login.',
  registration_incomplete: 'Registration did not return a real client ID. Start a fresh login.',
  consent_denied: 'ChatGPT authorization was declined. No code was exchanged.',
  login_timeout: 'The sign-in attempt expired. Start a fresh login.',
  browser_unavailable: 'The system browser could not be opened. Retry on your local computer.',
  invalid_identity: 'The OpenAI ID token failed identity verification. No account was activated.',
  account_mismatch: 'The verified account does not match the selected registration.',
  invalid_tokens: 'OpenAI returned an invalid token response. No credentials were activated.',
  plan_disabled: 'ChatGPT plan use was not granted. Run chatgpt-login --enable-plan to request it.',
  refresh_not_ready: 'OpenAI has not yet allowed token refresh. Retry later without changing accounts.',
  model_required: 'Choose an account-listed model: chatgpt-models, then chatgpt-model <slug>.',
  model_unavailable: 'The selected model is unavailable for this account. Choose explicitly from chatgpt-models.',
  invalid_input: 'The manual input or approved context records are invalid.',
  manual_only: 'Only an explicitly requested local CLI test may invoke ChatGPT plan inference.',
  stream_failed: 'The response failed. No partial output was accepted as a completed answer.',
  stream_incomplete: 'The response was incomplete. No partial output was accepted as a completed answer.',
  stream_interrupted: 'The response stream ended without response.completed. The request was not retried.',
  invalid_stream: 'The Responses stream was malformed or exceeded the local size limit.',
  network_error: 'An OpenAI network request failed. Credentials were retained; retry manually later.',
  provider_error: 'OpenAI rejected the request. No billing fallback or automatic inference retry was attempted.',
  invalid_grant: 'The grant is unusable. Start a fresh login with the saved registration.',
  invalid_client: 'The issued OAuth client configuration was rejected.',
  invalid_refresh_token: 'The refresh token is unusable. Sign in again.',
  token_expired: 'The renewable session expired. Sign in again.',
  refresh_token_expired: 'The refresh token expired. Sign in again.',
  refresh_token_invalidated: 'The refresh token was invalidated. Sign in again.',
  refresh_token_reused: 'A rotating refresh token was reused. Sign in again.',
  subscription_sharing_user_not_eligible: 'This account, workspace or policy does not allow ChatGPT plan sharing.',
  subscription_sharing_usage_limit_exceeded: 'ChatGPT app usage is limited. Review https://chatgpt.com/#settings/Usage and retry manually when available.',
  subscription_sharing_usage_unavailable: 'ChatGPT usage availability could not be checked. Credentials were retained; retry later.',
  subscription_sharing_unsupported_capability: 'A requested capability is unsupported by ChatGPT plan sharing. Correct the request before retrying.',
  subscription_sharing_route_not_supported: 'The request route is unsupported by ChatGPT plan sharing.',
  subscription_sharing_invalid_user: 'OpenAI could not validate the subscriber context. Check the selected registration.',
  chatpass_v2_scope_not_authorized: 'The granted plan permission does not authorize this operation.',
  chatpass_v2_invalid_authorization_context: 'The authorization context does not permit this operation.',
  subscription_sharing_user_unavailable: 'Account or workspace information is temporarily unavailable. Credentials were retained; retry later.'
};

export class ChatGPTError extends Error {
  constructor(code, { status, requestId, param, bodyShape, providerCode } = {}) {
    const known = Object.hasOwn(messages, code) ? code : 'provider_error';
    super(messages[known]);
    this.name = 'ChatGPTError'; this.code = known;
    // Retain a machine-readable unknown provider code for private diagnosis; safe CLI output uses only known categories.
    this.providerCode = typeof providerCode === 'string' && /^[a-z][a-z0-9_]{0,100}$/.test(providerCode) ? providerCode : undefined;
    this.status = Number.isInteger(status) ? status : undefined;
    this.requestId = typeof requestId === 'string' && /^(?:req_[A-Za-z0-9_-]{1,100}|[a-f0-9-]{36})$/.test(requestId) ? requestId : undefined;
    this.param = typeof param === 'string' && /^(?:model|input|tools|service_tier|background|conversation|previous_response_id|temperature|top_p|max_output_tokens|metadata)(?:\.[a-z_]+|\[\d+\])*$/.test(param) ? param : undefined;
    this.bodyShape = ['error', 'detail', 'unknown'].includes(bodyShape) ? bodyShape : undefined;
  }
}

export const terminalRefreshCodes = new Set(['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']);

export function providerError(body, status, requestId) {
  const code = body?.error?.code ?? (typeof body?.error === 'string' ? body.error : undefined);
  return new ChatGPTError(code, { status, requestId, providerCode: code, param: body?.error?.param, bodyShape: body?.error ? 'error' : Object.hasOwn(body ?? {}, 'detail') ? 'detail' : 'unknown' });
}

export function formatSafeError(error) {
  if (!(error instanceof ChatGPTError)) return 'ChatGPT command failed. Private diagnostic details were not printed.';
  const details = [error.status && `HTTP ${error.status}`, error.param && `parameter ${error.param}`, error.requestId && `request ${error.requestId}`].filter(Boolean);
  return `${error.code}: ${error.message}${details.length ? ` (${details.join('; ')})` : ''}`;
}

export function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /token|authorization|cookie|secret|verifier|challenge|nonce|state|code|email|subject|\bsub\b|client.?id|host.?id|profile|url/i.test(key) ? '[REDACTED]' : redactSensitive(item)]));
  if (typeof value === 'string') return value.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
    .replace(/https?:\/\/\S*(?:id_token_hint|access_token|refresh_token|code_verifier|state)=\S*/gi, '[REDACTED URL]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED]');
  return value;
}
