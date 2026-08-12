import { app, BrowserWindow, protocol, net, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { MEDIA_SCHEME, resolveMediaUrl } from './core/whatsapp/mediaStore'
import { initDb, saveNow } from './db'
import { registerIpc } from './ipc'
import { whatsapp } from './core/whatsapp/client'
import { log, scoped, getLogPath, closeLogger } from './logger'
import { reconcileStuckJobs } from './repos/campaigns'
import { reconcileRunningCampaign } from './core/campaign/worker'
import { initUpdater } from './updater'
import {
  initTray,
  destroyTray,
  applyLaunchAtLogin,
  shouldStartHidden,
  notifyMinimizedToTray,
  notify
} from './tray'
import { startScheduler } from './core/crm/scheduler'
import {
  repairChatTimestamps,
  clearPhantomChatDates,
  clearUnprovenFullSync,
  mergeLidChats,
  backfillServerTimestamps,
  refreshLeadFlags
} from './repos/chats'
import { mappedLidChats } from './repos/lidMap'
import { getBackgroundSettings, shouldShowTrayNotice, getJson, setJson } from './settings'
import { beginQuit, shouldHideOnClose } from './lifecycle'

/**
 * Scheme proprio para o renderer exibir midia da inbox.
 *
 * O renderer roda com `contextIsolation` e, no app instalado, com origem
 * `file://` — nao pode apontar um `<img>`/`<audio>` para um caminho absoluto do
 * disco. Registrar um scheme e o caminho suportado pelo Electron. `stream:
 * true` e o que permite o `<audio>` fazer seek numa nota de voz, que um data:
 * URL nao daria.
 *
 * Precisa acontecer ANTES do app ficar pronto, por isso esta no topo do modulo.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, (request) => {
    // A validacao de caminho vive no mediaStore: e ela que impede este handler
    // de virar leitura arbitraria de disco a partir do renderer.
    const path = resolveMediaUrl(request.url)
    if (!path) return new Response(null, { status: 404 })
    // `net.fetch` sobre file:// entrega o arquivo em stream e ja trata Range,
    // que e o que o <audio> usa para navegar no meio do audio.
    return net.fetch(pathToFileURL(path).toString())
  })
}

function requestQuit(): void {
  beginQuit()
  app.quit()
}

/** Traz a janela de volta da bandeja, recriando-a se ja foi destruida. */
function showWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(startHidden = false): BrowserWindow {
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

  win.on('ready-to-show', () => {
    // Aberto pelo sistema no login: sobe direto para a bandeja, sem roubar a
    // tela de quem acabou de ligar o computador.
    if (!startHidden) win.show()
  })

  /**
   * Fechar a janela esconde o app em vez de encerrar, para o disparo em
   * andamento continuar. E a razao de existir a issue: hoje um clique no X
   * matava a campanha no meio.
   */
  win.on('close', (e) => {
    if (!shouldHideOnClose(getBackgroundSettings().closeToTray)) return
    e.preventDefault()
    win.hide()
    if (shouldShowTrayNotice()) notifyMinimizedToTray()
  })

  // Diagnostico de tela branca: no app empacotado nao ha console visivel, entao
  // erro de renderer/preload so aparece se for espelhado no log do main.
  const rlog = scoped('renderer')
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const at = sourceId ? ` (${sourceId}:${line})` : ''
    if (level >= 3) rlog.error(`${message}${at}`)
    else if (level === 2) rlog.warn(`${message}${at}`)
  })
  win.webContents.on('preload-error', (_e, preloadPath, error) => {
    rlog.fatal(`preload falhou: ${preloadPath}`, error)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    rlog.error(`did-fail-load ${code} ${desc}`, { url })
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    rlog.fatal('render-process-gone', details)
  })

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

async function bootstrap(): Promise<void> {
  await app.whenReady()
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

  // Inbox: conserta as datas erradas herdadas de versoes anteriores (conversa
  // carimbada com "agora" no lugar da data da mensagem) e marca quem esta na
  // base de leads, que e o foco da tela.
  const redatadas = repairChatTimestamps()
  if (redatadas > 0) log.info(`${redatadas} conversa(s) tiveram a data corrigida`)
  if (!getJson('inbox.phantomDatesCleared', false)) {
    const fantasmas = clearPhantomChatDates()
    setJson('inbox.phantomDatesCleared', true)
    if (fantasmas > 0) log.info(`${fantasmas} conversa(s) sem mensagem perderam a data inventada`)
  }
  // Conversas dadas como "historico completo" so porque o celular nao respondeu
  // a tempo: volta todas para a fila (ver clearUnprovenFullSync).
  if (!getJson('inbox.unprovenFullSyncCleared', false)) {
    const desmarcadas = clearUnprovenFullSync()
    setJson('inbox.unprovenFullSyncCleared', true)
    if (desmarcadas > 0) {
      log.info(`${desmarcadas} conversa(s) voltaram para a fila de sincronizacao`)
    }
  }
  /**
   * Recupera o carimbo do servidor das mensagens gravadas antes da coluna
   * `wa_ts` existir. Sem isso TODA conversa antiga ficaria sem ancora e o app
   * pararia de sincronizar historico — ver `backfillServerTimestamps`.
   */
  if (!getJson('inbox.waTsBackfilled', false)) {
    const recuperadas = backfillServerTimestamps()
    setJson('inbox.waTsBackfilled', true)
    if (recuperadas > 0) {
      log.info(`${recuperadas} mensagem(ns) recuperaram o carimbo do WhatsApp`)
    }
    /**
     * E devolve para a fila quem foi dado como completo com a ancora quebrada.
     *
     * O `clearUnprovenFullSync` acima ja rodou uma vez, com o marcador antigo;
     * quem sincronizou depois dele "completou" conversas pedindo historico com
     * um carimbo que o celular nunca resolveu. Marcador proprio para nao
     * disputar com aquele.
     */
    const desmarcadas = clearUnprovenFullSync()
    if (desmarcadas > 0) {
      log.info(`${desmarcadas} conversa(s) voltaram para a fila apos a correcao da ancora`)
    }
  }
  /**
   * A semantica de "conversa completa" mudou nesta versao.
   *
   * Ate aqui um `busy` ou um `requestFailed` — casos em que pedido nenhum saiu
   * daqui — ainda carimbavam a conversa via `setChatSync`. Quem foi marcado
   * naquele caminho precisa voltar para a fila uma ultima vez; dai o marcador
   * proprio, para nao disputar com os dois anteriores.
   */
  if (!getJson('inbox.unprovenFullSyncV3', false)) {
    const desmarcadas = clearUnprovenFullSync()
    setJson('inbox.unprovenFullSyncV3', true)
    if (desmarcadas > 0) {
      log.info(`${desmarcadas} conversa(s) voltaram para a fila apos a revisao dos desfechos`)
    }
  }
  /**
   * Junta as conversas que o endereçamento LID partiu em duas.
   *
   * Roda com o mapa que ja conseguimos montar; conversa LID sem traducao fica
   * onde esta e a varredura por USync resolve depois, fundindo no proximo boot.
   * Por isso NAO ha flag one-shot aqui: enquanto sobrar LID por traduzir, ainda
   * ha trabalho a fazer, e a funcao e barata quando nao ha nada a fundir.
   */
  const fundidas = mergeLidChats(mappedLidChats())
  if (fundidas > 0) {
    log.info(`${fundidas} conversa(s) duplicada(s) por LID foram unificadas`)
  }

  log.info(`${refreshLeadFlags()} conversa(s) na base de leads`)

  // Sem isso o Windows nao mostra as notificacoes do app (ele as associa ao
  // executavel do Electron em vez do nosso).
  app.setAppUserModelId('com.disparflux.app')

  registerMediaProtocol()
  registerIpc()

  const background = getBackgroundSettings()
  applyLaunchAtLogin(background.launchAtLogin)
  createWindow(shouldStartHidden())
  initTray({ showWindow, requestQuit })

  // Depois da bandeja existir: o agendador avisa compromissos por notificacao,
  // e a notificacao usa o icone da bandeja.
  startScheduler({ notify })

  // Depois da janela existir: o broadcast de estado so alcanca janelas abertas.
  initUpdater()
  log.info('app pronto', { logFile: getLogPath(), bandeja: background.closeToTray })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Se ja existe sessao salva em userData/wa-auth, reconecta sozinho (sem QR).
  // Se nao existe, o Baileys emitiria um QR que ninguem pediu — entao so
  // reconectamos quando ha credenciais.
  if (whatsapp.hasStoredSession()) {
    log.info('sessao encontrada, reconectando WhatsApp')
    void whatsapp.connect().catch((e: unknown) => log.error('falha ao reconectar', e))
  }
}

// Instancia unica. Duas janelas abertas corromperiam a base: o sql.js mantem o
// banco em memoria e o save reescreve o arquivo inteiro, entao a ultima a salvar
// apagaria o trabalho da outra. O reinicio automatico depois de uma atualizacao
// torna a sobreposicao bem mais provavel.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Abrir o app de novo enquanto ele roda escondido deve trazer a janela de
  // volta, e nao parecer que nada aconteceu.
  app.on('second-instance', () => showWindow())
  void bootstrap()
}

process.on('uncaughtException', (err) => {
  log.fatal('uncaughtException', err)
})

process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason)
})

app.on('before-quit', () => {
  // Cobre tambem os encerramentos que nao passam por requestQuit(): logoff do
  // sistema, `app.quit()` de qualquer outro ponto.
  beginQuit()
  saveNow()
  destroyTray()
  log.info('encerrando')
  closeLogger()
})

app.on('window-all-closed', () => {
  // Com fechar-para-bandeja ligado a janela e escondida, nao fechada, entao
  // este evento nao dispara. A guarda cobre o caso de a janela ser destruida
  // por outro caminho: encerrar aqui mataria o disparo em andamento.
  if (getBackgroundSettings().closeToTray) return
  if (process.platform !== 'darwin') app.quit()
})
