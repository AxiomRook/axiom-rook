# Reddit Data API application draft

Prepared 2026-10-07 from the operator's existing Data Access Request form. **Not submitted.** The public starter source is published at `AxiomRook/axiom-rook`, including the CI workflow. Review the GitHub Actions result for the exact commit before using this source in a submission. This is a source-grounded draft, not an approval statement. Do not claim live integration or guaranteed Devvit incompatibility.

## Form fields

| Visible field | Value |
| --- | --- |
| Hangi konuda yardıma ihtiyacın var? | Data Access Request |
| API erişimi isteme sebebini en iyi hangi rol açıklar? | Geliştiriciyim |
| Talebin nedir? | Bir geliştiriciyim ve Devvit ekosisteminde çalışmayan bir Reddit Uygulaması geliştirmek istiyorum. |
| Reddit hesap adı | AxiomRook |
| API'ye erişecek kaynak kodunun veya platformun bağlantısı | https://github.com/AxiomRook/axiom-rook |
| Bu Botu/Uygulamayı hangi kullanıcı adı altında çalıştıracaksın? | AxiomRook |
| E-posta adresi | Use the operator's private contact email in the form only; excluded from this repository. |
| Subreddit listesi | Unresolved. No communities or moderator permissions are confirmed; do not invent them. |
| Ekler | Optional; no private history, secrets or memory exports. |

## Benefit / purpose

Axiom Rook is a personal, non-commercial AI discussion agent being developed for the dedicated account u/AxiomRook. Its intended purpose is to contribute relevant questions, reasoned perspectives and constructive responses to selected public discussions, while maintaining limited conversational continuity and transparent AI identification. It is a hobby application, not an academic research data-collection project. It will not advertise, manipulate votes, mass-post, send unsolicited private messages, profile users or train AI models on Reddit data. The public repository is an offline, pre-approval starter; no Reddit API access has been granted or used.

## Detailed functionality and examples

The intended application is an external, account-based discussion agent. If authorized, it would periodically read a small number of comments in explicitly approved communities and relevant public follow-up threads, decide whether a contribution would be useful, prepare a clearly identified AI response and submit replies only within the permissions granted by Reddit and each community.

For example, in an approved AI discussion thread it could ask for the evidence behind a technical claim or explain uncertainty in a model evaluation. In a public reply to its own comment it could acknowledge a correction and respond to the specific argument. It would abstain from prohibited, repetitive or inappropriate participation. No subreddit or moderator permission is assumed to exist.

The current code implements an offline synthetic demo, public/private context filtering, encrypted operator context storage, a bounded approval-gated OAuth read adapter and an in-memory draft review workflow. It does not yet generate model responses, post comments, monitor Reddit in the background or persist Reddit discussion history. The read adapter has only been tested against mocks. The repository's conservative initial limits are at most six read requests per minute, 25 comments per explicit read, five drafts per day per process, a ten-minute draft cooldown and 24-hour draft expiry. Production-wide limits and persistent deduplication will be implemented before live posting; Reddit's granted limits will take precedence if lower.

The planned AI backend would send only the minimal relevant public discussion context to an external language model API for inference, together with explicitly shareable operator-approved behavior guidance. This third-party processing is part of the requested use case, not model training. The provider/model and retention settings have not yet been configured; I request review of the permitted processing and will not enable it until the relevant permissions and data-handling requirements are settled. Private operator chats, personal data and private memories will not be included in Reddit-facing prompts or published outputs.

Before deployment, the application will need app registration/labeling, an explicit community allowlist, appropriate moderator permission, disclosure, persistent rate controls, duplicate prevention, current deletion/block checks and an immediate operator stop mechanism. Discussion context would be bounded and deletion-aware; no bulk archives, off-platform identity matching or user profiling are planned. Initial posting would require human review. Supervised autonomy is a later development goal and would be enabled only within an approved scope. The initial source has no posting implementation at all.

## Why request review outside Devvit?

I have reviewed Devvit. Devvit supports external calls to approved AI providers, so external LLM use alone is not my reason for requesting Data API access. The intended workflow is a standalone, operator-controlled process acting through one dedicated account, with private context stored outside the Reddit application environment, rather than a community-installed interactive application or moderation tool.

I am asking Reddit to review whether this independent, account-based workflow across a small, explicitly approved community scope can be authorized through the Data API. I do not claim that every aspect is technically impossible in Devvit. If a supported Devvit design is the required route, I am willing to adapt the application accordingly. I will not scrape Reddit, bypass access controls or use the API before explicit approval.

## Subreddits: remaining input

Choose the actual small initial list with the operator and verify the communities' bot/AI rules and any moderator permissions. Interest in a subreddit is not permission to operate there. The runtime allowlist stays empty until this is settled. Do not submit a vague claim of unrestricted cross-Reddit access.

## Status and requested scope

Request review for non-commercial, selective public-discussion reads and replies, with explicit disclosure of external AI inference. OAuth scopes, app type, provider and operational scope are to be finalized after Reddit's instructions. The account exists; the API application has not been submitted. No access approval, OAuth client, token, external LLM connection, hosted agent or autonomous posting is claimed.
