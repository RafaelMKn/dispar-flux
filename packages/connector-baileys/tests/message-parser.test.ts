import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractContent,
  unwrapMessage,
  parseTimestamp,
  parseBaileysMessage,
  JidReconciler,
} from '../src/index.js';

describe('Baileys Connector: Message Parsing & Normalization', () => {
  describe('extractContent', () => {
    it('extracts plain conversation text', () => {
      const msg = { conversation: 'Olá, gostaria de informações sobre os serviços.' };
      const extracted = extractContent(msg);

      assert.equal(extracted.text, 'Olá, gostaria de informações sobre os serviços.');
      assert.equal(extracted.type, 'text');
    });

    it('extracts extended text message', () => {
      const msg = {
        extendedTextMessage: {
          text: 'Mensagem com link https://disparflux.com.br',
        },
      };
      const extracted = extractContent(msg);

      assert.equal(extracted.text, 'Mensagem com link https://disparflux.com.br');
      assert.equal(extracted.type, 'text');
    });

    it('extracts image message and caption', () => {
      const msg = {
        imageMessage: {
          url: 'https://mmg.whatsapp.net/d/f/image.enc',
          mimetype: 'image/jpeg',
          caption: 'Segue o comprovante de pagamento',
        },
      };
      const extracted = extractContent(msg);

      assert.equal(extracted.text, 'Segue o comprovante de pagamento');
      assert.equal(extracted.type, 'image');
      assert.equal(extracted.mediaType, 'image/jpeg');
      assert.equal(extracted.mediaUrl, 'https://mmg.whatsapp.net/d/f/image.enc');
    });

    it('extracts video message with caption', () => {
      const msg = {
        videoMessage: {
          url: 'https://mmg.whatsapp.net/d/f/video.enc',
          mimetype: 'video/mp4',
          caption: 'Vídeo demonstrativo',
        },
      };
      const extracted = extractContent(msg);

      assert.equal(extracted.text, 'Vídeo demonstrativo');
      assert.equal(extracted.type, 'video');
      assert.equal(extracted.mediaType, 'video/mp4');
    });

    it('extracts audio / voice message (PTT)', () => {
      const msg = {
        audioMessage: {
          url: 'https://mmg.whatsapp.net/d/f/audio.enc',
          mimetype: 'audio/ogg; codecs=opus',
          seconds: 14,
        },
      };
      const extracted = extractContent(msg);

      assert.equal(extracted.text, '');
      assert.equal(extracted.type, 'audio');
      assert.equal(extracted.mediaType, 'audio/ogg; codecs=opus');
    });

    it('extracts document message with fileName and caption', () => {
      const msg = {
        documentMessage: {
          url: 'https://mmg.whatsapp.net/d/f/doc.enc',
          mimetype: 'application/pdf',
          fileName: 'proposta_comercial.pdf',
          caption: 'Segue nossa proposta',
        },
      };
      const extracted = extractContent(msg);

      assert.equal(extracted.text, 'Segue nossa proposta');
      assert.equal(extracted.type, 'document');
      assert.equal(extracted.fileName, 'proposta_comercial.pdf');
      assert.equal(extracted.mediaType, 'application/pdf');
    });
  });

  describe('unwrapMessage', () => {
    it('unwraps view-once and ephemeral message containers', () => {
      const viewOnce = {
        viewOnceMessage: {
          message: {
            imageMessage: {
              caption: 'Foto única',
              mimetype: 'image/jpeg',
            },
          },
        },
      };
      const extracted = extractContent(viewOnce);
      assert.equal(extracted.text, 'Foto única');
      assert.equal(extracted.type, 'image');

      const ephemeral = {
        ephemeralMessage: {
          message: {
            conversation: 'Mensagem temporária',
          },
        },
      };
      const extractedEphem = extractContent(ephemeral);
      assert.equal(extractedEphem.text, 'Mensagem temporária');
    });
  });

  describe('parseTimestamp', () => {
    it('handles Unix seconds timestamp', () => {
      const seconds = 1700000000;
      const parsed = parseTimestamp(seconds);
      assert.equal(parsed.getTime(), 1700000000000);
    });

    it('handles Protobuf Long object { low, high }', () => {
      const longObj = { low: 1700000000, high: 0 };
      const parsed = parseTimestamp(longObj);
      assert.equal(parsed.getTime(), 1700000000000);
    });
  });

  describe('parseBaileysMessage', () => {
    it('ignores outbound messages (fromMe = true)', () => {
      const outboundMsg = {
        key: {
          id: 'msg-out-1',
          remoteJid: '5511998765432@s.whatsapp.net',
          fromMe: true,
        },
        message: { conversation: 'Mensagem enviada por mim' },
      };

      const result = parseBaileysMessage(outboundMsg, 'conn-1');
      assert.equal(result, null);
    });

    it('parses valid inbound message into InboundMessage contract', () => {
      const inboundMsg = {
        key: {
          id: 'msg-in-12345',
          remoteJid: '5511998765432@s.whatsapp.net',
          fromMe: false,
        },
        message: {
          conversation: 'Olá, gostaria de contratar o serviço',
        },
        messageTimestamp: 1700000000,
      };

      const result = parseBaileysMessage(inboundMsg, 'conn-1');
      assert.ok(result);
      assert.equal(result.messageId, 'msg-in-12345');
      assert.equal(result.connectionId, 'conn-1');
      assert.equal(result.from, '5511998765432');
      assert.equal(result.remoteJid, '5511998765432@s.whatsapp.net');
      assert.equal(result.content, 'Olá, gostaria de contratar o serviço');
      assert.equal(result.type, 'text');
      assert.equal(result.timestamp.getTime(), 1700000000000);
    });

    it('reconciles LID to canonical phone number via JidReconciler', () => {
      const reconciler = new JidReconciler();
      const lid = '9876543210@lid';
      const jid = '5511998765432@s.whatsapp.net';
      reconciler.registerMapping(lid, jid);

      const lidMsg = {
        key: {
          id: 'msg-lid-1',
          remoteJid: lid,
          fromMe: false,
        },
        message: { conversation: 'Oi vim pelo WhatsApp' },
      };

      const parsed = parseBaileysMessage(lidMsg, 'conn-1', reconciler);
      assert.ok(parsed);
      assert.equal(parsed.from, '5511998765432', 'Should resolve canonical phone from registered LID mapping');
      assert.equal(parsed.isLid, true);
    });
  });
});
