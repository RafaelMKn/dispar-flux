# Arquitetura Self-Hosted & Estratégia de Monetização — Dispar Flux

> **Documento substituído.** Este texto foi uma exploração anterior às decisões de arquitetura.
> O plano canônico aprovado está em
> [`plano-mestre-self-hosted-web.md`](./plano-mestre-self-hosted-web.md), com o vocabulário em
> [`../CONTEXT.md`](../CONTEXT.md) e as decisões em [`adr/`](./adr/).

Este documento descreve a tese de produto, arquitetura técnica, modelo de negócios e roteiro de migração para transformar o **Dispar Flux** de um app desktop local em uma plataforma **Self-Hosted** (Docker / Web / VPS), posicionando-o como infraestrutura empresarial de mensageria e CRM ativo.

---

## 1. Tese de Produto: Por que Self-Hosted?

O modelo desktop (Electron) atende bem a usuários individuais amadores, mas possui limitações estruturais de monetização e operação no mercado B2B:

| Dimensão | App Desktop (Electron Atual) | Plataforma Self-Hosted (Docker / Web) |
| :--- | :--- | :--- |
| **Percepção de Valor** | "Programinha de disparo" / utilitário local | "Infraestrutura Empresarial de CRM & Mensageria" |
| **Continuidade 24/7** | Se o PC desligar ou hibernar, a campanha para | Roda contínua em VPS (nuvem), mesmo com equipe offline |
| **Acesso & Equipe** | 1 máquina local, 1 usuário por vez | Toda a equipe comercial e SDRs acessam via navegador |
| **Segurança & Dados** | Dados presos no `%APPDATA%` do computador | Backup automatizado em nuvem (S3 / Drive / R2) |
| **Integrações** | Isolado no sistema operacional | API REST e Webhooks para conectar com n8n, Typebot, CRMs |
| **Ticket de Venda** | R$ 50 a R$ 150 (licença avulsa / baixa margem) | **R$ 1.500 a R$ 5.000 (Setup) + R$ 300 a R$ 900/mês (Suporte)** |

### Casos Análogos no Mercado
- **n8n / Typebot / Chatwoot / Evolution API / OpenClaw**: Projetos de código aberto ou *source-available* que geram receita primária através de **serviços de implementação, consultoria de implantação, sustentação de infraestrutura e suporte corporativo**.

---

## 2. Modelo de Monetização & Empacotamento de Serviços

A complexidade técnica percebida na instalação em servidor permite transformar o software em uma **oferta de alto valor agregado (High-Ticket)**:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   PACOTE DE IMPLEMENTAÇÃO ENTERPRISE                   │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Provisionamento de VPS dedicada (Hetzner, DigitalOcean ou AWS)     │
│ 2. Apontamento de domínio próprio + SSL automático (ex: crm.empresa)   │
│ 3. Instalação e isolamento do Dispar Flux via Docker                   │
│ 4. Parametrização anti-ban e consultoria de cadência segura            │
│ 5. Estruturação do funil Kanban e réguas de follow-up (Cron)           │
│ 6. Treinamento de 1h para a equipe de vendas / SDRs                    │
├────────────────────────────────────────────────────────────────────────┤
│ PREÇO SUGERIDO: R$ 1.500 a R$ 5.000 (Setup único)                     │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│              CONTRATO DE SUSTENTAÇÃO & SUPORTE (RECORRÊNCIA)           │
├────────────────────────────────────────────────────────────────────────┤
│ • Monitoramento de uptime e integridade da sessão do WhatsApp          │
│ • Backups diários automatizados do banco de dados e sessões            │
│ • Atualizações contínuas de compatibilidade (Baileys / WhatsApp Web)   │
│ • Suporte técnico prioritário para re-pareamento ou dúvidas            │
├────────────────────────────────────────────────────────────────────────┤
│ PREÇO SUGERIDO: R$ 300 a R$ 900 / mês (MRR)                           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Arquitetura Técnica Self-Hosted

Na arquitetura Self-Hosted, o frontend é servido via navegador e o backend centraliza o motor de mensageria, banco de dados e cron contínuo.

```
                  ┌──────────────────────────────────────────────┐
                  │                 NAVEGADORES                  │
                  │   (Equipe Comercial / Gestor / SDRs)         │
                  └──────────────────────┬───────────────────────┘
                                         │ HTTPS / WSS
                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        VPS / SERVIDOR DO CLIENTE                       │
│                                                                        │
│   ┌────────────────────────┐         ┌─────────────────────────────┐   │
│   │   Nginx / Caddy / SSL  │ ──────► │       Dispar Flux Web       │   │
│   │ (Domínio & Certificado)│         │ (Frontend React compilado)  │   │
│   └────────────────────────┘         └──────────────┬──────────────┘   │
│                                                     │ REST / WebSockets│
│                                                     ▼                  │
│                                      ┌─────────────────────────────┐   │
│                                      │     Dispar Flux Server      │   │
│                                      │ (Node.js API + Engine Core) │   │
│                                      └──────┬───────────────┬──────┘   │
│                                             │               │          │
│                      ┌──────────────────────▼──────┐ ┌──────▼────────┐ │
│                      │ Baileys Engine (WhatsApp)   │ │ SQLite / PG   │ │
│                      │ - Gerenciamento de Sessão   │ │ Drizzle ORM   │ │
│                      │ - Campanhas & Cron 24/7     │ │ Dados & Logs  │ │
│                      └─────────────────────────────┘ └───────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

### Componentes da Nova Estrutura

1. **Frontend Web (`web`)**:
   - O código atual de `src/renderer` já é um SPA React + Tailwind completo.
   - Em vez de chamar `window.electronAPI.*`, consome uma API REST (`/api/...`) e escuta eventos em tempo real via **WebSockets (Socket.io ou WS nativo)**.

2. **Backend API Server (`server`)**:
   - Desenvolvido em **Node.js (Fastify ou Express)** com TypeScript.
   - Absorve os módulos existentes em `src/main/core` (campanhas, CRM, Baileys socket, cron, contatos).
   - Converte os handlers do IPC (`src/main/ipc.ts`) em rotas REST e emissores de eventos WebSocket.

3. **Camada de Persistência**:
   - **SQLite com better-sqlite3** (alta performance nativa em Linux) ou **PostgreSQL** para cenários multi-usuário corporativos.
   - O schema e queries já utilizam **Drizzle ORM**, facilitando a troca do driver de `sql.js` para `better-sqlite3` ou `node-postgres`.

4. **Persistência de Sessões do WhatsApp**:
   - Diretório de autenticação do Baileys montado em volume Docker persistente (`/data/auth`).

---

## 4. Estrutura de Pastas Sugerida (Monorepo ou Fullstack)

```
dispar-flux/
├── apps/
│   ├── server/                   # Backend Node.js / Fastify
│   │   ├── src/
│   │   │   ├── api/              # Rotas REST (/campaigns, /crm, /contacts, etc.)
│   │   │   ├── ws/               # WebSockets (eventos em tempo real da Inbox e Disparo)
│   │   │   ├── core/             # Lógica de WhatsApp (Baileys), Cron, Pacing
│   │   │   ├── db/               # Drizzle ORM + Migrations
│   │   │   └── index.ts          # Inicialização do servidor HTTP + WS
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── web/                      # Frontend React SPA (ex-renderer)
│       ├── src/                  # Telas (Conversas, Disparo, Kanban, Agenda, etc.)
│       │   ├── lib/api.ts        # Cliente Axios / Fetch substituindo Electron IPC
│       │   ├── lib/socket.ts     # Cliente WebSocket para updates em tempo real
│       │   └── ...
│       ├── Dockerfile
│       └── package.json
│
├── deploy/
│   ├── docker-compose.yml        # Orquestração da stack completa
│   ├── Caddyfile / nginx.conf    # Proxy reverso com SSL automático
│   └── install.sh                # Script de instalação em 1 linha
└── package.json
```

---

## 5. Docker & Script de Deploy em 1 Comando

Para criar a experiência de "alta tecnologia" e facilitar o setup técnico para clientes:

### Exemplo de `docker-compose.yml`

```yaml
version: '3.8'

services:
  dispar-flux:
    image: disparflux/core:latest
    container_name: dispar-flux-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - DATABASE_PATH=/data/disparflux.db
      - AUTH_DIR=/data/sessions
      - JWT_SECRET=alterar_em_producao_chave_segura
      - AI_API_KEY=${AI_API_KEY}
    volumes:
      - disparflux_data:/data

  caddy:
    image: caddy:2-alpine
    container_name: dispar-flux-proxy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - dispar-flux

volumes:
  disparflux_data:
  caddy_data:
  caddy_config:
```

### Script de Instalação Rápida (`install.sh`)

O cliente ou o técnico executa um único comando na VPS limpa:

```bash
curl -sSL https://raw.githubusercontent.com/RafaelMKn/dispar-flux/main/deploy/install.sh | bash
```

O script:
1. Instala Docker e Docker Compose automaticamente (se ausentes).
2. Pergunta o domínio do cliente (ex: `zap.minhaempresa.com.br`).
3. Gera o arquivo de configuração com SSL automático via Caddy/Let's Encrypt.
4. Faz o pull das imagens e inicializa o serviço.
5. Exibe a URL pronta para login e pareamento de QR Code.

---

## 6. Recursos Enterprise para Elevar o Ticket Médio

Para posicionar o sistema em empresas maiores e justificar setups de R$ 3.000 a R$ 5.000+:

1. **Multi-Instâncias / Multi-WhatsApp**:
   - Conexão de múltiplos chips na mesma VPS (ex: "SDR 1 - Prospecção", "SDR 2 - Follow-up", "Atendimento").
2. **Controle de Acesso Baseado em Funções (RBAC)**:
   - **Administrador**: Gerencia campanhas, importa bases, ajusta cadências e chaves de IA.
   - **Operador / SDR**: Acessa apenas a tela de Conversas (Inbox) e o Kanban para qualificar e negociar.
3. **Webhooks de Entrada & Saída (Ecossistema n8n / Typebot)**:
   - Envio de mensagem disparado por evento externo (ex: lead preencheu formulário no site ou webhook do CRM).
   - Disparo de webhook quando o lead responde ou avança de coluna no Kanban.
4. **Painel de Métricas & Conversão**:
   - Gráficos de taxa de entrega, taxa de abertura/leitura, taxa de resposta e taxa de conversão por campanha.

---

## 7. Roteiro Prático de Execução

### Fase 1: Desacoplamento do Backend (API & WebSockets)
- [ ] Criar servidor Node.js/Fastify com TypeScript.
- [ ] Portar schema do Drizzle para `better-sqlite3` (ou PostgreSQL).
- [ ] Converter as rotas de `src/main/ipc.ts` em endpoints HTTP (`/api/*`).
- [ ] Implementar WebSocket para emissão de eventos (QR code, nova mensagem, status de campanha).

### Fase 2: Adaptação do Frontend Web
- [ ] Criar camada de abstração de API no frontend substituindo `window.electronAPI`.
- [ ] Integrar hook de WebSocket para manter estado reativo da Inbox e Kanban.
- [ ] Adicionar tela de autenticação/login para proteção do painel web.

### Fase 3: Empacotamento Docker & Deploy
- [ ] Criar `Dockerfile` multi-stage (build do frontend + runtime do backend).
- [ ] Configurar `docker-compose.yml` com Caddy/Nginx para HTTPS automático.
- [ ] Escrever `install.sh` com fluxo guiado via terminal.

### Fase 4: Posicionamento Comercial & Documentação de Vendas
- [ ] Criar apresentação/proposta comercial de implementação técnica.
- [ ] Definir tabela de preços (Setup + Mensalidade de Suporte).
- [ ] Elaborar contrato padrão de sustentação de infraestrutura.
