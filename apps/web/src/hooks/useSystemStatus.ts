import { useEffect, useState, useCallback, useRef } from 'react';
import {
  fetchHealth,
  fetchReady,
  fetchSystemStatus,
  type ApiFetchResult,
} from '../services/api';
import type {
  HealthResponse,
  ReadyResponse,
  SystemStatusResponse,
} from '@dispar-flux/contracts';

export interface SystemDataState {
  health: ApiFetchResult<HealthResponse>;
  ready: ApiFetchResult<ReadyResponse>;
  system: ApiFetchResult<SystemStatusResponse>;
  isLoading: boolean;
  lastFetchedAt: string | null;
}

const initialFetchResult = <T>(): ApiFetchResult<T> => ({
  data: null,
  error: null,
  latencyMs: 0,
  lastUpdated: null,
});

export function useSystemStatus(pollingIntervalMs = 5000) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [state, setState] = useState<SystemDataState>({
    health: initialFetchResult<HealthResponse>(),
    ready: initialFetchResult<ReadyResponse>(),
    system: initialFetchResult<SystemStatusResponse>(),
    isLoading: true,
    lastFetchedAt: null,
  });

  const timerRef = useRef<number | null>(null);

  const fetchAll = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }));

    const [healthRes, readyRes, systemRes] = await Promise.all([
      fetchHealth(),
      fetchReady(),
      fetchSystemStatus(),
    ]);

    setState({
      health: healthRes,
      ready: readyRes,
      system: systemRes,
      isLoading: false,
      lastFetchedAt: new Date().toISOString(),
    });
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!autoRefresh) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = window.setInterval(() => {
      fetchAll();
    }, pollingIntervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoRefresh, pollingIntervalMs, fetchAll]);

  return {
    ...state,
    autoRefresh,
    setAutoRefresh,
    refresh: fetchAll,
  };
}
