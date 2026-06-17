import * as path from 'path'
import { DirEntry } from './directoryListing'
import { listDirectory } from './directoryListing'
import { readMarkdownFile } from './fileReader'

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
