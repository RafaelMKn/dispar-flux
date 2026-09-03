import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DisconnectReason } from '@whiskeysockets/baileys';
import {
  calculateBackoff,
  classifyDisconnectReason,
  isPermanentDisconnect,
  isImmediateRestart,
  isTemporaryNetworkError,
} from '../src/index.js';

describe('Baileys Connector: Error Handling & Reconnection Backoff', () => {
  describe('Exponential Backoff Calculation', () => {
    it('calculates deterministic exponential backoff delays', () => {
      // 0-indexed attempts with default initial 1000ms, factor 2, max 30000ms
      assert.equal(calculateBackoff(0), 1000);
      assert.equal(calculateBackoff(1), 2000);
      assert.equal(calculateBackoff(2), 4000);
      assert.equal(calculateBackoff(3), 8000);
      assert.equal(calculateBackoff(4), 16000);
      assert.equal(calculateBackoff(5), 30000); // capped at maxDelayMs
      assert.equal(calculateBackoff(10), 30000); // capped
    });

    it('respects custom backoff options', () => {
      const options = {
        initialDelayMs: 500,
        factor: 3,
        maxDelayMs: 10000,
        jitter: false,
      };

      assert.equal(calculateBackoff(0, options), 500);
      assert.equal(calculateBackoff(1, options), 1500);
      assert.equal(calculateBackoff(2, options), 4500);
      assert.equal(calculateBackoff(3, options), 10000); // capped
    });

    it('applies jitter within expected range when enabled', () => {
      const baseDelay = 1000;
      for (let i = 0; i < 20; i++) {
        const delayWithJitter = calculateBackoff(0, { jitter: true });
        assert.ok(delayWithJitter >= baseDelay, `Delay ${delayWithJitter} should be >= base ${baseDelay}`);
        assert.ok(delayWithJitter <= baseDelay * 1.25, `Delay ${delayWithJitter} should be <= ${baseDelay * 1.25}`);
      }
    });
  });

  describe('Disconnect Reason Classification', () => {
    it('identifies permanent logout (401)', () => {
      assert.equal(classifyDisconnectReason(DisconnectReason.loggedOut), 'logged_out');
      assert.equal(classifyDisconnectReason(401), 'logged_out');
      assert.equal(isPermanentDisconnect(DisconnectReason.loggedOut), true);
      assert.equal(isPermanentDisconnect(401), true);
      assert.equal(isTemporaryNetworkError(401), false);
    });

    it('identifies immediate restart required (515)', () => {
      assert.equal(classifyDisconnectReason(DisconnectReason.restartRequired), 'restart_required');
      assert.equal(classifyDisconnectReason(515), 'restart_required');
      assert.equal(isImmediateRestart(DisconnectReason.restartRequired), true);
      assert.equal(isImmediateRestart(515), true);
    });

    it('identifies conflict / replaced connection (440)', () => {
      assert.equal(classifyDisconnectReason(DisconnectReason.connectionReplaced), 'conflict');
      assert.equal(classifyDisconnectReason(440), 'conflict');
      assert.equal(isPermanentDisconnect(440), true);
    });

    it('identifies temporary network errors and timeouts', () => {
      assert.equal(classifyDisconnectReason(DisconnectReason.timedOut), 'temporary_network');
      assert.equal(classifyDisconnectReason(DisconnectReason.connectionClosed), 'temporary_network');
      assert.equal(classifyDisconnectReason(DisconnectReason.connectionLost), 'temporary_network');
      assert.equal(classifyDisconnectReason(408), 'temporary_network');
      assert.equal(classifyDisconnectReason(428), 'temporary_network');
      assert.equal(classifyDisconnectReason(500), 'temporary_network');

      assert.equal(classifyDisconnectReason(undefined, 'ECONNRESET'), 'temporary_network');
      assert.equal(classifyDisconnectReason(undefined, 'ETIMEDOUT'), 'temporary_network');
      assert.equal(classifyDisconnectReason(undefined, 'ENOTFOUND'), 'temporary_network');

      assert.equal(isTemporaryNetworkError(DisconnectReason.timedOut), true);
      assert.equal(isTemporaryNetworkError(undefined, 'ECONNRESET'), true);
    });

    it('handles unknown status codes gracefully', () => {
      assert.equal(classifyDisconnectReason(999), 'unknown');
      assert.equal(isTemporaryNetworkError(999), true); // treated as retryable by default
    });
  });
});
