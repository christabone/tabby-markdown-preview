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
