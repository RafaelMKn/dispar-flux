import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Lock, AlertCircle, Laptop, RefreshCw } from 'lucide-react';
import { Button, Card, Input } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const { login, refresh } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Device approval state
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [checkingApproval, setCheckingApproval] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError('Preencha seu e-mail e senha.');
      return;
    }

    setLoading(true);
    try {
      const res = await login(email.trim().toLowerCase(), password);
      if (res.requiresDeviceApproval) {
        setAwaitingApproval(true);
        setPendingDeviceId(res.deviceId || null);
      } else {
        navigate('/disparo', { replace: true });
      }
    } catch (err: any) {
      setError(err?.message || 'E-mail ou senha incorretos.');
    } finally {
      setLoading(false);
    }
  };

  const handleRecheck = async () => {
    setCheckingApproval(true);
    setError(null);
    try {
      const res = await login(email.trim().toLowerCase(), password);
      if (!res.requiresDeviceApproval) {
        navigate('/disparo', { replace: true });
      } else {
        setError('O dispositivo ainda não foi aprovado pelo Proprietário.');
      }
    } catch (err: any) {
      setError(err?.message || 'Falha ao verificar autorização.');
    } finally {
      setCheckingApproval(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-surface-base px-4 py-12 text-ink">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-surface-raised shadow-float">
            <Send size={24} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Dispar Flux</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Entre com suas credenciais de membro para acessar o painel.
          </p>
        </div>

        <Card className="p-6 md:p-8">
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-line bg-state-dangerWash p-3 text-sm text-state-dangerText">
              <AlertCircle size={18} className="mt-0.5 flex-none" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {awaitingApproval ? (
            <div className="flex flex-col items-center text-center">
              <div className="mb-3 grid h-12 w-12 place-items-center rounded-full border border-line bg-surface-sunken text-accent-text">
                <Laptop size={24} />
              </div>
              <h2 className="text-lg font-semibold">Dispositivo Aguardando Autorização</h2>
              <p className="mt-2 text-sm text-ink-secondary [text-wrap:pretty]">
                Por política de segurança da Organização (ADR 0022), o seu navegador precisa ser aprovado pelo Proprietário antes de liberar o acesso.
              </p>

              {pendingDeviceId && (
                <div className="mt-4 w-full rounded border border-line-subtle bg-surface-sunken p-2.5 text-xs text-ink-meta">
                  <span>Identificador do Dispositivo:</span>
                  <div className="mt-0.5 font-mono font-medium text-ink truncate">{pendingDeviceId}</div>
                </div>
              )}

              <div className="mt-6 flex w-full flex-col gap-2">
                <Button onClick={handleRecheck} disabled={checkingApproval} className="w-full">
                  <RefreshCw size={16} className={checkingApproval ? 'animate-spin' : ''} />
                  {checkingApproval ? 'Verificando...' : 'Já foi aprovado? Tentar novamente'}
                </Button>
                <Button variant="ghost" onClick={() => setAwaitingApproval(false)}>
                  Voltar ao login
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="E-mail"
                type="email"
                placeholder="seu.email@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />

              <Input
                label="Senha"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />

              <div className="pt-2">
                <Button type="submit" disabled={loading} className="w-full py-2.5">
                  <Lock size={16} />
                  {loading ? 'Autenticando...' : 'Entrar'}
                </Button>
              </div>
            </form>
          )}
        </Card>

        <div className="mt-6 text-center text-xs text-ink-meta">
          Instalação Self-Hosted • Dispar Flux Edição Comunitária
        </div>
      </div>
    </div>
  );
}
