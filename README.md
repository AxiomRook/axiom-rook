# Axiom Rook

A personal, non-commercial AI discussion agent being developed for the dedicated Reddit account **u/AxiomRook**. The goal is selective, constructive public discussion with conversational continuity, transparent AI identification and human oversight.

**Status: pre-approval Reddit starter with manual Sign in with ChatGPT plan-sharing support.** Reddit API approval is pending. The SIWC integration has been tested with mocked OpenAI services only; no real account login, plan eligibility or live inference has been verified.

## What works now

- A runnable offline demonstration using entirely synthetic input.
- Four-layer context records, explicit public/private separation, versioned revisions and external-use consent filtering.
- An AES-256-GCM encrypted context vault stored outside this repository, with overwrite protection.
- A draft/review workflow with disclosure, community allowlist, operator-maintained blocklist, self-reply prevention, cooldowns, draft caps, duplicate checks and expiry.
- A bounded OAuth read adapter that refuses all network calls until approval, token and community allowlist are explicitly configured. This adapter has only been tested with mocks.
- Automated tests and a strict public-file allowlist/credential-pattern check.
- A local SIWC public-client flow, verified OpenAI identity, private account/token storage, rotating-token renewal, account-specific model discovery and a manual streaming Responses test. No OpenAI API key or client secret is used.

**Not implemented:** Reddit OAuth registration/token acquisition, model-driven Reddit replies, posting, background monitoring, persistent Reddit discussion history, automatic block/deletion synchronization, hosted deployment, ChatGPT history/personalization import or bidirectional synchronization. Draft limits apply to a single in-memory process and are not production-wide posting limits.

## Run locally

Use Node.js 24 or newer. Install the locked `jose` dependency used for OpenID Connect signature verification:

```sh
npm ci --ignore-scripts
npm test
npm run check:public
npm run demo
node src/cli.js status
```

`demo` calls neither Reddit nor an LLM, publishes nothing, and writes no context files. Its reply text is a fixed demonstration string, not a generated response.

## Manual ChatGPT plan-sharing test

Run on your own local computer. Start sign-in only when you explicitly choose to connect the account:

```sh
node src/cli.js chatgpt-login
```

This opens the system browser after starting a callback listener bound to `127.0.0.1`. A successful login requests permission; actual plan availability is still determined by OpenAI. It does not fetch ChatGPT conversations or memories, call a model, or connect Reddit.

```sh
node src/cli.js chatgpt-status
node src/cli.js chatgpt-models
node src/cli.js chatgpt-model LISTED_MODEL_SLUG
node src/cli.js chatgpt-test
node src/cli.js chatgpt-logout
```

Replace `LISTED_MODEL_SLUG` with a slug returned for your connected account. There is no default model or silent fallback. `chatgpt-test` is a fixed synthetic connection check initiated by the operator; Reddit comments and webhooks cannot trigger it. Optional continuity records must be loaded explicitly from your external encrypted vault and still pass the existing public-and-approved filter.

Read the [SIWC setup, privacy notice, recovery and test limitations](docs/chatgpt-plan-sharing.md) before signing in. ChatGPT plan usage consumes the account's applicable shared allowance and app limits; it does not provide extra usage. Tokens remain in protected local user storage outside the Git checkout. No API-key fallback exists.

After explicit Reddit approval, an operator can prepare a **private configuration outside the repository**, preserving the validation limits, marking approval and listing only permitted communities. With an approved OAuth access token in the environment:

```sh
node src/cli.js read CommunityName /absolute/private/config.json
```

This reads at most 25 recent comments from one allowlisted community and prints only a count. Never activate it before approval. The initial release cannot post even after a draft is reviewed.

## Context continuity and privacy

The four layers are behavioral identity, behavioral history, evolving memory, and continuity controls. The public repository contains their structure and code only. It contains no operator conversations, personal profile, actual private memories or model credentials.

Private context must be kept in an encrypted vault outside the Git checkout. Only records deliberately marked `public` **and** `approvedForExternalUse: true` pass the external-context filter. Editing a record revokes its previous approval. Labels require human review: code cannot reliably decide whether prose reveals private information.

The software cannot export ChatGPT's hidden state, model weights or automatic personalization. Carrying selected records into a model backend may preserve observed preferences and behavior; identical identity, output and model/session continuity are not guaranteed. SIWC supplies model access only. No private records have been imported by this integration, and real continuity has not been evaluated.

See [architecture](docs/architecture.md), [security](SECURITY.md), [application draft](docs/reddit-application.md) and [verified status](docs/status.md).

## Intended access and operation

The intended future scope is reading approved public discussions and, if Reddit authorizes it, submitting reviewed replies from the dedicated account. No automated voting, unsolicited private messaging, advertising, bulk collection, user profiling or model training is planned. Subreddit choices and moderator permissions remain unresolved; the runtime allowlist is empty.

Planned AI processing of public discussion text must be explicitly disclosed and separately reviewed before implementation. The SIWC path here allows only manual synthetic tests and explicitly approved operator context. Another user's activity must not directly trigger a request against the operator's ChatGPT plan. Background use requires a separate design, express authorization and compliance review; Reddit approval alone would not enable it.

An independent account-based workflow is the reason for requesting review outside Devvit; external LLM access by itself is **not** a Devvit limitation. Reddit decides which access path and scope it permits. Autonomous operation is a later goal, not a current capability or approval.

## Official references

- [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)
- [Developer Platform and Data API access](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data)
- [Devvit HTTP Fetch Policy](https://developers.reddit.com/docs/capabilities/server/http-fetch-policy)

This project is open source and licensed under the MIT License. See [LICENSE](LICENSE).
