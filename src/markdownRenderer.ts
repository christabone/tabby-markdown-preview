import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import * as path from 'path'
import { pathToFileURL } from 'url'

export interface RenderOptions {
  baseDir: string | null
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
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || ''
      if (href && !href.startsWith('#')) {
        node.setAttribute('rel', 'noopener noreferrer')
        node.setAttribute('target', '_blank')
      }
    }
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
  }

  DOMPurify.addHook('afterSanitizeAttributes', hook as any)
  try {
    return DOMPurify.sanitize(rawHtml, {
      USE_PROFILES: { html: true },
      FORBID_ATTR: ['style'],
    })
  } finally {
    DOMPurify.removeHook('afterSanitizeAttributes', hook as any)
  }
}
