import type {
  HealthResponse,
  ReadyResponse,
  SystemStatusResponse,
} from '@dispar-flux/contracts';

export interface ApiFetchResult<T> {
  data: T | null;
  error: string | null;
  latencyMs: number;
  lastUpdated: string | null;
}

async function safeFetch<T>(endpoint: string): Promise<ApiFetchResult<T>> {
  const start = performance.now();
  try {
    const res = await fetch(endpoint, {
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
    const latencyMs = Math.round(performance.now() - start);

    if (!res.ok) {
      const errorText = await res.text().catch(() => res.statusText);
      return {
        data: null,
        error: `HTTP ${res.status}: ${errorText || res.statusText}`,
        latencyMs,
        lastUpdated: new Date().toISOString(),
      };
    }

    const data = (await res.json()) as T;
    return {
      data,
      error: null,
      latencyMs,
      lastUpdated: new Date().toISOString(),
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Falha na conexão com o servidor',
      latencyMs,
      lastUpdated: new Date().toISOString(),
    };
  }
}

export async function fetchHealth(): Promise<ApiFetchResult<HealthResponse>> {
  return safeFetch<HealthResponse>('/health');
}

export async function fetchReady(): Promise<ApiFetchResult<ReadyResponse>> {
  return safeFetch<ReadyResponse>('/ready');
}

export async function fetchSystemStatus(): Promise<ApiFetchResult<SystemStatusResponse>> {
  return safeFetch<SystemStatusResponse>('/api/v1/system/status');
}
