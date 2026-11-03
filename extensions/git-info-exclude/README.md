# Git Info Exclude

Right-click files or folders in Source Control to add local ignore rules. Explorer offers these rules plus Stage Changes, Discard Changes, and Add to .gitignore under Git. Multi-selection is supported.

Local excludes use Git’s common directory for linked worktrees and never modify tracked files or untrack files already in the index. Patterns are anchored to the repository root and escape Git wildcard characters.

Adapted from kyroxen/vscode-git-info-exclude (MIT). The fork registers the commands in `extensions/git/src/intellij/gitInfoExclude.ts` to reuse native repository resolution, staging, discard confirmation, and refresh behavior. This extension supplies only menu contributions.
