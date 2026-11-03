# IntelliJ Java Development Defaults

This fork defaults to Dark Modern and VS Code’s Seti file icons. It also includes the local IntelliJ Islands Dark palette, JetBrains Icons Enhanced 2.3.0, and IntelliJ IDEA Keybindings 1.7.8. The first-party extension supplies the theme, editor defaults, and keybindings. Fork-owned workbench contributions provide class search and Search Everywhere using native search and command providers. The selected external extensions are copied into a separate development profile; the installed VS Code profile is not modified.

## Setup and Launch

Use the Node version in the repository's `.nvmrc` and install repository dependencies with pnpm as usual. Then run:

```sh
node scripts/intellij/setup.ts
./scripts/code-intellij.sh /path/to/java-project
```

Setup reads the exact versions in `scripts/intellij/extensions.json` from `~/.vscode/extensions`. Use `--source /another/extensions-directory` to select another installation. Missing versions, missing pack dependencies, and incompatible platform builds produce an error before extensions are copied. Setup detects SDKMAN JDKs and configures Java project runtimes separately from the Java language server's bundled runtime. Existing profile settings and keybindings take precedence; comments are preserved. Close the IntelliJ development profile before rerunning setup.

The development profile lives under `.profile-oss/intellij/` and contains its own extensions, settings, keybindings, and shared storage. The launcher runs the repository's incremental source build before normal launch preparation. This first launch can download Electron and compile the workbench and built-in extensions. Subsequent launches reuse unchanged outputs.

The extension stack includes Java language support, debugger, test runner, project management, Maven, Gradle, Spring Boot Tools, Initializr, and Boot Dashboard. Setup reuses locally installed copies; it does not enable an extension marketplace or implement distributable packaging. The source VS Code installation remains independent.

## Installed macOS App

The packaged fork can be installed as `/Applications/CatCode.app` and launched from Finder, Spotlight, or the Dock. Normal launches do not need a terminal or rebuild the source. It uses its own CatCode settings and extensions; the first local installation can copy the IntelliJ development profile into those locations. Later source changes require a new packaged build. Build the Apple Silicon app with `pnpm run gulp vscode-darwin-arm64`. See the [local installation notes](../../scripts/intellij/UPSTREAM-SYNC.md#local-macos-installation).

## Refreshing a Running Development Instance

After source edits, run `pnpm run build-fast --client-only`. For edits to existing client modules, use Cmd+Shift+A and select Developer: Reload Window. When a change adds or removes a CSS module, fully quit Code - OSS with Cmd+Q and relaunch with `./scripts/code-intellij.sh`. The development main process caches the CSS module import map; a window reload cannot refresh that cache. A stale map can produce a CSS MIME-type error and prevent the workbench from loading. The new navigation popup stylesheet requires this full restart the first time it is added.

## Project Appearance

Problem decorations on files and folders are disabled by default (`problems.decorations.enabled: false`), so warnings and errors do not recolor Explorer entries or add count badges. Files with errors receive a red wavy underline beneath the filename through the fork-owned Explorer contribution. Warnings stay undecorated, Git filename colors remain intact, and editor diagnostics and the Problems panel are unaffected. Disable underlines with `intellij.explorer.errorUnderlines.enabled: false`.

The title bar hides the Open in Agents Window icon and Copilot Sign In button by default, using native visibility settings. Authentication and AI features remain available. Set `chat.titleBar.openInAgentsWindow.enabled` or `chat.titleBar.signIn.enabled` to `true` to restore either control.

Java workspaces automatically use IntelliJ Islands Dark and JetBrains Icons Enhanced when those themes are installed. Detection searches all workspace folders, including nested modules and remote folders, for Maven/Gradle descriptors, root-level Java files, Java files under the root `src/`, or nested `src/main/java` and `src/test/java` sources. Isolated Java fixtures elsewhere do not classify a JavaScript project as Java. Dependency and generated directories are excluded. Mixed Java/JavaScript workspaces use the Java defaults. JavaScript, TypeScript, and unrecognized workspaces retain Dark Modern and Seti. Appearance follows the workspace, not the active editor tab.

Explicit user/profile and workspace theme or icon choices take precedence independently. Detection changes only window-local configuration defaults: it never writes `.vscode/settings.json`, executes project code, or installs extensions. Adding/removing project files or workspace folders recomputes the defaults. Disable this behavior with `"intellij.projectAppearance.enabled": false`.

Setup no longer copies `workbench.colorTheme` and `workbench.iconTheme` into profile settings. Existing profiles may still contain values generated by earlier setup runs; these cannot be distinguished safely from intentional preferences and are preserved. To enable automatic selection in such a profile, use **Reset Setting** for those two settings in the User settings editor, and remove any workspace overrides that you no longer want. Reset only the setting you want managed automatically. Existing `compliance-rule-manager` or `compliance-suite-app` workspace overrides remain effective until removed.

Both Dark Modern and Islands Dark ship editor background `#18191C`, breadcrumb background `#222429`, and breadcrumb bottom border `#3A3D43` as theme-scoped defaults. Explicit user color preferences take precedence.

## Explorer Context Menu

`New` groups native New File and New Folder actions and works from a file or folder selection. `Git` contains local excludes, Add to .gitignore, Stage Changes, Discard Changes, and Compare With... for a single file. Comparison selects a branch/tag or accepts a commit/revision, then opens the native diff against the file’s current contents without switching branches. See the [Git action guide](../git-info-exclude/README.md).

## Navigation and Keyboard Behavior

- Cmd+click and Cmd+B use language-provider definitions, including dependency sources. At the sole declaration, the existing alternative action finds usages.
- Cmd+Option+B navigates to implementations. Multiple Java definition, declaration, type, implementation, and usage destinations open an anchored popup with file/line labels and source snippets. Filter by file or path, narrow to Current File, navigate with the arrow keys, press Enter to open, or Escape to cancel. Open Results expands into the existing full Peek view. Explicit Peek commands remain available.
- Cmd+Option+F7 opens the same compact usages popup. Cmd+click/Cmd+B at a declaration retains the declaration-to-usages fallback.
- In dark themes, the popup and source previews keep the Islands surface palette, including when the editor uses Dark Modern. These color overrides are scoped to this popup; light and high-contrast themes retain their native colors. The popup stays within the active editor and opens above the symbol when space below is limited. Results use a bounded scrolling viewport. Drag the bottom-right grip to resize the popup; drag the dividers in the File / Source / Path header to resize columns. Focus these handles and use arrow keys (Shift for larger steps); double-click resets their sizes. Icons appear only in category headings, with compact count badges and borders between sections. Result rows use a darker background than section headings. The initial result is not painted as selected while the filter has focus. Collapsing sections preserves the opening position, constrained to the editor bounds. File / Source / Path headings have a contrasting background and share column boundaries with the result rows. Labels inherit the native workbench UI font; snippets follow the active editor font family and size. Hover a result to preview up to five source lines around the reference, with the matching line highlighted. Previews share the popup’s top layer so they render above it.
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

The popup, search contribution, setup, and theme live in fork-owned modules. Ten small upstream integration points are documented in [the sync guide](../../scripts/intellij/UPSTREAM-SYNC.md), along with the required behavior checks and regression-test commands. The guide includes the earlier changes from this chat. This reduces merge friction; upstream API and lifecycle changes can still require adaptation.

## Scope

This phase provides tooling setup, appearance defaults, keymaps, and core navigation changes. Deeper Java/Spring workflow polish, distribution and extension licensing review, and end-to-end validation against representative Spring applications are deferred to the next phase. Theme colors do not reproduce IntelliJ's Islands layout geometry or controls.
