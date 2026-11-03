# IntelliJ Java Development Defaults

This fork uses the existing local IntelliJ Islands Dark palette, JetBrains Icons Enhanced 2.3.0, and IntelliJ IDEA Keybindings 1.7.8. The first-party extension supplies the theme, editor defaults, and keybindings. Fork-owned workbench contributions provide class search and Search Everywhere using native search and command providers. The selected external extensions are copied into a separate development profile; the installed VS Code profile is not modified.

## Setup and Launch

Use the Node version in the repository's `.nvmrc` and install repository dependencies with pnpm as usual. Then run:

```sh
node scripts/intellij/setup.ts
./scripts/code-intellij.sh /path/to/java-project
```

Setup reads the exact versions in `scripts/intellij/extensions.json` from `~/.vscode/extensions`. Use `--source /another/extensions-directory` to select another installation. Missing versions, missing pack dependencies, and incompatible platform builds produce an error before extensions are copied. Setup detects SDKMAN JDKs and configures Java project runtimes separately from the Java language server's bundled runtime. Existing profile settings and keybindings take precedence; comments are preserved. Close the IntelliJ development profile before rerunning setup.

The development profile lives under `.profile-oss/intellij/` and contains its own extensions, settings, keybindings, and shared storage. The launcher runs the repository's incremental source build before normal launch preparation. This first launch can download Electron and compile the workbench and built-in extensions. Subsequent launches reuse unchanged outputs.

The extension stack includes Java language support, debugger, test runner, project management, Maven, Gradle, Spring Boot Tools, Initializr, and Boot Dashboard. Setup reuses locally installed copies; it does not enable an extension marketplace or implement distributable packaging. The source VS Code installation remains independent.

## Refreshing a Running Development Instance

After source edits, run `pnpm run build-fast --client-only`. For edits to existing client modules, use Cmd+Shift+A and select Developer: Reload Window. When a change adds or removes a CSS module, fully quit Code - OSS with Cmd+Q and relaunch with `./scripts/code-intellij.sh`. The development main process caches the CSS module import map; a window reload cannot refresh that cache. A stale map can produce a CSS MIME-type error and prevent the workbench from loading. The new navigation popup stylesheet requires this full restart the first time it is added.

## Navigation and Keyboard Behavior

- Cmd+click and Cmd+B use language-provider definitions, including dependency sources. At the sole declaration, the existing alternative action finds usages.
- Cmd+Option+B navigates to implementations. Multiple Java definition, declaration, type, implementation, and usage destinations open an anchored popup with file/line labels and source snippets. Filter by file or path, narrow to Current File, navigate with the arrow keys, press Enter to open, or Escape to cancel. Open Results expands into the existing full Peek view. Explicit Peek commands remain available.
- Cmd+Option+F7 opens the same compact usages popup. Cmd+click/Cmd+B at a declaration retains the declaration-to-usages fallback.
- The popup stays within the active editor and opens above the symbol when space below is limited. Results use a bounded scrolling viewport. Drag the bottom-right grip to resize the popup; drag the dividers in the File / Source / Path header to resize columns. Focus these handles and use arrow keys (Shift for larger steps); double-click resets their sizes. Icons appear only in category headings, with compact count badges and borders between sections. Result rows use a darker background than section headings. The initial result is not painted as selected while the filter has focus. Collapsing sections preserves the opening position, constrained to the editor bounds. File / Source / Path headings have a contrasting background and share column boundaries with the result rows. Labels inherit the native workbench UI font; snippets follow the active editor font family and size. Hover a result to preview up to five source lines around the reference, with the matching line highlighted. Previews share the popup’s top layer so they render above it.
- Reference results are grouped by type: Implementations, Production Usages, Test Usages, Documentation References, Declarations, Imports, and Configuration / Resource References. Empty categories are omitted. Other References contains results without enough provider metadata or source to classify. Groups show counts, collapse with Left/Right or Enter, and keep the existing result-row design. Group by Type toggles grouping; Current File and path filtering apply to all categories. Header totals count references, including definitions and documentation, rather than presenting them all as executable usages.
- Implementations and declarations come from language-provider targets. Documentation classification recognizes JavaDoc comments while ignoring comment markers inside Java strings/text blocks. Test usage detection follows conventional test source roots and Java test class names, rather than a complete build-system test model. Semantic implementation/declaration roles take precedence over file location: a test implementation stays under Implementations. Configuration/resource categories cover locations returned by the provider; grouping does not discover additional Spring relationships.
- Cmd+O searches classes, interfaces, enums, and records. Cmd+Shift+O searches files. Cmd+Option+O searches workspace symbols. Cmd+F12 searches the current file's structure.
- Cmd+Shift+B navigates to the type declaration. Cmd+U invokes Java's super-implementation navigation when its language server is ready.
- Option+F7 finds usages. Cmd+Option+Left/Right navigates backward/forward. Option+Enter opens quick fixes. Shift+F6 renames. Cmd+Option+L formats.
- Double Shift opens Search Everywhere with combined file, workspace-symbol, and action results. Files, editor history, and actions appear independently while slower language-provider results load. Class search preserves native lazy symbol resolution; actions preserve native history and error reporting. Cmd+Shift+A opens the action-only picker. Search uses native VS Code pickers rather than IntelliJ's tabbed popup layout.
- Option+click retains multi-cursor behavior. Cmd+Option+click retains VS Code's open-beside behavior. New destinations use persistent tabs rather than replacing a preview tab.

The existing keymap handles editing, run/debug, and tool-window shortcuts. Setup adds higher-priority corrections for Show Usages, Search Everywhere, class search, workspace symbol search, and the macOS type-declaration shortcut. Explicit user bindings still win.

## Upstream Syncing

The fork uses an blue seated cat on a white app tile for desktop and web branding. The shared SVG, regeneration command, and existing-bundle refresh instructions are documented under Fork Branding in the [sync guide](../../scripts/intellij/UPSTREAM-SYNC.md). Empty-editor watermarks retain their theme-specific monochrome treatment.

The popup, search contribution, setup, and theme live in fork-owned modules. Six small upstream integration points are documented in [the sync guide](../../scripts/intellij/UPSTREAM-SYNC.md), along with the required behavior checks and regression-test commands. The guide includes the earlier changes from this chat. This reduces merge friction; upstream API and lifecycle changes can still require adaptation.

## Scope

This phase provides tooling setup, appearance defaults, keymaps, and core navigation changes. Deeper Java/Spring workflow polish, distribution and extension licensing review, and end-to-end validation against representative Spring applications are deferred to the next phase. Theme colors do not reproduce IntelliJ's Islands layout geometry or controls.
