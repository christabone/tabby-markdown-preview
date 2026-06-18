import { resolveSource, ResolveDeps, deriveTabFacts } from '../src/sourceResolver'

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

describe('deriveTabFacts (unwraps the focused leaf of a SplitTabComponent)', () => {
  const termSession = { supportsWorkingDirectory: () => true, getWorkingDirectory: async () => '/r' }

  it('unwraps a SplitTabComponent wrapper to a focused SSH leaf', () => {
    const sshLeaf = { sshSession: { openSFTP: async () => ({}) }, session: termSession, profile: { type: 'ssh' } }
    const f = deriveTabFacts({ getFocusedTab: () => sshLeaf })
    expect(f.isSshTab).toBe(true)
    expect(f.sshSession).toBe(sshLeaf.sshSession)
    expect(f.session).toBe(sshLeaf.session)
    expect(f.isLocalTerminal).toBe(false)
  })

  it('unwraps to a focused local terminal leaf', () => {
    const localLeaf = { session: termSession, profile: { type: 'local' } }
    const f = deriveTabFacts({ getFocusedTab: () => localLeaf })
    expect(f.isSshTab).toBe(false)
    expect(f.isLocalTerminal).toBe(true)
    expect(f.session).toBe(localLeaf.session)
  })

  it('handles a directly-focused SSH leaf with no wrapper', () => {
    const sshLeaf = { sshSession: { openSFTP: async () => ({}) }, session: termSession }
    expect(deriveTabFacts(sshLeaf).isSshTab).toBe(true)
  })

  it('treats a non-terminal tab (no getFocusedTab, no session) as neither', () => {
    const f = deriveTabFacts({})
    expect(f.isSshTab).toBe(false)
    expect(f.isLocalTerminal).toBe(false)
  })

  it('does not classify a remote (ssh/telnet/serial) profile as a local terminal', () => {
    const f = deriveTabFacts({ getFocusedTab: () => ({ session: termSession, profile: { type: 'telnet' } }) })
    expect(f.isLocalTerminal).toBe(false)
  })

  it('null active tab → neither', () => {
    const f = deriveTabFacts(null)
    expect(f.isSshTab).toBe(false)
    expect(f.isLocalTerminal).toBe(false)
  })
})
