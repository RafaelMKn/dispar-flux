import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BookOpen, Clock, Search } from 'lucide-react'
import { PageBody, PageHeader, Card, Button, IconButton, EmptyState, Pill } from '../components/ui'
import { DOC_GROUPS, DOC_GUIDES, findGuide } from '../docs/registry'
import { extractToc, stripTitle } from '../docs/toc'
import Markdown from '../docs/markdown'

export default function DocsPage(): JSX.Element {
  const { slug } = useParams()
  return slug ? <Reader slug={slug} /> : <Index />
}

/* ── Indice ───────────────────────────────────────────────────────────── */

function Index(): JSX.Element {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const found = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return DOC_GUIDES
    // Busca tambem no corpo: quem procura "spintax" ou "teto diario" nao sabe
    // em qual guia isso esta — que e justamente o motivo de estar procurando.
    return DOC_GUIDES.filter((g) =>
      `${g.title} ${g.summary} ${g.markdown}`.toLowerCase().includes(q)
    )
  }, [query])

  return (
    <PageBody>
      <PageHeader
        title="Documentacao"
        subtitle="Tutoriais de uso do app e os guias de risco, para ler antes de disparar."
      />

      <Card className="mb-6">
        <div className="flex items-center gap-2">
          <Search size={16} className="flex-none text-ink-tertiary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar nos guias (ex.: CSV, teto diario, opt-out)"
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-tertiary"
          />
        </div>
      </Card>

      {found.length === 0 ? (
        <EmptyState title="Nada encontrado">
          Nenhum guia menciona <strong>{query}</strong>. Tente outra palavra.
        </EmptyState>
      ) : (
        DOC_GROUPS.map((group) => {
          const guides = found.filter((g) => g.group === group)
          if (guides.length === 0) return null
          return (
            <section key={group} className="mb-8">
              <h2 className="mb-3 text-xs font-medium uppercase tracking-[.06em] text-ink-meta">
                {group}
              </h2>
              <div className="flex flex-col gap-2">
                {guides.map((g) => (
                  <Card key={g.slug}>
                    <button
                      onClick={() => navigate(`/docs/${g.slug}`)}
                      className="flex w-full items-start gap-4 text-left"
                    >
                      <g.icon size={18} className="mt-1 flex-none text-accent-text" />
                      <div className="min-w-0 flex-1">
                        <div className="text-base font-medium hover:text-accent-text">
                          {g.title}
                        </div>
                        <p className="mt-1 text-sm text-ink-secondary [text-wrap:pretty]">
                          {g.summary}
                        </p>
                      </div>
                      <Pill className="tnum mt-0.5 flex-none">
                        <Clock size={12} /> {g.minutes} min
                      </Pill>
                    </button>
                  </Card>
                ))}
              </div>
            </section>
          )
        })
      )}
    </PageBody>
  )
}

/* ── Leitor ───────────────────────────────────────────────────────────── */

function Reader({ slug }: { slug: string }): JSX.Element {
  const guide = findGuide(slug)
  const body = useMemo(() => (guide ? stripTitle(guide.markdown) : ''), [guide])
  const toc = useMemo(() => (guide ? extractToc(body) : []), [guide, body])
  const [activeId, setActiveId] = useState('')
  const articleRef = useRef<HTMLDivElement>(null)

  const index = DOC_GUIDES.findIndex((g) => g.slug === slug)
  const previous = index > 0 ? DOC_GUIDES[index - 1] : undefined
  const next = index >= 0 && index < DOC_GUIDES.length - 1 ? DOC_GUIDES[index + 1] : undefined

  // Trocar de guia (inclusive pelo rodape) precisa voltar ao topo: quem rola o
  // conteudo e o <main> do App, entao e nele que o scroll mora.
  useEffect(() => {
    articleRef.current?.closest('main')?.scrollTo({ top: 0 })
  }, [slug])

  // Destaque do sumario: o titulo ativo e o ultimo que passou pelo topo da area
  // visivel. `rootMargin` inferior negativo evita que um titulo la embaixo da
  // tela ja se declare ativo.
  useEffect(() => {
    const article = articleRef.current
    if (!article) return

    const headings = Array.from(article.querySelectorAll<HTMLElement>('h2[id], h3[id]'))
    if (headings.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id)
        }
      },
      { rootMargin: '0px 0px -75% 0px', threshold: 0 }
    )
    headings.forEach((h) => observer.observe(h))
    return () => observer.disconnect()
  }, [body])

  if (!guide) {
    return (
      <PageBody>
        <EmptyState title="Guia nao encontrado">
          <p>Esse endereco nao corresponde a nenhum guia.</p>
          <div className="mt-4 flex justify-center">
            <Link to="/docs">
              <Button variant="secondary">
                <ArrowLeft size={16} /> Voltar para a documentacao
              </Button>
            </Link>
          </div>
        </EmptyState>
      </PageBody>
    )
  }

  return (
    <PageBody>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <Link to="/docs">
          <IconButton label="Voltar para a documentacao">
            <ArrowLeft size={16} />
          </IconButton>
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-.01em]">{guide.title}</h1>
          <p className="mt-1 text-sm text-ink-secondary [text-wrap:pretty]">{guide.summary}</p>
        </div>
        <div className="flex-1" />
        <Pill className="tnum">
          <Clock size={12} /> {guide.minutes} min de leitura
        </Pill>
      </div>

      <div className="flex gap-10">
        <article ref={articleRef} className="min-w-0 flex-1 pb-4">
          <Markdown>{body}</Markdown>
        </article>

        {toc.length > 1 && (
          <nav
            aria-label="Sumario do guia"
            className="hidden w-56 flex-none min-[1200px]:block"
            // `sticky` funciona porque o ancestral que rola e o <main> do App;
            // um scroll proprio aqui criaria uma segunda barra de rolagem.
          >
            <div className="sticky top-8">
              <span className="mb-2 block text-xs font-medium uppercase tracking-[.06em] text-ink-meta">
                Nesta pagina
              </span>
              <ul className="flex flex-col gap-0.5 border-l border-line">
                {toc.map((item) => (
                  <li key={item.id}>
                    <button
                      onClick={() =>
                        document
                          .getElementById(item.id)
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }
                      className={[
                        '-ml-px block w-full border-l py-1 pr-2 text-left text-xs [text-wrap:pretty]',
                        item.depth === 3 ? 'pl-6' : 'pl-3',
                        item.id === activeId
                          ? 'border-accent font-medium text-accent-text'
                          : 'border-transparent text-ink-secondary hover:text-ink'
                      ].join(' ')}
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        )}
      </div>

      <div className="mt-10 flex flex-wrap gap-3 border-t border-line pt-6">
        {previous && (
          <Link to={`/docs/${previous.slug}`}>
            <Button variant="secondary">
              <ArrowLeft size={16} /> {previous.title}
            </Button>
          </Link>
        )}
        <div className="flex-1" />
        {next ? (
          <Link to={`/docs/${next.slug}`}>
            <Button variant="secondary">
              {next.title} <ArrowRight size={16} />
            </Button>
          </Link>
        ) : (
          <Link to="/docs">
            <Button variant="secondary">
              <BookOpen size={16} /> Todos os guias
            </Button>
          </Link>
        )}
      </div>
    </PageBody>
  )
}
