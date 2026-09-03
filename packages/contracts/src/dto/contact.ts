export interface CreateContactRequest {
  phone: string;
  name?: string;
  customFields?: Record<string, string>;
  notes?: string;
}

export interface CanonicalProfileDto {
  customFields: Record<string, string>;
  notes?: string;
  lastEditedAt?: string;
}

export interface ContactResponse {
  id: string;
  organizationId: string;
  normalizedPhone: string;
  name?: string;
  canonicalProfile: CanonicalProfileDto;
  isOptedOut: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListContactsResponse {
  contacts: ContactResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface OptOutRequest {
  reason?: string;
}

export interface ReauthorizeOptOutRequest {
  reason: string;
}
