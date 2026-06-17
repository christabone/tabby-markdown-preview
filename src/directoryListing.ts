import * as fs from 'fs'
import * as path from 'path'

export interface DirEntry {
  name: string
  path: string
  isDirectory: boolean
  clickable: boolean
}

export interface RawEntry {
  name: string
  path: string
  isDirectory: boolean
  clickable: boolean
}

const MD_EXT = ['.md', '.markdown']

type FsLike = Pick<typeof fs.promises, 'readdir' | 'realpath' | 'stat'>

export function classifyEntries(raw: RawEntry[]): DirEntry[] {
  const entries: DirEntry[] = []
  for (const r of raw) {
    if (r.isDirectory) {
      entries.push({ name: r.name, path: r.path, isDirectory: true, clickable: r.clickable })
    } else if (r.clickable && MD_EXT.includes(path.extname(r.name).toLowerCase())) {
      entries.push({ name: r.name, path: r.path, isDirectory: false, clickable: true })
    }
  }
  return sortEntries(entries)
}

export async function listDirectory(dir: string, fsImpl: FsLike = fs.promises): Promise<DirEntry[]> {
  const dirents = await fsImpl.readdir(dir, { withFileTypes: true })
  const raw: RawEntry[] = []
  for (const d of dirents) {
    const full = path.join(dir, d.name)
    let isDirectory = d.isDirectory()
    let clickable = true
    if (d.isSymbolicLink()) {
      try {
        const real = await fsImpl.realpath(full)
        const st = await fsImpl.stat(real)
        isDirectory = st.isDirectory()
      } catch {
        isDirectory = false
        clickable = false
      }
    }
    raw.push({ name: d.name, path: full, isDirectory, clickable })
  }
  return classifyEntries(raw)
}

export function sortEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}
