import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { initDb, saveNow } from './db'
import { registerIpc } from './ipc'
import { whatsapp } from './core/whatsapp/client'
import { log, getLogPath, closeLogger } from './logger'
import { reconcileStuckJobs } from './repos/campaigns'
import { reconcileRunningCampaign } from './core/campaign/worker'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 940,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'Dispar Flux',
    backgroundColor: '#FBEFE5', // --surface-base (tema claro) evita flash na abertura
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  log.info(`Dispar Flux v${app.getVersion()} iniciando`)
  await initDb()
  log.info('banco inicializado')

  // Reconciliacao pos-crash, antes de qualquer envio:
  // 1) jobs presos em 'sending' viram 'unknown' (entrega indeterminada, nunca
  //    reenviamos as cegas — duplicata e o que mais gera denuncia);
  // 2) campanha marcada como 'running' obviamente nao esta rodando.
  const ambiguos = reconcileStuckJobs()
  if (ambiguos > 0) log.warn(`${ambiguos} envio(s) com entrega indeterminada apos encerramento`)
  reconcileRunningCampaign()

  registerIpc()
  createWindow()
  log.info('app pronto', { logFile: getLogPath() })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Se ja existe sessao salva em userData/wa-auth, reconecta sozinho (sem QR).
  // Se nao existe, o Baileys emitiria um QR que ninguem pediu — entao so
  // reconectamos quando ha credenciais.
  if (existsSync(join(app.getPath('userData'), 'wa-auth', 'creds.json'))) {
    log.info('sessao encontrada, reconectando WhatsApp')
    void whatsapp.connect().catch((e: unknown) => log.error('falha ao reconectar', e))
  }
})

process.on('uncaughtException', (err) => {
  log.fatal('uncaughtException', err)
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason)
})

app.on('before-quit', () => {
  saveNow()
  log.info('encerrando')
  closeLogger()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
