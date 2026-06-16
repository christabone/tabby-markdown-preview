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
