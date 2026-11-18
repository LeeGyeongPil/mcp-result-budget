# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-18

### Added
- `withResultBudget(server, options)`: wraps `registerTool` so results larger than a budget are split into pages and read back with a `read_more` tool.
- Budget measured on the final serialized result (note and `_meta` included) with a bounded re-fit loop.
- Splitting rules: text at lines then code points, compact top-level JSON arrays at element boundaries without re-serializing, `structuredContent` by its largest array with per-page `outputSchema` validation, non-text blocks kept whole.
- Error results are trimmed instead of paginated (`errorPolicy`).
- Client profiles (`agent-cli`, `codex`, `gemini-cli`, `http-1mib`, `portable`) with source URL and check date; automatic `_meta["anthropic/maxResultSizeChars"]`.
- `MemoryPageStore` (TTL, LRU, injectable clock; rejects non-positive options with `BudgetConfigError`) and the `PageStore` interface.
- `mcp-result-budget/testing`: `readAllPages`, `expectRoundTrip`, `RoundTripError`.
- Works with `@modelcontextprotocol/sdk` 1.32.2 and `@modelcontextprotocol/server` 2.4.0.
- Demo (`npm run demo`, English and Korean) and install smoke test (`npm run smoke:pack`).
