import { LocalFileSource } from '../src/fileSource'

describe('LocalFileSource', () => {
  it('exposes start/notice/allowImages and POSIX-or-local parentOf', () => {
    const s = new LocalFileSource('/home/me', 'hi')
    expect(s.start).toBe('/home/me')
    expect(s.notice).toBe('hi')
    expect(s.allowImages).toBe(true)
    expect(s.parentOf('/home/me/docs')).toBe('/home/me')
  })
})
