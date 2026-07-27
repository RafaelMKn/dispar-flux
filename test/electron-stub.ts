/**
 * Stub do modulo `electron` para os testes.
 *
 * Os modulos do processo main (db, settings, repos) importam `electron`, que so
 * existe dentro do runtime do Electron. Com este stub eles rodam no vitest, o
 * que permite testar a camada de dados de verdade — necessario para o teste de
 * crash/resume da fila de disparo.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const userData = mkdtempSync(join(tmpdir(), 'dispar-flux-test-'))

export const app = {
  getPath: (name: string): string => (name === 'userData' ? userData : userData),
  getVersion: (): string => '0.0.0-test'
}

/** Sem criptografia nos testes: o settings cai no caminho de texto plano. */
export const safeStorage = {
  isEncryptionAvailable: (): boolean => false,
  encryptString: (s: string): Buffer => Buffer.from(s, 'utf-8'),
  decryptString: (b: Buffer): string => b.toString('utf-8')
}

export const ipcMain = {
  handle: (): void => {},
  on: (): void => {}
}

export const BrowserWindow = {
  getAllWindows: (): unknown[] => [],
  getFocusedWindow: (): unknown => null
}

export const dialog = {
  showOpenDialog: async (): Promise<{ canceled: boolean; filePaths: string[] }> => ({
    canceled: true,
    filePaths: []
  })
}

export const shell = { openExternal: async (): Promise<void> => {} }
