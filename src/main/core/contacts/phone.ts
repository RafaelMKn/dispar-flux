import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js'

export const DEFAULT_REGION: CountryCode = 'BR'

/**
 * Normaliza um telefone para E.164 (ex.: "+5511987654210").
 *
 * Retorna null se o numero for invalido. Aceita as formas que aparecem em CSV
 * brasileiro: "(11) 98765-4210", "11987654210", "5511987654210", "+55 11 ...".
 *
 * NAO tentamos adicionar/remover o 9o digito aqui: se o numero e valido em
 * E.164, quem decide o JID real e o WhatsApp, via `onWhatsApp()`. Mexer no 9o
 * digito por conta propria e a causa classica de mandar mensagem para o numero
 * errado.
 */
export function normalizePhone(
  raw: string,
  region: CountryCode = DEFAULT_REGION
): string | null {
  if (!raw) return null

  // Remove separadores comuns e ruido de planilha, preservando o '+' inicial.
  const cleaned = raw.trim().replace(/[\s()\-. ]/g, '')
  if (!cleaned) return null

  // Rejeita ramais/textos ("11987654210 ramal 3") e celulas de planilha vazias.
  if (!/^\+?\d+$/.test(cleaned)) return null

  const parsed = parsePhoneNumberFromString(cleaned, region)
  if (!parsed || !parsed.isValid()) return null

  return parsed.number // formato E.164
}

/** Só os dígitos do E.164, como o Baileys espera em `onWhatsApp()`. */
export function toWaNumber(e164: string): string {
  return e164.replace(/\D/g, '')
}
