# Maintaining the IntelliJ Fork

Keep the IntelliJ implementation additive: new modules own the UI and behavior; upstream files contain only configuration support, registration, or calls into those modules. Do not copy upstream navigation, editor-opening, file-search, or command-search implementations into the fork. These continue to own provider results, editor history, source resolution, filtering, and command preconditions.

## Fork-Owned Code

- `extensions/git-info-exclude/`: Git context menus and original extension attribution; command implementation and literal ignore-pattern helpers live in `extensions/git/src/intellij/`, with coverage in `extensions/git/src/test/gitInfoExclude.test.ts`.
- `extensions/intellij-experience/`: appearance defaults, local theme, and keybindings.
- `scripts/intellij/` and `scripts/code-intellij.sh`: local extension provisioning, runtime detection, and development launch.
- `src/vs/editor/contrib/gotoSymbol/browser/intellij/`: the anchored navigation popup, its renderer, keyboard interaction, and styles.
- `src/vs/editor/contrib/gotoSymbol/browser/symbolNavigationPicker.ts`: popup adapter with a standard Quick Pick fallback for hosts without an editor anchor.
- `src/vs/workbench/contrib/intellij/`: Search Everywhere, class search, native command-picker adapter, source-origin tab decorations, breadcrumb formatters and a status-bar source entry, and registration.
- The corresponding navigation and Search Everywhere tests.

## Upstream Integration Points

These seven existing code files are the upstream behavior integration surface. Branding assets are listed separately below. New feature logic belongs in the fork-owned files above, rather than growing these hooks.

| Upstream file | Required change | What to check after syncing |
| --- | --- | --- |
| `extensions/git/src/main.ts` | Import and register the fork Git actions | Native repository resolution, stage conflict handling, discard confirmation, and disposal remain intact. Local excludes use `dotGit.commonPath ?? dotGit.path` for linked worktrees. |
| `build/lib/i18n.resources.json` | One localization entry | Strings in the separate IntelliJ workbench contribution remain discoverable. |
| `src/vs/workbench/workbench.common.main.ts` | One side-effect import | The IntelliJ contribution registers once in every supported workbench window. |
| `src/vs/editor/common/config/editorOptions.ts` | Add `pick` to navigation preference validation and descriptions | Upstream has not changed option validation or introduced an equivalent choice. Default behavior for other configurations is unchanged. |
| `src/vs/monaco.d.ts` | Add `pick` to the public navigation preference union | This declaration agrees with the editor's option type. |
| `src/vs/editor/contrib/gotoSymbol/browser/goToCommands.ts` | Import and call the picker for multiple `pick` destinations and all categorized usages, including empty or declaration-only reference results | Cancellation still prevents navigation; editor opening still uses the upstream path; the original results model is disposed exactly once; Open Results creates a Peek model containing every discovered location. |
| `src/vs/workbench/contrib/search/browser/anythingQuickAccess.ts` | Small session-initialization and file/history adapters | Upstream still owns file/history/symbol search and opening. Results resolve in the intended workspace, including remote resources. Each picker session initializes the native file-query cache and resets scoring state; slow symbols must not block files or history. |

Quick Access registration and the adapter exposing processed command picks live in fork-owned modules. There are no edits to upstream Quick Access registration, command-provider visibility, or the extension compilation list. Class search filters native workspace-symbol picks and retains their provider resolution and editor-opening handlers. Search Everywhere publishes file/history, symbol, and command results independently, preserving native command filtering, history, and error reporting.

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

Run targeted ESLint on the files changed during conflict resolution and stylelint on the popup stylesheet. The IntelliJ extension is declarative and does not require a separate TypeScript build.

Categorized usages supplement reference-provider results with definition and implementation locations, publishing each provider response independently. This is required for Java library methods whose reference results contain only the declaration. Keep empty and single-result usages routed through the picker when `pick` is configured, while preserving single-destination navigation and explicit Peek commands.

Finally, smoke-test a method call, its declaration, and an interface with multiple implementations: Cmd+click/Cmd+B, the usages popup, Cmd+Option+B, Escape, Enter, filtering, Current File, and Open Results. Verify that the back action restores the origin and that remote/dependency source locations still open. Check a narrow window and a high-contrast theme when popup layout or colors change.

Fully quit and restart Code - OSS after adding or removing CSS modules. The development main process caches their import-map entries, so Developer: Reload Window alone can fail with a CSS MIME-type error even when the source build is current. Preserve this upstream loader behavior rather than adding a fork-specific loader workaround.

This structure limits merge conflicts but cannot guarantee conflict-free syncing. Changes to upstream navigation lifecycle, provider contracts, and Quick Access APIs still need review. The targeted tests are regression coverage, not a replacement for the separate Java/Spring end-to-end validation phase.

Source-origin labels are shared by the navigation popup and the native workbench decorations/label services. Library and JDK tab badges use the existing decoration provider; dependency breadcrumb homes use resource label template formatters. Keep those registrations disposable and preserve original resource URIs, filenames, user decoration preferences, and existing category grouping. Never infer decompilation from the `jdt` scheme.

Native breadcrumbs require a filesystem provider and are hidden for Java `jdt:` content-provider documents. The active dependency therefore also has a persistent status-bar source entry; do not register a fake filesystem provider or overwrite the editor banner to force breadcrumbs. Verify library/JDK badges, artifact versions, workspace detection (including remote folders), origin filtering, and source-entry cleanup when switching back to workspace editors.
