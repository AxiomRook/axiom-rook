# ChatGPT plan sharing (local SIWC)

Reviewed against official OpenAI documentation on 2026-10-07.

Axiom Rook implements Sign in with ChatGPT for an open-source local app. Eligible requests use the connected user's ChatGPT plan without an OpenAI API key, partner API key or client secret. Support in the code has been tested with mocks only. No real sign-in, account eligibility, model list or live inference has been verified.

## Privacy notice and control

Run this integration on your own local computer. It requests identity scopes and optional plan-use permission. A verified subject and issued client registration are retained to keep account mappings separate. Email/profile fields are not separately saved or displayed; the retained ID token can contain identity claims. Access, refresh and ID tokens stay in a protected local file under your control. They are sent only to the appropriate OpenAI authentication or inference endpoint. No passwords, browser cookies, ChatGPT conversations or automatic personalization are collected.

Manual inference sends a fixed synthetic test prompt and, only if you explicitly specify a context vault, the records accepted by the existing consent filter. OpenAI processes that input for inference; `store: false` disables Responses storage but is not a claim of zero provider processing or universal zero retention. The code does not print OAuth responses, token values, subject/client/host IDs or private records. Model output from a completed manual test is displayed to the operator.

Read the [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) before connecting. Another user's activity must not directly trigger use of your plan. This integration includes no Reddit comment trigger, webhook, polling loop or background model invocation. Background use is a separate future design requiring express authorization and compliance review; adding Reddit API approval would not enable it automatically.

## Start and verify manually

Use Node.js 24 or newer, check out the feature branch and install its locked dependency once:

```sh
npm ci --ignore-scripts
```

The single command that starts your sign-in is:

```sh
node src/cli.js chatgpt-login
```

The listener starts first on an available port at `http://127.0.0.1:PORT/auth/callback`, then the system browser opens. Complete account selection and consent there. The terminal prints a safe status after ID-token verification. Sign-in does not perform inference. `planUsageAuthorized: true` means the returned grant includes `chatgpt.tokens.use.direct`; it does not establish present usage capacity or guarantee admission.

Inspect the active account, discover eligible display models and explicitly select one:

```sh
node src/cli.js chatgpt-status
node src/cli.js chatgpt-models
node src/cli.js chatgpt-model LISTED_MODEL_SLUG
node src/cli.js chatgpt-test
```

Replace `LISTED_MODEL_SLUG` with a listed slug for your account. Only models whose `visibility` is exactly `list` are displayed. The catalog is refreshed using the same OAuth access token before each test. Model selections are local and per registration. An unavailable selection produces an error, with no silent replacement.

The test is synthetic and manual. To supply existing approved continuity/history records from your encrypted external vault, explicitly use:

```sh
node src/cli.js chatgpt-test --context-vault /absolute/private/context.vault
```

Provide the vault key through the existing `AXIOM_VAULT_KEY` environment variable; never put it in the command or a committed file. The four record layers remain `identity`, `behavior_history`, `memory`, `continuity`. Records must be both public and explicitly approved. Private records remain excluded even if their approval flag is true. History is sent directly in `input`; OAuth gives no access to ChatGPT history or memories. This work imported no actual Robobok context and performed no continuity evaluation.

## Accounts and sign-out

Account labels such as `Account 1` are local labels with no personal data. Registrations are keyed separately by issued client ID and verified subject, rather than merged by email. Switching accounts does not rotate accounts automatically or bypass usage limits.

```sh
node src/cli.js chatgpt-accounts
node src/cli.js chatgpt-login --new-account
node src/cli.js chatgpt-use "Account 1"
node src/cli.js chatgpt-login --account "Account 1"
node src/cli.js chatgpt-login --enable-plan
node src/cli.js chatgpt-logout
```

Routine reauthorization reuses the saved registration and host. Account hints are deliberately omitted so selection stays explicit and no retained ID token appears in a URL. A returned identity must match the selected registration before credentials are replaced. `--enable-plan` explicitly requests consent again using the currently documented OAuth `prompt=consent`; ordinary logins do not force consent. There is no alternate billing path.

Logout attempts renewable-session revocation using discovery, then clears local tokens while retaining the registration and host ID. Temporary revocation failures are retried at most three times with bounded backoff. If remote revocation is unconfirmed, the CLI reports that result and directs you to disconnect Axiom Rook in ChatGPT Settings.

## Local storage and renewal

Default credential file:

- Unix: `~/.config/axiom-rook/chatgpt/chatgpt-auth.json`.
- Windows: `%LOCALAPPDATA%\Axiom Rook\chatgpt\chatgpt-auth.json`, with a local-profile fallback.

`AXIOM_CHATGPT_DIR` can explicitly override the directory. It must be absolute, outside the repository, and on Windows inside the current user profile. The app refuses credential symlinks and unsafe Unix permissions/ownership. Unix directories use 0700 and files 0600; updates use an exclusive temporary file and atomic rename. Windows relies on the user's local profile and OS permissions; Windows ACL/browser behavior has not been tested here. This is protected local storage, not an OS credential-manager or encrypted OAuth store. Never place it in a shared, synced, remote or managed directory. The context vault's encryption is separate.

A host ID is generated once from an ephemeral Ed25519 public JWK, encoded as the recommended RFC 9278 SHA-256 thumbprint URI and persisted before authorization. It includes no user identity and is not a credential or proof of key possession. The private key used to derive the identifier is not retained.

Initial authorization uses `dynamic_agent_client` and `agent_name_hint=Axiom Rook`. A successful registration returns the real issued client ID, which is used for the exchange and retained locally. Each attempt uses fresh state, nonce and S256 PKCE. The exact callback URI is reused in the exchange. Identity checks validate OpenAI JWKS signature, issuer, issued-client audience, expiry and nonce; returning logins also check the saved subject. Unknown signing-key IDs cause a bounded JWKS refresh.

Requested scopes: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`. Resource: `https://api.openai.com/v1`. Returned token-response scopes determine authorization; callback scopes do not. No direct grant means the account can stay signed in while inference is disabled.

Access renewal uses `expires_in` with a one-minute safety margin and respects `earliest_refresh_at` when supplied. A saved refresh token is considered renewable for approximately 30 days from receipt; the provider remains authoritative. A replacement resets that window. Refresh occurs only during explicit CLI actions and is serialized across processes by a local session lock. Access token, replacement refresh token, ID token, scopes and expiry are replaced together. A terminal refresh failure clears unusable tokens; temporary failures retain them. No inference retry or account/billing fallback is performed.

## Responses and recovery

Only `GET https://api.openai.com/v1/models` and `POST https://api.openai.com/v1/responses` use the inference access token. A Responses body contains exactly `model`, an `input` array, `store: false`, and `stream: true`. No system message, hosted tools, background field, server conversation, previous response ID, sampling settings, output-token cap or metadata is emitted. No ChatGPT backend endpoint is used.

The SSE consumer buffers output and requires a valid `response.completed` event before accepting it. Failed, incomplete, malformed and interrupted streams are separate errors. Usage-limit failures are recognized both before streaming and in a failed stream. Partial text is not accepted as a finished answer. Inference is never retried automatically.

On usage limits, review your app limits and shared allowance in ChatGPT Settings → Usage. The error alone does not identify which limit applied or when it resets. On temporary service/routing failures, retain credentials and retry manually later. On ineligible user/policy or unsupported capability/route errors, correct the restriction rather than looping through sign-in. Terminal refresh errors require a fresh login using the saved issued client. Safe errors retain HTTP status, machine-code category, parameter and request ID where appropriate, without printing private diagnostic bodies.

## Verified and unverified

Offline tests use generated synthetic signing keys, synthetic account/token data, mock OpenAI fetch calls, mock loopback listeners and temporary private files. They exercise OAuth construction/callbacks, identity verification, configuration/storage safety, refresh and account separation, redaction, model filtering, consent filtering, streaming outcomes and logout. The original 19 tests and offline demo are preserved.

Not tested with a real account: browser sign-in/consent, dynamically issued registration, actual plan admission/limits, actual account models, live Responses/SSE, provider refresh/revocation and Windows launch/ACLs. Real testing begins only when the operator runs the login command. Reddit API approval is still pending; Reddit network access remains gated, posting is unimplemented, and live background autonomy is not enabled.

## Official sources

- [OSS plan-sharing overview](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
- [OpenID Connect verification reference](https://developers.openai.com/siwc/website)
- [Sign in with ChatGPT Terms](https://openai.com/policies/sign-in-with-chatgpt-terms/)
