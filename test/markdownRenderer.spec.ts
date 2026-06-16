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
