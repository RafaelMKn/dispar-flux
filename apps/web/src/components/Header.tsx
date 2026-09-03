import React from 'react';
import { StatusBadge } from './StatusBadge';

interface HeaderProps {
  isClaimed?: boolean;
  edition?: string;
  version?: string;
  autoRefresh: boolean;
  isLoading: boolean;
  lastFetchedAt: string | null;
  onToggleAutoRefresh: () => void;
  onRefresh: () => void;
}

export function Header({
  isClaimed,
  edition = 'community',
  version = '0.0.1',
  autoRefresh,
  isLoading,
  lastFetchedAt,
  onToggleAutoRefresh,
  onRefresh,
}: HeaderProps) {
  const formattedTime = lastFetchedAt
    ? new Date(lastFetchedAt).toLocaleTimeString('pt-BR')
    : '--:--:--';

  return (
    <header className="app-header">
      <div className="header-brand-group">
        <div className="logo-badge">
          <svg
            className="brand-logo"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
            <path d="M9.5 9.5 14.5 14.5" />
            <path d="M14.5 9.5 9.5 14.5" />
          </svg>
        </div>
        <div>
          <div className="header-title-row">
            <h1 className="header-title">Dispar Flux</h1>
            <span className="badge-edition">
              {edition === 'community' ? 'Edição Comunitária AGPLv3' : edition}
            </span>
            <span className="badge-version">v{version}</span>
          </div>
          <p className="header-subtitle">
            Plataforma Self-Hosted Web de Atendimento &amp; Mensageria WhatsApp
          </p>
        </div>
      </div>

      <div className="header-actions">
        {typeof isClaimed === 'boolean' && (
          <StatusBadge
            status={isClaimed ? 'Instalação Reivindicada' : 'Aguardando Reivindicação'}
            variant={isClaimed ? 'success' : 'warning'}
            size="sm"
          />
        )}

        <div className="refresh-controls">
          <button
            type="button"
            className={`btn-auto-refresh ${autoRefresh ? 'active' : ''}`}
            onClick={onToggleAutoRefresh}
            title={autoRefresh ? 'Pausar atualização automática' : 'Ativar atualização automática (5s)'}
          >
            <span className={`pulse-indicator ${autoRefresh ? 'pulsing' : ''}`} />
            {autoRefresh ? 'Auto 5s' : 'Pausado'}
          </button>

          <button
            type="button"
            className="btn-refresh"
            onClick={onRefresh}
            disabled={isLoading}
            title="Atualizar agora"
          >
            <svg
              className={`refresh-icon ${isLoading ? 'spinning' : ''}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
            <span>Atualizar</span>
          </button>
        </div>

        <div className="last-updated">
          Última checagem: <span>{formattedTime}</span>
        </div>
      </div>
    </header>
  );
}
