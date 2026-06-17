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
