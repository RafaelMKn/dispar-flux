import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Send, Shield, Building2, User, KeyRound, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button, Card, Input, Select } from '../components/ui';
import { useAuth } from '../contexts/AuthContext';

const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'Brasília / São Paulo (UTC-3)' },
  { value: 'America/Manaus', label: 'Manaus (UTC-4)' },
  { value: 'America/Cuiaba', label: 'Cuiabá (UTC-4)' },
  { value: 'America/Belem', label: 'Belém / Pará (UTC-3)' },
  { value: 'America/Fortaleza', label: 'Nordeste / Fortaleza (UTC-3)' },
  { value: 'America/Rio_Branco', label: 'Acre / Rio Branco (UTC-5)' },
  { value: 'America/Noronha', label: 'Fernando de Noronha (UTC-2)' },
];

export default function ClaimPage(): JSX.Element {
  const navigate = useNavigate();
  const { claim } = useAuth();

  const [claimCode, setClaimCode] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [operationalTimezone, setOperationalTimezone] = useState('America/Sao_Paulo');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!claimCode.trim()) {
      setError('Informe o código de instalação (Claim Code).');
      return;
    }
    if (!organizationName.trim()) {
      setError('Informe o nome da Organização.');
      return;
    }
    if (!ownerName.trim()) {
      setError('Informe o nome do Proprietário.');
      return;
    }
    if (!ownerEmail.trim() || !ownerEmail.includes('@')) {
      setError('Informe um e-mail válido para o Proprietário.');
      return;
    }
    if (password.length < 8) {
      setError('A senha deve conter no mínimo 8 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas digitadas não conferem.');
      return;
    }

    setLoading(true);
    try {
      await claim({
        claimCode: claimCode.trim(),
        organizationName: organizationName.trim(),
        operationalTimezone,
        ownerName: ownerName.trim(),
        ownerEmail: ownerEmail.trim().toLowerCase(),
        password,
      });
      navigate('/disparo', { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Falha ao concluir a instalação. Verifique o código de claim.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-surface-base px-4 py-12 text-ink">
      <div className="w-full max-w-xl">
        {/* Header Branding */}
        <div className="mb-8 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-surface-raised shadow-float">
            <Send size={24} />
          </div>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Configuração Inicial da Instalação</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Esta instalação do <strong>Dispar Flux</strong> é virgem. Insira o código gerado no servidor para definir a Organização e a conta do Proprietário.
          </p>
        </div>

        <Card className="p-6 md:p-8">
          {error && (
            <div className="mb-6 flex items-start gap-3 rounded-lg border border-line bg-state-dangerWash p-3 text-sm text-state-dangerText">
              <AlertCircle size={18} className="mt-0.5 flex-none" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            {/* Step 1: Claim Code */}
            <div>
              <div className="mb-3 flex items-center gap-2 border-b border-line pb-2 font-medium text-ink">
                <Shield size={16} className="text-accent-text" />
                <span>1. Código de Autorização do Host</span>
              </div>
              <Input
                label="Código de Instalação (Claim Code)"
                placeholder="FLUX-XXXX-XXXX-XXXX"
                value={claimCode}
                onChange={(e) => setClaimCode(e.target.value)}
                hint="Exibido no seu terminal ao iniciar o servidor ou gerado via terminal com: npm run token"
                required
              />
            </div>

            {/* Step 2: Organization */}
            <div>
              <div className="mb-3 flex items-center gap-2 border-b border-line pb-2 font-medium text-ink">
                <Building2 size={16} className="text-accent-text" />
                <span>2. Organização</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Nome da Empresa / Organização"
                  placeholder="Ex: Minha Empresa"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  required
                />
                <Select
                  label="Fuso Horário Operacional"
                  value={operationalTimezone}
                  onChange={(e) => setOperationalTimezone(e.target.value)}
                  hint="Fuso canônico para horários de envio e CRM."
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {/* Step 3: Owner Account */}
            <div>
              <div className="mb-3 flex items-center gap-2 border-b border-line pb-2 font-medium text-ink">
                <User size={16} className="text-accent-text" />
                <span>3. Conta do Proprietário (Admin)</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Nome Completo"
                  placeholder="Seu nome"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  required
                />
                <Input
                  label="E-mail de Acesso"
                  type="email"
                  placeholder="admin@empresa.com"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  required
                />
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Input
                  label="Senha Forte"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Input
                  label="Confirmar Senha"
                  type="password"
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Safety Reminder */}
            <div className="rounded-lg border border-line-subtle bg-surface-sunken p-3 text-xs text-ink-meta">
              <div className="flex items-center gap-1.5 font-medium text-ink-secondary">
                <KeyRound size={14} /> Chave de Recuperação de Desastre
              </div>
              <p className="mt-1">
                Ao reivindicar esta instalação, o seu navegador principal será autorizado automaticamente.
                Certifique-se de salvar sua senha em um gerenciador seguro.
              </p>
            </div>

            <Button type="submit" disabled={loading} className="w-full py-2.5">
              {loading ? 'Inicializando Instalação...' : 'Concluir Instalação e Acessar'}
            </Button>
          </form>
        </Card>

        <div className="mt-6 text-center text-xs text-ink-meta">
          Dispar Flux • Plataforma Aberta Self-Hosted (AGPLv3)
        </div>
      </div>
    </div>
  );
}
