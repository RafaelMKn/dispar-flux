import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  DisparApi,
  AiSettings,
  SendingDefaults,
  CsvPreview,
  CsvMapping,
  WhatsappState,
  CampaignDraft,
  JobStatus,
  BackgroundSettings,
  UpdateState,
  CrmSettings,
  CrmAppointmentInput,
  FollowUpRuleInput,
  HistorySyncState,
  ChatSyncState
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
    dismissRelinkNotice: () => ipcRenderer.invoke('whatsapp:dismissRelinkNotice'),
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
    jobs: (campaignId: string, opts?: { status?: JobStatus; limit?: number; offset?: number }) =>
      ipcRenderer.invoke('campaign:jobs', campaignId, opts),
    loadDraft: () => ipcRenderer.invoke('campaign:loadDraft'),
    saveDraft: (draft: CampaignDraft | null) => ipcRenderer.invoke('campaign:saveDraft', draft),
    onProgress: (cb) => subscribe('campaign:progress', cb),
    onStopped: (cb) => subscribe('campaign:stopped', cb)
  },
  inbox: {
    chats: (opts) => ipcRenderer.invoke('inbox:chats', opts),
    chat: (chatJid: string) => ipcRenderer.invoke('inbox:chat', chatJid),
    leadCount: () => ipcRenderer.invoke('inbox:leadCount'),
    totalUnread: () => ipcRenderer.invoke('inbox:totalUnread'),
    messages: (chatJid: string, limit?: number) =>
      ipcRenderer.invoke('inbox:messages', chatJid, limit),
    count: (chatJid: string) => ipcRenderer.invoke('inbox:count', chatJid),
    requestOlder: (chatJid: string) => ipcRenderer.invoke('inbox:requestOlder', chatJid),
    syncChat: (chatJid: string, days: number | null) =>
      ipcRenderer.invoke('inbox:syncChat', chatJid, days),
    opened: (chatJid: string) => ipcRenderer.invoke('inbox:opened', chatJid),
    syncLeads: (maxChats?: number) => ipcRenderer.invoke('inbox:syncLeads', maxChats),
    cancelLeadSync: () => ipcRenderer.invoke('inbox:cancelLeadSync'),
    leadSyncState: () => ipcRenderer.invoke('inbox:leadSyncState'),
    onLeadSync: (cb: (s: ChatSyncState) => void) => subscribe('inbox:leadSync', cb),
    onHistoryLate: (cb: (p: { chatJid: string; inserted: number }) => void) =>
      subscribe('inbox:historyLate', cb),
    syncState: () => ipcRenderer.invoke('inbox:syncState'),
    onSyncProgress: (cb: (s: HistorySyncState) => void) => subscribe('inbox:syncProgress', cb),
    send: (chatJid: string, text: string) => ipcRenderer.invoke('inbox:send', chatJid, text),
    markRead: (chatJid: string) => ipcRenderer.invoke('inbox:markRead', chatJid),
    pickAttachment: (kind: 'media' | 'document' | 'audio') =>
      ipcRenderer.invoke('inbox:pickAttachment', kind),
    sendMedia: (chatJid: string, input) => ipcRenderer.invoke('inbox:sendMedia', chatJid, input),
    sendVoice: (chatJid: string, webmBase64: string, seconds: number) =>
      ipcRenderer.invoke('inbox:sendVoice', chatJid, webmBase64, seconds),
    downloadMedia: (messageId: string) => ipcRenderer.invoke('inbox:downloadMedia', messageId),
    openMedia: (messageId: string) => ipcRenderer.invoke('inbox:openMedia', messageId),
    saveMediaAs: (messageId: string) => ipcRenderer.invoke('inbox:saveMediaAs', messageId),
    resync: () => ipcRenderer.invoke('inbox:resync'),
    onChanged: (cb) => subscribe('inbox:changed', cb)
  },
  crm: {
    board: () => ipcRenderer.invoke('crm:board'),
    moveLead: (leadId: string, stageId: string) =>
      ipcRenderer.invoke('crm:moveLead', leadId, stageId),
    setLeadNotes: (leadId: string, notes: string) =>
      ipcRenderer.invoke('crm:setLeadNotes', leadId, notes),
    removeLead: (leadId: string) => ipcRenderer.invoke('crm:removeLead', leadId),
    createStage: (name: string) => ipcRenderer.invoke('crm:createStage', name),
    renameStage: (id: string, name: string) => ipcRenderer.invoke('crm:renameStage', id, name),
    moveStage: (id: string, direction: -1 | 1) =>
      ipcRenderer.invoke('crm:moveStage', id, direction),
    removeStage: (id: string, moveToId: string) =>
      ipcRenderer.invoke('crm:removeStage', id, moveToId),
    onChanged: (cb: () => void) => subscribe('crm:changed', cb)
  },
  agenda: {
    list: (opts?: { from?: number; to?: number; includeDone?: boolean }) =>
      ipcRenderer.invoke('agenda:list', opts),
    upcomingFollowUps: (limit?: number) => ipcRenderer.invoke('agenda:upcomingFollowUps', limit),
    create: (input: CrmAppointmentInput) => ipcRenderer.invoke('agenda:create', input),
    update: (id: string, input: CrmAppointmentInput) =>
      ipcRenderer.invoke('agenda:update', id, input),
    setDone: (id: string, done: boolean) => ipcRenderer.invoke('agenda:setDone', id, done),
    remove: (id: string) => ipcRenderer.invoke('agenda:remove', id)
  },
  followups: {
    list: () => ipcRenderer.invoke('followups:list'),
    create: (input: FollowUpRuleInput) => ipcRenderer.invoke('followups:create', input),
    update: (id: string, input: FollowUpRuleInput) =>
      ipcRenderer.invoke('followups:update', id, input),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('followups:setEnabled', id, enabled),
    remove: (id: string) => ipcRenderer.invoke('followups:remove', id),
    preview: (id: string) => ipcRenderer.invoke('followups:preview', id),
    runNow: (id: string) => ipcRenderer.invoke('followups:runNow', id)
  },
  settings: {
    getSendingDefaults: () => ipcRenderer.invoke('settings:getSendingDefaults'),
    setSendingDefaults: (v: SendingDefaults) =>
      ipcRenderer.invoke('settings:setSendingDefaults', v),
    getCrm: () => ipcRenderer.invoke('settings:getCrm'),
    setCrm: (v: CrmSettings) => ipcRenderer.invoke('settings:setCrm', v),
    getAi: () => ipcRenderer.invoke('settings:getAi'),
    setAi: (provider: AiSettings['provider'], model: string, apiKey?: string) =>
      ipcRenderer.invoke('settings:setAi', provider, model, apiKey),
    getBackground: () => ipcRenderer.invoke('settings:getBackground'),
    setBackground: (v: BackgroundSettings) => ipcRenderer.invoke('settings:setBackground', v)
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
