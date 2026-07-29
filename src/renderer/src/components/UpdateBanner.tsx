import { useEffect, useState } from 'react'
import { Download, RefreshCw, X } from 'lucide-react'
import { Button, Progress } from './ui'
import { useUpdater } from '../useUpdater'

/**
 * Faixa no topo da janela avisando que ha versao nova.
 *
 * Fica escondida no caso normal (nada pendente) e tambem quando ha erro — falha
 * de rede nao e assunto do usuario no meio do trabalho; o erro aparece na tela
 * de Configuracoes, para quem foi ate la procurar.
 */
export default function UpdateBanner(): JSX.Element | null {
  const u = useUpdater()
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [campaignRunning, setCampaignRunning] = useState(false)

  // Reinstalar no meio de um disparo mata a campanha e deixa os envios em voo
  // como 'unknown' (entrega indeterminada) — o app existe justamente para nao
  // fazer isso. O botao de instalar so libera com a fila parada.
  useEffect(() => {
    const refresh = (): void => {
      void window.api.campaign.active().then((p) => setCampaignRunning(p?.status === 'running'))
    }
    refresh()
    const offProgress = window.api.campaign.onProgress((p) =>
      setCampaignRunning(p.status === 'running')
    )
    const offStopped = window.api.campaign.onStopped(refresh)
    return () => {
      offProgress()
      offStopped()
    }
  }, [])

  if (u.status !== 'available' && u.status !== 'downloading' && u.status !== 'ready') return null
  // O dispensar vale so para a versao dispensada: uma versao mais nova volta a
  // aparecer.
  if (u.status === 'available' && dismissed === u.version) return null

  return (
    <div className="flex flex-none flex-wrap items-center gap-3 border-b border-line bg-accent-wash px-4 py-2.5 text-sm">
      {u.status === 'available' && (
        <>
          <Download size={16} className="flex-none text-accent-text" />
          <span className="min-w-0">
            Dispar Flux <strong className="font-semibold">{u.version}</strong> disponivel. Voce esta
            na {u.currentVersion}.
          </span>
          <div className="flex-1" />
          <Button
            variant="secondary"
            className="!py-1.5"
            onClick={() => void window.api.updater.download()}
          >
            Baixar agora
          </Button>
          <button
            aria-label="Dispensar aviso de atualizacao"
            title="Dispensar"
            onClick={() => setDismissed(u.version)}
            className="grid h-7 w-7 flex-none place-items-center rounded text-ink-secondary transition-colors duration-120 hover:bg-accent-wash-strong hover:text-ink"
          >
            <X size={15} />
          </button>
        </>
      )}

      {u.status === 'downloading' && (
        <>
          <Download size={16} className="flex-none text-accent-text" />
          <span className="tnum flex-none">
            Baixando a versao {u.version}… {u.percent}%
          </span>
          <div className="min-w-[8rem] flex-1">
            <Progress value={u.percent} max={100} />
          </div>
        </>
      )}

      {u.status === 'ready' && (
        <>
          <RefreshCw size={16} className="flex-none text-accent-text" />
          <span className="min-w-0">
            Versao <strong className="font-semibold">{u.version}</strong> pronta para instalar.
            {campaignRunning && ' Termine ou pause o disparo em andamento antes de reiniciar.'}
          </span>
          <div className="flex-1" />
          <Button
            className="!py-1.5"
            disabled={campaignRunning}
            title={campaignRunning ? 'Ha um disparo em andamento' : undefined}
            onClick={() => void window.api.updater.install()}
          >
            Reiniciar e instalar
          </Button>
        </>
      )}
    </div>
  )
}
