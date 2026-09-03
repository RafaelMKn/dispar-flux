import React from 'react';
import { Header } from './components/Header';
import { StatusBadge } from './components/StatusBadge';
import { SystemMetrics } from './components/SystemMetrics';
import { ReadinessPanel } from './components/ReadinessPanel';
import { HealthPanel } from './components/HealthPanel';
import { WebSocketPanel } from './components/WebSocketPanel';
import { useSystemStatus } from './hooks/useSystemStatus';
import { useWebSocket } from './hooks/useWebSocket';

export function App() {
  const {
    health,
    ready,
    system,
    isLoading,
    lastFetchedAt,
    autoRefresh,
    setAutoRefresh,
    refresh,
  } = useSystemStatus(5000);

  const {
    status: wsStatus,
    events: wsEvents,
    lastEventAt: wsLastEventAt,
    reconnectAttempts: wsAttempts,
    wsUrl,
    reconnect: wsReconnect,
    clearEvents: wsClearEvents,
  } = useWebSocket();

  const isClaimed = system.data?.isClaimed;
  const edition = system.data?.edition || 'community';
  const version = system.data?.version || health.data?.version || '0.0.1';

  return (
    <div className="app-container">
      <Header
        isClaimed={isClaimed}
        edition={edition}
        version={version}
        autoRefresh={autoRefresh}
        isLoading={isLoading}
        lastFetchedAt={lastFetchedAt}
        onToggleAutoRefresh={() => setAutoRefresh(!autoRefresh)}
        onRefresh={refresh}
      />

      {/* Top Banner Status Bar */}
      <div className="status-strip">
        <div className="status-strip-item">
          <span className="strip-label">Sistema:</span>
          <StatusBadge
            status={system.data ? 'Online' : 'Indisponível'}
            variant={system.data ? 'success' : 'error'}
            pulse={!!system.data}
            size="sm"
          />
        </div>

        <div className="status-strip-item">
          <span className="strip-label">Prontidão:</span>
          <StatusBadge
            status={ready.data?.status === 'ready' ? 'Pronto' : 'Não Pronto'}
            variant={ready.data?.status === 'ready' ? 'success' : 'warning'}
            pulse={ready.data?.status === 'ready'}
            size="sm"
          />
        </div>

        <div className="status-strip-item">
          <span className="strip-label">Vitalidade:</span>
          <StatusBadge
            status={health.data?.status === 'ok' ? 'Saudável' : 'Atenção'}
            variant={health.data?.status === 'ok' ? 'success' : 'error'}
            pulse={health.data?.status === 'ok'}
            size="sm"
          />
        </div>

        <div className="status-strip-item">
          <span className="strip-label">WebSocket:</span>
          <StatusBadge
            status={wsStatus === 'connected' ? 'Ao Vivo' : 'Desconectado'}
            variant={wsStatus === 'connected' ? 'success' : 'warning'}
            pulse={wsStatus === 'connected'}
            size="sm"
          />
        </div>
      </div>

      <main className="dashboard-content">
        <div className="dashboard-grid">
          {/* Main System Status Card */}
          <div className="grid-col-span-2">
            <SystemMetrics
              system={system.data}
              error={system.error}
              latencyMs={system.latencyMs}
            />
          </div>

          {/* Database & Readiness Card */}
          <div className="grid-col-1">
            <ReadinessPanel
              ready={ready.data}
              error={ready.error}
              latencyMs={ready.latencyMs}
            />
          </div>

          {/* Healthcheck Card */}
          <div className="grid-col-1">
            <HealthPanel
              health={health.data}
              error={health.error}
              latencyMs={health.latencyMs}
            />
          </div>

          {/* WebSocket Card */}
          <div className="grid-col-span-2">
            <WebSocketPanel
              status={wsStatus}
              events={wsEvents}
              lastEventAt={wsLastEventAt}
              reconnectAttempts={wsAttempts}
              wsUrl={wsUrl}
              onReconnect={wsReconnect}
              onClearEvents={wsClearEvents}
            />
          </div>
        </div>
      </main>

      <footer className="app-footer">
        <div className="footer-content">
          <p>
            <strong>Dispar Flux Community Edition</strong> — Licenciado sob GNU AGPLv3.
            Desenvolvido para auto-hospedagem robusta em VPS.
          </p>
          <div className="footer-links">
            <span>Invariante: 1 Instalação = 1 Organização</span>
            <span>&bull;</span>
            <span>SQLite WAL + Lock Exclusivo</span>
            <span>&bull;</span>
            <span>Conector Baileys Isolado</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
export default App;
