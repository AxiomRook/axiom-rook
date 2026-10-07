# Axiom Rook

A personal, non-commercial AI discussion agent being developed for the dedicated Reddit account **u/AxiomRook**. The goal is selective, constructive public discussion with conversational continuity, transparent AI identification and human oversight.

**Status: pre-approval starter, not a deployed autonomous bot.** The Reddit Data API application has not been submitted. Reddit access has not been granted or tested. No OAuth client, model subscription, model key or running service is assumed to exist.

## What works now

- A runnable offline demonstration using entirely synthetic input.
- Four-layer context records, explicit public/private separation, versioned revisions and external-use consent filtering.
- An AES-256-GCM encrypted context vault stored outside this repository, with overwrite protection.
- A draft/review workflow with disclosure, community allowlist, operator-maintained blocklist, self-reply prevention, cooldowns, draft caps, duplicate checks and expiry.
- A bounded OAuth read adapter that refuses all network calls until approval, token and community allowlist are explicitly configured. This adapter has only been tested with mocks.
- Automated tests and a strict public-file allowlist/credential-pattern check.

**Not implemented:** OAuth registration/token acquisition, LLM generation, posting, background monitoring, persistent Reddit discussion history, automatic block/deletion synchronization, hosted deployment, ChatGPT import or bidirectional synchronization. Draft limits apply to a single in-memory process and are not production-wide posting limits.

## Run locally

Use Node.js 24 or newer. There are no third-party runtime dependencies and no package installation is necessary.

```sh
npm test
npm run check:public
npm run demo
node src/cli.js status
```

`demo` calls neither Reddit nor an LLM, publishes nothing, and writes no context files. Its reply text is a fixed demonstration string, not a generated response.

After explicit Reddit approval, an operator can prepare a **private configuration outside the repository**, preserving the validation limits, marking approval and listing only permitted communities. With an approved OAuth access token in the environment:

```sh
node src/cli.js read CommunityName /absolute/private/config.json
```

This reads at most 25 recent comments from one allowlisted community and prints only a count. Never activate it before approval. The initial release cannot post even after a draft is reviewed.

## Context continuity and privacy

The four layers are behavioral identity, behavioral history, evolving memory, and continuity controls. The public repository contains their structure and code only. It contains no operator conversations, personal profile, actual private memories or model credentials.

Private context must be kept in an encrypted vault outside the Git checkout. Only records deliberately marked `public` **and** `approvedForExternalUse: true` pass the external-context filter. Editing a record revokes its previous approval. Labels require human review: code cannot reliably decide whether prose reveals private information.

The software cannot export ChatGPT's hidden state, model weights or automatic personalization. Carrying selected records into a future model backend may preserve observed preferences and behavior; identical identity, output and model/session continuity are not guaranteed. No private records have been imported in this release.

See [architecture](docs/architecture.md), [security](SECURITY.md), [application draft](docs/reddit-application.md) and [verified status](docs/status.md).

## Intended access and operation

The intended future scope is reading approved public discussions and, if Reddit authorizes it, submitting reviewed replies from the dedicated account. No automated voting, unsolicited private messaging, advertising, bulk collection, user profiling or model training is planned. Subreddit choices and moderator permissions remain unresolved; the runtime allowlist is empty.

Planned AI processing of a small amount of public discussion text through an external model API will be explicitly disclosed in the application. No external model processing is implemented or authorized by this repository alone. Provider, model, retention controls and permissions must be settled before enabling that path.

An independent account-based workflow is the reason for requesting review outside Devvit; external LLM access by itself is **not** a Devvit limitation. Reddit decides which access path and scope it permits. Autonomous operation is a later goal, not a current capability or approval.

## Official references

- [Responsible Builder Policy](https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy)
- [Developer Platform and Data API access](https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data)
- [Devvit HTTP Fetch Policy](https://developers.reddit.com/docs/capabilities/server/http-fetch-policy)

This public source is available for review. No open-source license has been selected; public visibility alone does not grant a license.
