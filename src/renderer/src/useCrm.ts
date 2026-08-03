import { useCallback, useEffect, useState } from 'react'
import type { CrmBoard } from '@shared/types'

const EMPTY: CrmBoard = { stages: [], leads: [] }

/**
 * Carrega o quadro do CRM e o mantem atualizado.
 *
 * O quadro inteiro e recarregado a cada evento em vez de aplicar delta: a
 * mudanca que mais importa (o cliente respondeu) chega do processo main, nao de
 * um clique, e reconciliar dezenas de cartoes no renderer daria trabalho sem
 * ganho perceptivel.
 */
export function useCrm(): { board: CrmBoard; loading: boolean; reload: () => void } {
  const [board, setBoard] = useState<CrmBoard>(EMPTY)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(() => {
    void window.api.crm.board().then((next) => {
      setBoard(next)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    reload()
    return window.api.crm.onChanged(reload)
  }, [reload])

  return { board, loading, reload }
}
