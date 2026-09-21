import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
export interface WebhookLogger {
  warn(msg: string, ...args: any[]): void;
  error?(msg: string, ...args: any[]): void;
  info?(msg: string, ...args: any[]): void;
}

export interface WebhookSubscription {
  id: string;
  organizationId: string;
  targetUrl: string;
  secret: string;
  events: string[];
  isActive: boolean;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  eventName: string;
  payloadJson: string;
  responseStatus: number | null;
  attempts: number;
  state: 'pending' | 'success' | 'failed';
  nextRetryAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

export interface CreateSubscriptionParams {
  targetUrl: string;
  secret?: string;
  events?: string[];
}

export type WebhookFetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export class WebhookService {
  private db: DatabaseConnection;
  private logger?: WebhookLogger;
  private fetchFn: WebhookFetchFn;

  constructor(db: DatabaseConnection, logger?: WebhookLogger, fetchFn?: WebhookFetchFn) {
    this.db = db;
    this.logger = logger;
    this.fetchFn = fetchFn || (globalThis.fetch as WebhookFetchFn);
  }

  public setFetchFn(fn: WebhookFetchFn): void {
    this.fetchFn = fn;
  }

  public createSubscription(organizationId: string, params: CreateSubscriptionParams): WebhookSubscription {
    const targetUrl = (params.targetUrl || '').trim();
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      throw new Error('targetUrl deve ser uma URL válida http ou https');
    }

    const secret = params.secret?.trim() || crypto.randomBytes(32).toString('hex');
    const events = Array.isArray(params.events) && params.events.length > 0 ? params.events : ['*'];
    const id = `wh_sub_${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO webhook_subscriptions (
        id, organization_id, target_url, secret_ciphertext, events_json, is_active, failure_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
    `).run(id, organizationId, targetUrl, secret, JSON.stringify(events), now, now);

    return {
      id,
      organizationId,
      targetUrl,
      secret,
      events,
      isActive: true,
      failureCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  public listSubscriptions(organizationId: string): WebhookSubscription[] {
    const rows = this.db.prepare(`
      SELECT * FROM webhook_subscriptions
      WHERE organization_id = ?
      ORDER BY created_at DESC
    `).all(organizationId) as any[];

    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      targetUrl: r.target_url,
      secret: r.secret_ciphertext,
      events: JSON.parse(r.events_json || '[]'),
      isActive: Boolean(r.is_active),
      failureCount: r.failure_count || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public getSubscription(organizationId: string, subscriptionId: string): WebhookSubscription | null {
    const r = this.db.prepare(`
      SELECT * FROM webhook_subscriptions
      WHERE id = ? AND organization_id = ?
    `).get(subscriptionId, organizationId) as any;

    if (!r) return null;
    return {
      id: r.id,
      organizationId: r.organization_id,
      targetUrl: r.target_url,
      secret: r.secret_ciphertext,
      events: JSON.parse(r.events_json || '[]'),
      isActive: Boolean(r.is_active),
      failureCount: r.failure_count || 0,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public deleteSubscription(organizationId: string, subscriptionId: string): boolean {
    const res = this.db.prepare(`
      DELETE FROM webhook_subscriptions
      WHERE id = ? AND organization_id = ?
    `).run(subscriptionId, organizationId);
    return res.changes > 0;
  }

  public getDeliveries(organizationId: string, subscriptionId?: string, limit = 50): WebhookDelivery[] {
    let sql = `
      SELECT d.* FROM webhook_deliveries d
      JOIN webhook_subscriptions s ON d.subscription_id = s.id
      WHERE s.organization_id = ?
    `;
    const params: any[] = [organizationId];

    if (subscriptionId) {
      sql += ` AND d.subscription_id = ?`;
      params.push(subscriptionId);
    }

    sql += ` ORDER BY d.created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map((r) => ({
      id: r.id,
      subscriptionId: r.subscription_id,
      eventName: r.event_name,
      payloadJson: r.payload_json,
      responseStatus: r.response_status,
      attempts: r.attempts,
      state: r.state,
      nextRetryAt: r.next_retry_at,
      createdAt: r.created_at,
      deliveredAt: r.delivered_at,
    }));
  }

  public async dispatch(organizationId: string, eventName: string, data: unknown): Promise<number> {
    const subscriptions = this.listSubscriptions(organizationId).filter((s) => s.isActive);
    const matching = subscriptions.filter(
      (s) => s.events.includes('*') || s.events.includes(eventName)
    );

    if (matching.length === 0) {
      return 0;
    }

    const payload = {
      id: `evt_${crypto.randomUUID()}`,
      event: eventName,
      timestamp: new Date().toISOString(),
      organizationId,
      data,
    };
    const payloadJson = JSON.stringify(payload);

    const promises = matching.map(async (sub) => {
      const deliveryId = `wh_del_${crypto.randomUUID()}`;
      const now = new Date().toISOString();

      // Sign payload with HMAC-SHA256
      const signature = crypto
        .createHmac('sha256', sub.secret)
        .update(payloadJson)
        .digest('hex');

      // Record pending delivery
      this.db.prepare(`
        INSERT INTO webhook_deliveries (
          id, subscription_id, event_name, payload_json, response_status, attempts, state, created_at
        ) VALUES (?, ?, ?, ?, NULL, 0, 'pending', ?)
      `).run(deliveryId, sub.id, eventName, payloadJson, now);

      try {
        const response = await this.fetchFn(sub.targetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-DisparFlux-Signature': `sha256=${signature}`,
            'X-DisparFlux-Event': eventName,
            'X-DisparFlux-Delivery': deliveryId,
            'User-Agent': 'DisparFlux-Webhooks/1.0',
          },
          body: payloadJson,
          signal: AbortSignal.timeout(5000),
        });

        const deliveredAt = new Date().toISOString();
        if (response.ok) {
          this.db.prepare(`
            UPDATE webhook_deliveries
            SET response_status = ?, attempts = attempts + 1, state = 'success', delivered_at = ?
            WHERE id = ?
          `).run(response.status, deliveredAt, deliveryId);

          this.db.prepare(`
            UPDATE webhook_subscriptions
            SET failure_count = 0, updated_at = ?
            WHERE id = ?
          `).run(deliveredAt, sub.id);
        } else {
          this.db.prepare(`
            UPDATE webhook_deliveries
            SET response_status = ?, attempts = attempts + 1, state = 'failed', delivered_at = ?
            WHERE id = ?
          `).run(response.status, deliveredAt, deliveryId);

          this.db.prepare(`
            UPDATE webhook_subscriptions
            SET failure_count = failure_count + 1, updated_at = ?
            WHERE id = ?
          `).run(deliveredAt, sub.id);
        }
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.logger?.warn(`Webhook delivery failed for ${sub.targetUrl}`, { error: errorMsg, eventName });
        const failedAt = new Date().toISOString();
        this.db.prepare(`
          UPDATE webhook_deliveries
          SET response_status = 500, attempts = attempts + 1, state = 'failed', delivered_at = ?
          WHERE id = ?
        `).run(failedAt, deliveryId);

        this.db.prepare(`
          UPDATE webhook_subscriptions
          SET failure_count = failure_count + 1, updated_at = ?
          WHERE id = ?
        `).run(failedAt, sub.id);
      }
    });

    await Promise.allSettled(promises);
    return matching.length;
  }
}
