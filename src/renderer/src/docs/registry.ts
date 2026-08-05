import {
  Rocket,
  Database,
  Send,
  MessagesSquare,
  Columns3,
  ShieldCheck,
  Sprout,
  type LucideIcon
} from 'lucide-react'
import primeirosPassos from '@docs/tutorial-primeiros-passos.md?raw'
import baseDeContatos from '@docs/tutorial-base-de-contatos.md?raw'
import primeiroDisparo from '@docs/tutorial-primeiro-disparo.md?raw'
import conversasEConfiguracoes from '@docs/tutorial-conversas-e-configuracoes.md?raw'
import crm from '@docs/tutorial-crm.md?raw'
import disparoSeguro from '@docs/guia-disparo-seguro.md?raw'
import maturacaoDeChip from '@docs/guia-maturacao-de-chip.md?raw'
import { readingMinutes } from './toc'

/**
 * Catalogo da tela de Documentacao.
 *
 * O texto continua vivendo em `docs/*.md` — editar um guia e editar o markdown,
 * sem tocar em React. Aqui ficam so os metadados de apresentacao.
 *
 * `docs/design-prompt.md` fica de fora de proposito: e briefing interno de
 * design, nao material de usuario.
 */

export type DocGroup = 'Comece por aqui' | 'Antes de disparar em volume'

export interface DocGuide {
  /** Ultimo pedaco da URL (`/docs/<slug>`) e alvo dos links `app:` nos guias. */
  slug: string
  title: string
  summary: string
  group: DocGroup
  icon: LucideIcon
  markdown: string
}

interface DocGuideEntry extends DocGuide {
  minutes: number
}

const GUIDES: DocGuide[] = [
  {
    slug: 'primeiros-passos',
    title: 'Primeiros passos',
    summary: 'Instalar, conectar o WhatsApp pelo QR Code e entender para que serve cada tela.',
    group: 'Comece por aqui',
    icon: Rocket,
    markdown: primeirosPassos
  },
  {
    slug: 'base-de-contatos',
    title: 'Montar a base de contatos',
    summary: 'Planilha, importacao de CSV, validacao dos numeros e descadastro.',
    group: 'Comece por aqui',
    icon: Database,
    markdown: baseDeContatos
  },
  {
    slug: 'primeiro-disparo',
    title: 'Seu primeiro disparo',
    summary: 'Os cinco passos da tela de Disparo, campo por campo, ate a campanha rodando.',
    group: 'Comece por aqui',
    icon: Send,
    markdown: primeiroDisparo
  },
  {
    slug: 'conversas-e-configuracoes',
    title: 'Conversas e Configuracoes',
    summary: 'Responder quem respondeu e o que cada ajuste do app faz.',
    group: 'Comece por aqui',
    icon: MessagesSquare,
    markdown: conversasEConfiguracoes
  },
  {
    slug: 'crm',
    title: 'Acompanhar os leads',
    summary: 'Kanban, Agenda e Cron: o que acontece depois que a campanha sai.',
    group: 'Comece por aqui',
    icon: Columns3,
    markdown: crm
  },
  {
    slug: 'disparo-seguro',
    title: 'Disparo em massa sem tomar ban',
    summary: 'Lista, cadencia, conteudo e criterio de parada. O guia longo do risco.',
    group: 'Antes de disparar em volume',
    icon: ShieldCheck,
    markdown: disparoSeguro
  },
  {
    slug: 'maturacao-de-chip',
    title: 'Como maturar um chip de WhatsApp',
    summary: 'Protocolo de 21 dias, metricas de acompanhamento e ritmo por fase.',
    group: 'Antes de disparar em volume',
    icon: Sprout,
    markdown: maturacaoDeChip
  }
]

/** Ordem de leitura; os grupos aparecem na tela nesta mesma ordem. */
export const DOC_GUIDES: DocGuideEntry[] = GUIDES.map((g) => ({
  ...g,
  minutes: readingMinutes(g.markdown)
}))

export const DOC_GROUPS: DocGroup[] = ['Comece por aqui', 'Antes de disparar em volume']

export function findGuide(slug: string | undefined): DocGuideEntry | undefined {
  return DOC_GUIDES.find((g) => g.slug === slug)
}
