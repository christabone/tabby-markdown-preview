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
