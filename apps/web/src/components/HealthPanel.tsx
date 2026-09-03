import React from 'react';
import type { HealthResponse } from '@dispar-flux/contracts';
import { StatusBadge, type BadgeVariant } from './StatusBadge';

interface HealthPanelProps {
  health: HealthResponse | null;
  error: string | null;
  latencyMs: number;
}

export function HealthPanel({ health, error, latencyMs }: HealthPanelProps) {
  if (error || !health) {
    return (
      <div className="card card-error">
        <div className="card-header">
          <div className="card-title-group">
            <h3>Healthcheck HTTP (/health)</h3>
          </div>
          <StatusBadge status="Inacessível" variant="error" />
        </div>
        <div className="card-body">
          <p className="error-message">{error || 'Servidor indisponível'}</p>
        </div>
      </div>
    );
  }

  const getVariant = (s: string): BadgeVariant => {
    switch (s) {
      case 'ok':
        return 'success';
      case 'degraded':
        return 'warning';
      default:
        return 'error';
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <h3>Healthcheck HTTP</h3>
          <span className="api-endpoint">GET /health</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="latency-indicator">{latencyMs}ms</span>
          <StatusBadge
            status={health.status.toUpperCase()}
            variant={getVariant(health.status)}
            pulse={health.status === 'ok'}
          />
        </div>
      </div>

      <div className="metrics-grid compact">
        <div className="metric-box">
          <span className="metric-label">Status Vital</span>
          <span className="metric-value font-mono">{health.status}</span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Versão Reportada</span>
          <span className="metric-value font-mono">v{health.version}</span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Uptime do Processo</span>
          <span className="metric-value font-mono">{health.uptimeSeconds}s</span>
        </div>

        <div className="metric-box">
          <span className="metric-label">Carimbo de Data/Hora</span>
          <span className="metric-value text-sm">
            {new Date(health.timestamp).toLocaleString('pt-BR')}
          </span>
        </div>
      </div>
    </div>
  );
}
