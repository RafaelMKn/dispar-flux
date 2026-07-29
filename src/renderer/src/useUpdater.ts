import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/types'

const INITIAL: UpdateState = {
  status: 'idle',
  currentVersion: '',
  version: null,
  percent: 0,
  bytesPerSecond: null,
  error: null
}

/**
 * Estado da atualizacao automatica, vindo do processo main.
 *
 * Le o estado atual ao montar e depois acompanha por evento push — mesmo
 * desenho de `useWhatsapp`.
 */
export function useUpdater(): UpdateState {
  const [state, setState] = useState<UpdateState>(INITIAL)

  useEffect(() => {
    let alive = true
    void window.api.updater.getState().then((s) => {
      if (alive) setState(s)
    })
    const unsubscribe = window.api.updater.onState(setState)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [])

  return state
}
