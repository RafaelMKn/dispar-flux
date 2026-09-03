import React from 'react';
import type { ReadyResponse } from '@dispar-flux/contracts';
import { StatusBadge } from './StatusBadge';

interface ReadinessPanelProps {
  ready: ReadyResponse | null;
  error: string | null;
  latencyMs: number;
}

export function ReadinessPanel({ ready, error, latencyMs }: ReadinessPanelProps) {
  if (error || !ready) {
    return (
      <div className="card card-error">
        <div className="card-header">
          <div className="card-title-group">
            <h3>Saúde da Instalação &amp; Banco (/ready)</h3>
          </div>
          <StatusBadge status="Falha" variant="error" />
        </div>
        <div className="card-body">
          <p className="error-message">{error || 'Serviço de prontidão inacessível'}</p>
        </div>
      </div>
    );
  }

  const isFullyReady = ready.status === 'ready';

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <h3>Saúde da Instalação &amp; Banco</h3>
          <span className="api-endpoint">GET /ready</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span className="latency-indicator">{latencyMs}ms</span>
          <StatusBadge
            status={ready.status.toUpperCase()}
            variant={isFullyReady ? 'success' : 'warning'}
            pulse={isFullyReady}
          />
        </div>
      </div>

      <div className="readiness-grid">
        <div className="readiness-item">
          <div className="readiness-item-header">
            <span className="item-title">Banco SQLite Nativo (WAL)</span>
            <StatusBadge
              status={ready.database}
              variant={ready.database === 'connected' ? 'success' : 'error'}
              size="sm"
            />
          </div>
          <p className="item-desc">
            Base persistente de dados com journal WAL e lock de runtime exclusivo contra segundo processo.
          </p>
        </div>

        <div className="readiness-item">
          <div className="readiness-item-header">
            <span className="item-title">Storage Local (/data)</span>
            <StatusBadge
              status={ready.storage}
              variant={ready.storage === 'ready' ? 'success' : 'error'}
              size="sm"
            />
          </div>
          <p className="item-desc">
            Diretório de mídias, avatares e sessão Baileys isolado no volume de dados.
          </p>
        </div>
      </div>

      {ready.checks && Object.keys(ready.checks).length > 0 && (
        <div className="checks-section">
          <h4 className="checks-title">Verificações de Prontidão do Kernel</h4>
          <div className="checks-list">
            {Object.entries(ready.checks).map(([checkName, isOk]) => (
              <div key={checkName} className="check-row">
                <span className="check-name">{checkName}</span>
                <span className={`check-status ${isOk ? 'ok' : 'fail'}`}>
                  {isOk ? 'OK' : 'FALHA'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
