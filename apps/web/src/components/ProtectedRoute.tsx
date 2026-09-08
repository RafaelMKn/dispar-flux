import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Send } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children }: { children: JSX.Element }): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-surface-base text-ink">
        <div className="grid h-12 w-12 animate-pulse place-items-center rounded-2xl bg-accent text-surface-raised shadow-float">
          <Send size={24} />
        </div>
        <p className="mt-4 text-sm font-medium text-ink-secondary">Carregando Dispar Flux...</p>
      </div>
    );
  }

  if (status === 'unclaimed') {
    return <Navigate to="/claim" replace state={{ from: location }} />;
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}
