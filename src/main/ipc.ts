import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import {
  listContactLists,
  createContactList,
  removeContactList
} from './repos/contactLists'
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
  setAiSettings
} from './settings'
import { whatsapp } from './core/whatsapp/client'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { buildPreview, importCsv, guessMapping, buildExportCsv } from './core/contacts/import'
import { buildTemplateCsv, TEMPLATE_FILENAME } from './core/contacts/template'
import { validateList } from './core/contacts/validate'
import { inboxEvents } from './core/whatsapp/inbox'
import {
  planCampaign,
  startCampaign,
  pauseCampaign,
  resumeCampaign,
  cancelCampaign,
  progressOf
} from './core/campaign/service'
import { campaignEvents, campaignRunner } from './core/campaign/worker'
import { listCampaigns } from './repos/campaigns'
import {
  listChats,
  listMessages,
  markRead,
  insertMessage,
  upsertChat,
  totalUnread
} from './repos/chats'
import { scoped } from './logger'
import type {
  AiSettings,
  SendingDefaults,
  ContactFilter,
  CsvPreview,
  CsvMapping,
  WhatsappState,
  MessageMode,
  MessageConfig
} from '@shared/types'

const log = scoped('whatsapp')
const csvLog = scoped('csv')

/** Envia um evento para todas as janelas abertas. */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
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

  ipcMain.handle('campaign:plan', (_e, listId: string, mode: MessageMode, config: MessageConfig) =>
    planCampaign(listId, mode, config)
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

  /* ── Inbox ────────────────────────────────────────────────────────────── */
  inboxEvents.on('changed', (p: { chatJid: string; optOut?: boolean }) =>
    broadcast('inbox:changed', p)
  )

  ipcMain.handle('inbox:chats', () => listChats())
  ipcMain.handle('inbox:totalUnread', () => totalUnread())
  ipcMain.handle('inbox:messages', (_e, chatJid: string) => listMessages(chatJid))
  ipcMain.handle('inbox:markRead', (_e, chatJid: string) => {
    markRead(chatJid)
    // Avisa o renderer para o badge de nao lidas zerar na hora.
    broadcast('inbox:changed', { chatJid })
  })

  ipcMain.handle('inbox:send', async (_e, chatJid: string, text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    const waId = await whatsapp.sendText(chatJid, trimmed)
    // Registra localmente na hora: o `messages.upsert` costuma ecoar o proprio
    // envio, e a insercao e idempotente pelo id, entao nao duplica.
    const now = Date.now()
    insertMessage({
      id: waId ?? `local-${now}`,
      chatJid,
      direction: 'out',
      body: trimmed,
      ts: now,
      waMessageId: waId,
      status: 'sent'
    })
    upsertChat(chatJid, { lastMessage: trimmed, lastTs: now })
    broadcast('inbox:changed', { chatJid })
  })

  /* ── Configuracoes ────────────────────────────────────────────────────── */
  ipcMain.handle('settings:getSendingDefaults', () => getSendingDefaults())
  ipcMain.handle('settings:setSendingDefaults', (_e, v: SendingDefaults) =>
    setSendingDefaults(v)
  )
  ipcMain.handle('settings:getAi', () => getAiSettings())
  ipcMain.handle(
    'settings:setAi',
    (_e, provider: AiSettings['provider'], model: string, apiKey?: string) =>
      setAiSettings(provider, model, apiKey)
  )
}
