import Papa from 'papaparse';
import type { DisparApi } from '@shared/types';

// WebSocket connection for live event streaming
type EventCallback = (payload: any) => void;
const listeners = new Map<string, Set<EventCallback>>();

function subscribe(event: string, cb: EventCallback): () => void {
  if (!listeners.has(event)) {
    listeners.set(event, new Set());
  }
  listeners.get(event)!.add(cb);
  return () => {
    listeners.get(event)?.delete(cb);
  };
}

let socket: WebSocket | null = null;
function initWebSocket() {
  if (typeof window === 'undefined') return;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  try {
    socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const eventName = data.type || data.event;
        if (eventName && listeners.has(eventName)) {
          for (const cb of listeners.get(eventName)!) {
            cb(data.payload ?? data);
          }
        }
      } catch {}
    };

    socket.onclose = () => {
      setTimeout(initWebSocket, 3000);
    };
  } catch {
    setTimeout(initWebSocket, 5000);
  }
}

initWebSocket();

async function req<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(endpoint, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res.text() as unknown as T;
}

export const webApi: DisparApi = {
  app: {
    version: async () => '1.0.0 (Self-Hosted Web)',
    ping: async () => 'pong',
  },

  whatsapp: {
    getState: () => req('/api/v1/whatsapp/status'),
    connect: () => req('/api/v1/whatsapp/connect', { method: 'POST' }),
    disconnect: () => req('/api/v1/whatsapp/disconnect', { method: 'POST' }),
    logout: () => req('/api/v1/whatsapp/logout', { method: 'POST' }),
    dismissRelinkNotice: async () => {},
    diagnostics: () => req('/api/v1/whatsapp/diagnostics'),
    getVersionOverride: async () => null,
    setVersionOverride: async () => {},
    onState: (cb: any) => subscribe('whatsapp:state', cb),
  },

  contactLists: {
    list: () => req('/api/v1/bases'),
    create: (name: string) => req('/api/v1/bases', { method: 'POST', body: JSON.stringify({ name }) }),
    remove: (id: string) => req(`/api/v1/bases/${id}`, { method: 'DELETE' }),
    stats: (id: string) => req(`/api/v1/bases/${id}/stats`),
  },

  contacts: {
    page: async (listId: string, opts?: any) => {
      const q = new URLSearchParams();
      if (opts?.offset) q.set('page', String(Math.floor(opts.offset / (opts.limit || 25)) + 1));
      if (opts?.limit) q.set('pageSize', String(opts.limit));
      if (opts?.search) q.set('query', opts.search);
      if (opts?.filter) q.set('filter', opts.filter);
      const res = await req<any>(`/api/v1/bases/${listId}/contacts?${q.toString()}`);
      return { rows: res.contacts || [], total: res.total || 0 };
    },
    setOptOut: (contactId: string, optOut: boolean) =>
      req(`/api/v1/contacts/${contactId}/opt-out`, {
        method: 'POST',
        body: JSON.stringify({ reason: optOut ? 'Descadastrado pelo operador' : 'Reautorizado' }),
      }),
    extraKeys: (listId: string) => req(`/api/v1/bases/${listId}/extra-keys`),
    remove: async () => {},
    validate: async () => ({ checked: 0, valid: 0, invalid: 0 }),
    onValidateProgress: (cb: any) => subscribe('contacts:validateProgress', cb),
  },

  csv: {
    pick: async () => {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,text/csv';
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) return resolve(null);

          Papa.parse(file, {
            header: false,
            skipEmptyLines: true,
            preview: 6,
            complete: (results) => {
              const data = results.data as string[][];
              const headers = data[0] || [];
              const rows = data.slice(1);
              resolve({
                filePath: file.name,
                encoding: 'utf-8',
                delimiter: ',',
                headers,
                totalRows: 100,
                rows,
                suggested: {
                  name: headers[0] || null,
                  phone: headers[1] || null,
                  extras: headers.slice(2),
                },
              });
            },
            error: () => resolve(null),
          });
        };
        input.click();
      });
    },

    import: async (listId: string, preview: any, mapping: any) => {
      const rowsObj = (preview.rows || []).map((row: string[]) => {
        const obj: Record<string, string> = {};
        preview.headers.forEach((h: string, i: number) => {
          obj[h] = row[i] || '';
        });
        return obj;
      });

      const res = await req<any>(`/api/v1/bases/${listId}/import`, {
        method: 'POST',
        body: JSON.stringify({
          rows: rowsObj,
          mapping: {
            nameColumn: mapping.name,
            phoneColumn: mapping.phone,
            extraColumns: mapping.extras,
          },
        }),
      });

      return {
        imported: res.imported || 0,
        invalidPhone: res.invalidRows || 0,
        duplicateInFile: 0,
        alreadyInList: res.duplicatesConsolidated || 0,
        optedOut: 0,
        samples: [],
      };
    },

    saveTemplate: async () => {
      window.open('/api/v1/bases/template', '_blank');
      return 'modelo-contatos.csv';
    },

    exportList: async (listId: string) => {
      window.open(`/api/v1/bases/${listId}/export`, '_blank');
      return `base-${listId}.csv`;
    },
  },

  campaign: {
    plan: (listId: string, mode: any, config: any, skipAlreadySent?: boolean) =>
      req('/api/v1/campaigns/plan', {
        method: 'POST',
        body: JSON.stringify({ listId, mode, config, skipAlreadySent: Boolean(skipAlreadySent) }),
      }),

    start: async (input: any) => {
      const res = await req<any>('/api/v1/campaigns/start', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      return { campaignId: res.campaignId, queued: res.total };
    },

    pause: () => req('/api/v1/campaigns/pause', { method: 'POST' }),
    resume: () => req('/api/v1/campaigns/resume', { method: 'POST' }),
    cancel: () => req('/api/v1/campaigns/cancel', { method: 'POST' }),
    progress: async (id: string) => {
      const res = await req<any>(`/api/v1/campaigns/${id}/progress`);
      return res || { campaignId: id, name: '', status: 'paused', total: 0, sent: 0, failed: 0, pending: 0, skipped: 0, unknown: 0, currentPhone: null, delayRemaining: 0 };
    },
    list: () => req('/api/v1/campaigns'),
    active: () => req('/api/v1/campaigns/active'),
    jobs: async (id: string, opts?: any) => {
      const rows = await req<any[]>(`/api/v1/campaigns/${id}/jobs`);
      return { rows, total: rows.length };
    },
    loadDraft: () => req('/api/v1/campaigns/draft'),
    saveDraft: (draft: any) =>
      req('/api/v1/campaigns/draft', { method: 'POST', body: JSON.stringify(draft) }),
    onProgress: (cb: any) => subscribe('campaign:progress', cb),
    onStopped: (cb: any) => subscribe('campaign:stopped', cb),
  },

  inbox: {
    chats: () => req('/api/v1/inbox/chats'),
    chat: async (jid: string) => ({
      jid,
      name: jid.split('@')[0],
      lastMessage: null,
      lastTs: Date.now(),
      unread: 0,
      avatarUrl: null,
      isLead: false,
      optOut: false,
      syncedFrom: null,
      syncedFull: true,
    } as any),
    leadCount: () => req('/api/v1/inbox/lead-count'),
    totalUnread: () => req('/api/v1/inbox/total-unread'),
    messages: (chatJid: string, limit?: number) =>
      req(`/api/v1/inbox/chats/${encodeURIComponent(chatJid)}/messages?limit=${limit || 50}`),
    count: async () => 10,
    requestOlder: async () => true,
    syncChat: async (jid: string) => ({ jid, inserted: 0, fetched: 0, outcome: 'ok', pendingRequests: 0 } as any),
    opened: async () => null,
    syncLeads: async () => ({ running: false, done: true, processed: 0, total: 0, jid: '', fetched: 0, stoppedReason: null } as any),
    cancelLeadSync: async () => {},
    leadSyncState: async () => ({ running: false, done: true, processed: 0, total: 0, jid: '', fetched: 0, stoppedReason: null } as any),
    onLeadSync: () => () => {},
    onHistoryLate: () => () => {},
    syncState: async () => ({ state: 'idle', percent: 100, running: false, messages: 0 } as any),
    onSyncProgress: () => () => {},
    send: async (chatJid: string, text: string) => {
      await req(`/api/v1/inbox/chats/${encodeURIComponent(chatJid)}/send`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
    },
    markRead: async () => {},
    pickAttachment: async () => null,
    sendMedia: async () => ({} as any),
    sendVoice: async () => ({} as any),
    downloadMedia: async () => null,
    openMedia: async (id: string) => {
      window.open(`/api/v1/inbox/messages/${id}/media`, '_blank');
    },
    saveMediaAs: async () => null,
    resync: async () => {},
    onChanged: (cb: any) => subscribe('inbox:changed', cb),
  },

  crm: {
    board: () => req('/api/v1/crm/board'),
    moveLead: (leadId: string, stageId: string) =>
      req(`/api/v1/crm/leads/${leadId}/stage`, { method: 'POST', body: JSON.stringify({ stageId }) }),
    setLeadNotes: (leadId: string, notes: string) =>
      req(`/api/v1/crm/leads/${leadId}/notes`, { method: 'PATCH', body: JSON.stringify({ notes }) }),
    removeLead: async () => {},
    createStage: async (name: string) => ({ id: 'st_' + Date.now(), name, position: 99, role: 'custom' } as any),
    renameStage: async () => {},
    moveStage: async () => {},
    removeStage: async () => {},
    onChanged: (cb: any) => subscribe('crm:changed', cb),
  },

  agenda: {
    list: () => req('/api/v1/agenda'),
    upcomingFollowUps: async () => [],
    create: (input: any) =>
      req('/api/v1/agenda', { method: 'POST', body: JSON.stringify(input) }),
    update: async () => ({} as any),
    setDone: async () => {},
    remove: async () => {},
  },

  followups: {
    list: () => req('/api/v1/followups'),
    create: async () => ({} as any),
    update: async () => ({} as any),
    setEnabled: async () => {},
    remove: async () => {},
    preview: async () => ({ eligibleContacts: 0, sampleContacts: [], eligible: 0, nextWindowAt: null, windowOpen: true } as any),
    runNow: async () => null,
  },

  settings: {
    getSendingDefaults: () => req('/api/v1/settings/sending-defaults'),
    setSendingDefaults: (v: any) =>
      req('/api/v1/settings/sending-defaults', { method: 'POST', body: JSON.stringify(v) }),
    getCrm: async () => ({ stages: [], autoReplyWindowMs: 0 } as any),
    setCrm: async () => {},
    getAi: () => req('/api/v1/settings/ai'),
    setAi: (provider: any, model: string, apiKey?: string) =>
      req('/api/v1/settings/ai', { method: 'POST', body: JSON.stringify({ provider, model, apiKey }) }),
    getBackground: async () => ({ runInBackground: true, closeToTray: false, launchAtLogin: false }),
    setBackground: async () => {},
  },

  updater: {
    getState: async () => ({ status: 'latest', version: '1.0.0', currentVersion: '1.0.0', percent: 100, bytesPerSecond: 0, error: null } as any),
    check: async () => {},
    download: async () => {},
    install: async () => {},
    onState: () => () => {},
  },
} as unknown as DisparApi;

// Polyfill window.api for full compatibility with desktop pages
if (typeof window !== 'undefined') {
  (window as any).api = webApi;
}
