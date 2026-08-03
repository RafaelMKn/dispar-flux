import { Children, cloneElement, isValidElement, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  MessageCircle,
  Send,
  Database,
  Settings,
  BookOpen,
  Square,
  CheckSquare,
  ShieldAlert,
  OctagonAlert,
  Lightbulb,
  Info,
  ArrowUpRight,
  type LucideIcon
} from 'lucide-react'
import { Callout, Table, Th, Td } from '../components/ui'
import { slugify } from './toc'

/* ── Indicacao de tela ────────────────────────────────────────────────── */

/**
 * Telas que um guia pode apontar. No markdown escreve-se
 * `[Configuracoes -> Envio](app:/config)` e o link vira um botao que leva o
 * usuario direto para la, com o mesmo icone que a tela tem na sidebar.
 */
const APP_ROUTES: Record<string, LucideIcon> = {
  '/inbox': MessageCircle,
  '/disparo': Send,
  '/base': Database,
  '/config': Settings,
  '/docs': BookOpen
}

function ScreenLink({ to, children }: { to: string; children: ReactNode }): JSX.Element {
  const navigate = useNavigate()
  // Rota conhecida ganha icone; rota nova (ou com erro de digitacao) ainda
  // navega, so sem icone — nunca quebra o texto do guia. A busca e pela
  // primeira parte do caminho para que `/docs/<guia>` herde o icone de `/docs`.
  const Icon = APP_ROUTES[`/${to.split('/')[1] ?? ''}`]
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="mx-0.5 inline-flex items-baseline gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface-raised px-2.5 py-0.5 text-xs font-medium text-accent-text transition-colors duration-120 ease-out hover:bg-accent-wash"
    >
      {Icon && <Icon size={12} className="flex-none translate-y-0.5" />}
      {children}
    </button>
  )
}

/* ── Avisos ───────────────────────────────────────────────────────────── */

type AlertTone = 'warning' | 'danger' | 'success' | 'neutral'

const ALERTS: Record<string, { tone: AlertTone; icon: LucideIcon }> = {
  perigo: { tone: 'danger', icon: OctagonAlert },
  aviso: { tone: 'warning', icon: ShieldAlert },
  dica: { tone: 'success', icon: Lightbulb },
  nota: { tone: 'neutral', icon: Info }
}

/** Texto plano de uma arvore React, para achar o marcador `[!AVISO]`. */
function textOf(node: ReactNode): string {
  let out = ''
  Children.forEach(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') out += child
    else if (isValidElement(child))
      out += textOf((child.props as { children?: ReactNode }).children)
  })
  return out
}

/**
 * Tira o marcador `[!AVISO]` do inicio do bloco. A limpeza e feita na arvore
 * (descendo so pelo primeiro filho) em vez de no texto plano porque o resto do
 * aviso pode ter negrito, links e indicacoes de tela, que se perderiam se o
 * conteudo fosse remontado a partir de uma string.
 */
function stripMarker(node: ReactNode): ReactNode {
  const kids = Children.toArray(node)
  // O markdown deixa quebras de linha soltas entre os blocos; o marcador esta
  // no primeiro filho que tem conteudo, nao no primeiro filho.
  const at = kids.findIndex((k) => typeof k !== 'string' || k.trim() !== '')
  if (at === -1) return node

  const target = kids[at]
  const replace = (value: ReactNode): ReactNode[] => [
    ...kids.slice(0, at),
    value,
    ...kids.slice(at + 1)
  ]

  if (typeof target === 'string') {
    return replace(target.replace(/^\s*\[![a-zA-Z]+\]\s*/, ''))
  }
  if (isValidElement(target)) {
    const props = target.props as { children?: ReactNode }
    return replace(cloneElement(target, undefined, stripMarker(props.children)))
  }
  return node
}

/* ── Mapa de componentes ──────────────────────────────────────────────── */

const prose = 'text-sm leading-relaxed text-ink-secondary [text-wrap:pretty]'

const components: Components = {
  h2: ({ children }) => (
    <h2
      id={slugify(textOf(children))}
      // Sem regua propria: os guias ja separam as secoes com `---`.
      className="mb-3 mt-10 scroll-mt-8 text-xl font-semibold text-ink first:mt-0"
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 id={slugify(textOf(children))} className="mb-2 mt-6 scroll-mt-8 text-base font-semibold">
      {children}
    </h3>
  ),
  h4: ({ children }) => <h4 className="mb-1 mt-5 text-sm font-semibold">{children}</h4>,
  p: ({ children }) => <p className={`mt-3 ${prose}`}>{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  ul: ({ children, className }) => (
    // Lista de checklist nao leva marcador: o proprio item desenha o quadrado.
    <ul
      className={
        className?.includes('contains-task-list')
          ? 'mt-3 space-y-2'
          : 'mt-3 list-disc space-y-1.5 pl-5 marker:text-ink-tertiary'
      }
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-3 list-decimal space-y-1.5 pl-5 marker:text-ink-meta">{children}</ol>
  ),
  li: ({ children, className }) =>
    // Item de checklist (`- [ ]`) vem do GFM com a classe `task-list-item` e um
    // <input> como primeiro filho, que viramos icone.
    className?.includes('task-list-item') ? (
      <li className={`flex list-none items-start gap-2 ${prose}`}>{children}</li>
    ) : (
      <li className={prose}>{children}</li>
    ),
  input: ({ checked }) =>
    // Checkbox do GFM e sempre desabilitado; viramos icone para nao parecer um
    // controle clicavel que nao faz nada.
    checked ? (
      <CheckSquare size={15} className="mt-0.5 flex-none text-state-successText" />
    ) : (
      <Square size={15} className="mt-0.5 flex-none text-ink-tertiary" />
    ),
  blockquote: ({ children }) => {
    const marker = /^\s*\[!([a-zA-Z]+)\]/.exec(textOf(children))?.[1].toLowerCase()
    const alert = marker ? ALERTS[marker] : undefined
    return (
      <div className="mt-4 [&_p:first-child]:mt-0">
        <Callout tone={alert?.tone ?? 'neutral'} icon={alert?.icon ?? Info}>
          {alert ? stripMarker(children) : children}
        </Callout>
      </div>
    )
  },
  a: ({ href = '', children }) =>
    href.startsWith('app:') ? (
      <ScreenLink to={href.slice('app:'.length)}>{children}</ScreenLink>
    ) : (
      // O main abre link externo no navegador padrao (setWindowOpenHandler em
      // src/main/index.ts) e nega a navegacao, entao a janela do app nunca sai
      // da tela de docs.
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-baseline gap-0.5 text-accent-text underline decoration-line underline-offset-2 hover:decoration-accent-strong"
      >
        {children}
        <ArrowUpRight size={12} className="flex-none translate-y-0.5" />
      </a>
    ),
  code: ({ className, children }) =>
    // Sem `className` de linguagem e codigo inline; com, veio de bloco cercado
    // e o <pre> ao redor ja cuida do enquadramento.
    className ? (
      <code className="font-mono text-xs text-ink">{children}</code>
    ) : (
      <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-xs text-ink">
        {children}
      </code>
    ),
  pre: ({ children }) => (
    // Rola dentro do proprio bloco: a pagina nunca rola na horizontal.
    <pre className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface-sunken p-3 leading-relaxed">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-8 border-line-subtle" />,
  table: ({ children }) => (
    <div className="mt-4">
      <Table>{children}</Table>
    </div>
  ),
  th: ({ children }) => <Th>{children}</Th>,
  td: ({ children }) => <Td className="align-top text-ink-secondary">{children}</Td>
}

/** `app:` nao passa no filtro padrao de URL do react-markdown; os demais sim. */
function urlTransform(url: string): string | null | undefined {
  return url.startsWith('app:') ? url : defaultUrlTransform(url)
}

/** Renderiza o corpo de um guia com os componentes do design system. */
export default function Markdown({ children }: { children: string }): JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
      {children}
    </ReactMarkdown>
  )
}
