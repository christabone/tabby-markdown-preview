import { resolveSource, ResolveDeps } from '../src/sourceResolver'

function deps(over: Partial<ResolveDeps>): ResolveDeps {
  return {
    isSshTab: false,
    openSFTP: async () => ({} as any),
    getRemoteCwd: async () => null,
    isLocalTerminal: true,
    supportsWorkingDirectory: true,
    getLocalCwd: async () => '/work',
    pathExists: async () => true,
    homedir: '/home/me',
    makeSftp: (_s, start, notice) => ({ kind: 'sftp', start, notice } as any),
    makeLocal: (start, notice) => ({ kind: 'local', start, notice } as any),
    ...over,
  }
}

describe('resolveSource', () => {
  it('SSH tab with remote cwd → sftp source at that cwd, no notice', async () => {
    const r: any = await resolveSource(deps({ isSshTab: true, getRemoteCwd: async () => '/remote/dir' }))
    expect(r).toEqual({ kind: 'sftp', start: '/remote/dir', notice: undefined })
  })
  it('SSH tab without remote cwd → sftp source at "." with a notice', async () => {
    const r: any = await resolveSource(deps({ isSshTab: true, getRemoteCwd: async () => null }))
    expect(r.kind).toBe('sftp'); expect(r.start).toBe('.'); expect(r.notice).toBeDefined()
  })
  it('SSH tab whose openSFTP rejects → local source at home', async () => {
    const r: any = await resolveSource(deps({ isSshTab: true, openSFTP: async () => { throw new Error('no sftp') } }))
    expect(r).toEqual({ kind: 'local', start: '/home/me', notice: undefined })
  })
  it('local terminal with a valid cwd → local source at cwd', async () => {
    const r: any = await resolveSource(deps({ getLocalCwd: async () => '/work' }))
    expect(r).toEqual({ kind: 'local', start: '/work', notice: undefined })
  })
  it('local terminal whose cwd does not exist → local source at home', async () => {
    const r: any = await resolveSource(deps({ pathExists: async () => false }))
    expect(r.kind).toBe('local'); expect(r.start).toBe('/home/me')
  })
  it('non-terminal → local source at home', async () => {
    const r: any = await resolveSource(deps({ isLocalTerminal: false, supportsWorkingDirectory: false }))
    expect(r.kind).toBe('local'); expect(r.start).toBe('/home/me')
  })
})
