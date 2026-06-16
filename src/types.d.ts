declare module '*.pug' {
  const content: string
  export default content
}
declare module '*.scss' {
  const content: string
  export default content
}
declare module '*.svg' {
  const content: string
  export default content
}
declare module 'electron' {
  export const shell: { openExternal(url: string): Promise<void> }
}
