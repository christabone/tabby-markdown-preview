# Remote (SFTP) browsing & preview — Design

**Date:** 2026-06-16
**Status:** Approved design, revised after Opus 4.8 review (verified against Tabby 1.0.234 runtime)
**Builds on:** the v0.1.1 local plugin (`2026-06-16-tabby-markdown-preview-design.md`)

## Summary

Extend `tabby-markdown-preview` so that, when the active tab is an **SSH session**,
the toolbar button browses the **remote** filesystem over Tabby's existing SSH/SFTP
connection — rooted at the remote shell's working directory — and previews the
chosen remote `.md` file. Local terminals keep the existing local-`fs` behavior.
The browser applies the **same filter on both** (directories + `.md`/`.markdown`,
directories first).

## Confirmed decisions

| Decision | Choice |
|----------|--------|
| Trigger | Same top-toolbar button (placement unchanged); behavior auto-detected from the active tab |
| SSH tab | Browse remotely via SFTP, preview remote files |
| Remote start dir | `getWorkingDirectory()` (absolute remote path) when available; else remote home (`.`) with a notice. **cwd is `null` in most setups (needs remote shell integration), so the home fallback is the EXPECTED common path, not an error.** |
| Local tab | Unchanged (local `fs`) |
| Non-SSH remote (telnet/serial), null `sshSession`, non-terminal | Fall back to local `$HOME` |
| Remote file filter | Directories + `.md`/`.markdown` only, dirs first (same as local) |
| Remote images | **Dropped** — `renderMarkdown` gets an explicit "no local images" mode (NOT the empty-`baseDir` trick, which is broken — see Renderer change) |
| SFTP read mode | `sftp.open(path, 1)` — `SSH_FXF_READ` (`russh.OPEN_READ === 1`, verified) |
| Reload | Re-reads via a loader thunk; fails gracefully if the SSH session has closed |
| tabby-ssh / russh dependency | **None** — duck-type the SSH tab + declare minimal local interfaces; the read flag is a documented local constant (avoids stale npm typings AND avoids our external plugin needing to resolve `russh`) |

## Verified runtime API (Tabby 1.0.234)

- `SSHTabComponent` (active tab when SSH'd): `sshSession: SSHSession | null` (for SFTP),
  `session: SSHShellSession | null` (`supportsWorkingDirectory()` /
  `getWorkingDirectory(): Promise<string|null>` → **remote** cwd, where
  `getWorkingDirectory()` returns `reportedCWD ?? null` — null unless the remote
  shell reports its dir).
- `SSHSession.openSFTP(): Promise<SFTPSession>`.
- `SFTPSession`: `readdir(p): Promise<SFTPFile[]>`, `stat(p): Promise<SFTPFile>`,
  `open(p, mode): Promise<SFTPFileHandle>`, `readlink(p)`, `closed$: Observable<void>`.
- `SFTPFile`: `{ name, fullPath, isDirectory, isSymlink, mode, size, modified }` —
  note `isDirectory` reflects the dirent type, so for a **symlink** it is NOT the
  link target's type.
- `SFTPFileHandle`: `read(): Promise<Uint8Array>` (a chunk; loop until
  `chunk.length === 0`), `close()`.
- `russh.OPEN_READ === 1` (verified from the native binding; equals SFTP
  `SSH_FXF_READ`). Tabby's own `SFTPSession.download()` does
  `open(path, OPEN_READ)` then loops `read()` until empty — we mirror that.
- `BaseTabComponent.getRecoveryToken()` returns `null` by default; the preview tab
  does not override it, so tabs are already non-recoverable across restarts — the
  non-serializable `loader` thunk introduces **no** recovery regression.

We declare **minimal local TypeScript interfaces** for these shapes and reach the
tab via `as any` duck-typing (`tab.sshSession?.openSFTP`), adding no dependency on
`tabby-ssh`/`russh`.

## Architecture

### New unit: `FileSource` (`src/fileSource.ts`)
```ts
interface FileSource {
  readonly start: string                 // initial directory to open
  readonly notice?: string               // optional user-facing note
  readonly allowImages: boolean          // true for local, false for remote
  list(dir: string): Promise<DirEntry[]> // already filtered (dirs + .md) and sorted
  read(path: string): Promise<string>    // UTF-8 text, size-capped
  parentOf(dir: string): string          // for "up" navigation
}
```
- **`LocalFileSource`** — delegates to the existing fs-based listing/reading;
  `parentOf` = `path.dirname`; `allowImages = true`.
- **`SftpFileSource`** — wraps an `SFTPSession`; `allowImages = false`:
  - `list(dir)`: `sftp.readdir(dir)` → for each `SFTPFile`, classify; **for symlink
    entries (`isSymlink`), call `sftp.stat(fullPath)` (follows the link) to learn
    if the target is a directory** (so symlinked dirs aren't dropped); on stat
    error mark the entry non-clickable. Then the **shared `classifyEntries`**
    (dirs first, `.md`/`.markdown` only).
  - `read(path)`: `sftp.stat(path)` (pre-check size cap), then
    `sftp.open(path, SFTP_OPEN_READ)` and loop `handle.read()` accumulating
    `Uint8Array` chunks. **Enforce `MAX_PREVIEW_BYTES` during accumulation** (a
    running total — `stat.size` can be stale/under-reported), aborting with
    `PreviewError`. `close()` the handle. Concatenate → `Buffer` → shared
    `decodeUtf8`. `open()` on a non-file (e.g., a name that's actually a dir)
    rejecting → surface as `PreviewError`.
  - `parentOf`: **`path.posix.dirname`** — remote paths are POSIX even on Windows;
    this matches Tabby's own SFTP panel `goUp()`.
  - `SFTP_OPEN_READ = 1` is a documented local constant (`// SSH_FXF_READ / russh.OPEN_READ`).

### Renderer change (`src/markdownRenderer.ts`) — fixes the image-skip correctness bug
`RenderOptions.baseDir` becomes `string | null`. When `baseDir` is `null`, the
sanitize hook **removes every `<img src>`** (no local resolution attempted) — this
is how remote previews drop images. **Do NOT pass an empty string** to skip images:
`resolveLocalImage('img/x.png', '')` resolves against `process.cwd()` and yields a
bogus local `file://` URL (verified) — a correctness and minor info-disclosure bug.
Local previews pass the file's real directory (images work as today); remote
previews pass `null`.

### Refactor (extract shared pure logic)
- `directoryListing.ts`: extract a **pure** `classifyEntries(records): DirEntry[]`
  that takes already-classified `{ name, path, isDirectory, clickable }` records
  and applies the markdown filter + dirs-first sort. **The per-entry symlink I/O
  stays in each source's wrapper** (local: `realpath`+`stat`; remote: `sftp.stat`)
  — `classifyEntries` does no I/O and is trivially unit-testable. `listDirectory`
  becomes the local wrapper that does its fs I/O then calls `classifyEntries`.
- `fileReader.ts`: keep `decodeUtf8`, `PreviewError`, `MAX_PREVIEW_BYTES`; both
  sources reuse `decodeUtf8` and the cap. (Remote also enforces the cap mid-stream.)

### `SourceResolver` (`src/sourceResolver.ts`, evolves `cwdResolver.ts`)
Decides the `FileSource` from `appService.activeTab`. Pure decision logic stays
injected/testable; the Angular service wires Tabby/Node in.
1. **SSH tab** — `const ssh = (tab as any).sshSession`; if `ssh && typeof
   ssh.openSFTP === 'function'`: `try { const sftp = await ssh.openSFTP() }` —
   **on rejection or null `sshSession`, fall back to local `$HOME`** (don't
   throw). `cwd = await (tab as any).session?.getWorkingDirectory?.()`;
   `start = cwd || '.'`; `notice` set when `cwd` was null (the common case).
   Returns `SftpFileSource(sftp, start, notice)`.
2. **Local terminal** — `tab instanceof BaseTerminalTabComponent` and not an SSH
   tab: validated local cwd → `LocalFileSource`.
3. **Otherwise** — `LocalFileSource` at `os.homedir()`.

This preserves the existing local behavior and its unit tests (the
local-vs-`$HOME` decision logic is unchanged; only the SSH branch is added and the
old "ssh → $HOME" gate is replaced by "ssh → SFTP, with $HOME as the failure
fallback").

### `FileBrowserComponent` (modified)
- Receives a `FileSource` via `init(source)` (keeping the explicit-`init` pattern
  that fixed the v0.1.1 NgbModal input race). Uses `source.start/notice/list/parentOf`.
- On selecting a file, returns `{ path, source }` to the opener.
- **Keeps `ChangeDetectorRef.detectChanges()` after async work** — both fs and SFTP
  continuations resolve outside Angular's zone, so this is still required.

### `MarkdownToolbarButtonProvider` (modified)
`openBrowser()`: `resolver.resolve()` → `FileSource`; open the modal with
`init(source)`; on a returned `{path, source}`, open the preview tab with inputs
`{ title: basename(path), loader: () => source.read(path), baseDir: source.allowImages ? dirnameOf(path) : null }`
(local `dirname` vs `path.posix.dirname` chosen by source).

### `MarkdownPreviewTabComponent` (modified)
Inputs become `{ title, loader, baseDir }`. `ngOnInit` calls `setTitle(this.title)`.
`load()` does `const md = await this.loader()`, then `renderMarkdown(md, { baseDir })`,
then the sandboxed-iframe srcdoc. **Preserves all v0.1.1 fixes:** `super(injector)`
(with the `@ts-ignore` for the stale typings), and `this.cdr.detectChanges()` after
`await this.loader()` (SFTP `read()` continuations also resolve outside the zone).
Reload re-invokes `loader`. CSP/sanitization/`Injector` unchanged.

## Data flow
```
button click
  → SourceResolver.resolve()                 → FileSource (Local | Sftp) + start + notice + allowImages
  → FileBrowserComponent.init(source)         → source.list(start)  (filtered + sorted)
  → navigate (source.list / source.parentOf)
  → pick a .md → { path, source }
  → openNewTab(MarkdownPreviewTabComponent, {
        title: basename(path),
        loader: () => source.read(path),
        baseDir: source.allowImages ? dirname(path) : null,   // null ⇒ images dropped
    })
  → preview: md = await loader() → renderMarkdown(md,{baseDir}) → sanitized → iframe srcdoc
```

## Error handling

| Condition | Behavior |
|-----------|----------|
| `sshSession` null (still connecting) / `openSFTP()` rejects | Resolver falls back to local `$HOME` (no throw) |
| Remote `getWorkingDirectory()` null (common) | Start at remote home (`.`) with the expected notice |
| Remote `readdir` error (perms, missing dir) | Inline error in browser; stay at previous dir (as local) |
| Remote symlink whose `stat` fails | Entry shown non-clickable |
| `open()` on a non-file / unreadable remote file | `PreviewError` in the preview tab |
| Remote file too large (`stat` OR mid-stream cap) | `PreviewError` ("too large") — enforced during the read loop |
| Non-UTF8 remote file | Same strict `PreviewError` as local (conscious v1 choice; no lossy fallback) |
| SSH session closed before Reload | `loader()` rejects → preview shows a read error |

## Scope

**In scope (v1):** SSH remote browsing rooted at the remote working dir (home
fallback); remote `.md` preview (text, code highlighting, dark CSP iframe);
markdown-only filter on remote; local behavior unchanged.

**Out of scope (future):** remote images (fetch over SFTP and inline); live remote
watching; writing/editing remote files; SFTP for non-SSH remote types; an absolute
"remote home" breadcrumb (v1 uses `.` for the home fallback, so the breadcrumb at
home is `.` and "up from home" is intentionally inert — `path.posix.dirname('.') === '.'`).

## Testing

- **Unit (Jest, mocks):**
  - `classifyEntries` — pure filter/sort (dirs first, `.md`/`.markdown`, drop others), no I/O.
  - `SftpFileSource.list` over a mock `SFTPSession.readdir` (incl. a symlink whose
    `stat` says directory → kept; a symlink whose `stat` rejects → non-clickable;
    non-md files dropped).
  - `SftpFileSource.read` over a mock handle: multi-chunk `read()` accumulation +
    `decodeUtf8`; **mid-stream size-cap abort** when chunks exceed the cap despite a
    small/zero `stat.size`; `open()` rejection → `PreviewError`.
  - `SftpFileSource.parentOf` POSIX semantics regardless of host OS.
  - `renderMarkdown` with `baseDir: null` → all `<img>` dropped (the C1 fix);
    with a real `baseDir` → images still resolved (no local regression).
  - `SourceResolver` branches: SSH (sshSession present), SSH with `openSFTP`
    rejection → `$HOME`, null `sshSession` → `$HOME`, local, other.
- **Headless integration:** on this Linux box, drive headless Tabby (the CDP
  harness from the v0.1.1 debugging) to SSH into **localhost**, click the button,
  confirm the remote listing renders and a remote `.md` previews. Falls back to
  manual verification on Chris's Windows Tabby.

## File structure / changes

```
src/
  fileSource.ts            (new)  FileSource + LocalFileSource + SftpFileSource + minimal SFTP/SSH interfaces + SFTP_OPEN_READ
  markdownRenderer.ts      (mod)  RenderOptions.baseDir: string|null; null ⇒ drop all <img>
  directoryListing.ts      (mod)  extract pure classifyEntries(); listDirectory wraps it (keeps local symlink I/O)
  fileReader.ts            (mod)  expose decodeUtf8 + cap for reuse (largely unchanged)
  sourceResolver.ts        (new, replaces cwdResolver.ts)  source decision (+ SSH branch) + Angular service
  fileBrowser.component.ts (mod)  init(source); drive off FileSource; return {path, source}; keep detectChanges
  buttonProvider.ts        (mod)  resolve source; open preview with {title, loader, baseDir}
  previewTab.component.ts  (mod)  inputs {title, loader, baseDir}; render via loader; keep super(injector)+detectChanges
test/
  fileSource.spec.ts       (new)  SftpFileSource list/read/parentOf + size-cap + symlink
  directoryListing.spec.ts (mod)  classifyEntries pure tests
  markdownRenderer.spec.ts (mod)  add baseDir:null drops images
  sourceResolver.spec.ts   (rename/expand cwdResolver.spec.ts)  add SSH branches
```

## Open items / preflight
- Confirm against the headless harness that a real remote `.md` reads correctly
  with `mode = 1` and that `getWorkingDirectory()`/`readdir('.')` behave as
  expected on the test SSH server (OpenSSH canonicalizes `.` to home).
- Confirm the exact member names on the runtime `SSHTabComponent` (`sshSession`,
  `session`) hold for the installed Tabby when reached via `activeTab` (verified in
  typings; re-confirm live).
