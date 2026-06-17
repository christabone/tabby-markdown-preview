import * as path from 'path'
import { DirEntry, RawEntry, classifyEntries } from './directoryListing'
import { listDirectory } from './directoryListing'
import { readMarkdownFile, decodeUtf8, PreviewError, MAX_PREVIEW_BYTES } from './fileReader'

export interface FileSource {
  readonly start: string
  readonly notice?: string
  readonly allowImages: boolean
  list(dir: string): Promise<DirEntry[]>
  read(filePath: string): Promise<string>
  parentOf(dir: string): string
}

export class LocalFileSource implements FileSource {
  readonly allowImages = true
  constructor(readonly start: string, readonly notice?: string) {}
  list(dir: string): Promise<DirEntry[]> {
    return listDirectory(dir)
  }
  read(filePath: string): Promise<string> {
    return readMarkdownFile(filePath)
  }
  parentOf(dir: string): string {
    return path.dirname(dir)
  }
}

// --- Minimal SFTP shapes (duck-typed against Tabby's russh-backed SFTPSession) ---
export interface SftpFile {
  name: string
  fullPath: string
  isDirectory: boolean
  isSymlink: boolean
  size: number
}
export interface SftpFileHandle {
  read(): Promise<Uint8Array>
  close(): Promise<void>
}
export interface SftpLike {
  readdir(p: string): Promise<SftpFile[]>
  stat(p: string): Promise<SftpFile>
  open(p: string, mode: number): Promise<SftpFileHandle>
}
/** SFTP SSH_FXF_READ open flag (== russh.OPEN_READ; verified against Tabby 1.0.234). */
export const SFTP_OPEN_READ = 1

export class SftpFileSource implements FileSource {
  readonly allowImages = false
  constructor(private sftp: SftpLike, readonly start: string, readonly notice?: string) {}

  async list(dir: string): Promise<DirEntry[]> {
    const files = await this.sftp.readdir(dir)
    const raw: RawEntry[] = []
    for (const f of files) {
      let isDirectory = f.isDirectory
      let clickable = true
      if (f.isSymlink) {
        try {
          const st = await this.sftp.stat(f.fullPath)
          isDirectory = st.isDirectory
        } catch {
          isDirectory = false
          clickable = false
        }
      }
      raw.push({ name: f.name, path: f.fullPath, isDirectory, clickable })
    }
    return classifyEntries(raw)
  }

  async read(filePath: string): Promise<string> {
    const st = await this.sftp.stat(filePath)
    if (st.size > MAX_PREVIEW_BYTES) {
      throw new PreviewError(`File is too large to preview (${(st.size / (1024 * 1024)).toFixed(1)} MB > 10 MB limit).`)
    }
    const handle = await this.sftp.open(filePath, SFTP_OPEN_READ)
    try {
      const chunks: Buffer[] = []
      let total = 0
      for (;;) {
        const chunk = await handle.read()
        if (!chunk || chunk.length === 0) {
          break
        }
        total += chunk.length
        if (total > MAX_PREVIEW_BYTES) {
          throw new PreviewError('File is too large to preview (exceeds 10 MB).')
        }
        chunks.push(Buffer.from(chunk))
      }
      return decodeUtf8(Buffer.concat(chunks))
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  parentOf(dir: string): string {
    return path.posix.dirname(dir)
  }
}
