// Arquivo sem import/export de proposito: so um .d.ts global aceita declaracao
// de modulo com curinga. Se isto virar um modulo, `declare module` passa a ser
// augmentation e o TypeScript volta a nao achar os guias.

/** Markdown importado como texto puro (`import guia from '@docs/x.md?raw'`). */
declare module '*.md?raw' {
  const content: string
  export default content
}
