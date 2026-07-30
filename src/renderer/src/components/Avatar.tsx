import { useState } from 'react'
import { initialsFor } from '../format'

/**
 * Foto de perfil do contato, com iniciais como reserva.
 *
 * A foto vem do cache local pelo protocolo `disparmedia://`. Contato sem foto
 * (ou que restringiu quem pode ve-la) e o caso comum, nao um erro — por isso o
 * fallback e silencioso.
 */
export function Avatar({
  name,
  jid,
  url,
  size = 36
}: {
  name: string | null
  jid: string
  url: string | null
  size?: number
}): JSX.Element {
  // Guardamos QUAL url falhou, e nao um booleano: a url muda quando a foto e
  // reatualizada, e um booleano ficaria grudado em "quebrado" para sempre.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  const style = { width: size, height: size, fontSize: Math.round(size * 0.34) }

  if (url && failedUrl !== url) {
    return (
      <img
        src={url}
        alt=""
        style={style}
        onError={() => setFailedUrl(url)}
        className="flex-none rounded-full object-cover"
      />
    )
  }

  return (
    <div
      style={style}
      aria-hidden="true"
      className="grid flex-none place-items-center rounded-full bg-surface-raised font-semibold text-ink-secondary"
    >
      {initialsFor(name, jid)}
    </div>
  )
}
