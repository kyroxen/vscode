# Maintaining the IntelliJ Fork

Keep the IntelliJ implementation additive: new modules own the UI and behavior; upstream files contain only configuration support, registration, or calls into those modules. Do not copy upstream navigation, editor-opening, file-search, or command-search implementations into the fork. These continue to own provider results, editor history, source resolution, filtering, and command preconditions.

## Fork-Owned Code

- `extensions/git-info-exclude/`: Git context menus and original extension attribution; command implementation and literal ignore-pattern helpers live in `extensions/git/src/intellij/`, with coverage in `extensions/git/src/test/gitInfoExclude.test.ts`.
- `extensions/intellij-experience/`: appearance defaults, local theme, and keybindings.
- `extensions/intellij-javascript/`: active-package detection, project tools, and native command adapters. Detection reads package metadata and configuration filenames without executing project code or changing workspace settings.
- `scripts/intellij/` and `scripts/code-intellij.sh`: local extension provisioning, runtime detection, and development launch.
- `src/vs/editor/contrib/gotoSymbol/browser/intellij/`: the anchored navigation popup, its renderer, keyboard interaction, and styles.
- `src/vs/workbench/browser/parts/editor/intellij/breadcrumbsTail.ts`: cancellable post-layout scheduling for the native rightmost breadcrumb reveal.
- `src/vs/editor/contrib/gotoSymbol/browser/symbolNavigationPicker.ts`: popup adapter with a standard Quick Pick fallback for hosts without an editor anchor.
- `src/vs/workbench/contrib/intellij/`: Search Everywhere, class search, native command-picker adapter, source-origin tab decorations, breadcrumb formatters and a status-bar source entry, and registration.
- The corresponding navigation and Search Everywhere tests.

## Upstream Integration Points

These nine existing code files are the upstream behavior integration surface. Branding assets are listed separately below. New feature logic belongs in the fork-owned files above, rather than growing these hooks.

| Upstream file | Required change | What to check after syncing |
| --- | --- | --- |
| `extensions/git/src/main.ts` | Import and register the fork Git actions | Native repository resolution, stage conflict handling, discard confirmation, and disposal remain intact. Local excludes use `dotGit.commonPath ?? dotGit.path` for linked worktrees. |
| `build/lib/i18n.resources.json` | One localization entry | Strings in the separate IntelliJ workbench contribution remain discoverable. |
| `build/gulpfile.extensions.ts` | One compilation-list entry for `intellij-javascript` | Standard extension compilation, transpilation, and packaging include the fork-owned extension. |
| `src/vs/workbench/workbench.common.main.ts` | One side-effect import | The IntelliJ contribution registers once in every supported workbench window. |
| `src/vs/editor/common/config/editorOptions.ts` | Add `pick` to navigation preference validation and descriptions | Upstream has not changed option validation or introduced an equivalent choice. Default behavior for other configurations is unchanged. |
| `src/vs/monaco.d.ts` | Add `pick` to the public navigation preference union | This declaration agrees with the editor's option type. |
| `src/vs/editor/contrib/gotoSymbol/browser/goToCommands.ts` | Import and call the picker for multiple `pick` destinations and all categorized usages, including empty or declaration-only reference results | Cancellation still prevents navigation; editor opening still uses the upstream path; the original results model is disposed exactly once; Open Results creates a Peek model containing every discovered location. |
| `src/vs/workbench/browser/parts/editor/breadcrumbsControl.ts` | Own the fork breadcrumb-tail helper and schedule it after native layout | Native breadcrumb order, scrollbar measurement, keyboard navigation, picker focus, and disposal remain intact. Resizing reveals the rightmost item after measurements settle without stealing breadcrumb keyboard focus. |
| `src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts` | Small session-initialization and file/history adapters | Upstream still owns file/history/symbol search and opening. Results resolve in the intended workspace, including remote resources. Each picker session initializes the native file-query cache and resets scoring state; slow symbols must not block files or history. |

Quick Access registration and the adapter exposing processed command picks live in fork-owned modules. There are no edits to upstream Quick Access registration or command-provider visibility. Class search filters native workspace-symbol picks and retains their provider resolution and editor-opening handlers. Search Everywhere publishes file/history, symbol, and command results independently, preserving native command filtering, history, and error reporting.

## Merge-Risk Boundaries

The navigation preference adds `pick` to both editor validation and the public Monaco declaration. Keep those changes together and review new upstream navigation modes during each sync. The picker branch delegates opening and Peek to upstream; changes to cancellation, alternative actions, reference-model ownership, or editor history require a behavioral review even if Git reports no textual conflict.

Search Everywhere's two methods in `anythingQuickAccess.ts` deliberately touch native picker state and file-query caches. They are the most API-sensitive search integration. Recheck `pickState.set`, additional-pick contracts, and native scoring/cache disposal when upstream changes Quick Access. The fork-owned command adapter subclasses the upstream provider's protected `_getPicks`; it does not copy command acceptance or history logic.

Branding replaces existing upstream assets. Expect to regenerate or retain the cat assets when upstream changes logos; these changes are separate from runtime behavior. The JSON language-server launcher's executable-bit change is not part of the fork feature and should be reviewed separately rather than swept into a feature or sync commit.

Before syncing, inspect both tracked and untracked files. In particular, `intellij-javascript` must be included with its compilation-list entry; committing only the tracked diff would leave a broken build. Do not discard unrelated work while preparing the sync.

## Appearance and Local Preferences

The appearance extension, popup stylesheet, fork-owned workbench `appearance.css` (minimal breadcrumb padding), and native workspace settings own appearance; shared editor, list, hover, and theme implementations are unchanged. Dark Modern and Seti are the general defaults. Java projects opt into Islands Dark and JetBrains icons through workspace settings. The popup's dark palette is scoped to its own surface and preview so it stays consistent across dark themes; light and high-contrast themes retain native colors. If palette values change, review both the bundled theme and the scoped popup overrides.

Personal settings under the ignored `.profile-oss/` directory are not shipped with the fork. The darker `#141517` editor backgrounds were applied there as theme-specific `workbench.colorCustomizations`; a fresh checkout/profile will not receive those personal overrides automatically. Java appearance overrides in an external project's `.vscode/settings.json` are also outside this repository. Preserve those separately or intentionally promote them into provisioning defaults if they should become distributable behavior.

## JavaScript and TypeScript Projects

Run `scripts/code-intellij.sh --tooling javascript <project>` for an isolated JavaScript profile, `--tooling java` for Java/Spring, or omit the option for both. `scripts/intellij/extensions.json` owns all pinned versions; setup selects shared appearance/keymap extensions plus the requested language tools. JavaScript provisioning includes ESLint and Prettier and does not require Java extensions or JDKs. Provisioning copies extensions already installed in the source directory; it never downloads them. Close the target profile before manually rerunning setup. The launcher checks the profile version and selected extension versions before launch, applying missing defaults while preserving explicit user settings and later keybindings.

JavaScript, JSX, TypeScript, and TSX use the navigation popup by default. Cmd+O/Ctrl+N routes to native symbol search for those active languages, including function components, hooks, and variables; Go to Class remains available as a separate command. Existing profiles insert this override after the previously generated class binding, before later user customizations.

The JavaScript Project status entry follows the active file's nearest package, reads ancestor tooling and language configuration, and hides for Java files and dependency/generated sources. Each workspace folder is isolated. Folder-scoped configuration watchers invalidate the bounded directory cache, and a revision guard discards stale async results. Package scripts select and execute the built-in npm extension’s native task objects, preserving task dependencies, user options, package boundaries, and package-manager settings. Avoid the upstream folder-run command: its current registration does not bind the context argument its handler expects. Debugging, formatter selection, language configuration, and the Testing view use upstream commands. Configured ESLint, Prettier, Biome, Vitest, Jest, and framework integrations are surfaced in the project picker; missing integrations open extension search rather than installing or configuring them silently. Scripts and debugging require workspace trust. Opening a project does not execute scripts, install dependencies, enable strict checking, choose a default formatter, or write project configuration.

Reference categories recognize JS/TS test/spec filenames, `__tests__`, CommonJS bindings, and multiline imports/re-exports. JSDoc classification uses native language tokens and falls back when tokenization is unavailable. npm source labels recognize nested/scoped `node_modules` paths and pnpm versions before workspace membership, preserving original resource URIs. Yarn Plug'n'Play archives and symlink targets without package paths retain generic source labels.

Validate project detection with `pnpm exec tsc -p extensions/intellij-javascript/tsconfig.json` and `pnpm exec mocha --ui tdd extensions/intellij-javascript/out/test/project.test.js`, plus setup and browser tests below. The extension-host suite at `extensions/intellij-javascript/out/test` additionally validates native task objects and remote package matching through `--extensionDevelopmentPath=extensions/intellij-javascript --extensionTestsPath=extensions/intellij-javascript/out/test`. Smoke-test JS/JSX, TS/TSX, CommonJS, monorepos, and mixed Java/JavaScript workspaces. Check symbol search, aliases, cross-file rename/references, source labels, formatter configuration, script execution, test integration availability, and Node/browser debugging. Missing dependencies and missing integrations must remain visible and actionable.

## Sync Procedure

### Fork Branding

`resources/intellij/cat.svg` owns the blue cat artwork; `scripts/intellij/generate-icons.py` generates the white app tile, macOS ICNS, Windows ICO, Linux PNG, web favicon/PWA icons, workbench logo, Sessions open-in-editor logo, and four theme-specific empty-editor watermarks. Existing upstream asset paths remain unchanged, so packaging, welcome/onboarding screens, title bars, banners, and update prompts all reuse the fork icon without runtime hooks. File-association icons and the separate Sessions app identity are unchanged.

After syncing, retain the generated cat assets at `resources/darwin/code.icns`, `resources/win32/code.ico`, `resources/linux/code.png`, `resources/server/{favicon.ico,code-192.png,code-512.png}`, `src/vs/workbench/browser/media/code-icon.svg`, `src/vs/sessions/browser/media/vscode-icon.svg`, and `src/vs/workbench/browser/parts/editor/media/letterpress-{light,dark,hcLight,hcDark}.svg`. Check for new upstream app-logo consumers and wire them into the generator rather than copying artwork by hand.

Run `uv run scripts/intellij/generate-icons.py` to regenerate and add `--check` to verify all generated assets match the source. CairoSVG requires the native Cairo library; on Homebrew macOS, use `DYLD_FALLBACK_LIBRARY_PATH=/opt/homebrew/lib uv run scripts/intellij/generate-icons.py --check` if Cairo is not found automatically. Python dependencies are pinned in the script; these tools are only needed when regenerating or verifying artwork, not when building or running the editor.

Electron downloads and packaged builds read the existing platform asset paths. A development Electron bundle downloaded before the icon changed must be refreshed separately: copy `resources/darwin/code.icns` to `.build/electron/Code - OSS.app/Contents/Resources/Code - OSS.icns`, then fully quit and reopen the app. macOS may retain its previous Dock icon until the app restarts.

### Updating From Upstream

Commit the fork's source and new files on a dedicated branch before syncing; a working-tree diff alone does not include untracked new files. Fetch the upstream remote configured for this checkout, then rebase or merge upstream main using the project's normal policy.

Resolve conflicts at the integration points above by adapting the small hook to the new upstream API. Preserve upstream fixes and avoid restoring whole files from an older fork revision. If upstream introduces equivalent behavior, remove the redundant adapter rather than keeping two implementations. Never apply broad search-and-replace patches to upstream navigation code.

After resolving a sync, use the Node version in `.nvmrc` and run:

```sh
pnpm run typecheck-client
pnpm run build-fast --client-only
node --test scripts/intellij/setup.test.ts
pnpm run test-browser-no-install --runList scripts/intellij/browser-tests.txt --browser chromium
pnpm run valid-layers-check
```

Run targeted ESLint on the files changed during conflict resolution and stylelint on the popup stylesheet. The IntelliJ appearance extension is declarative; the JavaScript project extension is compiled by the standard extension build.

Categorized usages supplement reference-provider results with definition and implementation locations, publishing each provider response independently. This is required for Java library methods whose reference results contain only the declaration. Keep empty and single-result usages routed through the picker when `pick` is configured, while preserving single-destination navigation and explicit Peek commands.

Finally, smoke-test a method call, its declaration, and an interface with multiple implementations: Cmd+click/Cmd+B, the usages popup, Cmd+Option+B, Escape, Enter, filtering, Current File, and Open Results. Verify that the back action restores the origin and that remote/dependency source locations still open. Check a narrow window and a high-contrast theme when popup layout or colors change.

Fully quit and restart Code - OSS after adding or removing CSS modules. The development main process caches their import-map entries, so Developer: Reload Window alone can fail with a CSS MIME-type error even when the source build is current. Preserve this upstream loader behavior rather than adding a fork-specific loader workaround.

This structure limits merge conflicts but cannot guarantee conflict-free syncing. Changes to upstream navigation lifecycle, provider contracts, and Quick Access APIs still need review. The targeted tests are regression coverage, not a replacement for the separate Java/Spring end-to-end validation phase.

Source-origin labels are shared by the navigation popup and the native workbench decorations/label services. Library and JDK tab badges use the existing decoration provider; dependency breadcrumb homes use resource label template formatters. Keep those registrations disposable and preserve original resource URIs, filenames, user decoration preferences, and existing category grouping. Never infer decompilation from the `jdt` scheme.

Breadcrumb rightmost visibility uses the native `revealLast` operation after the existing deferred dimensions and scrollbar measurements. Keep scheduling cancellable and coalesced, skip hidden controls and open pickers, and preserve active breadcrumb keyboard navigation. Do not reverse DOM order or rebuild scrolling. Run the native breadcrumb control/widget tests when adapting this integration.

Native breadcrumbs require a filesystem provider and are hidden for Java `jdt:` content-provider documents. The active dependency therefore also has a persistent status-bar source entry; do not register a fake filesystem provider or overwrite the editor banner to force breadcrumbs. Verify library/JDK badges, artifact versions, workspace detection (including remote folders), origin filtering, and source-entry cleanup when switching back to workspace editors.
