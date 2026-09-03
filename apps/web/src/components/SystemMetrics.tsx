import React, { useState } from 'react';
import type { SystemStatusResponse } from '@dispar-flux/contracts';
import { StatusBadge } from './StatusBadge';

interface SystemMetricsProps {
  system: SystemStatusResponse | null;
  error: string | null;
  latencyMs: number;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return `${h}h ${remM}m ${s}s`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return `${d}d ${remH}h ${remM}m`;
}

export function SystemMetrics({ system, error, latencyMs }: SystemMetricsProps) {
  const [copied, setCopied] = useState(false);

  const copyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error || !system) {
    return (
      <div className="card card-error">
        <div className="card-header">
          <div className="card-title-group">
            <h3>Status do Sistema (/api/v1/system/status)</h3>
          </div>
          <StatusBadge status="Indisponível" variant="error" />
        </div>
        <div className="card-body">
          <p className="error-message">{error || 'Sem resposta do servidor'}</p>
          <p className="error-tip">
            Certifique-se de que o serviço <code>dispar-flux</code> está em execução na porta 3000.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <h3>Status Geral da Instalação</h3>
          <span className="api-endpoint">GET /api/v1/system/status</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="latency-indicator">{latencyMs}ms</span>
          <StatusBadge status="Ativo" variant="success" pulse />
        </div>
      </div>

      <div className="metrics-grid">
        <div className="metric-box">
          <span className="metric-label">Identificador da Instalação</span>
          <div className="metric-value-with-action">
            <code className="metric-code" title={system.installationId}>
              {system.installationId.length > 20
                ? `${system.installationId.slice(0, 16)}...`
                : system.installationId}
            </code>
            <button
              type="button"
              className="btn-copy"
              onClick={() => copyId(system.installationId)}
              title="Copiar ID da Instalação"
            >
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        </div>

        <div className="metric-box">
          <span className="metric-label">Tempo Ativo (Uptime)</span>
          <span className="metric-value">{formatUptime(system.uptimeSeconds)}</span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Fuso Operacional</span>
          <span className="metric-value">{system.operationalTimezone || 'UTC'}</span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Runtime Node.js</span>
          <span className="metric-value">{system.nodeVersion}</span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Conexões WhatsApp</span>
          <span className="metric-value">
            {system.activeConnectionsCount}
            <span className="metric-subtext"> / 1 ativa (máx. comunitário)</span>
          </span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Provedor de Armazenamento</span>
          <span className="metric-value">{system.storageType || 'Local (Volume /data)'}</span>
        </div>
      </div>
    </div>
  );
}
