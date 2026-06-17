# Remote (SFTP) browsing & preview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the active tab is an SSH session, browse the remote filesystem over Tabby's SFTP connection (rooted at the remote working directory) and preview remote `.md` files; local terminals keep working exactly as in v0.1.1.

**Architecture:** Introduce a `FileSource` abstraction (`LocalFileSource` over Node `fs`, `SftpFileSource` over Tabby's `SFTPSession`) so the browser and preview are source-agnostic. A `SourceResolver` picks the source from the active tab. Shared pure helpers (`classifyEntries`, `decodeUtf8`) are reused by both. The preview tab receives a `loader` thunk so it never knows local vs remote.

**Tech Stack:** TypeScript, Angular 15, `tabby-core`/`tabby-terminal` (duck-typed), `marked`/`DOMPurify`/`highlight.js`, webpack UMD, Jest (ts-jest, jsdom).

**Spec:** `docs/superpowers/specs/2026-06-16-remote-sftp-browsing-design.md`

## Global Constraints

- Built and run against **Tabby 1.0.234** (Angular 15). Keep the v0.1.1 fixes intact: tab components call `super(injector)` with the `@ts-ignore` (stale typings); components call `ChangeDetectorRef.detectChanges()` after any `await` of filesystem/SFTP I/O (those continuations resolve outside Angular's zone); the file-browser modal is initialized via an explicit method (NgbModal runs `ngOnInit` before inputs are assigned).
- **No new runtime dependency** on `tabby-ssh` or `russh`. Reach the SSH tab by duck-typing (`(tab as any).sshSession?.openSFTP`) and declare minimal local interfaces for the SFTP shapes.
- SFTP read mode is the constant **`SFTP_OPEN_READ = 1`** (`SSH_FXF_READ` / `russh.OPEN_READ`, verified from the native binding).
- Remote paths are **POSIX** even when Tabby runs on Windows — use `path.posix` for remote path math.
- `MAX_PREVIEW_BYTES` (10 MB) cap applies to remote reads **both** via `stat` and **during** the read loop.
- Markdown filter (dirs + `.md`/`.markdown`, dirs first) is identical for local and remote.
- Commit messages: the repo has secret-scanning pre-commit/pre-push hooks — never use `--no-verify`.
- Work happens on branch `feat/remote-sftp` (already checked out).

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/markdownRenderer.ts` | modify | `RenderOptions.baseDir: string \| null`; `null` ⇒ drop all `<img>` (the remote image-skip mechanism) |
| `src/directoryListing.ts` | modify | extract pure `classifyEntries(raw)`; `listDirectory` becomes the local wrapper |
| `src/fileReader.ts` | unchanged | `decodeUtf8`, `PreviewError`, `MAX_PREVIEW_BYTES` reused as-is |
| `src/fileSource.ts` | create | `FileSource` interface, `LocalFileSource`, `SftpFileSource`, minimal SFTP interfaces, `SFTP_OPEN_READ` |
| `src/sourceResolver.ts` | create | pure `resolveSource(deps)` + Angular `SourceResolver` service (replaces `cwdResolver.ts`) |
| `src/cwdResolver.ts` | delete (Task 6) | superseded by `sourceResolver.ts` |
| `src/fileBrowser.component.ts` | modify | driven by a `FileSource` via `init(source)`; returns `{ path, source }` |
| `src/buttonProvider.ts` | modify | resolve a `FileSource`; open preview with `{ title, loader, baseDir }` |
| `src/previewTab.component.ts` | modify | inputs `{ title, loader, baseDir }`; render via `loader()` |
| `test/markdownRenderer.spec.ts` | modify | add `baseDir: null` drops images |
| `test/directoryListing.spec.ts` | modify | add `classifyEntries` pure tests |
| `test/fileSource.spec.ts` | create | `SftpFileSource` list/read/parentOf + cap + symlink; `LocalFileSource` delegation |
| `test/sourceResolver.spec.ts` | create | `resolveSource` branch logic (replaces `cwdResolver.spec.ts`) |
| `test/cwdResolver.spec.ts` | delete (Task 6) | replaced |

---

## Task 1: Renderer — `baseDir: null` drops images

**Files:**
- Modify: `src/markdownRenderer.ts`
- Test: `test/markdownRenderer.spec.ts`

**Interfaces:**
- Produces: `interface RenderOptions { baseDir: string | null }`; `renderMarkdown(md: string, opts: RenderOptions): string` — when `opts.baseDir === null`, every `<img>` has its `src` removed.

- [ ] **Step 1: Add the failing tests** to `test/markdownRenderer.spec.ts` (inside the existing `describe('renderMarkdown', ...)`):

```ts
  it('drops all images when baseDir is null (remote source)', () => {
    const html = renderMarkdown('![a](img/a.png)\n\n![b](https://x/y.png)', { baseDir: null })
    expect(html).not.toContain('img/a.png')
    expect(html).not.toContain('https://x/y.png')
    expect(html).not.toContain('src=')
  })
  it('still resolves relative images when baseDir is a real dir', () => {
    const html = renderMarkdown('![a](img/a.png)', { baseDir: '/docs/project' })
    expect(html).toContain('file:///docs/project/img/a.png')
  })
```

- [ ] **Step 2: Run, expect FAIL** — `npx jest test/markdownRenderer.spec.ts` — the null-baseDir test fails (current code calls `resolveLocalImage(src, null)` → resolves against cwd).

- [ ] **Step 3: Implement** — in `src/markdownRenderer.ts`, change the interface and the IMG branch of the hook:

```ts
export interface RenderOptions {
  baseDir: string | null
}
```
and in the sanitize hook, replace the IMG handling with:
```ts
    if (node.tagName === 'IMG') {
      const rewritten = options.baseDir === null
        ? null
        : resolveLocalImage(node.getAttribute('src') || '', options.baseDir)
      if (rewritten) {
        node.setAttribute('src', rewritten)
      } else {
        node.removeAttribute('src')
      }
    }
```
(Leave `resolveLocalImage` and everything else unchanged.)

- [ ] **Step 4: Run, expect PASS** — `npx jest test/markdownRenderer.spec.ts` — all tests pass (the new two plus the existing image tests).

- [ ] **Step 5: Commit**
```bash
git add src/markdownRenderer.ts test/markdownRenderer.spec.ts
git commit -m "feat: renderer drops images when baseDir is null (remote previews)"
```

---

## Task 2: Extract pure `classifyEntries`

**Files:**
- Modify: `src/directoryListing.ts`
- Test: `test/directoryListing.spec.ts`

**Interfaces:**
- Produces: `interface RawEntry { name: string; path: string; isDirectory: boolean; clickable: boolean }`; `classifyEntries(raw: RawEntry[]): DirEntry[]` — keeps directories and `.md`/`.markdown` files (clickable only), drops everything else, dirs-first then alphabetical. `listDirectory` keeps its existing signature/behavior.
- Consumes (later tasks): `DirEntry`, `RawEntry`, `classifyEntries` from `./directoryListing`.

- [ ] **Step 1: Add failing tests** to `test/directoryListing.spec.ts`:

```ts
import { classifyEntries, RawEntry } from '../src/directoryListing'

describe('classifyEntries', () => {
  const raw: RawEntry[] = [
    { name: 'b.md', path: '/x/b.md', isDirectory: false, clickable: true },
    { name: 'sub', path: '/x/sub', isDirectory: true, clickable: true },
    { name: 'a.md', path: '/x/a.md', isDirectory: false, clickable: true },
    { name: 'c.txt', path: '/x/c.txt', isDirectory: false, clickable: true },
    { name: 'broken', path: '/x/broken', isDirectory: false, clickable: false },
    { name: 'note.MARKDOWN', path: '/x/note.MARKDOWN', isDirectory: false, clickable: true },
  ]
  it('keeps dirs + .md/.markdown, drops others, dirs first then alphabetical', () => {
    expect(classifyEntries(raw).map(e => e.name)).toEqual(['sub', 'a.md', 'b.md', 'note.MARKDOWN'])
  })
  it('drops a non-clickable (broken) non-md entry', () => {
    expect(classifyEntries([{ name: 'broken', path: '/x/broken', isDirectory: false, clickable: false }])).toEqual([])
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx jest test/directoryListing.spec.ts` — `classifyEntries` not exported.

- [ ] **Step 3: Implement** — in `src/directoryListing.ts`, add the `RawEntry` interface and `classifyEntries`, and rewrite `listDirectory` to use it. Replace the body of `listDirectory` and add the new exports:

```ts
export interface RawEntry {
  name: string
  path: string
  isDirectory: boolean
  clickable: boolean
}

export function classifyEntries(raw: RawEntry[]): DirEntry[] {
  const entries: DirEntry[] = []
  for (const r of raw) {
    if (r.isDirectory) {
      entries.push({ name: r.name, path: r.path, isDirectory: true, clickable: r.clickable })
    } else if (r.clickable && MD_EXT.includes(path.extname(r.name).toLowerCase())) {
      entries.push({ name: r.name, path: r.path, isDirectory: false, clickable: true })
    }
  }
  return sortEntries(entries)
}

export async function listDirectory(dir: string, fsImpl: FsLike = fs.promises): Promise<DirEntry[]> {
  const dirents = await fsImpl.readdir(dir, { withFileTypes: true })
  const raw: RawEntry[] = []
  for (const d of dirents) {
    const full = path.join(dir, d.name)
    let isDirectory = d.isDirectory()
    let clickable = true
    if (d.isSymbolicLink()) {
      try {
        const real = await fsImpl.realpath(full)
        const st = await fsImpl.stat(real)
        isDirectory = st.isDirectory()
      } catch {
        isDirectory = false
        clickable = false
      }
    }
    raw.push({ name: d.name, path: full, isDirectory, clickable })
  }
  return classifyEntries(raw)
}
```
(Keep the existing `DirEntry`, `MD_EXT`, `FsLike`, and `sortEntries` exactly as they are.)

- [ ] **Step 4: Run, expect PASS** — `npx jest test/directoryListing.spec.ts` — the new `classifyEntries` tests AND all existing `listDirectory`/`sortEntries` tests pass (behavior is unchanged).

- [ ] **Step 5: Commit**
```bash
git add src/directoryListing.ts test/directoryListing.spec.ts
git commit -m "refactor: extract pure classifyEntries; listDirectory wraps it"
```

---

## Task 3: `FileSource` interface + `LocalFileSource`

**Files:**
- Create: `src/fileSource.ts`
- Test: `test/fileSource.spec.ts`

**Interfaces:**
- Produces:
  - `interface FileSource { readonly start: string; readonly notice?: string; readonly allowImages: boolean; list(dir: string): Promise<DirEntry[]>; read(path: string): Promise<string>; parentOf(dir: string): string }`
  - `class LocalFileSource implements FileSource` — `allowImages = true`; `list` = `listDirectory`; `read` = `readMarkdownFile`; `parentOf` = `path.dirname`.
  - minimal SFTP interfaces `SftpFile`, `SftpFileHandle`, `SftpLike` (used by Task 4).
  - `const SFTP_OPEN_READ = 1`.
- Consumes: `DirEntry`, `RawEntry`, `classifyEntries` (Task 2); `readMarkdownFile`, `decodeUtf8`, `PreviewError`, `MAX_PREVIEW_BYTES` from `./fileReader`; `listDirectory` from `./directoryListing`.

- [ ] **Step 1: Write failing tests** `test/fileSource.spec.ts`:

```ts
import { LocalFileSource } from '../src/fileSource'

describe('LocalFileSource', () => {
  it('exposes start/notice/allowImages and POSIX-or-local parentOf', () => {
    const s = new LocalFileSource('/home/me', 'hi')
    expect(s.start).toBe('/home/me')
    expect(s.notice).toBe('hi')
    expect(s.allowImages).toBe(true)
    expect(s.parentOf('/home/me/docs')).toBe('/home/me')
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx jest test/fileSource.spec.ts` — module not found.

- [ ] **Step 3: Implement** `src/fileSource.ts`:

```ts
import * as path from 'path'
import { DirEntry } from './directoryListing'
import { listDirectory } from './directoryListing'
import { readMarkdownFile } from './fileReader'

export interface FileSource {
  readonly start: string
  readonly notice?: string
  readonly allowImages: boolean
  list(dir: string): Promise<DirEntry[]>
  read(filePath: string): Promise<string>
  parentOf(dir: string): string
}

export class LocalFileSource implements FileSource {
  readonly allowImages = true
  constructor(readonly start: string, readonly notice?: string) {}
  list(dir: string): Promise<DirEntry[]> {
    return listDirectory(dir)
  }
  read(filePath: string): Promise<string> {
    return readMarkdownFile(filePath)
  }
  parentOf(dir: string): string {
    return path.dirname(dir)
  }
}

// --- Minimal SFTP shapes (duck-typed against Tabby's russh-backed SFTPSession) ---
export interface SftpFile {
  name: string
  fullPath: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
}
export interface SftpFileHandle {
  read(): Promise<Uint8Array>
  close(): Promise<void>
}
export interface SftpLike {
  readdir(p: string): Promise<SftpFile[]>
  stat(p: string): Promise<SftpFile>
  open(p: string, mode: number): Promise<SftpFileHandle>
}
/** SFTP SSH_FXF_READ open flag (== russh.OPEN_READ; verified against Tabby 1.0.234). */
export const SFTP_OPEN_READ = 1
```

- [ ] **Step 4: Run, expect PASS** — `npx jest test/fileSource.spec.ts`.

- [ ] **Step 5: Commit**
```bash
git add src/fileSource.ts test/fileSource.spec.ts
git commit -m "feat: FileSource interface + LocalFileSource + SFTP shapes"
```

---

## Task 4: `SftpFileSource`

**Files:**
- Modify: `src/fileSource.ts`
- Test: `test/fileSource.spec.ts`

**Interfaces:**
- Produces: `class SftpFileSource implements FileSource` — `allowImages = false`; `list` reads via `SftpLike.readdir`, stats symlinks to classify, then `classifyEntries`; `read` size-caps (stat + mid-stream), loops `handle.read()`, decodes UTF-8; `parentOf` = `path.posix.dirname`. Constructor `(sftp: SftpLike, start: string, notice?: string)`.

- [ ] **Step 1: Write failing tests** — append to `test/fileSource.spec.ts`:

```ts
import { SftpFileSource, SftpFile } from '../src/fileSource'
import { PreviewError } from '../src/fileReader'

function file(name: string, over: Partial<SftpFile> = {}): SftpFile {
  return { name, fullPath: '/r/' + name, isDirectory: false, isSymlink: false, size: 1, ...over }
}

describe('SftpFileSource.list', () => {
  it('keeps dirs + .md, drops others, resolves a symlinked dir via stat', async () => {
    const sftp = {
      readdir: async () => [
        file('a.md'),
        file('notes.txt'),
        file('sub', { isDirectory: true }),
        file('linkdir', { isSymlink: true }),
        file('linkbad', { isSymlink: true }),
      ],
      stat: async (p: string) => p.endsWith('linkdir') ? file('linkdir', { isDirectory: true }) : Promise.reject(new Error('ENOENT')),
      open: async () => { throw new Error('unused') },
    }
    const names = (await new SftpFileSource(sftp as any, '/r').list('/r')).map(e => e.name)
    expect(names).toEqual(['linkdir', 'sub', 'a.md'])
  })
})

describe('SftpFileSource.read', () => {
  function handleOf(chunks: Uint8Array[]) {
    let i = 0
    return { read: async () => (i < chunks.length ? chunks[i++] : new Uint8Array(0)), close: async () => {} }
  }
  it('accumulates chunks and decodes UTF-8', async () => {
    const sftp = {
      readdir: async () => [], stat: async () => file('x.md', { size: 5 }),
      open: async () => handleOf([Buffer.from('# h', 'utf8'), Buffer.from('i', 'utf8')]),
    }
    expect(await new SftpFileSource(sftp as any, '/r').read('/r/x.md')).toBe('# hi')
  })
  it('rejects (PreviewError) when stat size exceeds the cap', async () => {
    const sftp = { readdir: async () => [], stat: async () => file('big.md', { size: 20 * 1024 * 1024 }), open: async () => handleOf([]) }
    await expect(new SftpFileSource(sftp as any, '/r').read('/r/big.md')).rejects.toThrow(PreviewError)
  })
  it('rejects (PreviewError) mid-stream when chunks exceed the cap despite a small stat size', async () => {
    const big = new Uint8Array(6 * 1024 * 1024)
    const sftp = { readdir: async () => [], stat: async () => file('x.md', { size: 1 }), open: async () => handleOf([big, big]) }
    await expect(new SftpFileSource(sftp as any, '/r').read('/r/x.md')).rejects.toThrow(PreviewError)
  })
})

describe('SftpFileSource.parentOf', () => {
  it('uses POSIX semantics', () => {
    expect(new SftpFileSource({} as any, '/r').parentOf('/home/me/docs')).toBe('/home/me')
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx jest test/fileSource.spec.ts` — `SftpFileSource` not exported.

- [ ] **Step 3: Implement** — append to `src/fileSource.ts` (and extend its imports):

Change the top imports to also pull the shared helpers:
```ts
import { DirEntry, RawEntry, classifyEntries } from './directoryListing'
import { readMarkdownFile, decodeUtf8, PreviewError, MAX_PREVIEW_BYTES } from './fileReader'
```
(keep `listDirectory` import too). Then append:
```ts
export class SftpFileSource implements FileSource {
  readonly allowImages = false
  constructor(private sftp: SftpLike, readonly start: string, readonly notice?: string) {}

  async list(dir: string): Promise<DirEntry[]> {
    const files = await this.sftp.readdir(dir)
    const raw: RawEntry[] = []
    for (const f of files) {
      let isDirectory = f.isDirectory
      let clickable = true
      if (f.isSymlink) {
        try {
          const st = await this.sftp.stat(f.fullPath)
          isDirectory = st.isDirectory
        } catch {
          isDirectory = false
          clickable = false
        }
      }
      raw.push({ name: f.name, path: f.fullPath, isDirectory, clickable })
    }
    return classifyEntries(raw)
  }

  async read(filePath: string): Promise<string> {
    const st = await this.sftp.stat(filePath)
    if (st.size > MAX_PREVIEW_BYTES) {
      throw new PreviewError(`File is too large to preview (${(st.size / (1024 * 1024)).toFixed(1)} MB > 10 MB limit).`)
    }
    const handle = await this.sftp.open(filePath, SFTP_OPEN_READ)
    try {
      const chunks: Buffer[] = []
      let total = 0
      for (;;) {
        const chunk = await handle.read()
        if (!chunk || chunk.length === 0) {
          break
        }
        total += chunk.length
        if (total > MAX_PREVIEW_BYTES) {
          throw new PreviewError('File is too large to preview (exceeds 10 MB).')
        }
        chunks.push(Buffer.from(chunk))
      }
      return decodeUtf8(Buffer.concat(chunks))
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  parentOf(dir: string): string {
    return path.posix.dirname(dir)
  }
}
```

- [ ] **Step 4: Run, expect PASS** — `npx jest test/fileSource.spec.ts` then the full suite `npx jest` (no regressions).

- [ ] **Step 5: Commit**
```bash
git add src/fileSource.ts test/fileSource.spec.ts
git commit -m "feat: SftpFileSource (list+symlink stat, capped chunked read, posix parentOf)"
```

---

## Task 5: `SourceResolver` (pure `resolveSource` + Angular service)

**Files:**
- Create: `src/sourceResolver.ts`
- Test: `test/sourceResolver.spec.ts`

**Interfaces:**
- Produces:
  - `interface ResolveDeps { isSshTab; openSFTP(): Promise<SftpLike>; getRemoteCwd(): Promise<string|null>; isLocalTerminal; supportsWorkingDirectory; getLocalCwd(): Promise<string|null>; pathExists(p): Promise<boolean>; homedir: string; makeSftp(sftp, start, notice?): FileSource; makeLocal(start, notice?): FileSource }`
  - `async function resolveSource(d: ResolveDeps): Promise<FileSource>`
  - `@Injectable({providedIn:'root'}) class SourceResolver { resolve(): Promise<FileSource> }`
- Consumes: `FileSource`, `SftpLike`, `LocalFileSource`, `SftpFileSource` (Tasks 3-4).

> Added ALONGSIDE the existing `cwdResolver.ts` (deleted in Task 6) so the build stays green.

- [ ] **Step 1: Write failing tests** `test/sourceResolver.spec.ts`:

```ts
import { resolveSource, ResolveDeps } from '../src/sourceResolver'

function deps(over: Partial<ResolveDeps>): ResolveDeps {
  return {
    isSshTab: false,
    openSFTP: async () => ({} as any),
    getRemoteCwd: async () => null,
    isLocalTerminal: true,
    supportsWorkingDirectory: true,
    getLocalCwd: async () => '/work',
    pathExists: async () => true,
    homedir: '/home/me',
    makeSftp: (_s, start, notice) => ({ kind: 'sftp', start, notice } as any),
    makeLocal: (start, notice) => ({ kind: 'local', start, notice } as any),
    ...over,
  }
}

describe('resolveSource', () => {
  it('SSH tab with remote cwd → sftp source at that cwd, no notice', async () => {
    const r: any = await resolveSource(deps({ isSshTab: true, getRemoteCwd: async () => '/remote/dir' }))
    expect(r).toEqual({ kind: 'sftp', start: '/remote/dir', notice: undefined })
  })
  it('SSH tab without remote cwd → sftp source at "." with a notice', async () => {
    const r: any = await resolveSource(deps({ isSshTab: true, getRemoteCwd: async () => null }))
    expect(r.kind).toBe('sftp'); expect(r.start).toBe('.'); expect(r.notice).toBeDefined()
  })
  it('SSH tab whose openSFTP rejects → local source at home', async () => {
    const r: any = await resolveSource(deps({ isSshTab: true, openSFTP: async () => { throw new Error('no sftp') } }))
    expect(r).toEqual({ kind: 'local', start: '/home/me', notice: undefined })
  })
  it('local terminal with a valid cwd → local source at cwd', async () => {
    const r: any = await resolveSource(deps({ getLocalCwd: async () => '/work' }))
    expect(r).toEqual({ kind: 'local', start: '/work', notice: undefined })
  })
  it('local terminal whose cwd does not exist → local source at home', async () => {
    const r: any = await resolveSource(deps({ pathExists: async () => false }))
    expect(r.kind).toBe('local'); expect(r.start).toBe('/home/me')
  })
  it('non-terminal → local source at home', async () => {
    const r: any = await resolveSource(deps({ isLocalTerminal: false, supportsWorkingDirectory: false }))
    expect(r.kind).toBe('local'); expect(r.start).toBe('/home/me')
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `npx jest test/sourceResolver.spec.ts` — module not found.

- [ ] **Step 3: Implement** `src/sourceResolver.ts`:

```ts
import { Injectable } from '@angular/core'
import { AppService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import * as fs from 'fs'
import * as os from 'os'
import { FileSource, SftpLike, LocalFileSource, SftpFileSource } from './fileSource'

const REMOTE_HOME_NOTICE =
  'Showing remote home directory — the shell didn’t report its working directory.'
const REMOTE_PROFILE_TYPES = ['ssh', 'telnet', 'serial']

export interface ResolveDeps {
  isSshTab: boolean
  openSFTP: () => Promise<SftpLike>
  getRemoteCwd: () => Promise<string | null>
  isLocalTerminal: boolean
  supportsWorkingDirectory: boolean
  getLocalCwd: () => Promise<string | null>
  pathExists: (p: string) => Promise<boolean>
  homedir: string
  makeSftp: (sftp: SftpLike, start: string, notice?: string) => FileSource
  makeLocal: (start: string, notice?: string) => FileSource
}

export async function resolveSource(d: ResolveDeps): Promise<FileSource> {
  if (d.isSshTab) {
    try {
      const sftp = await d.openSFTP()
      let cwd: string | null = null
      try {
        cwd = await d.getRemoteCwd()
      } catch {
        cwd = null
      }
      return cwd ? d.makeSftp(sftp, cwd) : d.makeSftp(sftp, '.', REMOTE_HOME_NOTICE)
    } catch {
      return d.makeLocal(d.homedir)
    }
  }
  if (d.isLocalTerminal && d.supportsWorkingDirectory) {
    let cwd: string | null = null
    try {
      cwd = await d.getLocalCwd()
    } catch {
      cwd = null
    }
    if (cwd && (await d.pathExists(cwd))) {
      return d.makeLocal(cwd)
    }
  }
  return d.makeLocal(d.homedir)
}

@Injectable({ providedIn: 'root' })
export class SourceResolver {
  constructor(private app: AppService) {}

  async resolve(): Promise<FileSource> {
    const tab: any = this.app.activeTab
    const ssh = tab?.sshSession
    const isSshTab = !!ssh && typeof ssh.openSFTP === 'function'
    const isTerminal = tab instanceof BaseTerminalTabComponent
    const session = isTerminal ? (tab as any).session : null
    const profileType: string | undefined = tab?.profile?.type
    const isLocalTerminal =
      isTerminal && !isSshTab && !REMOTE_PROFILE_TYPES.includes(profileType ?? '')

    return resolveSource({
      isSshTab,
      openSFTP: () => ssh.openSFTP(),
      getRemoteCwd: () => session?.getWorkingDirectory?.() ?? Promise.resolve(null),
      isLocalTerminal,
      supportsWorkingDirectory: !!session?.supportsWorkingDirectory?.(),
      getLocalCwd: () => session?.getWorkingDirectory?.() ?? Promise.resolve(null),
      pathExists: async (p: string) => {
        try {
          await fs.promises.access(p, fs.constants.R_OK)
          return true
        } catch {
          return false
        }
      },
      homedir: os.homedir(),
      makeSftp: (sftp, start, notice) => new SftpFileSource(sftp, start, notice),
      makeLocal: (start, notice) => new LocalFileSource(start, notice),
    })
  }
}
```

- [ ] **Step 4: Run, expect PASS** — `npx jest test/sourceResolver.spec.ts` (the `@angular/core`/`tabby-core`/`tabby-terminal` imports resolve to the existing jest `moduleNameMapper` stubs, so the module loads and the pure `resolveSource` tests run). Then `npx jest` (full suite green). Then `npx tsc --noEmit -p tsconfig.json` (clean — `cwdResolver.ts` still present, so nothing is broken yet).

- [ ] **Step 5: Commit**
```bash
git add src/sourceResolver.ts test/sourceResolver.spec.ts
git commit -m "feat: SourceResolver — pick a FileSource from the active tab (SSH/local)"
```

---

## Task 6: Wire `FileSource` through the UI (browser + button + preview)

> These four edits are interdependent (the `init(source)` signature, the `{ path, source }` return, and the `{ title, loader, baseDir }` preview inputs must all agree), so they're one task to keep the build green. No unit tests (Angular/Tabby); verified by `tsc` + the full jest suite + Task 7's runtime check.

**Files:**
- Modify: `src/fileBrowser.component.ts`, `src/buttonProvider.ts`, `src/previewTab.component.ts`
- Delete: `src/cwdResolver.ts`, `test/cwdResolver.spec.ts`

**Interfaces:**
- Consumes: `SourceResolver` (Task 5), `FileSource` (Task 3).
- Produces: `FileBrowserComponent.init(source: FileSource)`; `FileBrowserComponent.result` resolves to a file path; the chosen source is the one the browser was initialized with.

- [ ] **Step 1: Rewrite `src/fileBrowser.component.ts`** to drive off a `FileSource`:

```ts
import { ChangeDetectorRef, Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { DirEntry } from './directoryListing'
import { FileSource } from './fileSource'

@Component({
  selector: 'markdown-file-browser',
  template: require('./fileBrowser.component.pug'),
  styles: [require('./fileBrowser.component.scss')],
})
export class FileBrowserComponent {
  dir = ''
  notice?: string
  entries: DirEntry[] = []
  error: string | null = null
  private source!: FileSource

  constructor(public activeModal: NgbActiveModal, private cdr: ChangeDetectorRef) {}

  /** Called by the opener right after the modal is created (NgbModal runs ngOnInit
   * before inputs are assigned, so we navigate explicitly here). */
  init(source: FileSource): void {
    this.source = source
    this.notice = source.notice
    void this.navigate(source.start)
  }

  canGoUp(): boolean {
    return !!this.dir && this.source.parentOf(this.dir) !== this.dir
  }

  up(): void {
    void this.navigate(this.source.parentOf(this.dir))
  }

  async navigate(target: string): Promise<void> {
    try {
      this.entries = await this.source.list(target)
      this.dir = target
      this.error = null
    } catch (e: any) {
      this.error = `Cannot open ${target}: ${e?.message ?? e}`
      this.entries = []
    }
    // fs/SFTP continuations run outside Angular's zone, so refresh the view manually.
    this.cdr.detectChanges()
  }

  open(entry: DirEntry): void {
    if (!entry.clickable) {
      return
    }
    if (entry.isDirectory) {
      void this.navigate(entry.path)
    } else {
      this.activeModal.close(entry.path)
    }
  }
}
```
(The `.pug`/`.scss` are unchanged — `dir`, `notice`, `error`, `entries`, `canGoUp()`, `up()`, `open()` all still exist.)

- [ ] **Step 2: Rewrite `src/buttonProvider.ts`** to resolve a source and pass a loader to the preview:

```ts
import { Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, AppService } from 'tabby-core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { SourceResolver } from './sourceResolver'
import { FileBrowserComponent } from './fileBrowser.component'
import { MarkdownPreviewTabComponent } from './previewTab.component'
import { markdownIcon } from './icon'

@Injectable()
export class MarkdownToolbarButtonProvider extends ToolbarButtonProvider {
  constructor(
    private app: AppService,
    private ngbModal: NgbModal,
    private sourceResolver: SourceResolver,
  ) {
    super()
  }

  provide(): ToolbarButton[] {
    return [{
      icon: markdownIcon,
      title: 'Preview markdown file',
      weight: 5,
      click: () => this.openBrowser(),
    }]
  }

  private async openBrowser(): Promise<void> {
    const source = await this.sourceResolver.resolve()
    const modal = this.ngbModal.open(FileBrowserComponent, { size: 'lg' })
    modal.componentInstance.init(source)

    let filePath: string | undefined
    try {
      filePath = await modal.result
    } catch {
      return // dismissed / escaped
    }
    if (filePath) {
      this.app.openNewTab({
        type: MarkdownPreviewTabComponent,
        inputs: {
          title: source.parentOf(filePath) === filePath ? filePath : filePath.split(/[\\/]/).pop() || filePath,
          loader: () => source.read(filePath as string),
          baseDir: source.allowImages ? sourceDirname(source, filePath) : null,
        },
      })
    }
  }
}

function sourceDirname(source: { parentOf(p: string): string }, filePath: string): string {
  return source.parentOf(filePath)
}
```
NOTE: the title is the file's basename. To avoid OS-specific `path.basename` on remote POSIX paths, derive it with `filePath.split(/[\\/]/).pop()`. The `baseDir` for local previews is the file's directory via the source's `parentOf` (local = `path.dirname`); for remote, `null` (images dropped).

- [ ] **Step 3: Update `src/previewTab.component.ts`** inputs to `{ title, loader, baseDir }`:

Replace the fields, `ngOnInit`, and `load()` (keep `super(injector)`, `onFrameLoad`, `detectChanges`):
```ts
  title = ''
  loader: () => Promise<string> = async () => ''
  baseDir: string | null = null
  error: string | null = null
  @ViewChild('frame', { static: false }) frame!: ElementRef<HTMLIFrameElement>

  constructor(private cdr: ChangeDetectorRef, injector: Injector) {
    // tabby-core's runtime BaseTabComponent requires an Injector; published typings say none.
    // @ts-ignore
    super(injector)
  }

  async ngOnInit(): Promise<void> {
    this.setTitle(this.title)
  }

  async ngAfterViewInit(): Promise<void> {
    await this.load()
  }

  async load(): Promise<void> {
    this.error = null
    try {
      const md = await this.loader()
      const body = renderMarkdown(md, { baseDir: this.baseDir })
      const doc = buildPreviewDocument(body, markdownCss)
      this.frame.nativeElement.srcdoc = doc
    } catch (e: any) {
      this.error = e instanceof PreviewError ? e.message : `Could not read file: ${e?.message ?? e}`
    }
    // loader (fs/SFTP) continuations run outside Angular's zone — refresh the view.
    this.cdr.detectChanges()
  }
```
Remove the now-unused `import * as path from 'path'` and the `filePath`/`readMarkdownFile` imports if they're no longer referenced. Keep `renderMarkdown`, `buildPreviewDocument`, `markdownCss`, `PreviewError`, `shell`, `ChangeDetectorRef`, `Injector`, `ElementRef`, `ViewChild`. (`PreviewError` is still imported from `./fileReader` for the `instanceof` check.)

- [ ] **Step 4: Delete the obsolete resolver**
```bash
git rm src/cwdResolver.ts test/cwdResolver.spec.ts
```

- [ ] **Step 5: Verify types + tests**
Run: `npx tsc --noEmit -p tsconfig.json` → Expected: clean (exit 0).
Run: `npx jest` → Expected: all suites pass (the pure suites; `cwdResolver.spec.ts` is gone, `sourceResolver.spec.ts` covers the resolver).

- [ ] **Step 6: Commit**
```bash
git add src/fileBrowser.component.ts src/buttonProvider.ts src/previewTab.component.ts
git commit -m "feat: drive browser/preview off FileSource; remove cwdResolver"
```

---

## Task 7: Build + headless runtime verification (local regression + remote SSH)

**Files:** none (verification only)

- [ ] **Step 1: Full build**
Run: `npm run build` → Expected: `webpack ... compiled` with no errors; `dist/index.js` produced.
Run: `npx jest` → Expected: all green.

- [ ] **Step 2: Deploy into the headless test Tabby**
```bash
PLUG=/home/ctabone/.config/tabby/plugins/node_modules/tabby-markdown-preview
cp package.json "$PLUG/"; cp dist/index.js dist/index.js.map "$PLUG/dist/"
```

- [ ] **Step 3: Local regression (must pass)** — using the CDP harness from the v0.1.1 debugging (`/tmp/cdp-preview.js` pattern): launch headless Tabby (`xvfb-run -a <tabby> --no-sandbox --disable-gpu --remote-debugging-port=9222 --enable-logging --debug`), create a `$HOME/_mdp_local_test.md`, click the toolbar button, confirm the browser lists entries (crumb = `$HOME`), click the `.md`, and confirm the preview iframe `srcdoc` contains the rendered heading. Expected: identical to v0.1.1 behavior (no regression from the refactor).

- [ ] **Step 4: Remote SSH verification (best-effort headless; else manual)** — confirm a local SSH server is reachable (`ssh -o BatchMode=yes localhost true`; if not, install/enable `openssh-server` and add the user's key to `~/.ssh/authorized_keys`). Add a Tabby SSH profile to `~/.config/tabby/config.yaml` pointing at `localhost` with key auth, launch headless Tabby, open the SSH tab (CDP: click the profile / use `app.openNewTabRaw`), then click the markdown button and confirm: the browser lists the **remote** directory (a `.md` placed in the SSH user's home/cwd appears), and clicking it previews the remote file. Capture `[plugin]`/console output via `--enable-logging`. If SSH-to-localhost cannot be configured in the sandbox, document that and defer remote sign-off to manual verification on Chris's Windows Tabby (SSH into a real host, click the button, confirm remote browse + preview).

- [ ] **Step 5: Commit any build/verification notes** (none expected; `dist/` is gitignored).

---

## Self-Review notes (for the implementer)
- **Spec coverage:** FileSource abstraction (T3/T4), local source (T3), SFTP source incl. symlink stat + capped chunked read + posix parentOf (T4), renderer image-skip fix C1 (T1), classifyEntries extraction (T2), SourceResolver with SSH/openSFTP-reject/null-sshSession/local branches (T5), browser+button+preview wiring + loader thunk + cwdResolver removal (T6), build + local regression + remote verification (T7). Every spec section maps to a task.
- **Hard-won v0.1.1 fixes preserved:** `super(injector)`+`@ts-ignore` (T6 preview), `detectChanges()` after async in both components (T6), explicit `init()` (T6 browser).
- **Type consistency:** `FileSource`/`SftpLike`/`SFTP_OPEN_READ` defined in T3, consumed in T4/T5/T6; `classifyEntries`/`RawEntry` defined in T2, consumed in T4; `resolveSource`/`SourceResolver` defined in T5, consumed in T6.
- **Known runtime-only risks (T7 confirms):** exact `SSHTabComponent.sshSession`/`session` member access via `activeTab`; `readdir('.')`/`getWorkingDirectory()` behavior on the test SSH server; `mode = 1` reading a real remote file.
