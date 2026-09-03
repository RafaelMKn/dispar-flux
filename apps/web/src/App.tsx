import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import UpdateBanner from './components/UpdateBanner';
import BasePage from './pages/BasePage';
import DisparoPage from './pages/DisparoPage';
import ConfigPage from './pages/ConfigPage';
import InboxPage from './pages/InboxPage';
import DocsPage from './pages/DocsPage';
import KanbanPage from './pages/KanbanPage';
import AgendaPage from './pages/AgendaPage';
import CronPage from './pages/CronPage';
import { useCallback, useEffect, useState } from 'react';
import { useTheme } from './useTheme';
import { useWhatsapp } from './useWhatsapp';
import './services/api';

export function App(): JSX.Element {
  const { theme, toggle } = useTheme();
  const wa = useWhatsapp();
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => {
    if (window.api?.inbox) {
      void window.api.inbox.totalUnread().then(setUnread).catch(() => {});
    }
  }, []);

  useEffect(() => {
    refreshUnread();
    if (window.api?.inbox) {
      return window.api.inbox.onChanged(refreshUnread);
    }
  }, [refreshUnread]);

  useEffect(() => {
    const interval = setInterval(refreshUnread, 10_000);
    return () => clearInterval(interval);
  }, [refreshUnread]);

  return (
    <BrowserRouter>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-surface-base font-sans text-base text-ink">
        <UpdateBanner />
        <div className="flex min-h-0 flex-1">
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
              <Route path="/kanban" element={<KanbanPage />} />
              <Route path="/agenda" element={<AgendaPage />} />
              <Route path="/cron" element={<CronPage />} />
              <Route path="/base" element={<BasePage />} />
              <Route path="/config" element={<ConfigPage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="/docs/:slug" element={<DocsPage />} />
              <Route path="*" element={<Navigate to="/disparo" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
