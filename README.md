# tabby-markdown-preview

A plugin for the [Tabby](https://github.com/Eugeny/tabby) terminal that previews
Markdown files in a dark, VS Code–style tab — straight from the directory your
terminal is sitting in.

Click the toolbar button, browse the active terminal's working directory, pick a
`.md` file, and it opens rendered in a new tab.

## Features

- **Toolbar button** that opens a file browser rooted at the **active terminal's
  working directory** (falls back to your home directory for remote/SSH sessions
  or when the working directory can't be determined).
- Renders Markdown in a **new tab** with a dark, GitHub-style theme and
  syntax-highlighted code blocks (highlight.js).
- **Reload** button to re-render after you edit the file on disk.
- Relative-path images render; links open in your **external browser**.
- Read-only and security-hardened: the rendered HTML is sanitized with DOMPurify
  and shown inside a **sandboxed `<iframe>` with a strict Content-Security-Policy**
  (no script execution, no remote resource loading).

## Install (from a GitHub Release)

No Node.js or build tools required on the target machine.

1. Download `tabby-markdown-preview-vX.Y.Z.zip` from the
   [Releases](https://github.com/christabone/tabby-markdown-preview/releases) page.
2. Extract it into Tabby's plugin folder so you get a `tabby-markdown-preview`
   folder there:
   - **Windows:** `%APPDATA%\tabby\plugins\node_modules\`
   - **macOS:** `~/Library/Application Support/tabby/plugins/node_modules/`
   - **Linux:** `~/.config/tabby/plugins/node_modules/`

   These folders are created the first time Tabby runs. On Windows, open the path
   with `Win+R` → `%APPDATA%\tabby`. The result should look like:

   ```
   .../plugins/node_modules/tabby-markdown-preview/
       package.json
       dist/index.js
   ```
3. Restart Tabby. A Markdown icon appears in the toolbar, and the plugin is
   listed under **Settings → Plugins**.

To update, download the newer zip and replace the folder.

## Build from source

Requires Node.js.

    npm install --legacy-peer-deps
    npm run build      # outputs dist/index.js

To develop against a local Tabby, symlink the repo into the plugin folder shown
above (Linux/macOS: `ln -s "$PWD" <plugins>/node_modules/tabby-markdown-preview`;
Windows: `mklink /D`), run `npm run watch`, and reload Tabby (Ctrl+Shift+R) to
pick up changes.

## How it works / security

Markdown is converted with `marked` + `marked-highlight`, sanitized with
`DOMPurify` (HTML profile, inline styles forbidden), wrapped in a document with a
strict Content-Security-Policy, and rendered inside a sandboxed `<iframe>` — so
scripts never run and remote resources never load. Links are intercepted and
opened in the system browser; images are limited to relative, in-tree files. See
the design spec in `docs/superpowers/specs/` for the full threat model.

## Compatibility

Built for Tabby **1.0.x** (Angular 15) and verified end-to-end against Tabby
**1.0.234** (toolbar button → file browser → rendered preview). If your Tabby
ships a different Angular major version, rebuild from source against its toolchain.

## License

MIT — see [LICENSE](LICENSE).
