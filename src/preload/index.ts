import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  DisparApi,
  AiSettings,
  SendingDefaults,
  CsvPreview,
  CsvMapping,
  WhatsappState,
  CampaignDraft,
  UpdateState
} from '@shared/types'

/**
 * Assina um canal de evento do main e devolve a funcao de unsubscribe.
 * Sem isso, o StrictMode do React (que monta/desmonta duas vezes) acumularia
 * listeners duplicados.
 */
function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: DisparApi = {
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    ping: () => ipcRenderer.invoke('app:ping')
  },
  whatsapp: {
    getState: () => ipcRenderer.invoke('whatsapp:getState'),
    connect: () => ipcRenderer.invoke('whatsapp:connect'),
    disconnect: () => ipcRenderer.invoke('whatsapp:disconnect'),
    logout: () => ipcRenderer.invoke('whatsapp:logout'),
    onState: (cb: (s: WhatsappState) => void) => subscribe('whatsapp:state', cb)
  },
  contactLists: {
    list: () => ipcRenderer.invoke('contactLists:list'),
    create: (name: string) => ipcRenderer.invoke('contactLists:create', name),
    remove: (id: string) => ipcRenderer.invoke('contactLists:remove', id),
    stats: (id: string) => ipcRenderer.invoke('contactLists:stats', id)
  },
  contacts: {
    page: (listId, opts) => ipcRenderer.invoke('contacts:page', listId, opts),
    setOptOut: (contactId: string, optOut: boolean) =>
      ipcRenderer.invoke('contacts:setOptOut', contactId, optOut),
    extraKeys: (listId: string) => ipcRenderer.invoke('contacts:extraKeys', listId),
    remove: (contactId: string) => ipcRenderer.invoke('contacts:remove', contactId),
    validate: (listId: string) => ipcRenderer.invoke('contacts:validate', listId),
    onValidateProgress: (cb) => subscribe('contacts:validateProgress', cb)
  },
  csv: {
    pick: () => ipcRenderer.invoke('csv:pick'),
    import: (listId: string, preview: CsvPreview, mapping: CsvMapping) =>
      ipcRenderer.invoke('csv:import', listId, preview, mapping),
    saveTemplate: () => ipcRenderer.invoke('csv:saveTemplate'),
    exportList: (listId: string) => ipcRenderer.invoke('csv:exportList', listId)
  },
  campaign: {
    plan: (listId, mode, config, skipAlreadySent) =>
      ipcRenderer.invoke('campaign:plan', listId, mode, config, skipAlreadySent),
    start: (input) => ipcRenderer.invoke('campaign:start', input),
    pause: () => ipcRenderer.invoke('campaign:pause'),
    resume: (campaignId: string) => ipcRenderer.invoke('campaign:resume', campaignId),
    cancel: () => ipcRenderer.invoke('campaign:cancel'),
    progress: (campaignId: string) => ipcRenderer.invoke('campaign:progress', campaignId),
    list: () => ipcRenderer.invoke('campaign:list'),
    active: () => ipcRenderer.invoke('campaign:active'),
    loadDraft: () => ipcRenderer.invoke('campaign:loadDraft'),
    saveDraft: (draft: CampaignDraft | null) => ipcRenderer.invoke('campaign:saveDraft', draft),
    onProgress: (cb) => subscribe('campaign:progress', cb),
    onStopped: (cb) => subscribe('campaign:stopped', cb)
  },
  inbox: {
    chats: () => ipcRenderer.invoke('inbox:chats'),
    totalUnread: () => ipcRenderer.invoke('inbox:totalUnread'),
    messages: (chatJid: string) => ipcRenderer.invoke('inbox:messages', chatJid),
    send: (chatJid: string, text: string) => ipcRenderer.invoke('inbox:send', chatJid, text),
    markRead: (chatJid: string) => ipcRenderer.invoke('inbox:markRead', chatJid),
    onChanged: (cb) => subscribe('inbox:changed', cb)
  },
  settings: {
    getSendingDefaults: () => ipcRenderer.invoke('settings:getSendingDefaults'),
    setSendingDefaults: (v: SendingDefaults) =>
      ipcRenderer.invoke('settings:setSendingDefaults', v),
    getAi: () => ipcRenderer.invoke('settings:getAi'),
    setAi: (provider: AiSettings['provider'], model: string, apiKey?: string) =>
      ipcRenderer.invoke('settings:setAi', provider, model, apiKey)
  },
  updater: {
    getState: () => ipcRenderer.invoke('updater:getState'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onState: (cb: (s: UpdateState) => void) => subscribe('updater:state', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
