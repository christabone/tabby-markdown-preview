import { Injectable } from '@angular/core'
import { AppService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import * as fs from 'fs'
import * as os from 'os'

export interface CwdResult {
  dir: string
  notice?: string
}

export interface CwdInputs {
  isLocalTerminal: boolean
  supportsWorkingDirectory: boolean
  getWorkingDirectory: () => Promise<string | null>
  pathExists: (p: string) => Promise<boolean>
  homedir: string
}

const REMOTE_NOTICE = 'Showing home directory — remote working directories aren’t supported yet.'
const INACCESSIBLE_NOTICE = 'Working directory not accessible locally — showing home directory.'

export async function resolveCwd(input: CwdInputs): Promise<CwdResult> {
  if (!input.isLocalTerminal || !input.supportsWorkingDirectory) {
    return { dir: input.homedir, notice: REMOTE_NOTICE }
  }
  let cwd: string | null = null
  try {
    cwd = await input.getWorkingDirectory()
  } catch {
    cwd = null
  }
  if (!cwd) {
    return { dir: input.homedir }
  }
  if (!(await input.pathExists(cwd))) {
    return { dir: input.homedir, notice: INACCESSIBLE_NOTICE }
  }
  return { dir: cwd }
}

const REMOTE_PROFILE_TYPES = ['ssh', 'telnet', 'serial']

@Injectable({ providedIn: 'root' })
export class CwdResolver {
  constructor(private app: AppService) {}

  async resolve(): Promise<CwdResult> {
    const tab = this.app.activeTab
    const isTerminal = tab instanceof BaseTerminalTabComponent
    const session = isTerminal ? (tab as BaseTerminalTabComponent).session : null
    const profileType: string | undefined = (tab as any)?.profile?.type
    const isLocalTerminal = isTerminal && !REMOTE_PROFILE_TYPES.includes(profileType ?? '')

    return resolveCwd({
      isLocalTerminal,
      supportsWorkingDirectory: !!session?.supportsWorkingDirectory?.(),
      getWorkingDirectory: () => session?.getWorkingDirectory?.() ?? Promise.resolve(null),
      pathExists: async (p: string) => {
        try {
          await fs.promises.access(p, fs.constants.R_OK)
          return true
        } catch {
          return false
        }
      },
      homedir: os.homedir(),
    })
  }
}
