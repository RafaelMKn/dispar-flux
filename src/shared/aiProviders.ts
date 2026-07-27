// Registro de provedores/modelos de IA para o menu interativo da tela de
// Configuracoes. Reutilizavel pelo processo main quando o modo IA for ligado.

export interface AiProvider {
  id: 'anthropic' | 'openai' | 'google'
  label: string
  models: { id: string; label: string }[]
}

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' }
    ]
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' }
    ]
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    models: [
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
    ]
  }
]
