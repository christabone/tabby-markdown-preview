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
