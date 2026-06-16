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
