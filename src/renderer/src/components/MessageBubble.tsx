import {
  Check,
  CheckCheck,
  Download,
  File as FileIcon,
  Loader2,
  AlertCircle,
  Play,
  Save
} from 'lucide-react'
import type { Message } from '@shared/types'
import { formatBytes, formatDuration } from '../format'

/**
 * Uma mensagem da conversa.
 *
 * Anexo pode estar em quatro estados (pendente, baixando, pronto, erro) e cada
 * um precisa de um desenho proprio — sem isso o usuario nao sabe se a imagem
 * nao aparece porque esta chegando ou porque falhou.
 */

function StatusTicks({ status }: { status: Message['status'] }): JSX.Element | null {
  if (status === 'read') return <CheckCheck size={13} className="text-accent-strong" />
  if (status === 'delivered') return <CheckCheck size={13} />
  if (status === 'sent') return <Check size={13} />
  if (status === 'error') return <AlertCircle size={13} className="text-state-dangerText" />
  return null
}

function MediaFrame({
  children,
  className = ''
}: {
  children: React.ReactNode
  className?: string
}): JSX.Element {
  return <div className={`mb-1 overflow-hidden rounded-md ${className}`}>{children}</div>
}

function Attachment({
  message,
  onDownload,
  onOpen,
  onSaveAs
}: {
  message: Message
  onDownload: () => void
  onOpen: () => void
  onSaveAs: () => void
}): JSX.Element | null {
  const { mediaKind, mediaState, mediaUrl } = message
  if (!mediaKind) return null

  if (mediaState === 'downloading') {
    return (
      <div className="mb-1 flex items-center gap-2 rounded-md bg-surface-sunken px-3 py-3 text-xs text-ink-meta">
        <Loader2 size={14} className="animate-spin" /> Baixando anexo...
      </div>
    )
  }

  if (mediaState === 'error') {
    return (
      <div className="mb-1 flex items-center gap-2 rounded-md bg-state-dangerWash px-3 py-3 text-xs text-ink-secondary">
        <AlertCircle size={14} className="flex-none text-state-dangerText" />
        <span className="[text-wrap:pretty]">
          Nao foi possivel baixar. Anexos antigos expiram no WhatsApp.
        </span>
        <button onClick={onDownload} className="ml-auto flex-none underline">
          tentar
        </button>
      </div>
    )
  }

  // Ainda nao baixado: video e documento so descem quando o usuario pede.
  if (mediaState === 'pending' || !mediaUrl) {
    return (
      <button
        onClick={onDownload}
        className="mb-1 flex w-full items-center gap-3 rounded-md bg-surface-sunken px-3 py-3 text-left transition-colors duration-120 hover:bg-accent-wash"
      >
        <Download size={16} className="flex-none text-ink-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">
            {message.mediaName ?? `Baixar ${mediaKind}`}
          </span>
          {message.mediaSize ? (
            <span className="block text-[11px] text-ink-tertiary">
              {formatBytes(message.mediaSize)}
            </span>
          ) : null}
        </span>
      </button>
    )
  }

  if (mediaKind === 'image' || mediaKind === 'sticker') {
    return (
      <MediaFrame className={mediaKind === 'sticker' ? 'w-32' : ''}>
        <button onClick={onOpen} className="block w-full" aria-label="Abrir imagem">
          <img
            src={mediaUrl}
            alt={message.body ?? 'Imagem recebida'}
            className="max-h-72 w-full rounded-md object-cover"
          />
        </button>
      </MediaFrame>
    )
  }

  if (mediaKind === 'video') {
    return (
      <MediaFrame>
        <video src={mediaUrl} controls preload="metadata" className="max-h-72 w-full rounded-md" />
      </MediaFrame>
    )
  }

  if (mediaKind === 'audio') {
    return (
      <div className="mb-1 min-w-[15rem]">
        {/* Controles nativos: dao play/pause, barra e seek de graca, e o
            protocolo disparmedia:// suporta Range para navegar no audio. */}
        <audio src={mediaUrl} controls preload="metadata" className="w-full" />
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-tertiary">
          <Play size={10} />
          {message.mediaPtt ? 'Nota de voz' : 'Audio'}
          {message.mediaSeconds ? ` · ${formatDuration(message.mediaSeconds)}` : ''}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-1 flex items-center gap-3 rounded-md bg-surface-sunken px-3 py-2.5">
      <FileIcon size={18} className="flex-none text-ink-secondary" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{message.mediaName ?? 'Arquivo'}</div>
        <div className="text-[11px] text-ink-tertiary">{formatBytes(message.mediaSize)}</div>
      </div>
      <button
        onClick={onOpen}
        aria-label="Abrir arquivo"
        title="Abrir"
        className="flex-none rounded p-1 text-ink-secondary hover:bg-accent-wash"
      >
        <Play size={14} />
      </button>
      <button
        onClick={onSaveAs}
        aria-label="Salvar arquivo como"
        title="Salvar como"
        className="flex-none rounded p-1 text-ink-secondary hover:bg-accent-wash"
      >
        <Save size={14} />
      </button>
    </div>
  )
}

export function MessageBubble({
  message,
  onDownload,
  onOpen,
  onSaveAs
}: {
  message: Message
  onDownload: (id: string) => void
  onOpen: (id: string) => void
  onSaveAs: (id: string) => void
}): JSX.Element {
  const out = message.direction === 'out'

  return (
    <div className={out ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={[
          'max-w-[min(78%,520px)] rounded-lg px-3 py-2 text-sm [text-wrap:pretty]',
          out ? 'bg-accent-wash text-ink' : 'border border-line bg-surface-raised text-ink'
        ].join(' ')}
      >
        <Attachment
          message={message}
          onDownload={() => onDownload(message.id)}
          onOpen={() => onOpen(message.id)}
          onSaveAs={() => onSaveAs(message.id)}
        />

        {message.body && <div className="whitespace-pre-wrap break-words">{message.body}</div>}

        <div className="tnum mt-1 flex items-center justify-end gap-1 text-[10px] text-ink-tertiary">
          {new Date(message.ts).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
          })}
          {out && <StatusTicks status={message.status} />}
        </div>
      </div>
    </div>
  )
}
