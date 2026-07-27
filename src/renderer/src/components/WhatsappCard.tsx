import { useState } from 'react'
import { QrCode, Loader2, LogOut, Unplug, Plug } from 'lucide-react'
import type { WhatsappState, WhatsappStatus } from '@shared/types'
import { Card, Button, Pill, StatusDot, Callout } from './ui'
import { formatJid } from '../format'

const LABEL: Record<WhatsappStatus, string> = {
  disconnected: 'Desconectado',
  connecting: 'Conectando...',
  pairing: 'Aguardando leitura do QR',
  connected: 'Conectado',
  loggedOut: 'Sessao encerrada'
}

const TONE: Record<WhatsappStatus, 'success' | 'warning' | 'danger' | 'idle'> = {
  disconnected: 'idle',
  connecting: 'warning',
  pairing: 'warning',
  connected: 'success',
  loggedOut: 'danger'
}

export default function WhatsappCard({ state }: { state: WhatsappState }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const { status, qrDataUrl, me, lastError } = state

  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center gap-2.5">
        <QrCode size={17} className="flex-none text-accent-text" />
        <h2 className="text-base font-semibold">Conexao WhatsApp</h2>
        <div className="flex-1" />
        <Pill>
          <StatusDot tone={TONE[status]} />
          {LABEL[status]}
        </Pill>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="grid h-44 w-44 flex-none place-items-center overflow-hidden rounded-lg border border-line bg-surface-raised">
          {qrDataUrl ? (
            <img src={qrDataUrl} alt="QR Code para conectar o WhatsApp" className="h-full w-full" />
          ) : status === 'connecting' ? (
            <Loader2 size={32} className="animate-[dfspin_1s_linear_infinite] text-ink-tertiary" />
          ) : status === 'connected' ? (
            <div className="px-3 text-center">
              <StatusDot tone="success" />
              <p className="mt-2 text-xs text-ink-secondary">Pareado</p>
            </div>
          ) : (
            <div className="grid place-items-center text-ink-tertiary">
              <QrCode size={40} />
            </div>
          )}
        </div>

        <div className="min-w-[240px] flex-1">
          {status === 'connected' ? (
            <>
              <p className="text-sm text-ink-secondary">
                Numero conectado
                {me?.id && (
                  <>
                    {': '}
                    <span className="tnum font-medium text-ink">{formatJid(me.id)}</span>
                  </>
                )}
                {me?.name ? ` (${me.name})` : ''}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => run(() => window.api.whatsapp.disconnect())}
                >
                  <Unplug size={16} /> Desconectar
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => run(() => window.api.whatsapp.logout())}
                >
                  <LogOut size={16} /> Encerrar sessao
                </Button>
              </div>
              <p className="mt-2 text-xs text-ink-tertiary">
                "Desconectar" mantem a sessao e reconecta sem QR. "Encerrar sessao" apaga as
                credenciais e exige novo QR.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-secondary [text-wrap:pretty]">
                No celular, abra o WhatsApp → <strong>Dispositivos conectados</strong> →{' '}
                <strong>Conectar dispositivo</strong> e escaneie o QR ao lado. Use um numero
                dedicado para disparos.
              </p>
              <div className="mt-4">
                <Button
                  disabled={busy || status === 'connecting' || status === 'pairing'}
                  onClick={() => run(() => window.api.whatsapp.connect())}
                >
                  <Plug size={16} />
                  {status === 'pairing' ? 'Aguardando leitura...' : 'Gerar QR e conectar'}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      {lastError && (
        <div className="mt-4">
          <Callout tone={status === 'loggedOut' ? 'danger' : 'warning'}>{lastError}</Callout>
        </div>
      )}
    </Card>
  )
}
