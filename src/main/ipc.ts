import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { listContactLists, createContactList, removeContactList } from './repos/contactLists'
import {
  pageContacts,
  listStats,
  setOptOut,
  removeContact,
  getContact,
  syncOptOutFlags,
  extraKeys
} from './repos/contacts'
import { addOptOut, removeOptOut } from './repos/optOuts'
import {
  getSendingDefaults,
  setSendingDefaults,
  getAiSettings,
  setAiSettings,
  getCampaignDraft,
<<<<<<< HEAD
  setCampaignDraft
} from './settings'
=======
  setCampaignDraft,
  getBackgroundSettings,
  setBackgroundSettings
} from './settings'
import { applyLaunchAtLogin } from './tray'
>>>>>>> f4de36f
import { whatsapp } from './core/whatsapp/client'
import { join, basename } from 'node:path'
import { statSync } from 'node:fs'
import { writeFile, copyFile } from 'node:fs/promises'
import { buildPreview, importCsv, guessMapping, buildExportCsv } from './core/contacts/import'
import { buildTemplateCsv, TEMPLATE_FILENAME } from './core/contacts/template'
import { validateList } from './core/contacts/validate'
import { inboxEvents, downloadMedia, previewLabel } from './core/whatsapp/inbox'
import { copyIntoMedia, kindForMime, mimeForPath, saveMedia } from './core/whatsapp/mediaStore'
import {
  planCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  progressOf
} from './core/campaign/service'
import { campaignEvents, campaignRunner } from './core/campaign/worker'
import { listCampaigns, jobsWithContacts } from './repos/campaigns'
import {
  listChats,
  listMessages,
  markRead,
  insertMessage,
  upsertChat,
  totalUnread,
  getMessage,
  getMessageRow,
  type InsertMessageInput
} from './repos/chats'
import { scoped } from './logger'
import {
  updaterEvents,
  getUpdateState,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall
} from './updater'
import type {
  AiSettings,
  SendingDefaults,
  ContactFilter,
  CsvPreview,
  CsvMapping,
  WhatsappState,
  MessageMode,
  MessageConfig,
  CampaignDraft,
  JobStatus,
<<<<<<< HEAD
=======
  MediaKind,
  BackgroundSettings,
>>>>>>> f4de36f
  UpdateState
} from '@shared/types'

const log = scoped('whatsapp')
const csvLog = scoped('csv')

/** Envia um evento para todas as janelas abertas. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif']
const VIDEO_EXT = ['mp4', 'mov', '3gp', 'webm']

/**
 * Grava na conversa uma mensagem que acabamos de enviar.
 *
 * Nao esperamos o eco do `messages.upsert`: ele chega com atraso e a mensagem
 * do usuario ficaria alguns segundos sumida da tela. Como a insercao e
 * idempotente pelo id da mensagem, quando o eco chegar ele nao duplica nada.
 */
function recordOutgoing(input: {
  chatJid: string
  waId: string | null
  id?: string
  body: string | null
  preview: string | null
  media?: Partial<InsertMessageInput>
}): void {
  const now = Date.now()
  insertMessage({
    id: input.id ?? input.waId ?? `local-${now}`,
    chatJid: input.chatJid,
    direction: 'out',
    body: input.body,
    ts: now,
    waMessageId: input.waId,
    status: 'sent',
    ...input.media
  })
  upsertChat(input.chatJid, { lastMessage: input.preview, lastTs: now })
  broadcast('inbox:changed', { chatJid: input.chatJid })
}

export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('app:ping', () => 'pong')

  /* ── WhatsApp ─────────────────────────────────────────────────────────── */
  whatsapp.on('state', (state: WhatsappState) => {
    // O ciclo de vida do Baileys e a parte mais dificil de depurar, e o QR nao
    // aparece em nenhum log por padrao.
    log.info(`status=${state.status}`, {
      qr: state.qrDataUrl ? 'gerado' : undefined,
      me: state.me?.id,
      erro: state.lastError ?? undefined
    })
    broadcast('whatsapp:state', state)
  })

  ipcMain.handle('whatsapp:getState', () => whatsapp.getState())
  ipcMain.handle('whatsapp:connect', () => whatsapp.connect())
  ipcMain.handle('whatsapp:disconnect', () => whatsapp.disconnect())
  ipcMain.handle('whatsapp:logout', () => whatsapp.logout())

  /* ── Bases ────────────────────────────────────────────────────────────── */
  ipcMain.handle('contactLists:list', () => listContactLists())
  ipcMain.handle('contactLists:create', (_e, name: string) => createContactList(name))
  ipcMain.handle('contactLists:remove', (_e, id: string) => removeContactList(id))
  ipcMain.handle('contactLists:stats', (_e, id: string) => listStats(id))

  /* ── Contatos ─────────────────────────────────────────────────────────── */
  ipcMain.handle(
    'contacts:page',
    (
      _e,
      listId: string,
      opts: { search?: string; filter?: ContactFilter; offset?: number; limit?: number }
    ) => pageContacts(listId, opts)
  )

  ipcMain.handle('contacts:setOptOut', (_e, contactId: string, optOut: boolean) => {
    // Grava tambem no opt-out GLOBAL: e isso que protege o numero nas outras bases.
    const contact = getContact(contactId)
    if (contact) {
      if (optOut) addOptOut(contact.phoneE164, 'manual')
      else removeOptOut(contact.phoneE164)
    }
    setOptOut(contactId, optOut)
  })

  ipcMain.handle('contacts:remove', (_e, contactId: string) => removeContact(contactId))

  ipcMain.handle('contacts:validate', async (_e, listId: string) => {
    const result = await validateList(listId, (p) => broadcast('contacts:validateProgress', p))
    return result
  })

  /* ── CSV ──────────────────────────────────────────────────────────────── */
  ipcMain.handle('csv:pick', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win, {
      title: 'Escolha o arquivo CSV',
      filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const preview = await buildPreview(res.filePaths[0])
    return { ...preview, suggested: guessMapping(preview.headers) }
  })

  ipcMain.handle(
    'csv:import',
    async (_e, listId: string, preview: CsvPreview, mapping: CsvMapping) => {
      const report = await importCsv(listId, preview, mapping)
      syncOptOutFlags(listId)
      return report
    }
  )

  ipcMain.handle('csv:saveTemplate', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showSaveDialog(win, {
      title: 'Salvar modelo de planilha',
      defaultPath: join(app.getPath('downloads'), TEMPLATE_FILENAME),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, buildTemplateCsv())
    csvLog.info('modelo de planilha salvo', { caminho: res.filePath })
    return res.filePath
  })

  ipcMain.handle('csv:exportList', async (_e, listId: string) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const nome = listContactLists().find((l) => l.id === listId)?.name ?? 'contatos'
    const seguro = nome.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'contatos'
    const res = await dialog.showSaveDialog(win, {
      title: 'Exportar contatos',
      defaultPath: join(app.getPath('downloads'), `${seguro}.csv`),
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (res.canceled || !res.filePath) return null
    await writeFile(res.filePath, buildExportCsv(listId))
    csvLog.info('base exportada', { listId, caminho: res.filePath })
    return res.filePath
  })

  ipcMain.handle('contacts:extraKeys', (_e, listId: string) => extraKeys(listId))

  /* ── Campanhas ────────────────────────────────────────────────────────── */
  campaignEvents.on('progress', (p) => broadcast('campaign:progress', p))
  campaignEvents.on('stopped', (p) => broadcast('campaign:stopped', p))

  ipcMain.handle(
    'campaign:plan',
    (_e, listId: string, mode: MessageMode, config: MessageConfig, skipAlreadySent?: boolean) =>
      planCampaign(listId, mode, config, skipAlreadySent)
  )
  ipcMain.handle(
    'campaign:start',
    (
      _e,
      input: {
        name: string
        listId: string
        mode: MessageMode
        config: MessageConfig
        pacing: SendingDefaults
        skipAlreadySent?: boolean
      }
    ) => startCampaign(input)
  )
  ipcMain.handle('campaign:pause', () => pauseCampaign())
  ipcMain.handle('campaign:resume', (_e, campaignId: string) => resumeCampaign(campaignId))
  ipcMain.handle('campaign:cancel', () => cancelCampaign())
  ipcMain.handle('campaign:progress', (_e, campaignId: string) => progressOf(campaignId))
  ipcMain.handle('campaign:list', () =>
    listCampaigns().map((c) => ({
      id: c.id,
      name: c.name,
      listId: c.listId,
      mode: c.mode,
      status: c.status,
      createdAt: c.createdAt
    }))
  )

  // Retomavel: em execucao, ou pausada com fila pendente.
  ipcMain.handle('campaign:active', () => {
    const active = campaignRunner.activeCampaignId
    if (active) return progressOf(active)
    for (const c of listCampaigns()) {
      if (c.status === 'running' || c.status === 'paused') {
        const p = progressOf(c.id)
        if (p.pending > 0) return p
      }
    }
    return null
  })

  ipcMain.handle(
    'campaign:jobs',
<<<<<<< HEAD
    (
      _e,
      campaignId: string,
      opts?: { status?: JobStatus; limit?: number; offset?: number }
    ) => jobsWithContacts(campaignId, opts ?? {})
  )

  ipcMain.handle('campaign:loadDraft', () => getCampaignDraft())
  ipcMain.handle('campaign:saveDraft', (_e, draft: CampaignDraft | null) =>
    setCampaignDraft(draft)
  )
=======
    (_e, campaignId: string, opts?: { status?: JobStatus; limit?: number; offset?: number }) =>
      jobsWithContacts(campaignId, opts ?? {})
  )

  ipcMain.handle('campaign:loadDraft', () => getCampaignDraft())
  ipcMain.handle('campaign:saveDraft', (_e, draft: CampaignDraft | null) => setCampaignDraft(draft))
>>>>>>> f4de36f

  /* ── Inbox ────────────────────────────────────────────────────────────── */
  inboxEvents.on('changed', (p: { chatJid: string; optOut?: boolean }) =>
    broadcast('inbox:changed', p)
  )

  ipcMain.handle('inbox:chats', () => listChats())
  ipcMain.handle('inbox:totalUnread', () => totalUnread())
  ipcMain.handle('inbox:messages', (_e, chatJid: string) => listMessages(chatJid))
  ipcMain.handle('inbox:markRead', async (_e, chatJid: string) => {
    markRead(chatJid)
    // Avisa o renderer para o badge de nao lidas zerar na hora.
    broadcast('inbox:changed', { chatJid })
    // E manda o visto para o WhatsApp, para o nao-lido zerar no celular tambem.
    await whatsapp.markReadOnWhatsapp(chatJid)
  })

  ipcMain.handle('inbox:send', async (_e, chatJid: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const waId = await whatsapp.sendText(chatJid, trimmed)
    // Registra localmente na hora: o `messages.upsert` costuma ecoar o proprio
    // envio, e a insercao e idempotente pelo id, entao nao duplica.
    recordOutgoing({ chatJid, waId, body: trimmed, preview: trimmed })
  })

  ipcMain.handle('inbox:pickAttachment', async (_e, kind: 'media' | 'document' | 'audio') => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const filters = {
      media: [{ name: 'Imagens e videos', extensions: [...IMAGE_EXT, ...VIDEO_EXT] }],
      audio: [{ name: 'Audio', extensions: ['mp3', 'ogg', 'opus', 'm4a', 'aac', 'wav', 'amr'] }],
      document: [{ name: 'Todos os arquivos', extensions: ['*'] }]
    }[kind]

    const res = await dialog.showOpenDialog(win, {
      title: 'Escolha o arquivo',
      filters,
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return null

    const filePath = res.filePaths[0]
    const fileName = basename(filePath)
    const mime = mimeForPath(filePath)
    return {
      filePath,
      fileName,
      mime,
      size: statSync(filePath).size,
      // Documento e explicito: se o usuario escolheu "arquivo", mandar como
      // imagem tiraria dele o nome do arquivo do outro lado.
      kind: kind === 'document' ? ('document' as const) : kindForMime(mime, fileName)
    }
  })

  ipcMain.handle(
    'inbox:sendMedia',
    async (
      _e,
      chatJid: string,
      input: { filePath: string; kind: MediaKind; fileName: string; mime: string; caption?: string }
    ) => {
      const waId = await whatsapp.sendMedia(chatJid, input)
      const id = waId ?? `local-${Date.now()}`
      // Guarda uma copia local: o usuario pode apagar o original depois, e a
      // conversa nao pode ficar com um anexo quebrado por causa disso.
      const path = copyIntoMedia(id, input.filePath, input.mime, input.fileName)

      recordOutgoing({
        chatJid,
        waId,
        id,
        body: input.caption?.trim() || null,
        preview: previewLabel(
          {
            kind: input.kind,
            mime: input.mime,
            name: input.fileName,
            size: null,
            seconds: null,
            ptt: false
          },
          input.caption?.trim() || null
        ),
        media: {
          mediaKind: input.kind,
          mediaPath: path,
          mediaMime: input.mime,
          mediaName: input.fileName,
          mediaSize: statSync(path).size,
          mediaState: 'done'
        }
      })
    }
  )

  ipcMain.handle(
    'inbox:sendVoice',
    async (_e, chatJid: string, webmBase64: string, seconds: number) => {
      const { waId, ogg } = await whatsapp.sendVoice(
        chatJid,
        Buffer.from(webmBase64, 'base64'),
        seconds
      )
      const id = waId ?? `local-${Date.now()}`
      // Guardamos o ogg (o que o contato recebeu), nao o webm gravado.
      const path = saveMedia(id, ogg, 'audio/ogg')

      recordOutgoing({
        chatJid,
        waId,
        id,
        body: null,
        preview: '[audio]',
        media: {
          mediaKind: 'audio',
          mediaPath: path,
          mediaMime: 'audio/ogg; codecs=opus',
          mediaSize: ogg.length,
          mediaSeconds: Math.max(1, Math.round(seconds)),
          mediaPtt: true,
          mediaState: 'done'
        }
      })
    }
  )

  ipcMain.handle('inbox:downloadMedia', async (_e, messageId: string) => {
    await downloadMedia(messageId)
    return getMessage(messageId)
  })

  ipcMain.handle('inbox:openMedia', async (_e, messageId: string) => {
    const row = getMessageRow(messageId)
    if (!row?.mediaPath) return
    await shell.openPath(row.mediaPath)
  })

  ipcMain.handle('inbox:saveMediaAs', async (_e, messageId: string) => {
    const row = getMessageRow(messageId)
    if (!row?.mediaPath) return null
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const suggested = row.mediaName || basename(row.mediaPath)
    const res = await dialog.showSaveDialog(win, {
      title: 'Salvar anexo',
      defaultPath: join(app.getPath('downloads'), suggested)
    })
    if (res.canceled || !res.filePath) return null
    await copyFile(row.mediaPath, res.filePath)
    return res.filePath
  })

  ipcMain.handle('inbox:resync', () => whatsapp.resync())

  /* ── Configuracoes ────────────────────────────────────────────────────── */
  ipcMain.handle('settings:getSendingDefaults', () => getSendingDefaults())
  ipcMain.handle('settings:setSendingDefaults', (_e, v: SendingDefaults) => setSendingDefaults(v))
  ipcMain.handle('settings:getBackground', () => getBackgroundSettings())
  ipcMain.handle('settings:setBackground', (_e, v: BackgroundSettings) => {
    setBackgroundSettings(v)
    // Aplica na hora: o item de inicializacao do sistema e estado externo ao
    // app, entao guardar sem aplicar deixaria os dois fora de sincronia.
    applyLaunchAtLogin(v.launchAtLogin)
  })

  ipcMain.handle('settings:getAi', () => getAiSettings())
  ipcMain.handle(
    'settings:setAi',
    (_e, provider: AiSettings['provider'], model: string, apiKey?: string) =>
      setAiSettings(provider, model, apiKey)
  )

  /* ── Atualizacao ──────────────────────────────────────────────────────── */
  updaterEvents.on('state', (s: UpdateState) => broadcast('updater:state', s))

  ipcMain.handle('updater:getState', () => getUpdateState())
  ipcMain.handle('updater:check', () => checkForUpdates())
  ipcMain.handle('updater:download', () => downloadUpdate())
  ipcMain.handle('updater:install', () => quitAndInstall())
}
