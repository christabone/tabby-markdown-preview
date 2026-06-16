import * as fs from 'fs'
import * as path from 'path'

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  clickable: boolean
}

const MD_EXT = ['.md', '.markdown']

type FsLike = Pick<typeof fs.promises, 'readdir' | 'realpath' | 'stat'>

export async function listDirectory(dir: string, fsImpl: FsLike = fs.promises): Promise<DirEntry[]> {
  const dirents = await fsImpl.readdir(dir, { withFileTypes: true })
  const entries: DirEntry[] = []
  for (const d of dirents) {
    const full = path.join(dir, d.name)
    let isDir = d.isDirectory()
    let clickable = true
    if (d.isSymbolicLink()) {
      try {
        const real = await fsImpl.realpath(full)
        const st = await fsImpl.stat(real)
        isDir = st.isDirectory()
      } catch {
        isDir = false
        clickable = false
      }
    }
    if (isDir) {
      entries.push({ name: d.name, path: full, isDirectory: true, clickable })
    } else if (clickable && MD_EXT.includes(path.extname(d.name).toLowerCase())) {
      entries.push({ name: d.name, path: full, isDirectory: false, clickable: true })
    }
  }
  return sortEntries(entries)
}

export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}
