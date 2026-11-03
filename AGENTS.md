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

## Fork References

Read the relevant fork references before changing its behavior or appearance. Keep this index and the linked documentation current when adding a feature or integration point.

- [Fork overview](README.md): feature inventory and entry points.
- [Upstream sync guide](scripts/intellij/UPSTREAM-SYNC.md): fork-owned modules, all upstream hooks, merge risks, branding, validation commands, and the distinction between shipped defaults and ignored personal settings.
- [Setup and appearance guide](extensions/intellij-experience/README.md): profile launch/reload instructions, project-specific themes and icons, popup appearance, navigation, and keymaps. [Declarative defaults](extensions/intellij-experience/package.json) and [Islands theme](extensions/intellij-experience/themes/intellij-islands-dark-color-theme.json) own the shared appearance defaults. [Workbench appearance styles](src/vs/workbench/contrib/intellij/browser/appearance.css) own scoped breadcrumb spacing and Explorer error underlines. The [Explorer underline contribution](src/vs/workbench/contrib/intellij/browser/explorerErrorUnderline.ts) uses the native Explorer file contribution registry and marker service while preserving Git decorations. The [breadcrumb-tail adapter](src/vs/workbench/browser/parts/editor/intellij/breadcrumbsTail.ts) reuses native scrolling after layout while preserving keyboard focus.
- [Tooling setup](scripts/intellij/setup.ts), [pinned extensions](scripts/intellij/extensions.json), and [launcher](scripts/code-intellij.sh): isolated profiles and language bundles. [JavaScript project extension](extensions/intellij-javascript/src/extension.ts) owns project-tool adapters. The [Copilot packaging adapter](scripts/intellij/copilotPackaging.ts) restores extension-host runtime files after the standard build; packaging and installation are documented in the sync guide.
- [Navigation adapter](src/vs/editor/contrib/gotoSymbol/browser/symbolNavigationPicker.ts), [popup](src/vs/editor/contrib/gotoSymbol/browser/intellij/symbolNavigationPopup.ts), and [popup styles](src/vs/editor/contrib/gotoSymbol/browser/intellij/symbolNavigationPopup.css): fork-specific navigation UI. Preserve native opening, cancellation, and model ownership at the upstream hook.
- [Workbench registration](src/vs/workbench/contrib/intellij/browser/intellij.contribution.ts), [Search Everywhere](src/vs/workbench/contrib/intellij/browser/searchEverywhere.ts), and [class search](src/vs/workbench/contrib/intellij/browser/classSearch.ts): native-provider adapters and contribution registration.
- [Git action guide](extensions/git-info-exclude/README.md): fork Git context-menu behavior and file comparison against branches/revisions. [Explorer menu adapter](src/vs/workbench/contrib/intellij/browser/explorerMenus.ts) groups native creation actions under New; the small integration hook lives in `fileActions.contribution.ts`.
- [Branding source](resources/intellij/cat.svg) and [asset generator](scripts/intellij/generate-icons.py): app artwork; regeneration and verification instructions live in the sync guide.
- [Browser regression list](scripts/intellij/browser-tests.txt), [setup tests](scripts/intellij/setup.test.ts), [packaging tests](scripts/intellij/copilotPackaging.test.ts), and [JavaScript project tests](extensions/intellij-javascript/src/test/project.test.ts): focused validation entry points. Follow the sync guide for the additional type, layer, task, and branding checks relevant to a change.
