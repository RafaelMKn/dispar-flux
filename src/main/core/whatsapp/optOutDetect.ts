/**
 * Deteccao de pedido de descadastro numa mensagem recebida.
 *
 * O app promete "responda SAIR para nao receber mais", e a LGPD espera que esse
 * pedido seja respeitado. Mas errar para o lado agressivo tambem e ruim: marcar
 * alguem como descadastrado porque escreveu "vou sair mais tarde" faz o usuario
 * perder um contato legitimo, e ele nunca vai entender o motivo.
 *
 * Por isso a regra e conservadora: a mensagem INTEIRA, normalizada, precisa ser
 * uma das palavras-chave (ou a palavra seguida de pontuacao). Frases que apenas
 * contem a palavra nao contam.
 */

const KEYWORDS = [
  'sair',
  'parar',
  'pare',
  'stop',
  'cancelar',
  'descadastrar',
  'descadastre',
  'remover',
  'remova',
  'nao quero',
  'nao quero mais',
  'nao enviar',
  'unsubscribe',
  'sair da lista',
  'me tira da lista',
  'me tire da lista'
]

/** minusculas, sem acento, sem pontuacao nas pontas, espacos colapsados. */
export function normalizeMessage(body: string): string {
  return body
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[!.,;:?"'`´~^()[\]{}\-_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * true se a mensagem e um pedido de descadastro.
 *
 * Exige igualdade exata com uma palavra-chave apos normalizar — e o que evita
 * o falso positivo de frases que so mencionam a palavra.
 */
export function isOptOutRequest(body: string | null | undefined): boolean {
  if (!body) return false
  const norm = normalizeMessage(body)
  if (!norm) return false
  return KEYWORDS.includes(norm)
}

/**
 * Extrai o telefone E.164 a partir do JID do WhatsApp.
 *
 * `@lid` NAO E TELEFONE. O WhatsApp esta migrando o endereçamento para LID
 * (`71700301529149@lid`), um identificador opaco que nao tem relacao nenhuma
 * com o numero — o telefone verdadeiro vem separado, no `senderPn` da chave da
 * mensagem.
 *
 * Sem esta guarda o LID passava direto: 14 digitos passam no teste de
 * comprimento e viravam `+71700301529149`. O estrago era grande e silencioso —
 * quem respondia SAIR numa conversa LID **nao era descadastrado** (o telefone
 * real nunca entrava na `opt_outs`, que e global a todas as bases) e ainda
 * gravava um numero inexistente na tabela. Ver tambem `resolveLead`, que
 * dependia daqui para achar o lead e por isso nunca movia o cartao.
 *
 * Devolver `null` faz quem chama tratar como "nao sei o telefone", que e a
 * verdade — e o caminho certo e canonicalizar o jid na entrada (ver `lid.ts`).
 */
export function jidToE164(jid: string): string | null {
  if (jid.endsWith('@lid')) return null
  const digits = jid.split(':')[0].split('@')[0].replace(/\D/g, '')
  if (digits.length < 10) return null
  return `+${digits}`
}
