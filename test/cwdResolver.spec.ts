import { resolveCwd, CwdInputs } from '../src/cwdResolver'

function inputs(over: Partial<CwdInputs>): CwdInputs {
  return {
    isLocalTerminal: true,
    supportsWorkingDirectory: true,
    getWorkingDirectory: async () => '/work',
    pathExists: async () => true,
    homedir: '/home/me',
    ...over,
  }
}

describe('resolveCwd', () => {
  it('returns the validated local cwd', async () => {
    expect(await resolveCwd(inputs({}))).toEqual({ dir: '/work' })
  })
  it('falls back to home when not a local terminal', async () => {
    const r = await resolveCwd(inputs({ isLocalTerminal: false }))
    expect(r.dir).toBe('/home/me')
    expect(r.notice).toBeDefined()
  })
  it('falls back to home when working dir unsupported', async () => {
    const r = await resolveCwd(inputs({ supportsWorkingDirectory: false }))
    expect(r.dir).toBe('/home/me')
  })
  it('falls back to home when getWorkingDirectory returns null', async () => {
    const r = await resolveCwd(inputs({ getWorkingDirectory: async () => null }))
    expect(r.dir).toBe('/home/me')
  })
  it('falls back to home when the cwd does not exist locally', async () => {
    const r = await resolveCwd(inputs({ pathExists: async () => false }))
    expect(r.dir).toBe('/home/me')
    expect(r.notice).toBeDefined()
  })
})
