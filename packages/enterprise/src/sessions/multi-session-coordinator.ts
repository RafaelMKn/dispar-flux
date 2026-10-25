export interface SessionSummary {
  connectionId: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'pairing' | 'connected' | 'failed';
  phoneNumber?: string | null;
  jid?: string | null;
  isDefault: boolean;
}

export class EnterpriseMultiSessionCoordinator {
  private sessions = new Map<string, SessionSummary>();

  registerSession(session: SessionSummary): void {
    this.sessions.set(session.connectionId, session);
  }

  updateSessionStatus(connectionId: string, status: SessionSummary['status'], details?: Partial<SessionSummary>): void {
    const existing = this.sessions.get(connectionId);
    if (existing) {
      this.sessions.set(connectionId, {
        ...existing,
        ...details,
        status,
      });
    }
  }

  removeSession(connectionId: string): void {
    this.sessions.delete(connectionId);
  }

  listSessions(): SessionSummary[] {
    return Array.from(this.sessions.values());
  }

  getActiveSessionCount(): number {
    return Array.from(this.sessions.values()).filter((s) => s.status === 'connected').length;
  }
}
