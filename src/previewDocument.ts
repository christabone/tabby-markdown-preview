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
