import { NavLink } from 'react-router-dom'
import {
  MessageCircle,
  Send,
  Database,
  Settings,
  BookOpen,
  Moon,
  Sun,
  Columns3,
  CalendarDays,
  Timer,
  type LucideIcon
} from 'lucide-react'
import { StatusDot } from './ui'
import type { Theme } from '../useTheme'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const items: NavItem[] = [
  { to: '/inbox', label: 'Conversas', icon: MessageCircle },
  { to: '/disparo', label: 'Disparo', icon: Send },
  { to: '/kanban', label: 'Kanban', icon: Columns3 },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/cron', label: 'Cron', icon: Timer },
  { to: '/base', label: 'Base de Dados', icon: Database },
  { to: '/config', label: 'Configuracoes', icon: Settings },
  { to: '/docs', label: 'Documentacao', icon: BookOpen }
]

export default function Sidebar({
  theme,
  onToggleTheme,
  connected = false,
  unread = 0
}: {
  theme: Theme
  onToggleTheme: () => void
  connected?: boolean
  unread?: number
}): JSX.Element {
  return (
    // Abaixo de 900px a sidebar colapsa para trilha de icones (w-16).
    <nav className="flex w-16 flex-none flex-col gap-1 border-r border-line bg-surface-sunken p-3 transition-[width] duration-180 ease-out min-[900px]:w-60">
      <div className="flex items-center gap-2.5 px-2 pb-5 pt-1">
        <div className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-accent text-surface-raised">
          <Send size={15} />
        </div>
        <span className="hidden whitespace-nowrap text-base font-semibold min-[900px]:inline">
          Dispar Flux
        </span>
      </div>

      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          title={item.label}
          className={({ isActive }) =>
            [
              'flex items-center gap-2.5 rounded px-2.5 py-2 text-sm transition-colors duration-120 ease-out',
              isActive
                ? 'bg-accent-wash font-medium text-accent-text'
                : 'text-ink-secondary hover:bg-accent-wash hover:text-ink'
            ].join(' ')
          }
        >
          <item.icon size={18} className="flex-none" />
          <span className="hidden whitespace-nowrap min-[900px]:inline">{item.label}</span>
          {item.to === '/inbox' && unread > 0 && (
            <span className="tnum ml-auto flex-none rounded-full bg-btn px-1.5 text-[10px] font-semibold text-btn-ink">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </NavLink>
      ))}

      <div className="flex-1" />

      <button
        onClick={onToggleTheme}
        title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
        className="flex items-center gap-2.5 rounded px-2.5 py-2 text-sm text-ink-secondary transition-colors duration-120 ease-out hover:bg-accent-wash hover:text-ink"
      >
        {theme === 'dark' ? (
          <Sun size={18} className="flex-none" />
        ) : (
          <Moon size={18} className="flex-none" />
        )}
        <span className="hidden whitespace-nowrap min-[900px]:inline">
          {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
        </span>
      </button>

      <div className="flex items-center gap-2.5 border-t border-line-subtle px-2 py-2.5">
        <StatusDot tone={connected ? 'success' : 'idle'} />
        <span className="hidden whitespace-nowrap text-xs text-ink-meta min-[900px]:inline">
          {connected ? 'WhatsApp conectado' : 'WhatsApp desconectado'}
        </span>
      </div>
    </nav>
  )
}
