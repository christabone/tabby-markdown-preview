import { Injectable } from '@angular/core'
import { AppService } from 'tabby-core'
import * as fs from 'fs'
import * as os from 'os'
import { FileSource, SftpLike, LocalFileSource, SftpFileSource } from './fileSource'

const REMOTE_HOME_NOTICE =
  'Showing remote home directory — the shell didn’t report its working directory.'
const REMOTE_PROFILE_TYPES = ['ssh', 'telnet', 'serial']

export interface ResolveDeps {
  isSshTab: boolean
  openSFTP: () => Promise<SftpLike>
  getRemoteCwd: () => Promise<string | null>
  isLocalTerminal: boolean
  supportsWorkingDirectory: boolean
  getLocalCwd: () => Promise<string | null>
  pathExists: (p: string) => Promise<boolean>
  homedir: string
  makeSftp: (sftp: SftpLike, start: string, notice?: string) => FileSource
  makeLocal: (start: string, notice?: string) => FileSource
}

export async function resolveSource(d: ResolveDeps): Promise<FileSource> {
  if (d.isSshTab) {
    try {
      const sftp = await d.openSFTP()
      let cwd: string | null = null
      try {
        cwd = await d.getRemoteCwd()
      } catch {
        cwd = null
      }
      return cwd ? d.makeSftp(sftp, cwd) : d.makeSftp(sftp, '.', REMOTE_HOME_NOTICE)
    } catch {
      return d.makeLocal(d.homedir)
    }
  }
  if (d.isLocalTerminal && d.supportsWorkingDirectory) {
    let cwd: string | null = null
    try {
      cwd = await d.getLocalCwd()
    } catch {
      cwd = null
    }
    if (cwd && (await d.pathExists(cwd))) {
      return d.makeLocal(cwd)
    }
  }
  return d.makeLocal(d.homedir)
}

export interface TabFacts {
  isSshTab: boolean
  sshSession: any | null
  session: any | null
  isLocalTerminal: boolean
}

/** Tabby's `AppService.activeTab` is usually a SplitTabComponent wrapper; the real
 * terminal/SSH tab is its focused leaf (`getFocusedTab()`). Read tab facts from that
 * leaf, duck-typed (no `instanceof`) so it stays robust across Tabby versions. */
export function deriveTabFacts(activeTab: any): TabFacts {
  const leaf =
    activeTab && typeof activeTab.getFocusedTab === 'function'
      ? activeTab.getFocusedTab()
      : activeTab
  const sshSession = leaf?.sshSession ?? null
  const isSshTab = !!sshSession && typeof sshSession.openSFTP === 'function'
  const session = leaf?.session ?? null
  const isTerminalSession = !!session && typeof session.supportsWorkingDirectory === 'function'
  const profileType: string | undefined = leaf?.profile?.type
  const isLocalTerminal =
    !isSshTab && isTerminalSession && !REMOTE_PROFILE_TYPES.includes(profileType ?? '')
  return { isSshTab, sshSession, session, isLocalTerminal }
}

@Injectable({ providedIn: 'root' })
export class SourceResolver {
  constructor(private app: AppService) {}

  async resolve(): Promise<FileSource> {
    const { isSshTab, sshSession, session, isLocalTerminal } = deriveTabFacts(this.app.activeTab)

    return resolveSource({
      isSshTab,
      openSFTP: () => sshSession.openSFTP(),
      getRemoteCwd: () => session?.getWorkingDirectory?.() ?? Promise.resolve(null),
      isLocalTerminal,
      supportsWorkingDirectory: !!session?.supportsWorkingDirectory?.(),
      getLocalCwd: () => session?.getWorkingDirectory?.() ?? Promise.resolve(null),
      pathExists: async (p: string) => {
        try {
          await fs.promises.access(p, fs.constants.R_OK)
          return true
        } catch {
          return false
        }
      },
      homedir: os.homedir(),
      makeSftp: (sftp, start, notice) => new SftpFileSource(sftp, start, notice),
      makeLocal: (start, notice) => new LocalFileSource(start, notice),
    })
  }
}
