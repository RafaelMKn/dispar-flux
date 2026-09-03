import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeJid,
  isLid,
  isUserJid,
  isGroupJid,
  extractPhoneNumberFromJid,
  formatToWhatsAppJid,
  JidReconciler,
} from '../src/index.js';

describe('Baileys Connector: JID & LID Reconciliation', () => {
  describe('JID Normalization and Formatting', () => {
    it('normalizes device and agent suffixes from JIDs', () => {
      assert.equal(normalizeJid('5511999999999:1@s.whatsapp.net'), '5511999999999@s.whatsapp.net');
      assert.equal(normalizeJid('5511999999999:12@s.whatsapp.net'), '5511999999999@s.whatsapp.net');
      assert.equal(normalizeJid('123456789:5@lid'), '123456789@lid');
      assert.equal(normalizeJid('12345-67890:1@g.us'), '12345-67890@g.us');
    });

    it('correctly classifies JID types', () => {
      assert.equal(isLid('123456789@lid'), true);
      assert.equal(isLid('123456789:1@lid'), true);
      assert.equal(isLid('5511999999999@s.whatsapp.net'), false);

      assert.equal(isUserJid('5511999999999@s.whatsapp.net'), true);
      assert.equal(isUserJid('5511999999999:2@s.whatsapp.net'), true);
      assert.equal(isUserJid('123456789@lid'), false);

      assert.equal(isGroupJid('12036302@g.us'), true);
      assert.equal(isGroupJid('5511999999999@s.whatsapp.net'), false);
    });

    it('extracts canonical phone number from user JID', () => {
      assert.equal(extractPhoneNumberFromJid('5511999999999@s.whatsapp.net'), '5511999999999');
      assert.equal(extractPhoneNumberFromJid('5511999999999:1@s.whatsapp.net'), '5511999999999');
      assert.equal(extractPhoneNumberFromJid('123456789@lid'), undefined, 'LIDs are opaque and do not expose phone numbers directly');
      assert.equal(extractPhoneNumberFromJid('group@g.us'), undefined);
    });

    it('formats destination phone numbers to canonical WhatsApp JID', () => {
      // Brazilian 11-digit mobile
      assert.equal(formatToWhatsAppJid('11987654321'), '5511987654321@s.whatsapp.net');
      // Brazilian formatted
      assert.equal(formatToWhatsAppJid('(11) 98765-4321'), '5511987654321@s.whatsapp.net');
      // Brazilian 10-digit mobile (auto-inserts 9th digit)
      assert.equal(formatToWhatsAppJid('1187654321'), '5511987654321@s.whatsapp.net');
      // International with plus
      assert.equal(formatToWhatsAppJid('+14155552671'), '14155552671@s.whatsapp.net');
      // Already JID
      assert.equal(formatToWhatsAppJid('5511987654321@s.whatsapp.net'), '5511987654321@s.whatsapp.net');
    });
  });

  describe('JidReconciler Mapping Store', () => {
    it('reconciles standard user JID without prior mapping', () => {
      const reconciler = new JidReconciler();
      const result = reconciler.reconcile('5511998765432@s.whatsapp.net');

      assert.equal(result.canonicalJid, '5511998765432@s.whatsapp.net');
      assert.equal(result.phoneNumber, '5511998765432');
      assert.equal(result.isLid, false);
    });

    it('handles unmapped LID by preserving LID until mapping is discovered', () => {
      const reconciler = new JidReconciler();
      const result = reconciler.reconcile('9876543210@lid');

      assert.equal(result.canonicalJid, '9876543210@lid');
      assert.equal(result.phoneNumber, undefined);
      assert.equal(result.isLid, true);
      assert.equal(result.lid, '9876543210@lid');
    });

    it('registers LID to JID mapping and reconciles subsequent LID messages to canonical JID', () => {
      const reconciler = new JidReconciler();
      const lid = '9876543210@lid';
      const jid = '5511998765432@s.whatsapp.net';

      reconciler.registerMapping(lid, jid);

      assert.equal(reconciler.getJidFromLid(lid), jid);
      assert.equal(reconciler.getLidFromJid(jid), lid);

      // Reconciling message arriving with LID remoteJid
      const reconciled = reconciler.reconcile(lid);
      assert.equal(reconciled.canonicalJid, jid);
      assert.equal(reconciled.phoneNumber, '5511998765432');
      assert.equal(reconciled.isLid, true);
      assert.equal(reconciled.lid, lid);
      assert.equal(reconciled.jid, jid);
    });

    it('reconciles participant JID when message arrives in group or multi-device with participant', () => {
      const reconciler = new JidReconciler();
      const lid = '9876543210@lid';
      const jid = '5511998765432@s.whatsapp.net';
      reconciler.registerMapping(lid, jid);

      const result = reconciler.reconcile('12036302@g.us', lid);
      assert.equal(result.canonicalJid, jid);
      assert.equal(result.phoneNumber, '5511998765432');
    });
  });
});
