# Changelog

All notable changes to this project will be documented in this file.

## v1.1.0

Memory Retrieval Quality Sprint.

### Changed
- Stripped inbound prompt metadata before retrieval decisions and recall queries.
- Added three-gate retrieval behavior: questions always retrieve, trivial follow-ups can be augmented from cached assistant context, and weak short prompts can skip retrieval.
- Reduced the extraction window to the last 5 real user/assistant messages via a backwards walk.
- Added a memory preamble inside `<relevant-memories>` tags so agents treat memories as evidence, surface relevant preferences, ask clarifying questions, and flag contradictions.
- Raised the default `minRelevanceScore` to `0.30`.

## v1.0.2

Security hardening release.

### Changed
- Removed the `X-Owner-Id` request header.
- Deduplicated the API key hardcoding warning so it is emitted once per process.

## v1.0.1

Security hardening release.

### Changed
- Scoped the local SQLite cache by `ownerId` to prevent cross-tenant memory leakage.

## v1.0.0

Initial release.

### Added
- Full memory lifecycle support: capture, retrieval, recall, deletion, commitments, contradictions, and open loops.
- 12 Cortex tools for direct agent access.
- Local SQLite cache support.
- Hybrid retrieval behavior for memory search.
