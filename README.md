# Cat-Code A Fork Of Visual Studio Code - Open Source ("Code - OSS")

<p align="center">
  <img alt="Blue cat application icon for this fork" src="resources/intellij/cat-app.svg" width="128">
</p>

Compared with Microsoft's VS Code, this fork adds an Jetbrains-inspired experience for Java, Spring Boot, and JavaScript/TypeScript projects while retaining the Code - OSS foundation.

* **Jetbrains-style navigation:** Cmd+click/Cmd+B, implementation navigation, and a custom usages popup backed by native language providers and editor-opening behavior.
* **Categorized references:** separate, collapsible sections for implementations, production usages, tests, documentation, declarations, imports, configuration/resources, and unresolved references. Empty sections are omitted.
* **Navigation popup:** file/path/source filtering, Current File scope, source snippets, code previews on hover, resizable popup and columns, stable positioning, section icons and count badges, darker result rows, and neutral selection colors.
* **Dependency identification:** library/JDK source information through native tab decorations, breadcrumb labels where supported, and a persistent status-bar source entry. Original resource URIs and filenames are preserved.
* **Search Everywhere and Go to Class:** combined file, symbol, and action results publish independently as providers respond. Class search uses native symbol resolution and opening handlers.
* **Jetbrains keymaps:** shortcuts for navigation, usages, search, rename, formatting, and quick fixes, with explicit user bindings taking precedence.
* **Isolated tooling setup:** provisions pinned, locally installed Java language, debugger, test, Maven, Gradle, and Spring Boot extensions, or JavaScript tooling including ESLint and Prettier, into a separate development profile. Extensions are copied from an existing installation rather than bundled or downloaded; versions live in the [setup manifest](scripts/intellij/extensions.json).
* **JavaScript project tools:** nearest-package detection, monorepo-aware package scripts through native tasks, and access to debugging, testing, and configured formatting/linting integrations. Project detection does not execute scripts or silently install dependencies.
* **Appearance and branding:** bundled Islands Dark theme, JetBrains icons, Jetbrains keymaps, and a blue cat application icon across desktop and web assets. General defaults are Dark Modern and Seti; Java projects can select Islands Dark and JetBrains icons through native workspace settings. The navigation popup retains its Islands palette across dark themes.
* **Breadcrumb refinements:** minimal bottom padding and post-layout scrolling to keep the rightmost/current element visible while preserving keyboard navigation.
* **Git convenience:** additional repository context-menu actions, including local Git info/exclude support. See the [Git action guide](extensions/git-info-exclude/README.md).

Prepare the isolated development profile using the [setup and appearance guide](extensions/intellij-experience/README.md). The [upstream sync guide](scripts/intellij/UPSTREAM-SYNC.md) documents fork-owned modules, the small upstream integration points, branding regeneration, and regression checks.

The fork ships theme-scoped color defaults for Dark Modern and Islands Dark: editor background `#18191C`, breadcrumb background `#222429`, and breadcrumb bottom border `#3A3D43`. Explicit user color settings take precedence. Java theme/icon selection uses per-project workspace settings; new Java projects need that override once. Other personal settings in the ignored development profile remain local.

Java language intelligence, debugging, Spring support, editor opening, and search providers continue to come from VS Code and its extensions. Deeper Java/Spring workflow polish, distributable packaging, and end-to-end validation against representative Spring applications remain a later phase.

[![Feature Requests](https://img.shields.io/github/issues/microsoft/vscode/feature-request.svg)](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
[![Bugs](https://img.shields.io/github/issues/microsoft/vscode/bug.svg)](https://github.com/microsoft/vscode/issues?utf8=✓&q=is%3Aissue+is%3Aopen+label%3Abug)

## The Repository

This repository ("`Code - OSS`") is where we (Microsoft) develop the [Visual Studio Code](https://code.visualstudio.com) product together with the community. Not only do we work on code and issues here, but we also publish our [roadmap](https://github.com/microsoft/vscode/wiki/Roadmap), [monthly iteration plans](https://github.com/microsoft/vscode/wiki/Iteration-Plans), and our [endgame plans](https://github.com/microsoft/vscode/wiki/Running-the-Endgame). This source code is available to everyone under the standard [MIT license](https://github.com/microsoft/vscode/blob/main/LICENSE.txt).

## Visual Studio Code

<p align="center">
  <img alt="VS Code in action" src="https://github.com/user-attachments/assets/56af271c-949d-454c-a3ea-16188c063414">
</p>

[Visual Studio Code](https://code.visualstudio.com) is a distribution of the `Code - OSS` repository with Microsoft-specific customizations released under a traditional [Microsoft product license](https://code.visualstudio.com/License/).

[Visual Studio Code](https://code.visualstudio.com) combines the simplicity of a code editor with what developers need for their core edit-build-debug cycle. It provides comprehensive code editing, navigation, and understanding support along with lightweight debugging, a rich extensibility model, and lightweight integration with existing tools.

Visual Studio Code is updated monthly with new features and bug fixes. You can download it for Windows, macOS, and Linux on the [Visual Studio Code website](https://code.visualstudio.com/Download). To get the latest releases every day, install the [Insiders build](https://code.visualstudio.com/insiders).

## Contributing

There are many ways in which you can participate in this project, for example:

* [Submit bugs and feature requests](https://github.com/microsoft/vscode/issues), and help us verify them as they are checked in
* Review [source code changes](https://github.com/microsoft/vscode/pulls)
* Review the [documentation](https://github.com/microsoft/vscode-docs) and make pull requests for anything from typos to new content.

If you are interested in fixing issues and contributing directly to the codebase, please see the document [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute), which covers the following:

* [How to build and run from source](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
* [The development workflow, including debugging and running tests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#debugging)
* [Coding guidelines](https://github.com/microsoft/vscode/wiki/Coding-Guidelines)
* [Submitting pull requests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#pull-requests)
* [Finding an issue to work on](https://github.com/microsoft/vscode/wiki/How-to-Contribute#where-to-contribute)
* [Contributing to translations](https://aka.ms/vscodeloc)

## Feedback

* Ask a question on [Stack Overflow](https://stackoverflow.com/questions/tagged/vscode)
* [Request a new feature](CONTRIBUTING.md)
* Upvote [popular feature requests](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
* [File an issue](https://github.com/microsoft/vscode/issues)
* Connect with the extension author community on [GitHub Discussions](https://github.com/microsoft/vscode-discussions/discussions) or [Slack](https://aka.ms/vscode-dev-community)
* Follow [@code](https://x.com/code) and let us know what you think!

See our [wiki](https://github.com/microsoft/vscode/wiki/Feedback-Channels) for a description of each of these channels and information on some other available community-driven channels.

## Related Projects

Many of the core components and extensions to VS Code live in their own repositories on GitHub. For example, the [node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter](https://github.com/microsoft/vscode-mono-debug) repositories are separate from each other. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).

## Bundled Extensions

VS Code includes a set of built-in extensions located in the [extensions](extensions) folder, including grammars and snippets for many languages. Extensions that provide rich language support (inline suggestions, Go to Definition) for a language have the suffix `language-features`. For example, the `json` extension provides coloring for `JSON` and the `json-language-features` extension provides rich language support for `JSON`.

## Development Container

This repository includes a Visual Studio Code Dev Containers / GitHub Codespaces development container.

* For [Dev Containers](https://aka.ms/vscode-remote/download/containers), use the **Dev Containers: Clone Repository in Container Volume...** command, which creates a Docker volume for better disk I/O on macOS and Windows.
  * If you already have VS Code and Docker installed, you can also click [here](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/microsoft/vscode) to get started. This will cause VS Code to automatically install the Dev Containers extension if needed, clone the source code into a container volume, and spin up a dev container for use.

* For Codespaces, install the [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) extension in VS Code, and use the **Codespaces: Create New Codespace** command.

Docker / the Codespace should have at least **4 cores and 6 GB of RAM (8 GB recommended)** to run a full build. See the [development container README](.devcontainer/README.md) for more information.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information, see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license.
