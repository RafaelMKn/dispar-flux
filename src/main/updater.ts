import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { autoUpdater } from 'electron-updater'
import { saveNow } from './db'
import { beginQuit } from './lifecycle'
import { scoped } from './logger'
import type { UpdateState } from '@shared/types'

/**
 * Atualizacao automatica via GitHub Releases (electron-updater).
 *
 * O modulo so mantem estado e emite eventos; quem repassa para o renderer e o
 * `ipc.ts` (via `broadcast`), seguindo o mesmo desenho de `campaignEvents` e
 * `inboxEvents` — e o que o teste de contrato do IPC cobra.
 *
 * Nada e baixado sem o usuario mandar: um disparo pode estar em andamento, e
 * consumir banda ou reiniciar o app no meio da fila e pior do que ficar uma
 * versao atras.
 */

const log = scoped('updater')

/** Espera antes do primeiro check: nao competir com initDb + reconexao do Baileys. */
const FIRST_CHECK_DELAY_MS = 15_000
/** Intervalo entre checagens enquanto o app fica aberto. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export const updaterEvents = new EventEmitter()

let state: UpdateState = {
  status: 'idle',
  currentVersion: '0.0.0',
  version: null,
  percent: 0,
  bytesPerSecond: null,
  error: null
}

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch }
  updaterEvents.emit('state', state)
}

export function getUpdateState(): UpdateState {
  return state
}

export function initUpdater(): void {
  state.currentVersion = app.getVersion()

  // Em dev nao existe app-update.yml e qualquer check estoura. Nao e erro:
  // e o estado normal de quem roda `npm run dev`.
  if (!app.isPackaged) {
    set({ status: 'unsupported' })
    log.info('build de desenvolvimento: atualizacao automatica desativada')
    return
  }

  autoUpdater.logger = log
  autoUpdater.autoDownload = false
  // Se ele baixou e so depois fechou o app, aproveita o fechamento para
  // instalar — sem UAC e sem interromper nada.
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }))

  autoUpdater.on('update-not-available', () =>
    set({ status: 'idle', version: null, percent: 0, error: null })
  )

  autoUpdater.on('update-available', (info) => {
    log.info(`versao ${info.version} disponivel`)
    set({ status: 'available', version: info.version, percent: 0, error: null })
  })

  autoUpdater.on('download-progress', (p) =>
    set({
      status: 'downloading',
      percent: Math.round(p.percent),
      bytesPerSecond: Math.round(p.bytesPerSecond)
    })
  )

  autoUpdater.on('update-downloaded', (info) => {
    log.info(`versao ${info.version} baixada, aguardando reinicio`)
    set({ status: 'ready', version: info.version, percent: 100, bytesPerSecond: null })
  })

  autoUpdater.on('error', (err: Error) => {
    // Sem rede, GitHub fora do ar e release ainda em rascunho caem todos aqui.
    // Nada disso e fatal: o app continua funcionando na versao instalada.
    // Sem o objeto de erro: o proprio electron-updater ja logou a stack por
    // este mesmo logger, e repetir deixa o arquivo ilegivel.
    const msg = err?.message ?? String(err)
    log.error(`falha no fluxo de atualizacao: ${msg}`)
    set({ status: 'error', error: msg })
  })

  setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS)
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    // O listener de 'error' ja registrou o estado; aqui so evitamos que a
    // rejeicao vire unhandledRejection.
    log.debug('checkForUpdates rejeitou', e)
  }
}

export async function downloadUpdate(): Promise<void> {
  if (state.status !== 'available') return
  try {
    set({ status: 'downloading', percent: 0, error: null })
    await autoUpdater.downloadUpdate()
  } catch (e) {
    log.error('falha ao baixar a atualizacao', e)
    set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

export function quitAndInstall(): void {
  if (state.status !== 'ready') return
  // O sql.js mantem o banco em memoria e so persiste quando exportamos os
  // bytes. `quitAndInstall` nao passa pelo caminho normal de saida, entao o
  // save tem que ser explicito aqui.
  saveNow()
  // Sem isto, o handler de `close` da janela (fechar-para-bandeja) cancelaria o
  // fechamento e a atualizacao nunca seria instalada.
  beginQuit()
  log.info('reiniciando para instalar a atualizacao')
  // isSilent=false mostra o instalador; isForceRunAfter=true reabre o app.
  autoUpdater.quitAndInstall(false, true)
}
