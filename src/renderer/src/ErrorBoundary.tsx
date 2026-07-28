import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Sem isto, qualquer erro de render derruba a arvore inteira e o app vira uma
 * tela branca sem pista nenhuma — o pior sintoma possivel num app empacotado,
 * onde nao ha DevTools aberto. O boundary troca a tela branca por uma mensagem
 * legivel + stack, e o `console.error` do React continua indo para o log do
 * main (ver o handler de 'console-message' em src/main/index.ts).
 */

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  stack: string | null
}

/** Erro tipico de abrir o renderer fora do Electron: o preload nunca rodou. */
function isPreloadMissing(): boolean {
  return typeof window.api === 'undefined'
}

// Estilos inline de proposito: se o problema for o CSS, as classes do Tailwind
// tambem estariam quebradas e a tela de erro sumiria junto.
const wrap: React.CSSProperties = {
  padding: '32px',
  fontFamily: 'system-ui, sans-serif',
  fontSize: '14px',
  lineHeight: 1.6,
  color: '#1a1614',
  background: '#fbefe5',
  height: '100%',
  overflow: 'auto'
}

const pre: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  background: '#f5e2d3',
  border: '1px solid #e8d1be',
  borderRadius: '8px',
  padding: '12px',
  fontSize: '12px',
  marginTop: '16px'
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Vai para o console do renderer e, por tabela, para o log do main.
    console.error('Erro fatal no renderer:', error, info.componentStack)
    this.setState({ stack: info.componentStack ?? null })
  }

  render(): ReactNode {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div style={wrap}>
        <h1 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 8px' }}>
          A interface parou de responder
        </h1>
        {isPreloadMissing() ? (
          <p style={{ margin: 0 }}>
            A ponte com o processo principal (<code>window.api</code>) nao existe. Isso acontece
            quando esta pagina e aberta direto no navegador. Rode o app pelo Electron:{' '}
            <code>npm run dev</code>.
          </p>
        ) : (
          <p style={{ margin: 0 }}>
            O erro abaixo esta no log em <code>%APPDATA%\dispar-flux\logs\dispar-flux.log</code>.
          </p>
        )}
        <pre style={pre}>
          {error.message}
          {error.stack ? `\n\n${error.stack}` : ''}
          {stack ? `\n\nComponentes:${stack}` : ''}
        </pre>
      </div>
    )
  }
}
