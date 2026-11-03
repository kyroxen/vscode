# Git Info Exclude

Right-click files or folders in Source Control to add local ignore rules. Explorer offers these rules plus Stage Changes, Discard Changes, and Add to .gitignore under Git. Multi-selection is supported for those actions. Git > Compare With... compares one selected file with a local branch, remote branch, tag, or entered commit/revision using the native Git filesystem and diff editor. The current side includes unsaved editor contents. Files absent from the chosen revision compare against an empty baseline; the comparison uses the same file path and does not follow historical renames. Cancelling the picker leaves the editor unchanged. No checkout or Git state changes occur.

Local excludes use Git’s common directory for linked worktrees and never modify tracked files or untrack files already in the index. Patterns are anchored to the repository root and escape Git wildcard characters.

Adapted from kyroxen/vscode-git-info-exclude (MIT). The fork registers the commands in `extensions/git/src/intellij/gitInfoExclude.ts` to reuse native repository resolution, staging, discard confirmation, and refresh behavior. This extension supplies only menu contributions.

The Explorer submenu uses the native `config.git.enabled` context key. Folder and multi-selection contexts hide the file comparison action. Read-only comparison does not share the mutation queue used by exclude, stage, and discard actions.
