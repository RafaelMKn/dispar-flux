import { normalizePhoneNumber } from '@dispar-flux/domain';

export interface ReconciledIdentity {
  canonicalJid: string; // The canonical WhatsApp JID (preferably @s.whatsapp.net)
  phoneNumber?: string; // Canonical E.164 phone number if known
  digits?: string; // Raw digits of phone number
  isLid: boolean;
  lid?: string;
  jid?: string;
}

/**
 * Strips device / session suffixes from JIDs (e.g. 5511999999999:1@s.whatsapp.net -> 5511999999999@s.whatsapp.net).
 */
export function normalizeJid(jid: string): string {
  if (!jid) return '';
  return jid.replace(/:[^@]+@/, '@').trim();
}

export function isLid(jid: string): boolean {
  if (!jid) return false;
  return normalizeJid(jid).endsWith('@lid');
}

export function isGroupJid(jid: string): boolean {
  if (!jid) return false;
  return normalizeJid(jid).endsWith('@g.us');
}

export function isUserJid(jid: string): boolean {
  if (!jid) return false;
  return normalizeJid(jid).endsWith('@s.whatsapp.net');
}

/**
 * Extracts phone number digits from a standard JID or phone string.
 */
export function extractPhoneNumberFromJid(jidOrPhone: string): string | undefined {
  if (!jidOrPhone) return undefined;
  const clean = normalizeJid(jidOrPhone);
  if (isLid(clean) || isGroupJid(clean)) {
    return undefined;
  }
  const atIdx = clean.indexOf('@');
  const user = atIdx !== -1 ? clean.slice(0, atIdx) : clean;
  const norm = normalizePhoneNumber(user);
  return norm.isValid ? norm.digits : (user.replace(/\D/g, '') || undefined);
}

/**
 * Formats a phone number or raw recipient into a valid Baileys WhatsApp JID.
 */
export function formatToWhatsAppJid(to: string): string {
  const clean = normalizeJid(to.trim());
  if (clean.includes('@')) {
    return clean;
  }
  const norm = normalizePhoneNumber(clean);
  if (norm.isValid && norm.digits) {
    return `${norm.digits}@s.whatsapp.net`;
  }
  const digits = clean.replace(/\D/g, '');
  return `${digits}@s.whatsapp.net`;
}

/**
 * Reconciles WhatsApp Linked Identity (LID) and Phone Number (JID) mappings.
 * WhatsApp multi-device infrastructure uses opaque LIDs for encryption sessions,
 * while business logic and CRM require phone-number based JIDs.
 */
export class JidReconciler {
  private lidToJid = new Map<string, string>();
  private jidToLid = new Map<string, string>();

  /**
   * Registers a discovered association between an LID and a canonical JID.
   */
  registerMapping(lidInput: string, jidInput: string): void {
    const lid = normalizeJid(lidInput);
    const jid = normalizeJid(jidInput);
    if (!isLid(lid) || !isUserJid(jid)) {
      return;
    }
    this.lidToJid.set(lid, jid);
    this.jidToLid.set(jid, lid);
  }

  /**
   * Gets the mapped JID for a given LID if known.
   */
  getJidFromLid(lidInput: string): string | undefined {
    const lid = normalizeJid(lidInput);
    return this.lidToJid.get(lid);
  }

  /**
   * Gets the mapped LID for a given JID if known.
   */
  getLidFromJid(jidInput: string): string | undefined {
    const jid = normalizeJid(jidInput);
    return this.jidToLid.get(jid);
  }

  /**
   * Reconciles remoteJid and optional participant into a canonical identity.
   */
  reconcile(remoteJidInput: string, participantInput?: string): ReconciledIdentity {
    const remoteJid = normalizeJid(remoteJidInput);
    const participant = participantInput ? normalizeJid(participantInput) : undefined;

    // 1. If participant is present (e.g. in group chat or multi-device):
    const effectiveSender = participant || remoteJid;

    if (isLid(effectiveSender)) {
      const mappedJid = this.lidToJid.get(effectiveSender);
      if (mappedJid) {
        const phone = extractPhoneNumberFromJid(mappedJid);
        return {
          canonicalJid: mappedJid,
          phoneNumber: phone,
          digits: phone,
          isLid: true,
          lid: effectiveSender,
          jid: mappedJid,
        };
      }

      // Unmapped LID: keep LID as canonical until mapping is learned
      return {
        canonicalJid: effectiveSender,
        phoneNumber: undefined,
        digits: undefined,
        isLid: true,
        lid: effectiveSender,
        jid: undefined,
      };
    }

    // 2. Standard user JID (@s.whatsapp.net)
    const phone = extractPhoneNumberFromJid(effectiveSender);
    const mappedLid = this.jidToLid.get(effectiveSender);

    return {
      canonicalJid: effectiveSender,
      phoneNumber: phone,
      digits: phone,
      isLid: false,
      lid: mappedLid,
      jid: effectiveSender,
    };
  }

  /**
   * Clears all cached mappings for this reconciler instance.
   */
  clear(): void {
    this.lidToJid.clear();
    this.jidToLid.clear();
  }
}
