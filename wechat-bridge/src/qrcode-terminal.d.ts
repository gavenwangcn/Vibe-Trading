declare module 'qrcode-terminal' {
  function generate(url: string, options?: { small?: boolean }, callback?: (qr: string) => void): void
  const _default: { generate: typeof generate }
  export default _default
}
