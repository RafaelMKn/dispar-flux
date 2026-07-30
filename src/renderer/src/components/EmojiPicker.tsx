import { useEffect, useRef, useState } from 'react'

/**
 * Seletor de emojis.
 *
 * Lista curada e embutida em vez de uma biblioteca: um pacote de emoji completo
 * traz alguns MB de dados e sprites para um recurso que, aqui, e "colocar um
 * emoji numa resposta". Estes cobrem com folga o vocabulario de uma conversa
 * comercial, e a fonte do sistema ja desenha todos.
 */
const GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: 'Rostos',
    emojis: [
      '😀',
      '😃',
      '😄',
      '😁',
      '😅',
      '😂',
      '🤣',
      '🙂',
      '😉',
      '😊',
      '😍',
      '😘',
      '😗',
      '🤗',
      '🤔',
      '😐',
      '😴',
      '😪',
      '😌',
      '😔',
      '😢',
      '😭',
      '😤',
      '😡',
      '🥺',
      '😱',
      '😳',
      '🤯',
      '😎',
      '🤓',
      '🥳',
      '😇',
      '🙃',
      '😬',
      '🤡',
      '🥰',
      '😏',
      '😒',
      '🙄',
      '😩'
    ]
  },
  {
    label: 'Gestos',
    emojis: [
      '👍',
      '👎',
      '👌',
      '🤝',
      '👏',
      '🙏',
      '💪',
      '✌️',
      '🤞',
      '👋',
      '🫡',
      '🤙',
      '☝️',
      '👇',
      '👈',
      '👉',
      '✋',
      '🖐️',
      '🫶',
      '👊'
    ]
  },
  {
    label: 'Negocios',
    emojis: [
      '💰',
      '💵',
      '💳',
      '📈',
      '📉',
      '📊',
      '🧾',
      '📝',
      '📄',
      '📋',
      '📎',
      '📌',
      '🗓️',
      '⏰',
      '⏳',
      '✅',
      '❌',
      '⚠️',
      '🔔',
      '🔒',
      '📞',
      '📱',
      '💻',
      '🖥️',
      '📧',
      '🏢',
      '🛒',
      '🎯',
      '🚀',
      '🤖'
    ]
  },
  {
    label: 'Simbolos',
    emojis: [
      '❤️',
      '🧡',
      '💛',
      '💚',
      '💙',
      '💜',
      '🖤',
      '🤍',
      '💔',
      '💯',
      '🔥',
      '⭐',
      '🌟',
      '✨',
      '🎉',
      '🎊',
      '🎁',
      '☕',
      '🍕',
      '🍻',
      '☀️',
      '🌙',
      '🌧️',
      '⚡',
      '🌈',
      '🏆',
      '🥇',
      '❓',
      '❗',
      '➡️'
    ]
  }
]

export function EmojiPicker({
  onPick,
  onClose
}: {
  onPick: (emoji: string) => void
  onClose: () => void
}): JSX.Element {
  const [group, setGroup] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  // Fecha ao clicar fora ou apertar Esc — comportamento esperado de um popover.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Escolher emoji"
      className="absolute bottom-full left-0 z-30 mb-2 w-[19rem] rounded-lg border border-line bg-surface-raised shadow-float"
    >
      <div className="flex gap-1 border-b border-line px-2 py-1.5">
        {GROUPS.map((g, i) => (
          <button
            key={g.label}
            onClick={() => setGroup(i)}
            className={[
              'rounded px-2 py-1 text-[11px] transition-colors duration-120',
              i === group ? 'bg-accent-wash text-ink' : 'text-ink-meta hover:bg-accent-wash'
            ].join(' ')}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto p-2">
        {GROUPS[group].emojis.map((emoji) => (
          <button
            key={emoji}
            onClick={() => onPick(emoji)}
            aria-label={emoji}
            className="grid h-8 w-8 place-items-center rounded text-xl leading-none hover:bg-accent-wash"
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  )
}
