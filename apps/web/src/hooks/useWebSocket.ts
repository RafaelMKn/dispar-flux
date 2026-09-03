import { useEffect, useRef, useState, useCallback } from 'react';
import type { DisparWebSocketEvent } from '@dispar-flux/contracts';

export type WebSocketStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface ReceivedEventItem {
  id: string;
  receivedAt: string;
  raw: string;
  parsed: DisparWebSocketEvent | null;
}

export function useWebSocket() {
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [events, setEvents] = useState<ReceivedEventItem[]>([]);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);

  const getWsUrl = useCallback(() => {
    const loc = window.location;
    const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    // If running in Vite dev mode on 5173 without proxy, default to port 3000
    if (loc.port === '5173') {
      return `${protocol}//${loc.hostname}:3000/ws`;
    }
    return `${protocol}//${loc.host}/ws`;
  }, []);

  const connect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }

    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    const wsUrl = getWsUrl();
    setStatus('connecting');

    try {
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('connected');
        setReconnectAttempts(0);
      };

      socket.onmessage = (event) => {
        const receivedAt = new Date().toISOString();
        setLastEventAt(receivedAt);

        let parsed: DisparWebSocketEvent | null = null;
        try {
          parsed = JSON.parse(event.data) as DisparWebSocketEvent;
        } catch {
          parsed = null;
        }

        const item: ReceivedEventItem = {
          id: parsed?.id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          receivedAt,
          raw: typeof event.data === 'string' ? event.data : JSON.stringify(event.data),
          parsed,
        };

        setEvents((prev) => [item, ...prev.slice(0, 49)]);
      };

      socket.onerror = () => {
        setStatus('error');
      };

      socket.onclose = (event) => {
        setStatus('disconnected');
        socketRef.current = null;

        if (shouldReconnectRef.current) {
          setReconnectAttempts((prev) => {
            const next = prev + 1;
            const delay = Math.min(1000 * 2 ** (next - 1), 10000);
            reconnectTimeoutRef.current = window.setTimeout(() => {
              connect();
            }, delay);
            return next;
          });
        }
      };
    } catch {
      setStatus('error');
      if (shouldReconnectRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect();
        }, 5000);
      }
    }
  }, [getWsUrl]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setStatus('disconnected');
  }, []);

  const manualReconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    setReconnectAttempts(0);
    connect();
  }, [connect]);

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, [connect]);

  return {
    status,
    events,
    lastEventAt,
    reconnectAttempts,
    wsUrl: getWsUrl(),
    reconnect: manualReconnect,
    disconnect,
    clearEvents,
  };
}
