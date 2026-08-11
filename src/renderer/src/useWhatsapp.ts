import { useEffect, useState } from 'react'
import type { WhatsappState } from '@shared/types'

const INITIAL: WhatsappState = {
  status: 'disconnected',
  qrDataUrl: null,
  me: null,
  lastError: null,
  // `null` ate o main responder: nao ha por que sugerir repareamento antes de
  // saber se existe sessao.
  historyPairing: null,
  relinkNoticeDismissed: false
}

/**
 * Estado da conexao do WhatsApp, vindo do processo main.
 *
 * Le o estado atual ao montar (para nao piscar "desconectado" quando a conexao
 * ja esta ativa) e depois acompanha por evento push.
 */
export function useWhatsapp(): WhatsappState {
  const [state, setState] = useState<WhatsappState>(INITIAL)

  useEffect(() => {
    let alive = true
    void window.api.whatsapp.getState().then((s) => {
      if (alive) setState(s)
    })
    const unsubscribe = window.api.whatsapp.onState(setState)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return state
}
