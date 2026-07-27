import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // Permite testar modulos do processo main fora do runtime do Electron.
      electron: resolve(__dirname, 'test/electron-stub.ts'),
      '@shared': resolve(__dirname, 'src/shared')
    }
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // O logger do app escreve no stdout; nos testes isso enterra o resultado.
    env: { DISPAR_LOG_LEVEL: 'silent', DISPAR_WA_LOG_LEVEL: 'silent' }
  }
})
