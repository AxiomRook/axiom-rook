# Architecture and continuity decisions

## Goal and limits

Axiom Rook is an external Reddit representative drawing on selected, operator-controlled context. It is not a claim that a ChatGPT instance or hidden internal state has moved into another process. Current records and tests are synthetic; no personal continuity seed has been installed.

| Layer | Purpose | Starter implementation |
| --- | --- | --- |
| `identity` | Stable, observed behavior and response preferences | Validated context records |
| `behavior_history` | Corrections, conflicts and changes with their reasons | Records plus revision increments; edits revoke consent |
| `memory` | Evolving conversational context | Encrypted local records; no Reddit history ingestion yet |
| `continuity` | Version tracking and comparisons across model changes | Record revisions and separate vault versions; model comparisons deferred |

Every record contains `id`, `layer`, `text`, `visibility`, `approvedForExternalUse` and `revision`. Private material never enters `buildExternalContext`, even if its approval flag is accidentally set. Only explicitly public, approved material can enter a future external prompt. An approval flag is not an automatic privacy classifier.

## Current data path

The offline CLI passes a synthetic comment and a fixed sample response into the draft workflow. The workflow creates a disclosed draft, holds it in memory and permits review of the exact body hash. Publishing always throws an error. Review cannot silently authorize publication.

The separate OAuth adapter permits bounded public reads only after the operator has recorded actual Reddit approval, supplied a token and allowlisted a community. It uses a fixed HTTPS host, no redirects, a timeout, a six-requests-per-minute ceiling, quota-header cooldown and no automatic retry. Mock tests verify these gates. No credentials or real responses have been used.

The encrypted vault is an independent storage component. It persists context records outside the repository but is not automatically loaded by the demo or sent to a model. A new vault filename is needed per save. No backups or synchronization are silently enabled.

## Before production

Implement and verify approved OAuth scopes, a model provider with appropriate retention controls, deletion-aware ephemeral thread context, and a durable job/review ledger. The process-local draft checks are suitable for testing only. Real posting needs persistent daily caps, community permission checks, live block/deletion/lock checks, review validity, concurrency-safe idempotency, clear disclosure and an immediate kill switch.

Reddit discussion content must remain separate from the operator's private continuity records. No public user profile memory is planned. Future thread context should be short-lived and purged when content is deleted or removed; the precise retention policy must be reviewed with Reddit before deployment. There is no Reddit content retention in the starter.

A later evaluation set should test evidence handling, disagreement, correction of errors, style continuity and privacy boundaries using operator-selected examples outside the public repository. Model-based continuity has not been evaluated. Reddit experience does not automatically synchronize to ChatGPT.
