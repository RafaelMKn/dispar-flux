import { renderSpintax } from '../entropy/entropy-validator.js';

/**
 * Renders campaign message templates with recipient-specific variables.
 * Supports {{nome}}, {{name}}, {{telefone}}, {{phone}}, and any custom field from base membership.
 * Also resolves Spintax {A|B} variations.
 */
export interface TemplateVariables {
  name?: string;
  phone: string;
  fields?: Record<string, unknown>;
}

export function renderTemplate(template: string, vars: TemplateVariables): string {
  if (!template) return '';

  const spun = renderSpintax(template);

  const normalizedFields: Record<string, string> = {};

  if (vars.fields) {
    for (const [key, val] of Object.entries(vars.fields)) {
      if (val !== undefined && val !== null) {
        normalizedFields[key.toLowerCase().trim()] = typeof val === 'object' ? JSON.stringify(val) : String(val);
      }
    }
  }

  return template.replace(/\{\{\s*([a-zA-Z0-9_\u00C0-\u017F-]+)\s*\}\}/g, (match, key: string) => {
    const cleanKey = key.toLowerCase().trim();

    if (cleanKey === 'nome' || cleanKey === 'name') {
      return vars.name ?? '';
    }

    if (cleanKey === 'telefone' || cleanKey === 'phone' || cleanKey === 'celular') {
      return vars.phone;
    }

    if (cleanKey in normalizedFields) {
      return normalizedFields[cleanKey]!;
    }

    // Return empty string if variable is unresolved
    return '';
  });
}
