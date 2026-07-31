import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes
} from 'react'
import { ShieldAlert, X, type LucideIcon } from 'lucide-react'

/* ── Cabecalho de pagina ───────────────────────────────────────────────── */
export function PageHeader({
  title,
  subtitle,
  aside
}: {
  title: string
  subtitle?: string
  aside?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-[-.01em]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-secondary">{subtitle}</p>}
      </div>
      {aside && (
        <>
          <div className="flex-1" />
          {aside}
        </>
      )}
    </div>
  )
}

/* ── Container de conteudo (largura de formulario) ─────────────────────── */
export function PageBody({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto max-w-form px-8 pb-16 pt-8">{children}</div>
}

/* ── Superficies ──────────────────────────────────────────────────────── */
export function Card({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <div className={`rounded-lg border border-line bg-surface-raised p-4 shadow-flat ${className}`}>
      {children}
    </div>
  )
}

/* ── Secao numerada (usada na tela de Disparo) ─────────────────────────── */
export function StepSection({
  step,
  title,
  hint,
  children
}: {
  step: number
  title: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className="flex gap-4">
      <div className="tnum mt-0.5 grid h-7 w-7 flex-none place-items-center rounded-full border border-line bg-surface-sunken text-xs font-semibold text-ink-secondary">
        {step}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint && <p className="mt-0.5 text-sm text-ink-meta">{hint}</p>}
        <div className="mt-3">{children}</div>
      </div>
    </section>
  )
}

/* ── Botoes ───────────────────────────────────────────────────────────── */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export function Button({
  children,
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }): JSX.Element {
  const base =
    'inline-flex items-center justify-center gap-2 rounded font-medium transition-colors duration-120 ease-out disabled:cursor-not-allowed disabled:opacity-45'
  const styles: Record<ButtonVariant, string> = {
    primary: 'bg-btn text-btn-ink hover:bg-btn-hover active:bg-btn-active px-4 py-2 text-sm',
    secondary: 'border border-line bg-transparent text-ink hover:bg-accent-wash px-4 py-2 text-sm',
    ghost: 'text-accent-text hover:bg-accent-wash px-2 py-2 text-sm',
    danger:
      'border border-line bg-transparent text-state-dangerText hover:bg-state-dangerWash px-4 py-2 text-sm'
  }
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export function IconButton({
  children,
  label,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): JSX.Element {
  return (
    <button
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 flex-none place-items-center rounded border border-line bg-transparent text-ink transition-colors duration-120 ease-out hover:bg-accent-wash ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

/* ── Campos ───────────────────────────────────────────────────────────── */
const fieldCls =
  'w-full min-h-9 rounded border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors duration-120 placeholder:text-ink-tertiary hover:border-ink-tertiary focus-visible:border-accent-strong'

function Field({
  label,
  hint,
  children
}: {
  label?: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs text-ink-secondary">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-tertiary">{hint}</span>}
    </label>
  )
}

export function Input({
  label,
  hint,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label?: string; hint?: string }): JSX.Element {
  return (
    <Field label={label} hint={hint}>
      <input className={`${fieldCls} ${className}`} {...props} />
    </Field>
  )
}

export function Select({
  label,
  hint,
  className = '',
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label?: string; hint?: string }): JSX.Element {
  return (
    <Field label={label} hint={hint}>
      <select className={`${fieldCls} ${className}`} {...props}>
        {children}
      </select>
    </Field>
  )
}

/** Chave liga/desliga com rotulo e explicacao. */
export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}): JSX.Element {
  return (
    // `relative` nao e decoracao: `sr-only` posiciona o input em absolute e,
    // sem um ancestral posicionado, o bloco container dele vira o documento. Ai
    // ele escapa do `overflow-y-auto` do <main>, estica o <html> ate a altura
    // onde ficou e a tela ganha uma segunda barra de rolagem.
    <label className="relative flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 grid h-5 w-9 flex-none items-center rounded-full p-0.5 transition-colors duration-120 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-strong ${
          checked ? 'bg-btn' : 'bg-surface-sunken border border-line'
        }`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-surface-raised shadow-flat transition-transform duration-120 ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm text-ink">{label}</span>
        {hint && (
          <span className="mt-0.5 block text-xs text-ink-meta [text-wrap:pretty]">{hint}</span>
        )}
      </span>
    </label>
  )
}

/* ── Pills / badges / status ──────────────────────────────────────────── */
export function Pill({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}): JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-line bg-surface-raised px-3.5 py-1.5 text-xs text-ink-secondary ${className}`}
    >
      {children}
    </span>
  )
}

type StatusTone = 'success' | 'warning' | 'danger' | 'idle'

export function StatusDot({ tone = 'idle' }: { tone?: StatusTone }): JSX.Element {
  const color: Record<StatusTone, string> = {
    success: 'bg-state-success',
    warning: 'bg-state-warning',
    danger: 'bg-state-danger',
    idle: 'bg-ink-tertiary'
  }
  return <span className={`h-2 w-2 flex-none rounded-full ${color[tone]}`} />
}

/* ── Callout (aviso de risco, dicas) ──────────────────────────────────── */
export function Callout({
  tone = 'warning',
  icon: Icon = ShieldAlert,
  children
}: {
  tone?: 'warning' | 'danger' | 'success' | 'neutral'
  icon?: LucideIcon
  children: ReactNode
}): JSX.Element {
  // O fundo vai no bloco; a cor do tom vale so para o icone, porque o texto tem
  // contraste proprio (`text-ink-secondary`). Antes as duas classes iam juntas
  // no bloco e a do texto era sobrescrita — mesma aparencia, intencao obscura.
  const toneBg = {
    warning: 'bg-state-warningWash',
    danger: 'bg-state-dangerWash',
    success: 'bg-state-successWash',
    neutral: 'bg-surface-sunken'
  }[tone]
  const toneIcon = {
    warning: 'text-state-warningText',
    danger: 'text-state-dangerText',
    success: 'text-state-successText',
    neutral: 'text-ink-secondary'
  }[tone]
  return (
    <div className={`flex gap-3 rounded-lg border border-line p-4 ${toneBg}`}>
      <Icon size={17} className={`mt-0.5 flex-none ${toneIcon}`} />
      <div className="text-xs text-ink-secondary [text-wrap:pretty]">{children}</div>
    </div>
  )
}

/* ── Modal ────────────────────────────────────────────────────────────── */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className={`flex max-h-[88vh] w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} flex-col rounded-xl border border-line bg-surface-raised shadow-float`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="flex-1" />
          <IconButton label="Fechar" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Tabela ───────────────────────────────────────────────────────────── */
export function Table({ children }: { children: ReactNode }): JSX.Element {
  // Rola dentro do proprio container: a pagina nunca rola na horizontal.
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  )
}

export function Th({
  children,
  className = ''
}: {
  children?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <th
      className={`border-b border-line bg-surface-sunken px-3 py-2 text-left text-[11px] font-medium uppercase tracking-[.06em] text-ink-meta ${className}`}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className = ''
}: {
  children?: ReactNode
  className?: string
}): JSX.Element {
  return <td className={`border-b border-line-subtle px-3 py-2 ${className}`}>{children}</td>
}

/* ── Barra de progresso ───────────────────────────────────────────────── */
export function Progress({ value, max }: { value: number; max: number }): JSX.Element {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-180 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

/* ── Empty state (serif no titulo, conforme o design) ─────────────────── */
export function EmptyState({
  title,
  children
}: {
  title: string
  children?: ReactNode
}): JSX.Element {
  return (
    <div className="rounded-lg border border-line bg-surface-raised px-6 py-12 text-center">
      <h2 className="font-serif text-2xl font-normal">{title}</h2>
      {children && (
        <div className="mx-auto mt-2 max-w-md text-sm text-ink-secondary">{children}</div>
      )}
    </div>
  )
}
