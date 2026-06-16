# Remote (SFTP) browsing & preview — Design

**Date:** 2026-06-16
**Status:** Approved design (pre-implementation)
**Builds on:** the v0.1.1 local plugin (`2026-06-16-tabby-markdown-preview-design.md`)

## Summary

Extend `tabby-markdown-preview` so that, when the active tab is an **SSH session**,
the toolbar button browses the **remote** filesystem over Tabby's existing SSH/SFTP
connection — rooted at the remote shell's working directory — and previews the
chosen remote `.md` file. Local terminals keep the existing local-`fs` behavior.
The browser applies the **same filter on both** (directories + `.md`/`.markdown`,
directories first).

This is the v1 "out of scope: remote/SFTP" item, now in scope.

## Confirmed decisions

| Decision | Choice |
|----------|--------|
| Trigger | Same toolbar button; behavior auto-detected from the active tab |
| SSH tab | Browse remotely via SFTP, preview remote files |
| Remote start dir | Remote working directory (`getWorkingDirectory()`); fall back to remote home with a notice |
| Local tab | Unchanged (local `fs`) |
| Non-SSH remote (telnet/serial) | Fall back to local `$HOME` (no SFTP) |
| Remote file filter | Directories + `.md`/`.markdown` only, dirs first (same as local) |
| Remote images | **Skipped** in v1 (no fetching) |
| Reload | Re-reads via a loader thunk; fails gracefully if the SSH session has closed |
| tabby-ssh dependency | **None** — duck-type the SSH tab + declare minimal local interfaces (avoids stale npm typings) |

## Verified runtime API (from the installed Tabby 1.0.234)

- `SSHTabComponent` (the active tab when SSH'd) exposes:
  - `sshSession: SSHSession` — used for SFTP.
  - `session: SSHShellSession | null` — has `supportsWorkingDirectory()` and
    `getWorkingDirectory(): Promise<string|null>` returning the **remote** cwd
    (when the remote shell reports it).
- `SSHSession.openSFTP(): Promise<SFTPSession>`.
- `SFTPSession`: `readdir(p): Promise<SFTPFile[]>`, `stat(p): Promise<SFTPFile>`,
  `open(p, mode): Promise<SFTPFileHandle>`, `readlink(p)`.
- `SFTPFile`: `{ name, fullPath, isDirectory, isSymlink, mode, size, modified }`.
- `SFTPFileHandle`: `read(): Promise<Uint8Array>` (a chunk; loop until empty), `close()`.

We declare **minimal local TypeScript interfaces** matching these shapes and
access the tab via `as any` duck-typing (`tab.sshSession?.openSFTP`), so we add no
dependency on `tabby-ssh` and avoid the stale-typings problem that broke v0.1.0.

## Architecture

### New unit: `FileSource` (`src/fileSource.ts`)
A small interface that hides local-vs-remote from the UI:
```ts
interface FileSource {
  readonly start: string                 // initial directory to open
  readonly notice?: string               // optional user-facing note
  list(dir: string): Promise<DirEntry[]> // already filtered (dirs + .md) and sorted
  read(path: string): Promise<string>    // UTF-8 text, size-capped
  parentOf(dir: string): string          // for "up" navigation
}
```
Two implementations:
- **`LocalFileSource`** — delegates to the existing `listDirectory` (fs) and
  `readMarkdownFile` (fs); `parentOf` = `path.dirname`.
- **`SftpFileSource`** — wraps an `SFTPSession`:
  - `list`: `sftp.readdir(dir)` → map `SFTPFile` → `DirEntry`, then the **shared**
    classify/sort/filter (dirs first, `.md`/`.markdown` only; symlinked entries
    classified via the `isDirectory`/`isSymlink` flags SFTP already returns).
  - `read`: `sftp.stat(path)` for the size cap, then `sftp.open(path, READ)` and
    loop `handle.read()` accumulating `Uint8Array` chunks → `Buffer` → the
    **shared** `decodeUtf8` (BOM strip + strict UTF-8).
  - `parentOf`: **`path.posix.dirname`** — remote paths are POSIX even when the
    user's Tabby runs on Windows.

### Refactor (extract shared pure logic)
- `directoryListing.ts`: extract the classify/sort/markdown-filter into a pure
  function `classifyEntries(raw): DirEntry[]` that both sources reuse. The
  existing fs-based `listDirectory` becomes a thin local wrapper around it.
- `fileReader.ts`: keep `decodeUtf8`, `PreviewError`, `MAX_PREVIEW_BYTES`; both
  sources reuse `decodeUtf8` and the size check.

### `SourceResolver` (`src/sourceResolver.ts`, evolves `cwdResolver.ts`)
Decides the `FileSource` from `appService.activeTab`:
1. **SSH tab** — `const ssh = (tab as any).sshSession`; if `ssh?.openSFTP` is a
   function: `const sftp = await ssh.openSFTP()`; `cwd = await (tab as any).session?.getWorkingDirectory?.()`;
   `start = cwd || '.'` (`'.'` = remote home); `notice` set when `cwd` was null.
   Returns `new SftpFileSource(sftp, start, notice)`.
2. **Local terminal** — `tab instanceof BaseTerminalTabComponent` and not remote:
   local cwd (validated) → `LocalFileSource`.
3. **Otherwise** — `LocalFileSource` at `os.homedir()`.

The pure decision logic (which branch, fallbacks) stays unit-testable with
injected dependencies, as today.

### `FileBrowserComponent` (modified)
- Receives a `FileSource` via `init(source)` (instead of a bare `dir` + local
  listing). Uses `source.start`, `source.notice`, `source.list`, `source.parentOf`.
- On selecting a file, it returns the chosen file path **and the source** to the
  opener (so the preview can read through the same source).
- Keeps the `ChangeDetectorRef.detectChanges()` after async work (still needed —
  both fs and SFTP continuations run outside Angular's zone).

### `MarkdownToolbarButtonProvider` (modified)
`openBrowser()`: `resolver.resolve()` → `FileSource`; open the modal with
`init(source)`; on a returned path, open the preview tab with inputs
`{ title, loader: () => source.read(path), baseDir }` where `baseDir` is the
file's directory for **local** (enables images) and **empty for remote** (images
skipped for free).

### `MarkdownPreviewTabComponent` (modified)
Inputs become `{ title, loader, baseDir }`. `load()` calls `await this.loader()`
to get the markdown text (local or remote — it doesn't know which), renders with
`renderMarkdown(md, { baseDir })`, and shows it in the sandboxed iframe. Reload
re-invokes `loader`. Everything else (CSP, sanitization, `Injector` super,
detectChanges) is unchanged.

## Data flow
```
button click
  → SourceResolver.resolve()                      → FileSource (Local or Sftp) + start + notice
  → FileBrowserComponent.init(source)             → source.list(start) (filtered + sorted)
  → user navigates (source.list / source.parentOf)
  → user picks a .md → { path, source }
  → openNewTab(MarkdownPreviewTabComponent, {
        title: basename(path),
        loader: () => source.read(path),
        baseDir: local ? dirname(path) : '',
    })
  → preview: await loader() → renderMarkdown(md,{baseDir}) → sanitized → iframe srcdoc
```

## Error handling

| Condition | Behavior |
|-----------|----------|
| `openSFTP()` fails (no SFTP subsystem / perms) | Browser shows an inline error; no tab opens |
| Remote `readdir` error (perms, missing dir) | Inline error in browser; stay at previous dir (as local) |
| Remote `getWorkingDirectory()` null | Start at remote home (`.`) with a notice |
| Remote file too large / non-UTF8 | Same `PreviewError` messages as local (size cap + decode) |
| SSH session closed before Reload | `loader()` rejects → preview shows a read error |
| Non-SSH / non-terminal tab | Local `$HOME` (unchanged) |

## Scope

**In scope (v1):**
- SSH remote browsing rooted at the remote working directory (home fallback).
- Remote `.md` preview (text, code highlighting; dark CSP iframe — same as local).
- Markdown-only filter on remote (dirs + `.md`/`.markdown`).
- Local behavior unchanged.

**Out of scope (future):**
- Remote images (fetch over SFTP and inline).
- Live remote file watching / auto-reload.
- Writing/editing remote files.
- SFTP for non-SSH remote types (telnet/serial have no SFTP).

## Testing

- **Unit (Jest, mocks):**
  - `classifyEntries` shared filter/sort (dirs first, `.md`/`.markdown`, drop others).
  - `SftpFileSource.list` over a mock `SFTPSession.readdir` returning `SFTPFile`s
    (incl. symlinks, non-md files dropped).
  - `SftpFileSource.read` over a mock handle: chunked `read()` accumulation,
    UTF-8 decode, size-cap rejection via mock `stat`.
  - `SftpFileSource.parentOf` uses POSIX semantics regardless of host OS.
  - `SourceResolver` branch logic (SSH vs local vs other) with injected fakes.
- **Headless integration:** on this Linux box, drive headless Tabby (CDP harness
  from the v0.1.1 debugging) to SSH into **localhost**, click the button, and
  confirm the remote listing renders and a remote `.md` previews. Falls back to
  manual verification on Chris's Windows Tabby.

## File structure / changes

```
src/
  fileSource.ts            (new)  FileSource interface, LocalFileSource, SftpFileSource,
                                  minimal SFTP/SSH-tab interfaces
  directoryListing.ts      (mod)  extract pure classifyEntries(); listDirectory wraps it
  fileReader.ts            (mod)  expose decodeUtf8 + size check for reuse (mostly unchanged)
  sourceResolver.ts        (new, replaces cwdResolver.ts) source decision + Angular service
  fileBrowser.component.ts (mod)  drive off a FileSource; return {path, source}
  buttonProvider.ts        (mod)  resolve source; open preview with a loader thunk
  previewTab.component.ts  (mod)  inputs {title, loader, baseDir}; render via loader
test/
  fileSource.spec.ts       (new)  SftpFileSource list/read/parentOf
  classifyEntries.spec.ts  (new or fold into directoryListing.spec.ts)
  sourceResolver.spec.ts   (rename/expand cwdResolver.spec.ts)
```

## Open items / preflight
- Confirm the SFTP `open` read-mode flag value used by Tabby's `russh` SFTP
  (`open(path, mode)`); verify during implementation against the installed Tabby
  (the headless harness can confirm a successful remote read).
- Confirm `getWorkingDirectory()` returns an absolute remote path usable directly
  as the SFTP `start` dir; if it returns null often, the home (`.`) fallback is
  the common path.
