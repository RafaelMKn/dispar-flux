import { Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import BasePage from './pages/BasePage'
import DisparoPage from './pages/DisparoPage'
import ConfigPage from './pages/ConfigPage'
import InboxPage from './pages/InboxPage'
import { useCallback, useEffect, useState } from 'react'
import { useTheme } from './useTheme'
import { useWhatsapp } from './useWhatsapp'

export default function App(): JSX.Element {
  const { theme, toggle } = useTheme()
  const wa = useWhatsapp()
  const [unread, setUnread] = useState(0)

  const refreshUnread = useCallback(() => {
    void window.api.inbox.totalUnread().then(setUnread)
  }, [])

  useEffect(() => {
    refreshUnread()
    // O badge acompanha qualquer mudanca na inbox (nova mensagem ou leitura).
    return window.api.inbox.onChanged(refreshUnread)
  }, [refreshUnread])

  return (
    <div className="flex h-full w-full overflow-hidden bg-surface-base font-sans text-base text-ink">
      <Sidebar
        theme={theme}
        onToggleTheme={toggle}
        connected={wa.status === 'connected'}
        unread={unread}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Navigate to="/disparo" replace />} />
          <Route path="/inbox" element={<InboxPage />} />
          <Route path="/disparo" element={<DisparoPage />} />
          <Route path="/base" element={<BasePage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="*" element={<Navigate to="/disparo" replace />} />
        </Routes>
      </main>
    </div>
  )
}
