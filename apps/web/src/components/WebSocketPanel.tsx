import React, { useState } from 'react';
import { StatusBadge, type BadgeVariant } from './StatusBadge';
import type { WebSocketStatus, ReceivedEventItem } from '../hooks/useWebSocket';

interface WebSocketPanelProps {
  status: WebSocketStatus;
  events: ReceivedEventItem[];
  lastEventAt: string | null;
  reconnectAttempts: number;
  wsUrl: string;
  onReconnect: () => void;
  onClearEvents: () => void;
}

export function WebSocketPanel({
  status,
  events,
  lastEventAt,
  reconnectAttempts,
  wsUrl,
  onReconnect,
  onClearEvents,
}: WebSocketPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getStatusVariant = (s: WebSocketStatus): BadgeVariant => {
    switch (s) {
      case 'connected':
        return 'success';
      case 'connecting':
        return 'warning';
      case 'error':
      case 'disconnected':
      default:
        return 'error';
    }
  };

  const getStatusLabel = (s: WebSocketStatus): string => {
    switch (s) {
      case 'connected':
        return 'Conectado';
      case 'connecting':
        return 'Conectando...';
      case 'error':
        return 'Erro';
      case 'disconnected':
      default:
        return 'Desconectado';
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title-group">
          <h3>Canal em Tempo Real (WebSocket)</h3>
          <span className="api-endpoint">{wsUrl}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {reconnectAttempts > 0 && (
            <span className="retry-indicator">Tentativa {reconnectAttempts}</span>
          )}
          <StatusBadge
            status={getStatusLabel(status)}
            variant={getStatusVariant(status)}
            pulse={status === 'connected'}
          />
        </div>
      </div>

      <div className="ws-meta-bar">
        <div className="ws-meta-item">
          <span className="ws-meta-label">Eventos Recebidos:</span>
          <span className="ws-meta-value">{events.length}</span>
        </div>
        <div className="ws-meta-item">
          <span className="ws-meta-label">Último Sinal:</span>
          <span className="ws-meta-value">
            {lastEventAt ? new Date(lastEventAt).toLocaleTimeString('pt-BR') : 'Nenhum'}
          </span>
        </div>

        <div className="ws-actions">
          {events.length > 0 && (
            <button
              type="button"
              className="btn-text"
              onClick={onClearEvents}
              title="Limpar histórico de eventos da tela"
            >
              Limpar Feed
            </button>
          )}
          {status !== 'connected' && (
            <button
              type="button"
              className="btn-reconnect"
              onClick={onReconnect}
              title="Forçar reconexão imediata"
            >
              Reconectar
            </button>
          )}
        </div>
      </div>

      <div className="events-feed">
        <h4 className="feed-title">Feed de Eventos WebSocket</h4>

        {events.length === 0 ? (
          <div className="empty-feed">
            <p className="empty-feed-text">
              {status === 'connected'
                ? 'Conectado ao canal /ws. Aguardando sinais do sistema...'
                : 'Aguardando conexão WebSocket...'}
            </p>
          </div>
        ) : (
          <div className="events-list">
            {events.map((evt) => {
              const eventType = evt.parsed?.type || 'raw.message';
              const isExpanded = expandedId === evt.id;

              return (
                <div
                  key={evt.id}
                  className={`event-item ${isExpanded ? 'expanded' : ''}`}
                  onClick={() => toggleExpand(evt.id)}
                >
                  <div className="event-item-header">
                    <div className="event-type-badge">
                      <span className="event-dot" />
                      <span className="event-type-text">{eventType}</span>
                    </div>
                    <span className="event-time">
                      {new Date(evt.receivedAt).toLocaleTimeString('pt-BR')}
                    </span>
                  </div>

                  {evt.parsed && (
                    <div className="event-summary">
                      {evt.parsed.type.startsWith('connection.') && (
                        <span>
                          Conexão: <strong>{(evt.parsed as any).payload?.status}</strong>
                        </span>
                      )}
                      {evt.parsed.type.startsWith('campaign.') && (
                        <span>
                          Campanha: <strong>{(evt.parsed as any).payload?.campaignId}</strong> (
                          {(evt.parsed as any).payload?.progressPercent}%)
                        </span>
                      )}
                      {evt.parsed.type.startsWith('system.') && (
                        <span>{(evt.parsed as any).payload?.message}</span>
                      )}
                      {evt.parsed.type.startsWith('message.') && (
                        <span>
                          {(evt.parsed as any).payload?.direction}:{' '}
                          {(evt.parsed as any).payload?.content?.slice(0, 40)}
                        </span>
                      )}
                    </div>
                  )}

                  {isExpanded && (
                    <pre className="event-payload-json">
                      {JSON.stringify(evt.parsed ?? evt.raw, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
