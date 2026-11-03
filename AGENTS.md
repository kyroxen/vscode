# VS Code Agents Instructions

This file provides instructions for AI coding agents working with the VS Code codebase.

For detailed project overview, architecture, coding guidelines, and validation steps, see the [Copilot Instructions](.github/copilot-instructions.md).

## Fork Maintenance

- Reuse existing variables, constants, utilities, services, components, and theme tokens before defining new ones. Keep shared defaults in one place.
- Reuse complete upstream behavior, including cancellation, disposal, caching, symbol resolution, editor opening, command history, and error feedback. Avoid copying or partially rebuilding it.
- Keep fork-specific features in separate modules. Limit edits to upstream files to small, necessary integration points so syncing with upstream main stays straightforward.
- Preserve upstream defaults and APIs wherever possible. Prefer thin adapters over widening APIs or modifying shared implementations.
- Let independent searches publish results independently; a slow provider must not block ready results from other sources.
- Add focused regression coverage for changed behavior, run the relevant checks, and keep [the upstream sync guide](scripts/intellij/UPSTREAM-SYNC.md) current when integration points change.
