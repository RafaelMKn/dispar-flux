import { useEffect, useState } from 'react'
import {
  Check,
  QrCode,
  Sparkles,
  Gauge,
  ScrollText,
  RefreshCw,
  PanelBottom,
  Columns3
} from 'lucide-react'
import type { AiSettings, BackgroundSettings, CrmSettings, SendingDefaults } from '@shared/types'
import { AI_PROVIDERS } from '@shared/aiProviders'
import { PageBody, PageHeader, Card, Button, Input, Select, Toggle } from '../components/ui'
import WhatsappCard from '../components/WhatsappCard'
import { useWhatsapp } from '../useWhatsapp'
import { useUpdater } from '../useUpdater'

function SectionTitle({ icon: Icon, title }: { icon: typeof QrCode; title: string }): JSX.Element {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <Icon size={17} className="flex-none text-accent-text" />
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  )
}

/** Descricao em uma linha do estado da atualizacao. */
function updateSummary(u: ReturnType<typeof useUpdater>): string {
  switch (u.status) {
    case 'unsupported':
      return 'Modo de desenvolvimento: a atualizacao automatica so funciona no app instalado.'
    case 'checking':
      return 'Procurando atualizacoes...'
    case 'available':
      return `Versao ${u.version} disponivel. Use o aviso no topo da janela para baixar.`
    case 'downloading':
      return `Baixando a versao ${u.version}... ${u.percent}%`
    case 'ready':
      return `Versao ${u.version} baixada. Reinicie o app para instalar.`
    case 'error':
      return `Nao foi possivel verificar: ${u.error ?? 'erro desconhecido'}`
    default:
      return 'Voce esta na versao mais recente.'
  }
}

export default function ConfigPage(): JSX.Element {
  const wa = useWhatsapp()
  const updater = useUpdater()
  const [sending, setSending] = useState<SendingDefaults | null>(null)
  const [ai, setAi] = useState<AiSettings | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [background, setBackground] = useState<BackgroundSettings | null>(null)
  const [crm, setCrm] = useState<CrmSettings | null>(null)
  const [savedFlag, setSavedFlag] = useState('')

  useEffect(() => {
    void (async () => {
      setSending(await window.api.settings.getSendingDefaults())
      setAi(await window.api.settings.getAi())
      setBackground(await window.api.settings.getBackground())
      setCrm(await window.api.settings.getCrm())
    })()
  }, [])

  function flash(msg: string): void {
    setSavedFlag(msg)
    setTimeout(() => setSavedFlag(''), 2200)
  }

  async function saveSending(): Promise<void> {
    if (!sending) return
    await window.api.settings.setSendingDefaults(sending)
    flash('Parametros de envio salvos')
  }

  // Chave liga/desliga salva na hora: um botao "Salvar" para duas chaves so
  // criaria a chance de mexer e esquecer de confirmar.
  async function saveBackground(next: BackgroundSettings): Promise<void> {
    setBackground(next)
    await window.api.settings.setBackground(next)
    flash('Preferencia salva')
  }

  async function saveCrm(): Promise<void> {
    if (!crm) return
    await window.api.settings.setCrm(crm)
    flash('Configuracoes do CRM salvas')
  }

  async function saveAi(): Promise<void> {
    if (!ai) return
    await window.api.settings.setAi(ai.provider, ai.model, apiKey || undefined)
    setApiKey('')
    setAi(await window.api.settings.getAi())
    flash('Configuracoes de IA salvas')
  }

  const providerModels = AI_PROVIDERS.find((p) => p.id === ai?.provider)?.models ?? []

  // Resumo do ritmo em linguagem natural — ajuda a entender o risco na pratica.
  // Inclui o tempo de descanso no calculo: ignorar isso superestima muito a
  // vazao real e passaria uma nocao errada de risco.
  const paceSummary = ((): string => {
    if (!sending) return ''
    const avgMs = (sending.delayMinMs + sending.delayMaxMs) / 2
    if (avgMs <= 0) return ''
    const n = sending.restEveryN
    const cycleMs = n > 0 ? n * avgMs + sending.restDurationMs : avgMs
    const perCycle = n > 0 ? n : 1
    const perHour = Math.round((3600000 / cycleMs) * perCycle)
    const restMin = Math.round(sending.restDurationMs / 60000)
    const restPart = n > 0 ? ` · pausa de ${restMin} min a cada ${n} envios` : ''
    return `≈${perHour} msgs/h${restPart} · max. ${sending.dailyCap}/dia`
  })()

  return (
    <PageBody>
      <PageHeader
        title="Configuracoes"
        subtitle="Conexao do WhatsApp, provedor de IA e parametros padrao de envio."
      />

      <div className="flex flex-col gap-6">
        <WhatsappCard state={wa} />

        <Card>
          <SectionTitle icon={Sparkles} title="Inteligencia artificial" />
          {ai && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Empresa / provedor"
                value={ai.provider}
                onChange={(e) =>
                  setAi({ ...ai, provider: e.target.value as AiSettings['provider'], model: '' })
                }
              >
                <option value="">Selecione...</option>
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>

              <Select
                label="Modelo"
                value={ai.model}
                disabled={!ai.provider}
                onChange={(e) => setAi({ ...ai, model: e.target.value })}
              >
                <option value="">Selecione...</option>
                {providerModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>

              <div className="sm:col-span-2">
                <Input
                  label={ai.hasKey ? 'Chave de API (uma chave ja esta salva)' : 'Chave de API'}
                  type="password"
                  placeholder={ai.hasKey ? '••••••••••••' : 'Cole a chave aqui'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  hint="Guardada criptografada no seu PC (DPAPI). Nunca sai em texto claro."
                />
              </div>
            </div>
          )}
          <div className="mt-4">
            <Button onClick={saveAi}>Salvar IA</Button>
          </div>
        </Card>

        <Card>
          <SectionTitle icon={Gauge} title="Envio" />
          {paceSummary && <p className="tnum mb-4 text-sm text-accent-text">{paceSummary}</p>}
          {sending && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Intervalo minimo (ms)"
                type="number"
                value={sending.delayMinMs}
                onChange={(e) => setSending({ ...sending, delayMinMs: Number(e.target.value) })}
              />
              <Input
                label="Intervalo maximo (ms)"
                type="number"
                value={sending.delayMaxMs}
                onChange={(e) => setSending({ ...sending, delayMaxMs: Number(e.target.value) })}
              />
              <Input
                label="Descansar a cada N envios"
                type="number"
                value={sending.restEveryN}
                onChange={(e) => setSending({ ...sending, restEveryN: Number(e.target.value) })}
              />
              <Input
                label="Duracao do descanso (ms)"
                type="number"
                value={sending.restDurationMs}
                onChange={(e) => setSending({ ...sending, restDurationMs: Number(e.target.value) })}
              />
              <Input
                label="Teto diario"
                type="number"
                value={sending.dailyCap}
                onChange={(e) => setSending({ ...sending, dailyCap: Number(e.target.value) })}
              />
            </div>
          )}
          <div className="mt-4">
            <Button onClick={saveSending}>Salvar parametros</Button>
          </div>
        </Card>

        <Card>
          <SectionTitle icon={Columns3} title="CRM" />
          {crm && (
            <>
              <Input
                label="Janela de resposta automatica (ms)"
                type="number"
                min={0}
                step={100}
                className="max-w-48"
                value={crm.autoReplyWindowMs}
                onChange={(e) =>
                  setCrm({ ...crm, autoReplyWindowMs: Math.max(0, Number(e.target.value) || 0) })
                }
                hint="Resposta que chega ate esse tempo depois do envio nao move o cartao no Kanban: e a mensagem automatica de ausencia do WhatsApp Business, nao o cliente. A mensagem continua aparecendo normalmente em Conversas. Use 0 para desligar a regra."
              />
              <div className="mt-4">
                <Button onClick={saveCrm}>Salvar CRM</Button>
              </div>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle icon={PanelBottom} title="Rodar em segundo plano" />
          {background && (
            <div className="flex flex-col gap-4">
              <Toggle
                checked={background.closeToTray}
                onChange={(v) => void saveBackground({ ...background, closeToTray: v })}
                label="Continuar rodando ao fechar a janela"
                hint="Fechar a janela esconde o app na bandeja do sistema, ao lado do relogio, e o disparo em andamento continua. Para encerrar de vez, use Sair no menu do icone. Desligado, o X encerra o app e interrompe o disparo."
              />
              <Toggle
                checked={background.launchAtLogin}
                onChange={(v) => void saveBackground({ ...background, launchAtLogin: v })}
                label="Iniciar junto com o sistema"
                hint="O app sobe minimizado na bandeja quando voce liga o computador, sem abrir a janela."
              />
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle icon={RefreshCw} title="Atualizacoes" />
          <p className="tnum text-sm text-ink-secondary">
            Versao instalada: {updater.currentVersion || '—'}
          </p>
          <p
            className={`mt-1 text-sm ${
              updater.status === 'error' ? 'text-state-dangerText' : 'text-ink-meta'
            }`}
          >
            {updateSummary(updater)}
          </p>
          <div className="mt-4">
            <Button
              variant="secondary"
              disabled={updater.status === 'checking' || updater.status === 'unsupported'}
              onClick={() => void window.api.updater.check()}
            >
              Procurar atualizacoes
            </Button>
          </div>
        </Card>

        <Card>
          <SectionTitle icon={ScrollText} title="Sobre e aviso legal" />
          <p className="text-sm text-ink-secondary [text-wrap:pretty]">
            Dispar Flux e software livre (MIT), fornecido sem garantias. Ele usa uma biblioteca
            nao-oficial do WhatsApp: disparo em massa viola os Termos de Servico e pode banir o
            numero permanentemente. Enviar mensagens sem consentimento pode violar a LGPD. O uso e
            de sua inteira responsabilidade.
          </p>
        </Card>
      </div>

      {savedFlag && (
        <div className="fixed bottom-6 right-6 flex animate-[dfin_180ms_ease-out] items-center gap-2 rounded-lg bg-btn px-4 py-2.5 text-sm font-medium text-btn-ink shadow-float">
          <Check size={16} /> {savedFlag}
        </div>
      )}
    </PageBody>
  )
}
