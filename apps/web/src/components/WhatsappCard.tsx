import { useState } from 'react'
import { QrCode, Loader2, LogOut, Unplug, Plug, ClipboardCopy } from 'lucide-react'
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
  const {
    status,
    qrDataUrl,
    me,
    lastError,
    historyPairing,
    relinkNoticeDismissed,
    desktopPairingRefused
  } = state

  /**
   * Sessao pareada por uma versao anterior, que se anunciava como navegador.
   *
   * Nada esta quebrado — por isso o aviso e neutro e dispensavel, e o app NUNCA
   * desconecta sozinho. Mas enquanto o pareamento nao for refeito o WhatsApp
   * continua mandando so o recorte curto, e o usuario nao tem como adivinhar
   * isso sozinho.
   *
   * `desktopPairingRefused` CALA o aviso: quando o servidor recusa parear este
   * numero como aplicativo de desktop, refazer o pareamento nao traz historico
   * nenhum a mais. Continuar sugerindo seria mandar o usuario repetir um
   * trabalho que ja sabemos nao levar a lugar nenhum.
   */
  const sugerirRepareamento =
    historyPairing === 'legacy' && !relinkNoticeDismissed && !desktopPairingRefused

  const [copiado, setCopiado] = useState(false)

  /**
   * Diagnostico copiavel.
   *
   * O bloco nao carrega corpo de mensagem, jid de contato nem credencial, e o
   * numero conectado vai mascarado — dito no texto ao lado, porque ninguem cola
   * o que nao consegue conferir.
   */
  async function copiarDiagnostico(): Promise<void> {
    const d = await window.api.whatsapp.diagnostics()
    await navigator.clipboard.writeText(JSON.stringify(d, null, 2))
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2500)
  }

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
              <div className="mt-3">
                <Button variant="secondary" onClick={() => void copiarDiagnostico()}>
                  <ClipboardCopy size={16} /> {copiado ? 'Copiado' : 'Copiar diagnostico'}
                </Button>
                <p className="mt-2 text-xs text-ink-tertiary [text-wrap:pretty]">
                  Copia um resumo tecnico da conexao (versao, plataforma do pareamento, ultimos
                  lotes de historico) para voce colar ao relatar um problema. Nao inclui suas
                  mensagens nem os numeros dos contatos, e o numero conectado vai mascarado.
                </p>
              </div>
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

      {sugerirRepareamento && (
        <div className="mt-4">
          <Callout tone="neutral">
            <p className="[text-wrap:pretty]">
              Esta conexao foi pareada por uma versao anterior do app, que se identificava como
              navegador — e a um navegador o WhatsApp envia cerca de <strong>3 meses</strong> de
              historico. Refazendo o pareamento ele passa a enviar cerca de <strong>1 ano</strong>.
            </p>
            <p className="mt-2 [text-wrap:pretty]">
              Suas conversas, mensagens, anexos, leads e campanhas <strong>nao sao apagados</strong>{' '}
              — o app so troca as credenciais da conexao. Para refazer:{' '}
              <strong>Encerrar sessao</strong> e depois <strong>Gerar QR e conectar</strong>. No
              celular, o aparelho passara a aparecer como um Mac em Dispositivos conectados.
            </p>
            <button
              type="button"
              className="mt-2 text-xs underline underline-offset-2 hover:text-ink"
              onClick={() => void window.api.whatsapp.dismissRelinkNotice()}
            >
              Nao mostrar de novo
            </button>
          </Callout>
        </div>
      )}

      {lastError && (
        <div className="mt-4">
          <Callout tone={status === 'loggedOut' ? 'danger' : 'warning'}>{lastError}</Callout>
        </div>
      )}
    </Card>
  )
}
