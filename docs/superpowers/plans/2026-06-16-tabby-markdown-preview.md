# tabby-markdown-preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tabby terminal plugin that adds a toolbar button which opens a file browser at the active terminal's working directory and renders a chosen `.md` file as a dark, VSCode-style preview in a new tab.

**Architecture:** A single Angular `NgModule` (Tabby plugin) with four units — a `ToolbarButtonProvider`, a `CwdResolver`, an `NgbModal` file browser, and a `BaseTabComponent` preview tab. All untrusted markdown is rendered with `marked` + `marked-highlight` + `DOMPurify` and displayed inside a **sandboxed `<iframe srcdoc>` with a strict CSP** (the renderer runs with Node integration, so a sanitizer bypass would otherwise be RCE). The pure logic (rendering/sanitizing, cwd decision, directory listing, file decoding) lives in dependency-injected functions that are unit-tested with Jest; the Angular/Tabby integration is verified by building and manual testing in a Tabby dev instance.

**Tech Stack:** TypeScript, Angular (version matched to installed Tabby), `tabby-core`, `tabby-terminal`, `@ng-bootstrap/ng-bootstrap`, `marked`, `marked-highlight`, `highlight.js`, `dompurify` (≥3.2.7), webpack 5 (UMD), Jest + ts-jest (jsdom env).

**Spec:** `docs/superpowers/specs/2026-06-16-tabby-markdown-preview-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `package.json` | Plugin manifest: `tabby-plugin` keyword, deps (bundled) vs peerDeps (externalized), build/test scripts |
| `tsconfig.json` | TS compiler options |
| `webpack.config.js` | UMD build, externals, loaders (based on Tabby's example plugin) |
| `jest.config.js` | ts-jest, jsdom environment (DOMPurify needs a DOM) |
| `src/types.d.ts` | Ambient module declarations for `*.pug`, `*.scss`, `*.svg` imports |
| `src/icon.ts` | Inline SVG string for the toolbar button (`ToolbarButton.icon` is raw SVG) |
| `src/markdown-dark.scss` | GitHub-dark stylesheet, imported as a string and inlined into the iframe |
| `src/markdownRenderer.ts` | **Pure:** markdown → sanitized HTML body; relative-only image rewriting; link hardening |
| `src/previewDocument.ts` | **Pure:** wrap sanitized body + CSP + CSS into an iframe `srcdoc` document |
| `src/directoryListing.ts` | **Pure (injected fs):** read/sort/filter/symlink-classify a directory |
| `src/cwdResolver.ts` | `resolveCwd()` **pure decision fn** + `CwdResolver` Angular service wrapper |
| `src/fileReader.ts` | **Pure (injected fs):** size cap + BOM strip + strict UTF-8 decode; `PreviewError` |
| `src/previewTab.component.ts` / `.pug` / `.scss` | `MarkdownPreviewTabComponent` — hosts the sandboxed iframe, link interception, Reload |
| `src/fileBrowser.component.ts` / `.pug` / `.scss` | `FileBrowserComponent` — NgbModal browser UI |
| `src/buttonProvider.ts` | `MarkdownToolbarButtonProvider` — button → resolve cwd → browser → open tab |
| `src/index.ts` | `NgModule` wiring all providers/components |
| `test/*.spec.ts` | Jest unit tests for the pure modules |
| `README.md` | Install/build/dev instructions + manual test checklist |

**Build order rationale:** scaffold first (Task 1), then the pure leaf modules with full TDD (Tasks 2–6) since they have no Angular/Tabby dependencies, then assets (Task 7), then the Angular units that consume them (Tasks 8–12), then integration + docs (Tasks 13–14).

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `webpack.config.js`, `jest.config.js`, `src/types.d.ts`, `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "tabby-markdown-preview",
  "version": "0.1.0",
  "description": "Preview markdown files in a dark VSCode-style tab from the terminal's working directory.",
  "keywords": ["tabby-plugin"],
  "main": "dist/index.js",
  "typings": "dist/index.d.ts",
  "scripts": {
    "build": "webpack --progress",
    "watch": "webpack --progress --watch",
    "test": "jest",
    "prepublishOnly": "npm run build"
  },
  "files": ["dist"],
  "license": "MIT",
  "dependencies": {
    "dompurify": "^3.2.7",
    "highlight.js": "^11.9.0",
    "marked": "^12.0.0",
    "marked-highlight": "^2.1.1"
  },
  "peerDependencies": {
    "@angular/common": "*",
    "@angular/core": "*",
    "@ng-bootstrap/ng-bootstrap": "*",
    "rxjs": "*",
    "tabby-core": "*",
    "tabby-terminal": "*"
  },
  "devDependencies": {
    "@angular/common": "^16.0.0",
    "@angular/core": "^16.0.0",
    "@ng-bootstrap/ng-bootstrap": "^15.0.0",
    "@types/dompurify": "^3.0.5",
    "@types/jest": "^29.5.0",
    "@types/marked": "^6.0.0",
    "@types/node": "^20.0.0",
    "css-loader": "^6.0.0",
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0",
    "pug-loader": "^2.4.0",
    "apply-loader": "^2.0.0",
    "rxjs": "^7.0.0",
    "sass": "^1.69.0",
    "sass-loader": "^13.0.0",
    "tabby-core": "^1.0.0",
    "tabby-terminal": "^1.0.0",
    "to-string-loader": "^1.2.0",
    "ts-jest": "^29.1.0",
    "ts-loader": "^9.5.0",
    "typescript": "^5.2.0"
  }
}
```

> NOTE: Angular/Tabby/ng-bootstrap dev versions above are placeholders to satisfy types during the standalone build. Task 14 pins them to the **exact versions your installed Tabby ships** — do that before publishing.

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "esnext",
    "moduleResolution": "node",
    "lib": ["es2020", "dom"],
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `webpack.config.js`** (based on Tabby's example plugin)

```js
const path = require('path')

module.exports = {
  target: 'node',
  entry: path.resolve(__dirname, 'src/index.ts'),
  context: __dirname,
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    pathinfo: true,
    libraryTarget: 'umd',
    devtoolModuleFilenameTemplate: 'webpack-tabby-markdown-preview:///[resource-path]',
  },
  mode: process.env.CI ? 'production' : 'development',
  resolve: {
    modules: ['.', 'src', 'node_modules'].map(x => path.join(__dirname, x)),
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: { loader: 'ts-loader', options: { configFile: path.resolve(__dirname, 'tsconfig.json') } },
      },
      { test: /\.pug$/, use: ['apply-loader', 'pug-loader'] },
      { test: /\.scss$/, use: ['to-string-loader', 'css-loader', 'sass-loader'] },
      { test: /\.svg$/, type: 'asset/source' },
    ],
  },
  externals: [
    'fs', 'os', 'path', 'url', 'electron',
    /^rxjs/, /^@angular/, /^@ng-bootstrap/, /^tabby-/,
  ],
}
```

- [ ] **Step 5: Create `jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/test/**/*.spec.ts'],
}
```

- [ ] **Step 6: Create `src/types.d.ts`**

```ts
declare module '*.pug' {
  const content: string
  export default content
}
declare module '*.scss' {
  const content: string
  export default content
}
declare module '*.svg' {
  const content: string
  export default content
}
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules/` populated. (If a tabby-* version fails to resolve, set it to the version printed by your installed Tabby — see Task 14.)

- [ ] **Step 8: Verify the test runner works**

Run: `npx jest --version`
Expected: prints a 29.x version number with no config error.

- [ ] **Step 9: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.json webpack.config.js jest.config.js src/types.d.ts
git commit -m "chore: scaffold tabby-markdown-preview plugin (build + test config)"
```

---

## Task 2: `markdownRenderer` — render, sanitize, image/link hardening

**Files:**
- Create: `src/markdownRenderer.ts`
- Test: `test/markdownRenderer.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/markdownRenderer.spec.ts
import { renderMarkdown, resolveLocalImage } from '../src/markdownRenderer'

describe('resolveLocalImage', () => {
  const base = '/docs/project'
  it('resolves a relative path to a file:// URL', () => {
    expect(resolveLocalImage('img/a.png', base)).toBe('file:///docs/project/img/a.png')
  })
  it('handles spaces and unicode via pathToFileURL', () => {
    expect(resolveLocalImage('a b/café.png', base)).toBe('file:///docs/project/a%20b/caf%C3%A9.png')
  })
  it('blocks remote URLs', () => {
    expect(resolveLocalImage('https://evil/x.png', base)).toBeNull()
  })
  it('blocks absolute file paths', () => {
    expect(resolveLocalImage('/etc/passwd', base)).toBeNull()
  })
  it('blocks traversal outside the base dir', () => {
    expect(resolveLocalImage('../../etc/passwd', base)).toBeNull()
  })
})

describe('renderMarkdown', () => {
  const opts = { baseDir: '/docs/project' }
  it('renders basic markdown to HTML', () => {
    expect(renderMarkdown('# Hello', opts)).toContain('<h1')
    expect(renderMarkdown('# Hello', opts)).toContain('Hello')
  })
  it('highlights fenced code blocks', () => {
    const html = renderMarkdown('```js\nconst x = 1\n```', opts)
    expect(html).toContain('hljs')
  })
  it('strips inline <script>', () => {
    expect(renderMarkdown('<script>alert(1)</script>', opts)).not.toContain('<script')
  })
  it('strips javascript: hrefs', () => {
    const html = renderMarkdown('[x](javascript:alert(1))', opts)
    expect(html).not.toContain('javascript:')
  })
  it('forces rel=noopener on links', () => {
    const html = renderMarkdown('[x](https://example.com)', opts)
    expect(html).toContain('rel="noopener noreferrer"')
  })
  it('rewrites a relative image to file://', () => {
    const html = renderMarkdown('![a](img/a.png)', opts)
    expect(html).toContain('file:///docs/project/img/a.png')
  })
  it('drops the src of a remote image', () => {
    const html = renderMarkdown('![a](https://evil/x.png)', opts)
    expect(html).not.toContain('https://evil')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/markdownRenderer.spec.ts`
Expected: FAIL — "Cannot find module '../src/markdownRenderer'".

- [ ] **Step 3: Implement `src/markdownRenderer.ts`**

```ts
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import * as path from 'path'
import { pathToFileURL } from 'url'

export interface RenderOptions {
  baseDir: string
}

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext'
      return hljs.highlight(code, { language }).value
    },
  }),
)

// Pure: resolve a relative, in-tree image path to a file:// URL, else null.
export function resolveLocalImage(src: string, baseDir: string): string | null {
  if (!src) {
    return null
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
    return null // has a scheme (http:, file:, data:, ...) -> block
  }
  if (path.isAbsolute(src)) {
    return null
  }
  const resolved = path.resolve(baseDir, src)
  const rel = path.relative(baseDir, resolved)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null // escaped baseDir
  }
  return pathToFileURL(resolved).href
}

export function renderMarkdown(markdown: string, options: RenderOptions): string {
  const rawHtml = marked.parse(markdown, { async: false }) as string

  const hook = (node: Element) => {
    if (node.tagName === 'A' && node.hasAttribute('href')) {
      node.setAttribute('rel', 'noopener noreferrer')
      node.setAttribute('target', '_blank')
    }
    if (node.tagName === 'IMG') {
      const rewritten = resolveLocalImage(node.getAttribute('src') || '', options.baseDir)
      if (rewritten) {
        node.setAttribute('src', rewritten)
      } else {
        node.removeAttribute('src')
      }
    }
  }

  DOMPurify.addHook('afterSanitizeAttributes', hook as any)
  try {
    return DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      FORBID_ATTR: ['style'],
    })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/markdownRenderer.spec.ts`
Expected: PASS (all cases). If `pathToFileURL` output differs on Windows, note that tests assume POSIX paths; run on a POSIX shell.

- [ ] **Step 5: Commit**

```bash
git add src/markdownRenderer.ts test/markdownRenderer.spec.ts
git commit -m "feat: markdown renderer with sanitization and image/link hardening"
```

---

## Task 3: `previewDocument` — iframe srcdoc with CSP + CSS

**Files:**
- Create: `src/previewDocument.ts`
- Test: `test/previewDocument.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/previewDocument.spec.ts
import { buildPreviewDocument, PREVIEW_CSP } from '../src/previewDocument'

describe('buildPreviewDocument', () => {
  it('embeds the body html', () => {
    expect(buildPreviewDocument('<h1>Hi</h1>', 'body{}')).toContain('<h1>Hi</h1>')
  })
  it('inlines the css', () => {
    expect(buildPreviewDocument('', 'body{color:red}')).toContain('body{color:red}')
  })
  it('includes the strict CSP meta', () => {
    const doc = buildPreviewDocument('', '')
    expect(doc).toContain('Content-Security-Policy')
    expect(doc).toContain(PREVIEW_CSP)
  })
  it('CSP forbids scripts', () => {
    expect(PREVIEW_CSP).toContain("script-src 'none'")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/previewDocument.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/previewDocument.ts`**

```ts
export const PREVIEW_CSP =
  "default-src 'none'; script-src 'none'; img-src 'self' file: data:; " +
  "style-src 'unsafe-inline'; font-src file: data:"

export function buildPreviewDocument(bodyHtml: string, css: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">
<style>${css}</style>
</head>
<body class="markdown-body">${bodyHtml}</body>
</html>`
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/previewDocument.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/previewDocument.ts test/previewDocument.spec.ts
git commit -m "feat: iframe preview document builder with strict CSP"
```

---

## Task 4: `directoryListing` — read/sort/filter/symlink

**Files:**
- Create: `src/directoryListing.ts`
- Test: `test/directoryListing.spec.ts`

- [ ] **Step 1: Write failing tests** (with a mock fs)

```ts
// test/directoryListing.spec.ts
import { listDirectory, sortEntries, DirEntry } from '../src/directoryListing'

function dirent(name: string, kind: 'dir' | 'file' | 'link') {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'link',
  } as any
}

describe('sortEntries', () => {
  it('puts directories before files, each alphabetical', () => {
    const input: DirEntry[] = [
      { name: 'b.md', path: '/x/b.md', isDirectory: false, clickable: true },
      { name: 'sub', path: '/x/sub', isDirectory: true, clickable: true },
      { name: 'a.md', path: '/x/a.md', isDirectory: false, clickable: true },
    ]
    expect(sortEntries(input).map(e => e.name)).toEqual(['sub', 'a.md', 'b.md'])
  })
})

describe('listDirectory', () => {
  it('keeps dirs and .md/.markdown files, drops other files', async () => {
    const fsMock = {
      readdir: async () => [dirent('sub', 'dir'), dirent('a.md', 'file'), dirent('b.MARKDOWN', 'file'), dirent('c.txt', 'file')],
      realpath: async (p: string) => p,
      stat: async () => ({ isDirectory: () => false }),
    }
    const names = (await listDirectory('/x', fsMock as any)).map(e => e.name)
    expect(names).toEqual(['sub', 'a.md', 'b.MARKDOWN'])
  })

  it('classifies a symlinked directory as a directory', async () => {
    const fsMock = {
      readdir: async () => [dirent('link', 'link')],
      realpath: async () => '/real',
      stat: async () => ({ isDirectory: () => true }),
    }
    const [entry] = await listDirectory('/x', fsMock as any)
    expect(entry.isDirectory).toBe(true)
    expect(entry.clickable).toBe(true)
  })

  it('marks a broken symlink non-clickable', async () => {
    const fsMock = {
      readdir: async () => [dirent('broken', 'link')],
      realpath: async () => { throw new Error('ELOOP') },
      stat: async () => ({ isDirectory: () => false }),
    }
    const result = await listDirectory('/x', fsMock as any)
    // broken link is not a dir and not .md -> dropped; ensure no throw
    expect(result).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/directoryListing.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/directoryListing.ts`**

```ts
import * as fs from 'fs'
import * as path from 'path'

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  clickable: boolean
}

const MD_EXT = ['.md', '.markdown']

type FsLike = Pick<typeof fs.promises, 'readdir' | 'realpath' | 'stat'>

export async function listDirectory(dir: string, fsImpl: FsLike = fs.promises): Promise<DirEntry[]> {
  const dirents = await fsImpl.readdir(dir, { withFileTypes: true })
  const entries: DirEntry[] = []
  for (const d of dirents) {
    const full = path.join(dir, d.name)
    let isDir = d.isDirectory()
    let clickable = true
    if (d.isSymbolicLink()) {
      try {
        const real = await fsImpl.realpath(full)
        const st = await fsImpl.stat(real)
        isDir = st.isDirectory()
      } catch {
        isDir = false
        clickable = false
      }
    }
    if (isDir) {
      entries.push({ name: d.name, path: full, isDirectory: true, clickable })
    } else if (clickable && MD_EXT.includes(path.extname(d.name).toLowerCase())) {
      entries.push({ name: d.name, path: full, isDirectory: false, clickable: true })
    }
  }
  return sortEntries(entries)
}

export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/directoryListing.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/directoryListing.ts test/directoryListing.spec.ts
git commit -m "feat: directory listing with markdown filter and symlink classification"
```

---

## Task 5: `cwdResolver` — pure decision function

**Files:**
- Create: `src/cwdResolver.ts`
- Test: `test/cwdResolver.spec.ts`

> This task implements ONLY the pure `resolveCwd()` function and the `CwdResult`/`CwdInputs` types. The Angular `CwdResolver` service that feeds it real Tabby data is added in Task 10 (it can't be unit-tested without Tabby).

- [ ] **Step 1: Write failing tests**

```ts
// test/cwdResolver.spec.ts
import { resolveCwd, CwdInputs } from '../src/cwdResolver'

function inputs(over: Partial<CwdInputs>): CwdInputs {
  return {
    isLocalTerminal: true,
    supportsWorkingDirectory: true,
    getWorkingDirectory: async () => '/work',
    pathExists: async () => true,
    homedir: '/home/me',
    ...over,
  }
}

describe('resolveCwd', () => {
  it('returns the validated local cwd', async () => {
    expect(await resolveCwd(inputs({}))).toEqual({ dir: '/work' })
  })
  it('falls back to home when not a local terminal', async () => {
    const r = await resolveCwd(inputs({ isLocalTerminal: false }))
    expect(r.dir).toBe('/home/me')
    expect(r.notice).toBeDefined()
  })
  it('falls back to home when working dir unsupported', async () => {
    const r = await resolveCwd(inputs({ supportsWorkingDirectory: false }))
    expect(r.dir).toBe('/home/me')
  })
  it('falls back to home when getWorkingDirectory returns null', async () => {
    const r = await resolveCwd(inputs({ getWorkingDirectory: async () => null }))
    expect(r.dir).toBe('/home/me')
  })
  it('falls back to home when the cwd does not exist locally', async () => {
    const r = await resolveCwd(inputs({ pathExists: async () => false }))
    expect(r.dir).toBe('/home/me')
    expect(r.notice).toBeDefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/cwdResolver.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure part of `src/cwdResolver.ts`**

```ts
export interface CwdResult {
  dir: string
  notice?: string
}

export interface CwdInputs {
  isLocalTerminal: boolean
  supportsWorkingDirectory: boolean
  getWorkingDirectory: () => Promise<string | null>
  pathExists: (p: string) => Promise<boolean>
  homedir: string
}

const REMOTE_NOTICE = 'Showing home directory — remote working directories aren’t supported yet.'
const INACCESSIBLE_NOTICE = 'Working directory not accessible locally — showing home directory.'

export async function resolveCwd(input: CwdInputs): Promise<CwdResult> {
  if (!input.isLocalTerminal || !input.supportsWorkingDirectory) {
    return { dir: input.homedir, notice: REMOTE_NOTICE }
  }
  let cwd: string | null = null
  try {
    cwd = await input.getWorkingDirectory()
  } catch {
    cwd = null
  }
  if (!cwd) {
    return { dir: input.homedir }
  }
  if (!(await input.pathExists(cwd))) {
    return { dir: input.homedir, notice: INACCESSIBLE_NOTICE }
  }
  return { dir: cwd }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/cwdResolver.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cwdResolver.ts test/cwdResolver.spec.ts
git commit -m "feat: pure cwd resolution decision function"
```

---

## Task 6: `fileReader` — size cap, BOM, strict UTF-8

**Files:**
- Create: `src/fileReader.ts`
- Test: `test/fileReader.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
// test/fileReader.spec.ts
import { decodeUtf8, readMarkdownFile, PreviewError, MAX_PREVIEW_BYTES } from '../src/fileReader'

describe('decodeUtf8', () => {
  it('decodes UTF-8 text', () => {
    expect(decodeUtf8(Buffer.from('héllo', 'utf8'))).toBe('héllo')
  })
  it('strips a UTF-8 BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('hi', 'utf8')])
    expect(decodeUtf8(buf)).toBe('hi')
  })
  it('throws PreviewError on invalid UTF-8', () => {
    expect(() => decodeUtf8(Buffer.from([0xFF, 0xFE, 0x00]))).toThrow(PreviewError)
  })
})

describe('readMarkdownFile', () => {
  it('reads and decodes a small file', async () => {
    const fsMock = {
      stat: async () => ({ size: 5 }),
      readFile: async () => Buffer.from('# hi', 'utf8'),
    }
    expect(await readMarkdownFile('/x.md', fsMock as any)).toBe('# hi')
  })
  it('throws PreviewError when over the size cap', async () => {
    const fsMock = {
      stat: async () => ({ size: MAX_PREVIEW_BYTES + 1 }),
      readFile: async () => Buffer.from(''),
    }
    await expect(readMarkdownFile('/big.md', fsMock as any)).rejects.toThrow(PreviewError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/fileReader.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/fileReader.ts`**

```ts
import * as fs from 'fs'

export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024

export class PreviewError extends Error {}

type FsLike = Pick<typeof fs.promises, 'stat' | 'readFile'>

export function decodeUtf8(buf: Buffer): string {
  let b = buf
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    b = b.subarray(3)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    throw new PreviewError('File is not valid UTF-8 text and cannot be previewed.')
  }
}

export async function readMarkdownFile(filePath: string, fsImpl: FsLike = fs.promises): Promise<string> {
  const stat = await fsImpl.stat(filePath)
  if (stat.size > MAX_PREVIEW_BYTES) {
    const mb = (stat.size / (1024 * 1024)).toFixed(1)
    throw new PreviewError(`File is too large to preview (${mb} MB > 10 MB limit).`)
  }
  const buf = await fsImpl.readFile(filePath)
  return decodeUtf8(buf as Buffer)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/fileReader.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fileReader.ts test/fileReader.spec.ts
git commit -m "feat: file reader with size cap, BOM strip, strict UTF-8 decode"
```

---

## Task 7: Static assets — toolbar icon + dark stylesheet

**Files:**
- Create: `src/icon.ts`, `src/markdown-dark.scss`

- [ ] **Step 1: Create `src/icon.ts`** (raw SVG string — `ToolbarButton.icon` requires SVG, not a name)

```ts
export const markdownIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M14.85 3H1.15C.52 3 0 3.52 0 4.15v7.69C0 12.48.52 13 1.15 13h13.69c.64 0 1.15-.52 1.15-1.15v-7.7C16 3.52 15.48 3 14.85 3zM9 11H7V8L5.5 9.92 4 8v3H2V5h2l1.5 2L7 5h2v6zm2.99.5L9.5 8H11V5h2v3h1.5l-2.51 3.5z"/></svg>`
```

- [ ] **Step 2: Create `src/markdown-dark.scss`** (GitHub-dark-style preview CSS, scoped to `.markdown-body`)

```scss
body { margin: 0; }
.markdown-body {
  box-sizing: border-box;
  min-width: 200px;
  margin: 0 auto;
  padding: 24px 32px;
  color: #c9d1d9;
  background: #0d1117;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  word-wrap: break-word;
}
.markdown-body h1, .markdown-body h2 { border-bottom: 1px solid #21262d; padding-bottom: .3em; }
.markdown-body a { color: #58a6ff; text-decoration: none; }
.markdown-body a:hover { text-decoration: underline; }
.markdown-body code {
  background: rgba(110,118,129,.4); border-radius: 6px; padding: .2em .4em;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 85%;
}
.markdown-body pre {
  background: #161b22; border-radius: 6px; padding: 16px; overflow: auto;
}
.markdown-body pre code { background: transparent; padding: 0; }
.markdown-body blockquote { color: #8b949e; border-left: .25em solid #30363d; padding: 0 1em; margin: 0; }
.markdown-body table { border-collapse: collapse; }
.markdown-body table th, .markdown-body table td { border: 1px solid #30363d; padding: 6px 13px; }
.markdown-body img { max-width: 100%; }
.markdown-body hr { border: 0; border-top: 1px solid #30363d; }
/* minimal highlight.js dark theme */
.hljs-keyword, .hljs-selector-tag { color: #ff7b72; }
.hljs-string, .hljs-attr { color: #a5d6ff; }
.hljs-comment { color: #8b949e; }
.hljs-number, .hljs-literal { color: #79c0ff; }
.hljs-title, .hljs-function .hljs-title { color: #d2a8ff; }
```

- [ ] **Step 3: Verify both files compile as imports** (smoke test the SVG export)

Run: `npx jest -e "require('ts-node')" 2>/dev/null; node -e "process.exit(0)"`
Expected: trivial no-op success — these files are validated for real when the bundle builds in Task 12. (No unit test; they are static assets.)

- [ ] **Step 4: Commit**

```bash
git add src/icon.ts src/markdown-dark.scss
git commit -m "feat: toolbar SVG icon and dark preview stylesheet"
```

---

## Task 8: `MarkdownPreviewTabComponent`

**Files:**
- Create: `src/previewTab.component.ts`, `src/previewTab.component.pug`, `src/previewTab.component.scss`

> No unit test (Angular + Electron `shell`); verified by the build (Task 12) and manual test (Task 13).

- [ ] **Step 1: Create `src/previewTab.component.pug`**

```pug
.mp-root
  .mp-toolbar
    button.btn.btn-sm.btn-secondary((click)='load()') Reload
    span.mp-path {{ filePath }}
  .mp-error(*ngIf='error') {{ error }}
  iframe.mp-frame(
    #frame
    [hidden]='!!error'
    sandbox='allow-same-origin'
    (load)='onFrameLoad()'
  )
```

- [ ] **Step 2: Create `src/previewTab.component.scss`**

```scss
.mp-root { display: flex; flex-direction: column; height: 100%; background: #0d1117; }
.mp-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid #21262d; }
.mp-path { color: #8b949e; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-error { color: #f85149; padding: 16px; }
.mp-frame { flex: 1; border: 0; width: 100%; }
```

- [ ] **Step 3: Create `src/previewTab.component.ts`**

```ts
import { Component, ElementRef, ViewChild } from '@angular/core'
import { BaseTabComponent } from 'tabby-core'
import { shell } from 'electron'
import * as path from 'path'
import { readMarkdownFile, PreviewError } from './fileReader'
import { renderMarkdown } from './markdownRenderer'
import { buildPreviewDocument } from './previewDocument'
import markdownCss from './markdown-dark.scss'

@Component({
  selector: 'markdown-preview-tab',
  template: require('./previewTab.component.pug'),
  styles: [require('./previewTab.component.scss')],
})
export class MarkdownPreviewTabComponent extends BaseTabComponent {
  filePath = ''
  error: string | null = null
  @ViewChild('frame', { static: false }) frame!: ElementRef<HTMLIFrameElement>

  constructor() {
    super()
  }

  async ngOnInit(): Promise<void> {
    this.setTitle(path.basename(this.filePath))
    await this.load()
  }

  async load(): Promise<void> {
    this.error = null
    try {
      const md = await readMarkdownFile(this.filePath)
      const body = renderMarkdown(md, { baseDir: path.dirname(this.filePath) })
      const doc = buildPreviewDocument(body, markdownCss)
      // assign after the view settles so the ViewChild exists
      setTimeout(() => { if (this.frame) { this.frame.nativeElement.srcdoc = doc } })
    } catch (e: any) {
      this.error = e instanceof PreviewError ? e.message : `Could not read file: ${e?.message ?? e}`
    }
  }

  onFrameLoad(): void {
    const doc = this.frame?.nativeElement?.contentDocument
    if (!doc) {
      return
    }
    doc.addEventListener('click', (ev: MouseEvent) => {
      const anchor = (ev.target as HTMLElement)?.closest?.('a')
      if (!anchor) {
        return
      }
      ev.preventDefault()
      const href = anchor.getAttribute('href') || ''
      if (/^(https?:|mailto:)/i.test(href)) {
        shell.openExternal(href)
      }
    })
  }
}
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `previewTab.component.ts`. (Template/scss `require` resolved via `src/types.d.ts`; `electron`/`fs` resolved as externals at bundle time, types from `@types/node`/electron.)

- [ ] **Step 5: Commit**

```bash
git add src/previewTab.component.ts src/previewTab.component.pug src/previewTab.component.scss
git commit -m "feat: markdown preview tab component (sandboxed iframe + external links)"
```

---

## Task 9: `FileBrowserComponent`

**Files:**
- Create: `src/fileBrowser.component.ts`, `src/fileBrowser.component.pug`, `src/fileBrowser.component.scss`

> No unit test (Angular + NgbActiveModal); the listing logic it calls is already tested in Task 4.

- [ ] **Step 1: Create `src/fileBrowser.component.pug`**

```pug
.modal-header
  h5.modal-title Open markdown file
  button.btn-close((click)='activeModal.dismiss()')
.modal-body
  .mp-notice(*ngIf='notice') {{ notice }}
  .mp-crumb {{ dir }}
  .mp-error(*ngIf='error') {{ error }}
  .mp-list
    .mp-entry(*ngIf='canGoUp()' (click)='up()') ..
    .mp-entry(
      *ngFor='let e of entries'
      [class.is-dir]='e.isDirectory'
      [class.disabled]='!e.clickable'
      (click)='open(e)'
    ) {{ e.isDirectory ? '📁 ' : '📄 ' }}{{ e.name }}
```

- [ ] **Step 2: Create `src/fileBrowser.component.scss`**

```scss
.mp-notice { color: #d29922; margin-bottom: 8px; }
.mp-crumb { color: #8b949e; font-size: 12px; margin-bottom: 8px; word-break: break-all; }
.mp-error { color: #f85149; margin-bottom: 8px; }
.mp-list { max-height: 50vh; overflow: auto; }
.mp-entry { padding: 4px 8px; cursor: pointer; border-radius: 4px; }
.mp-entry:hover { background: rgba(110,118,129,.2); }
.mp-entry.disabled { opacity: .4; cursor: default; }
```

- [ ] **Step 3: Create `src/fileBrowser.component.ts`**

```ts
import { Component } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import * as path from 'path'
import { listDirectory, DirEntry } from './directoryListing'

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

  constructor(public activeModal: NgbActiveModal) {}

  async ngOnInit(): Promise<void> {
    await this.navigate(this.dir)
  }

  canGoUp(): boolean {
    return path.dirname(this.dir) !== this.dir
  }

  up(): void {
    void this.navigate(path.dirname(this.dir))
  }

  async navigate(target: string): Promise<void> {
    try {
      this.entries = await listDirectory(target)
      this.dir = target
      this.error = null
    } catch (e: any) {
      this.error = `Cannot open ${target}: ${e?.message ?? e}`
    }
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

- [ ] **Step 4: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `fileBrowser.component.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/fileBrowser.component.ts src/fileBrowser.component.pug src/fileBrowser.component.scss
git commit -m "feat: file browser modal component"
```

---

## Task 10: `CwdResolver` Angular service

**Files:**
- Modify: `src/cwdResolver.ts` (append the Angular service; keep the pure `resolveCwd` from Task 5 untouched)

> The service wires real Tabby/Node data into the tested `resolveCwd`. No new unit test (it only adapts inputs); covered by Task 5 + manual test.

- [ ] **Step 1: Append the service to `src/cwdResolver.ts`**

```ts
import { Injectable } from '@angular/core'
import { AppService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import * as fs from 'fs'
import * as os from 'os'

@Injectable({ providedIn: 'root' })
export class CwdResolver {
  constructor(private app: AppService) {}

  async resolve(): Promise<CwdResult> {
    const tab = this.app.activeTab
    const isTerminal = tab instanceof BaseTerminalTabComponent
    const session = isTerminal ? (tab as BaseTerminalTabComponent).session : null
    const isLocalTerminal = isTerminal && (tab as any).profile?.type === 'local'

    return resolveCwd({
      isLocalTerminal,
      supportsWorkingDirectory: !!session?.supportsWorkingDirectory?.(),
      getWorkingDirectory: () => session?.getWorkingDirectory?.() ?? Promise.resolve(null),
      pathExists: async (p: string) => {
        try {
          await fs.promises.access(p, fs.constants.R_OK)
          return true
        } catch {
          return false
        }
      },
      homedir: os.homedir(),
    })
  }
}
```

- [ ] **Step 2: Re-run the pure tests to confirm no regression**

Run: `npx jest test/cwdResolver.spec.ts`
Expected: PASS (the pure function is unchanged).

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors. (If `profile` isn't typed on `BaseTerminalTabComponent` in your Tabby version, the `as any` cast keeps it compiling — confirm the `'local'` type string in Task 14.)

- [ ] **Step 4: Commit**

```bash
git add src/cwdResolver.ts
git commit -m "feat: Angular CwdResolver service wrapping the pure resolver"
```

---

## Task 11: `MarkdownToolbarButtonProvider`

**Files:**
- Create: `src/buttonProvider.ts`

> No unit test (Tabby DI); verified by build + manual test.

- [ ] **Step 1: Create `src/buttonProvider.ts`**

```ts
import { Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, AppService } from 'tabby-core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { CwdResolver } from './cwdResolver'
import { FileBrowserComponent } from './fileBrowser.component'
import { MarkdownPreviewTabComponent } from './previewTab.component'
import { markdownIcon } from './icon'

@Injectable()
export class MarkdownToolbarButtonProvider extends ToolbarButtonProvider {
  constructor(
    private app: AppService,
    private ngbModal: NgbModal,
    private cwdResolver: CwdResolver,
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
    const { dir, notice } = await this.cwdResolver.resolve()
    const modal = this.ngbModal.open(FileBrowserComponent, { size: 'lg' })
    modal.componentInstance.dir = dir
    modal.componentInstance.notice = notice

    let filePath: string | undefined
    try {
      filePath = await modal.result
    } catch {
      return // dismissed / escaped
    }
    if (filePath) {
      this.app.openNewTab({ type: MarkdownPreviewTabComponent, inputs: { filePath } })
    }
  }
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `buttonProvider.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/buttonProvider.ts
git commit -m "feat: toolbar button provider wiring browser to preview tab"
```

---

## Task 12: `index.ts` NgModule + full build

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create `src/index.ts`**

```ts
import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { ToolbarButtonProvider } from 'tabby-core'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { MarkdownToolbarButtonProvider } from './buttonProvider'
import { FileBrowserComponent } from './fileBrowser.component'
import { MarkdownPreviewTabComponent } from './previewTab.component'

@NgModule({
  imports: [CommonModule, NgbModule],
  providers: [
    { provide: ToolbarButtonProvider, useClass: MarkdownToolbarButtonProvider, multi: true },
  ],
  declarations: [FileBrowserComponent, MarkdownPreviewTabComponent],
})
export default class MarkdownPreviewModule {}
```

> If your Tabby version runs Angular ≤ 12, add `entryComponents: [FileBrowserComponent, MarkdownPreviewTabComponent]` to the `@NgModule` (removed/ignored in Angular 13+). Confirm in Task 14.

- [ ] **Step 2: Run the full bundle build**

Run: `npm run build`
Expected: webpack completes; `dist/index.js` and `dist/index.d.ts` produced with no TypeScript or loader errors. Fix any unresolved import/loader issues before continuing.

- [ ] **Step 3: Run the whole unit test suite**

Run: `npx jest`
Expected: all suites from Tasks 2–6 PASS.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: NgModule wiring; plugin builds to dist/index.js"
```

---

## Task 13: Manual integration test + README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# tabby-markdown-preview

A [Tabby](https://github.com/Eugeny/tabby) plugin: click the toolbar button to
browse the active terminal's working directory and preview a `.md` file in a
dark, VSCode-style tab.

## Build

    npm install
    npm run build      # outputs dist/index.js

## Develop against a local Tabby

Symlink the built plugin into Tabby's plugin directory, then restart Tabby:

- Linux:   `~/.config/tabby/plugins/node_modules/tabby-markdown-preview`
- macOS:   `~/Library/Application Support/tabby/plugins/node_modules/tabby-markdown-preview`
- Windows: `%APPDATA%\tabby\plugins\node_modules\tabby-markdown-preview`

    mkdir -p ~/.config/tabby/plugins/node_modules
    ln -s "$PWD" ~/.config/tabby/plugins/node_modules/tabby-markdown-preview

Use `npm run watch` while developing and reload Tabby (Ctrl+Shift+R) to pick up changes.

## Security

Rendered markdown is sanitized (DOMPurify) and displayed inside a sandboxed
`<iframe>` with a strict CSP; links open in the external browser. See the design
spec under `docs/superpowers/specs/`.
```

- [ ] **Step 2: Manual test in a Tabby dev instance** (check each box by observation)

Symlink per the README, restart Tabby, then verify:
- [ ] The markdown toolbar button appears in the toolbar.
- [ ] With a **local** terminal active in some directory containing `.md` files, clicking the button opens the browser **at that directory**.
- [ ] Folders and `.md`/`.markdown` files are listed (dirs first); other files are hidden; `..` navigates up.
- [ ] Clicking a `.md` file opens a **new tab** titled with the filename, dark-themed, with headings/code highlighting.
- [ ] A fenced code block is syntax-highlighted.
- [ ] A relative-path image in the markdown displays; a remote `<img>` does **not** load.
- [ ] An `http(s)` link opens in the **external browser**, not inside Tabby.
- [ ] **Reload** re-renders after you edit the file on disk.
- [ ] Opening from an **SSH** tab (or with no terminal active) falls back to `$HOME` with the notice.
- [ ] A non-`.md`/binary file path produces a clean error (no crash) — e.g. temporarily rename a large/binary file to `.md` to confirm the size/UTF-8 guards.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with install, dev, and manual test checklist"
```

---

## Task 14: Tabby-version preflight & dependency pinning

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Determine your installed Tabby's versions**

Inspect the installed Tabby (its `package.json` / `app/node_modules`) and record the versions of: `@angular/core`, `@ng-bootstrap/ng-bootstrap`, `rxjs`, `tabby-core`, `tabby-terminal`. (On Linux a packaged install exposes these under the Tabby resources directory.)

- [ ] **Step 2: Verify the cited APIs exist in that version**

Confirm these are present (grep the installed `tabby-core`/`tabby-terminal` typings):
- `ToolbarButtonProvider` with `provide(): ToolbarButton[]`; `ToolbarButton.icon` is a string (SVG).
- `AppService.activeTab` and `AppService.openNewTab(params)`.
- `BaseTerminalTabComponent` with `session`; `BaseSession.supportsWorkingDirectory()` and `getWorkingDirectory()`.
- `BaseTabComponent` with `setTitle()`.
- The local profile `type` string (expected `'local'`) used in `CwdResolver` — fix the literal if it differs.

- [ ] **Step 3: Pin `peerDependencies`/`devDependencies` to those versions in `package.json`**

Replace the `*`/placeholder versions with the exact versions you found, so the plugin builds against and declares compatibility with your Tabby.

- [ ] **Step 4: Rebuild and retest after pinning**

Run: `npm install && npm run build && npx jest`
Expected: build succeeds and all unit tests pass against the pinned versions.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: pin Angular/Tabby versions to installed Tabby; preflight verified"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** toolbar button (Task 11), cwd resolution incl. remote/non-terminal fallback (Tasks 5/10), file browser with markdown filter + symlink handling (Tasks 4/9), preview tab (Task 8), sandboxed-iframe + CSP + DOMPurify + link/image hardening (Tasks 2/3/8), `marked-highlight` (Task 2), size cap + UTF-8/BOM (Task 6), dependency plan + UMD build (Tasks 1/12), version preflight (Task 14), tests + manual checklist (per-task + Task 13). All spec sections map to a task.
- **Known version-sensitive points** (all routed through Task 14): Angular `entryComponents`, `BaseTerminalTabComponent.profile.type === 'local'`, exact tabby-* versions, and the scss loader name (`to-string-loader`) — if the build errors on scss, match the loader your Tabby example uses.
- **Test-environment caveat:** DOMPurify runs under jsdom in Jest; per the spec, the iframe + CSP are the primary defense, the unit assertions verify wiring, not browser-equivalent sanitization.
