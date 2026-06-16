import * as fs from 'fs'

export const MAX_PREVIEW_BYTES = 10 * 1024 * 1024

export class PreviewError extends Error {}

type FsLike = Pick<typeof fs.promises, 'stat' | 'readFile'>

export function decodeUtf8(buf: Buffer): string {
  let b = buf
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) {
    b = b.subarray(3)
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    throw new PreviewError('File is not valid UTF-8 text and cannot be previewed.')
  }
}

export async function readMarkdownFile(filePath: string, fsImpl: FsLike = fs.promises): Promise<string> {
  const stat = await fsImpl.stat(filePath)
  if (stat.size > MAX_PREVIEW_BYTES) {
    const mb = (stat.size / (1024 * 1024)).toFixed(1)
    throw new PreviewError(`File is too large to preview (${mb} MB > 10 MB limit).`)
  }
  const buf = await fsImpl.readFile(filePath)
  return decodeUtf8(buf as Buffer)
}
