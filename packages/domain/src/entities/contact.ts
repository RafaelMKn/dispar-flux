import { InvariantViolationError } from '../errors/domain-errors.js';

export interface CanonicalProfile {
  customFields: Record<string, string>;
  notes?: string;
  lastEditedByMemberId?: string;
  lastEditedAt?: Date;
}

export interface Contact {
  id: string;
  organizationId: string;
  normalizedPhone: string;
  name?: string;
  canonicalProfile: CanonicalProfile;
  isOptedOut: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactParams {
  id: string;
  organizationId: string;
  normalizedPhone: string;
  name?: string;
  canonicalProfile?: Partial<CanonicalProfile>;
  isOptedOut?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export function createContact(params: CreateContactParams): Contact {
  const normalizedPhone = params.normalizedPhone.trim();
  if (!normalizedPhone) {
    throw new InvariantViolationError('Normalized phone cannot be empty');
  }

  const now = new Date();
  const canonicalProfile: CanonicalProfile = {
    customFields: params.canonicalProfile?.customFields ? { ...params.canonicalProfile.customFields } : {},
    notes: params.canonicalProfile?.notes?.trim(),
    lastEditedByMemberId: params.canonicalProfile?.lastEditedByMemberId,
    lastEditedAt: params.canonicalProfile?.lastEditedAt,
  };

  return {
    id: params.id,
    organizationId: params.organizationId,
    normalizedPhone,
    name: params.name?.trim(),
    canonicalProfile,
    isOptedOut: params.isOptedOut ?? false,
    createdAt: params.createdAt ?? now,
    updatedAt: params.updatedAt ?? now,
  };
}

export function updateCanonicalProfile(
  contact: Contact,
  updates: {
    customFields?: Record<string, string>;
    notes?: string;
    editedByMemberId: string;
  },
  now: Date = new Date()
): Contact {
  const customFields = updates.customFields
    ? { ...contact.canonicalProfile.customFields, ...updates.customFields }
    : { ...contact.canonicalProfile.customFields };

  return {
    ...contact,
    canonicalProfile: {
      customFields,
      notes: updates.notes !== undefined ? updates.notes.trim() : contact.canonicalProfile.notes,
      lastEditedByMemberId: updates.editedByMemberId,
      lastEditedAt: now,
    },
    updatedAt: now,
  };
}
