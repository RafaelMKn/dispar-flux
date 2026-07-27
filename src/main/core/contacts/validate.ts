import { whatsapp } from '../whatsapp/client'
import { uncheckedContacts, setWaResult } from '../../repos/contacts'
import { toWaNumber } from './phone'
import { saveNow } from '../../db'

/**
 * Verifica no WhatsApp quais numeros de uma base existem.
 *
 * ATENCAO (anti-ban): checar milhares de numeros de uma vez e, por si, um sinal
 * de spam para o WhatsApp. Por isso vai em lotes pequenos e com pausa entre
 * eles, e nunca revalidamos quem ja tem resultado (a query so traz `wa_valid`
 * nulo).
 */

const BATCH_SIZE = 20
const PAUSE_BETWEEN_BATCHES_MS = 1500

export interface ValidateProgress {
  listId: string
  done: number
  total: number
}

export async function validateList(
  listId: string,
  onProgress?: (p: ValidateProgress) => void
): Promise<{ checked: number; valid: number; invalid: number }> {
  if (!whatsapp.socket) throw new Error('Conecte o WhatsApp antes de validar os numeros.')

  const pending = uncheckedContacts(listId)
  const total = pending.length
  let done = 0
  let valid = 0
  let invalid = 0

  onProgress?.({ listId, done, total })

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (!whatsapp.socket) throw new Error('O WhatsApp desconectou durante a validacao.')

    const batch = pending.slice(i, i + BATCH_SIZE)
    const results = await whatsapp.checkNumbers(batch.map((c) => toWaNumber(c.phoneE164)))

    batch.forEach((contact, idx) => {
      const r = results[idx]
      // Grava o jid que a API devolveu — e o que resolve o 9o digito.
      setWaResult(contact.id, r.exists, r.jid)
      if (r.exists) valid += 1
      else invalid += 1
    })

    done += batch.length
    onProgress?.({ listId, done, total })

    if (i + BATCH_SIZE < pending.length) {
      await new Promise((r) => setTimeout(r, PAUSE_BETWEEN_BATCHES_MS))
    }
  }

  saveNow()
  return { checked: done, valid, invalid }
}
