# Plano Mestre — Dispar Flux Self-Hosted Web

**Status:** entendimento compartilhado aprovado em 2026-09-03  
**Escopo:** arquitetura, migração, operação, distribuição e lançamento  
**Fora deste documento:** início da implementação ou remoção do Aplicativo Legado

Este é o plano canônico para substituir o Dispar Flux desktop por uma plataforma web
self-hosted. O vocabulário de negócio está em [`../CONTEXT.md`](../CONTEXT.md) e as decisões
duráveis estão registradas nos ADRs [`0001` a `0063`](./adr/).

## 1. Resultado pretendido

O novo Dispar Flux será uma plataforma web que:

- pode ser instalada gratuitamente por qualquer pessoa numa VPS;
- oferece o mesmo núcleo funcional no Serviço Gerenciado;
- isola cada Organização numa Instalação própria;
- continua usando Baileys no primeiro Conector de Mensageria;
- roda continuamente sem depender do computador de um usuário;
- permite trabalho em equipe com Proprietários e Operadores;
- preserva dados do desktop por meio de migração explícita e segura;
- oferece extensões empresariais comerciais sem tornar o núcleo dependente delas.

### Não objetivos da versão web 1.0

- API oficial da Meta;
- mais de uma Conexão de Mensageria ativa por Instalação;
- mais de um Funil ativo;
- modo de geração por IA, que ainda não existe funcionalmente no legado;
- SaaS multi-tenant com banco compartilhado;
- alta disponibilidade ou múltiplas réplicas do runtime;
- Kubernetes como implantação oficial;
- SSO, permissões granulares e painel central de frota;
- paridade de recursos exclusivos do sistema operacional, como tray e auto-start.

O novo schema e os contratos devem preparar múltiplas conexões e múltiplos funis sem
habilitá-los na primeira entrega.

## 2. Linha de base auditada

O Aplicativo Legado é um produto funcional na versão `0.4.0`, não um protótipo:

- Electron 33, React 18, TypeScript, Tailwind, Baileys `7.0.0-rc14`, `sql.js` e Drizzle;
- nove superfícies de uso: inbox, disparo, Kanban, agenda, cron, bases, configurações e docs;
- 28 arquivos de teste e 328 testes passando na auditoria de 2026-09-03;
- typecheck limpo na mesma auditoria;
- renderer isolado atrás de `window.api`, implementado pelo preload sobre IPC;
- aproximadamente 60 handlers/broadcasts concentrados no processo principal;
- um único socket Baileys, uma fila de campanha e um scheduler em memória;
- SQLite carregado em memória e exportado integralmente para `%APPDATA%`;
- mídia, avatares, logs e credenciais `wa-auth` mantidos no filesystem local;
- nenhuma autenticação, autorização, API HTTP, tenancy ou auditoria de atores.

### Acoplamentos que não atravessam diretamente para a web

- `BrowserWindow`, lifecycle, single-instance e protocolo `disparmedia://`;
- diálogos nativos para CSV, anexos e downloads;
- tray, notificações do Windows e início junto com o sistema;
- DPAPI por `safeStorage`;
- `electron-updater` e instalador NSIS;
- caminhos absolutos gravados no banco;
- pressuposto de um único usuário confiável no mesmo computador.

### Risco técnico dominante

O risco principal não é a SPA React. É trocar um processo local, síncrono e de escritor
único por um servidor acessível em rede sem perder durabilidade, isolamento, autorização ou
garantias contra envio duplicado.

## 3. Arquitetura-alvo

```text
Navegador / Dispositivo Autorizado
              │ HTTPS + WebSocket
              ▼
           Caddy
              │ rede privada do Compose
              ▼
┌──────────────────────────────────────────────────────────────┐
│ Dispar Flux — uma imagem OCI / um processo por Instalação   │
│                                                              │
│ SPA ─ REST /api/v1 ─ módulos de aplicação ─ domínio          │
│  │          │                 │                 │             │
│  └──── WebSocket/sinais ──────┘                 │             │
│                                                 │             │
│ Auth │ Contatos │ Campanhas │ Inbox │ CRM │ Integrações      │
│                                                 │             │
│ Baileys │ fila serial │ scheduler │ backup │ auditoria        │
│        │                 │              │                     │
│     SQLite/WAL      StorageProvider   SecretStore             │
└──────────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
   volume da Instalação   local inicialmente;
                         S3 compatível posteriormente
```

### Invariantes de implantação

1. Uma Instalação atende exatamente uma Organização.
2. Banco, arquivos, segredos, processos e rede são isolados por Instalação.
3. Várias Instalações podem compartilhar uma VPS, mas nunca banco ou volume.
4. Existe apenas um runtime ativo sobre um diretório de dados.
5. O processo Node é a autoridade exclusiva do SQLite e do socket Baileys.
6. A porta da aplicação não é publicada diretamente em produção.
7. O REST é a fonte da verdade; WebSocket apenas sinaliza mudanças.

## 4. Estrutura do novo repositório

O repositório novo se chamará `dispar-flux`. O atual será renomeado para
`dispar-flux-desktop` e permanecerá congelado durante a transição.

Estrutura inicial recomendada:

```text
dispar-flux/
├── apps/
│   ├── server/                 # bootstrap HTTP/WS e composição dos módulos
│   └── web/                    # SPA React
├── packages/
│   ├── domain/                 # regras puras e tipos de domínio
│   ├── application/            # casos de uso e portas
│   ├── contracts/              # DTOs, eventos e OpenAPI
│   ├── database/               # schema, migrations e repositórios SQLite
│   ├── connector-baileys/      # adapter do primeiro conector
│   ├── storage-local/          # implementação local de arquivos
│   └── testing/                # fixtures e testes de contrato
├── deploy/
│   ├── compose.yaml
│   ├── Caddyfile
│   └── install.sh
├── docs/
│   ├── adr/
│   └── operations/
├── CONTEXT.md
├── LICENSE                     # AGPLv3
└── package.json
```

Não haverá `apps/desktop` no novo repositório. O legado continuará separado para evitar que
Electron determine as fronteiras do servidor.

## 5. Módulos e responsabilidades

| Módulo | Responsabilidade | Não pode conhecer |
|---|---|---|
| Identidade e acesso | membros, papéis, sessões, dispositivos, convites | Baileys e regras de campanha |
| Mensageria | conexões, estado, QR, eventos e capacidades do conector | UI e detalhes do Electron |
| Contatos e bases | Contatos canônicos, Bases, Participações, importação | filas de transporte |
| Campanhas | snapshot, jobs, pacing, teto e retomada | HTTP, WebSocket ou React |
| Inbox e mídia | Conversas, mensagens, leitura, histórico e anexos | caminhos absolutos de storage |
| CRM | Funis, etapas, Leads, atribuição de respostas e agenda | tipos exclusivos do Baileys |
| Follow-up | elegibilidade e criação de Envios Automatizados | fila paralela própria |
| Integrações | Contas de Serviço, tokens, webhooks e entregas | cookies de membros |
| Auditoria | ator, ação, alvo e horário | conteúdo de mensagens |
| Migração e backup | exportação portátil, restore e integridade | credenciais dentro do pacote portátil |

O contrato atual `DisparApi` será usado como catálogo inicial de capacidades, não copiado
cegamente. Operações de diálogo, caminhos locais, updater e background serão redesenhadas
como capacidades web ou removidas.

## 6. Modelo de dados de referência

O schema detalhado será fechado na implementação, preservando estas chaves e invariantes:

| Entidade | Identidade/invariante |
|---|---|
| `organization` | exatamente uma por Instalação |
| `members` | usuário local; papel Proprietário ou Operador |
| `authorized_devices` | pertence a um membro; confiança expira por inatividade |
| `access_invites` | uso único, papel e expiração |
| `sessions` | revogáveis; duração ociosa e absoluta |
| `messaging_connections` | identificador presente desde o início; uma ativa no 1.0 |
| `contacts` | único por telefone normalizado na Organização |
| `bases` | procedência, finalidade e data de obtenção |
| `base_memberships` | único por Base–Contato; contém atributos da origem |
| `funnels` | identificador presente desde o início; um ativo no 1.0 |
| `leads` | único por Funil–Contato |
| `conversations` | único por Conexão–Contato |
| `messages` | pertence à Conversa; preserva ids/endereço do conector |
| `campaigns` | pertence a uma Conexão e registra confirmação responsável |
| `campaign_jobs` | snapshot de destinatário/conteúdo; pode terminar `unknown` |
| `opt_outs` | escopo da Organização, não da Base ou Conexão |
| `suppression_keys` | impede reimportação após eliminação da PII |
| `audit_records` | ator humano/serviço, ação, alvo, data e metadados sanitizados |
| `service_accounts` | identidade não humana com tokens e escopos revogáveis |
| `webhooks` | destino, segredo, eventos e estado |
| `webhook_deliveries` | tentativa, resposta e próximo retry |
| `retention_policy` | prazos por categoria no Fuso Operacional |
| `deletion_ledger` | exclusões que precisam ser reaplicadas após restore |

### Regras de domínio que o schema deve sustentar

- campos importados ficam na Participação na Base;
- somente edição humana altera o Perfil Canônico;
- JID e LID são endereços técnicos, não identidades de Contato;
- Conversas de conexões diferentes não são fundidas no armazenamento;
- uma resposta move somente o Lead atribuível ao envio relevante na mesma Conversa;
- casos ambíguos são sinalizados, nunca resolvidos movendo vários Leads;
- exclusão de PII não elimina a Supressão Pseudonimizada;
- Reautorização exige origem, data, ator e justificativa.

## 7. Persistência e concorrência

### SQLite

- substituir `sql.js` por driver SQLite nativo;
- habilitar WAL, foreign keys, busy timeout e integridade na abertura;
- adotar migrations versionadas e testadas sobre cópias reais do banco legado;
- envolver operações críticas em transações explícitas;
- impedir dois runtimes de abrirem o mesmo diretório de dados;
- eliminar gravação integral do banco em cada alteração.

### Fila de envio

- uma fila serial de Envio Automatizado por Conexão;
- campanha e follow-up compartilham pacing e teto diário;
- uma campanha automatizada ativa por Conexão no 1.0;
- Resposta Manual é imediata e não consome teto de prospecção;
- snapshot da Campanha não muda após o início;
- opt-out, validade do número e conexão são revalidados no envio;
- crash durante envio sem confirmação produz Envio Incerto;
- Envios Incertos nunca são repetidos automaticamente.

Ao habilitar múltiplas conexões, filas diferentes poderão avançar simultaneamente, mas cada
uma continuará serial e isolada.

## 8. API, eventos e integrações

### REST

- prefixo `/api/v1`;
- OpenAPI gerado e publicado com a mesma versão da imagem;
- validação de entrada e saída em todas as rotas;
- paginação e limites explícitos para inbox, mensagens e contatos;
- multipart para CSV e anexos;
- streaming e Range para mídia;
- idempotency keys em comandos externos quando a operação admitir repetição segura.

### WebSocket

- autenticação vinculada à sessão ou Conta de Serviço autorizada;
- eventos pequenos, versionados e sem conteúdo sensível desnecessário;
- reconexão sempre seguida de leitura REST do agregado afetado;
- nenhum pressuposto de entrega exatamente uma vez;
- backpressure e limites por conexão.

### Integrações

- Contas de Serviço, nunca cookies de membros;
- tokens armazenados apenas como hash e mostrados uma vez;
- escopos mínimos, por exemplo `messages:send`, `contacts:write` e `crm:read`;
- webhooks assinados por HMAC;
- retries com backoff, teto e dead-letter visível;
- payloads versionados e entregas auditáveis.

Webhooks básicos fazem parte da Edição Comunitária.

## 9. Identidade, autorização e segurança

### Primeiro acesso

1. O instalador gera um código de reivindicação de uso único.
2. O primeiro navegador informa o código, cria o Proprietário e torna-se autorizado.
3. O código é invalidado imediatamente.
4. O onboarding exige Fuso Operacional e Política de Retenção.

### Novos membros e dispositivos

- Proprietários criam Convites de Acesso temporários e de uso único;
- o convidado cria suas credenciais e autoriza o primeiro navegador pelo convite;
- outro navegador gera uma Solicitação de Acesso;
- um Proprietário em Dispositivo Autorizado aprova ou recusa;
- a Organização sempre conserva pelo menos um Proprietário;
- acesso de emergência exige comando na VPS e gera código curto e auditado.

### Sessões

- senha com hash resistente e parâmetros versionados;
- cookies `HttpOnly`, `Secure` e política `SameSite` adequada;
- sessão: 12 horas de inatividade e máximo absoluto de 30 dias;
- confiança do dispositivo: 90 dias sem uso;
- operações sensíveis exigem autenticação recente;
- revogar dispositivo encerra sessões e Web Push associados.

### Matriz mínima de autorização

| Capacidade | Proprietário | Operador |
|---|---:|---:|
| Inbox e Resposta Manual | sim | sim |
| CRM e agenda | sim | sim |
| Conexão de Mensageria | sim | não |
| Bases e importação | sim | não |
| iniciar/alterar Campanhas | sim | não |
| configurações e retenção | sim | não |
| membros e dispositivos | sim | próprio dispositivo apenas |
| backup, restore e migração | sim | não |
| Contas de Serviço | sim | não |

### Controles obrigatórios

- HTTPS em produção e porta do app privada;
- CSRF, CORS restritivo, CSP, headers seguros e rate limiting;
- limites de tamanho/tipo para uploads;
- autorização em cada objeto, não somente em cada rota;
- logs sem mensagens, nomes ou telefones legíveis;
- segredos nunca retornam novamente pela API;
- Piso de Segurança não pode ser desligado.

## 10. Arquivos, segredos e notificações

### Storage

O domínio usa `StorageProvider` com identificadores opacos. A implementação inicial grava em
volume local; S3/R2/MinIO poderá ser adicionado sem mudar mensagens ou UI. URLs de mídia são
curtas, autorizadas e nunca revelam caminhos do servidor.

### Chaves

- chave operacional gerada no bootstrap e guardada fora do banco;
- Chave de Recuperação distinta, mostrada uma vez ao Proprietário;
- Serviço Gerenciado guarda recuperação em cofre externo;
- perder a Chave de Recuperação torna o backup irrecuperável;
- `wa-auth` ao vivo usa permissões estritas do volume e entra criptografado nos backups;
- chaves de IA não entram em Pacotes de Migração.

### Web Push

- opt-in por Dispositivo Autorizado;
- assinatura revogada junto com o dispositivo;
- eventos iniciais: desconexão, Campanha concluída/interrompida, teto alcançado,
  compromisso e Solicitação de Acesso;
- payload não contém mensagem ou PII na tela bloqueada.

## 11. Migração do desktop

### Artefato

O Aplicativo Legado ganhará um exportador de Pacote de Migração contendo:

- manifesto com versão, checksums, contagens e Fuso Operacional sugerido;
- banco legado em snapshot consistente;
- mídias existentes e metadados necessários;
- nenhuma credencial Baileys;
- nenhuma chave de IA;
- nenhum log ou configuração exclusiva do Windows.

### Pré-condições

- nenhuma Campanha pode estar enviando;
- o exportador bloqueia novos inícios durante a captura;
- jobs `sending` são classificados de forma segura;
- o pacote é validado antes de ser considerado concluído.

### Importação

1. Aceitar somente numa Instalação vazia ou em modo específico de recuperação.
2. Verificar versão, manifesto, checksums e espaço disponível.
3. Consolidar Contatos repetidos por telefone normalizado.
4. Transformar linhas antigas em Participações na Base.
5. Criar a Conexão inicial e associar conversas, campanhas e jobs.
6. Criar o Funil inicial e associar etapas e Leads.
7. Reescrever referências de mídia para identificadores de storage.
8. Preservar Envios Incertos como `unknown`.
9. Importar filas pausadas, nunca retomá-las automaticamente.
10. Comparar contagens e emitir relatório de reconciliação.
11. Exigir novo pareamento do WhatsApp e reinserção de chaves.

O desktop permanece disponível durante a janela de transição, mas deve ficar desligado depois
do pareamento da Instalação web para não disputar a sessão.

## 12. Backup, restauração e retenção

### Dois artefatos, duas finalidades

- **Pacote de Migração:** portátil, sem segredos, move a operação.
- **Backup de Recuperação:** restaura a mesma Instalação e inclui banco, configurações,
  mídias e `wa-auth`, sempre criptografado.

### Estratégia

- snapshots frequentes do estado mutável;
- mídia copiada incrementalmente e deduplicada;
- retenção inicial oferecida: 7 diários, 4 semanais e 6 mensais;
- integridade de manifesto, criptografia e objetos verificada automaticamente;
- Serviço Gerenciado executa testes periódicos de restore;
- restauração reaplica o ledger de exclusões antes de liberar o sistema;
- avatares regeneráveis e logs ficam fora por padrão.

Cada Organização escolhe sua Política de Retenção para mensagens, mídias e logs. Opt-outs e
Supressões Pseudonimizadas têm ciclo de vida próprio e exigem validação jurídica.

## 13. Imagem, instalação e atualização

### Release

- uma imagem OCI para SPA e servidor;
- manifests multi-arquitetura Linux `amd64` e `arm64`;
- assinatura, SBOM e proveniência em cada release;
- imagem comunitária pública e fixada por SemVer;
- nenhuma atualização automática via `latest`.

### Instalação

O `install.sh`:

1. valida host Linux e arquitetura;
2. instala ou valida Docker/Compose;
3. coleta domínio, Fuso Operacional e diretório de dados;
4. gera segredos e arquivos de configuração com permissões restritas;
5. configura Caddy e HTTPS;
6. verifica assinatura da imagem;
7. inicia a Instalação;
8. mostra o código de reivindicação e orientações sobre a Chave de Recuperação.

Compose manual permanece documentado e suportado.

### Atualização e rollback

1. verificar compatibilidade e assinatura;
2. entrar em manutenção e drenar operações;
3. criar e verificar Backup de Recuperação;
4. baixar imagem SemVer escolhida;
5. executar migrations forward-only;
6. rodar health/readiness e smoke tests;
7. liberar tráfego;
8. em falha, restaurar juntos a imagem e o backup anteriores.

## 14. Observabilidade e metas operacionais

### Edição Comunitária

- health e readiness locais;
- logs estruturados e sanitizados;
- rotação e Política de Retenção configuráveis;
- telemetria externa desativada;
- adesão opcional a métricas anônimas sem conteúdo ou PII.

### Serviço Gerenciado

- monitoramento e alertas explicitamente informados;
- disponibilidade-alvo inicial: 99,5%;
- RPO inicial: até 24 horas;
- RTO inicial: até 4 horas;
- sem SLA financeiro ou promessa de alta disponibilidade na primeira oferta;
- Região de Dados declarada por Instalação;
- produção e backup permanecem nessa região salvo acordo explícito.

## 15. Edição Comunitária e Recursos Comerciais

### Edição Comunitária AGPLv3

- paridade funcional com o Aplicativo Legado;
- Proprietários, Operadores e Dispositivos Autorizados;
- uma Conexão ativa e um Funil ativo;
- backup local;
- REST/OpenAPI, Contas de Serviço e webhooks básicos;
- auditoria essencial;
- instalação, atualização e recuperação documentadas.

### Recursos Comerciais

- múltiplas Conexões de Mensageria;
- múltiplos Funis;
- permissões granulares e SSO;
- auditoria avançada e retenção estendida;
- backup externo gerenciado;
- painel central de várias Instalações;
- operação e suporte dos Planos Compartilhado e Dedicado.

Recursos Comerciais vivem em pacotes privados contra uma API pública de extensões e produzem
imagem Enterprise separada. O núcleo precisa compilar e operar de ponta a ponta sem eles.

Contribuições ao núcleo usam DCO/sign-off. A estrutura AGPL/comercial deve receber revisão
jurídica antes do lançamento.

## 16. Fases de execução

### Fase 0 — Preservação e criação dos repositórios

- verificar commits, tags, releases e remoto do repositório atual;
- publicar os documentos hoje não rastreados antes de qualquer rename;
- renomear o atual para `dispar-flux-desktop` no GitHub e localmente;
- criar o novo `dispar-flux` sob AGPLv3;
- copiar CONTEXT, ADRs e este plano para o novo repositório;
- configurar DCO, CI inicial e proteção de branch.

**Gate:** nenhum histórico ou release perdido; ambos os repositórios clonáveis.

### Fase 1 — Fundação executável

- workspace, builds e testes;
- domínio e contratos sem Electron;
- SQLite nativo, WAL, migrations e lock de Instalação;
- servidor REST/OpenAPI, WebSocket e SPA mínima;
- health/readiness, logging e configuração segura.

**Gate:** imagem local sobe, persiste dados após restart e rejeita segundo runtime.

### Fase 2 — Identidade e onboarding

- reivindicação inicial;
- membros, papéis, convites, dispositivos e sessões;
- recuperação por CLI;
- Fuso Operacional, Política de Retenção e auditoria essencial;
- autorização testada em cada superfície administrativa.

**Gate:** matriz de acesso coberta por testes E2E e negativos.

### Fase 3 — Conector Baileys

- contrato de Conector de Mensageria;
- storage seguro de `wa-auth`;
- QR, conexão, reconexão, versão e diagnósticos;
- ownership exclusivo do socket;
- eventos WebSocket com reconciliação REST.

**Gate:** pareamento e reconexão sobrevivem a restart sem socket duplicado.

### Fase 4 — Contatos, Bases e Campanhas

- Contato canônico e Participação na Base;
- import/export CSV via navegador;
- procedência, finalidade e confirmação responsável;
- snapshot de Campanha, fila serial, pacing, teto e Piso de Segurança;
- pausa, retomada, cancelamento e Envio Incerto.

**Gate:** crash em todos os pontos críticos não duplica destinatário automaticamente.

### Fase 5 — Inbox e mídia

- Conversa por Contato–Conexão;
- histórico, paginação, leitura, LID/JID e busca;
- upload, download, streaming, Range e nota de voz;
- StorageProvider local e URLs autorizadas;
- opt-out, Resposta Manual e Web Push.

**Gate:** paridade de inbox com uso prolongado sem carregar todo o histórico na UI.

### Fase 6 — CRM, agenda e follow-up

- Funil, etapas e Lead por Contato–Funil;
- atribuição inequívoca de respostas;
- agenda no Fuso Operacional;
- follow-ups na mesma fila de automação;
- supressão, Reautorização e casos ambíguos.

**Gate:** cenários de múltiplas Bases e conexões simuladas não movem Leads errados.

### Fase 7 — Migração e recuperação

- exportador no `dispar-flux-desktop`;
- formato versionado do Pacote de Migração;
- importador e relatório de reconciliação;
- Backup de Recuperação incremental e criptografado;
- restore, deletion ledger e testes de desastre.

**Gate:** uma instalação real é migrada, restaurada e reconciliada sem novo envio automático.

### Fase 8 — Distribuição e hardening

- imagem única multi-arquitetura;
- Compose, Caddy e `install.sh`;
- assinatura, SBOM e proveniência;
- update/rollback;
- CSP, CSRF, rate limiting, upload hardening e revisão de dependências;
- documentação de operação, segurança e incidente.

**Gate:** instalação limpa e atualização são reproduzíveis em `amd64` e `arm64`.

### Fase 9 — Dogfood, pilotos e 1.0

- migrar uma Instalação real do mantenedor;
- operar com duas ou três Organizações piloto;
- corrigir lacunas e executar restore real ensaiado;
- publicar release candidate;
- concluir gate de segurança, licenças e operação;
- publicar `1.0` e iniciar aviso de 90 dias do desktop.

**Gate:** todos os critérios da seção seguinte atendidos.

## 17. Gate da versão web 1.0

- funcionalidades já implementadas no desktop disponíveis na web;
- comportamento existente coberto por testes compartilhados;
- E2E de autenticação, conexão, contatos, campanha, inbox, CRM, cron e papéis;
- migração ensaiada com banco e mídia reais;
- backup e restore completos verificados;
- crash recovery sem reenvio automático de jobs incertos;
- imagens `amd64` e `arm64` instaladas do zero e atualizadas;
- segurança de aplicação e supply chain revisadas;
- licenças do núcleo, contribuições e módulos comerciais revisadas;
- Política de Retenção, exclusões e restauração validadas juridicamente;
- período controlado de dogfood e pilotos concluído;
- runbooks de desconexão, corrupção, restore, chave perdida e rollback testados.

## 18. Riscos e respostas

| Risco | Resposta planejada |
|---|---|
| Mudança incompatível no WhatsApp/Baileys | adapter isolado, versão fixada, rollout gradual e diagnóstico |
| Duas réplicas abrirem a mesma sessão | lock de runtime e um processo por Instalação |
| Duplicação depois de crash | estado `unknown`, at-most-once em incerteza e reconciliação manual |
| Corrupção/perda do SQLite | WAL, transações, backup verificado e restore ensaiado |
| Crescimento de mídia | storage abstrato, retenção e cópia incremental |
| Vazamento de `wa-auth` | volume restrito, backup criptografado e segredos fora do banco |
| Perda da Chave de Recuperação | exibição única, confirmação de guarda e cofre no gerenciado |
| Evento WebSocket perdido | REST como fonte da verdade e refetch após reconexão |
| Abuso da API | escopos, rate limits, auditoria e Piso de Segurança |
| Regressão na migração | fixtures reais, relatório de contagens e destino inicialmente vazio |
| Escopo enterprise atrasar o 1.0 | Recursos Comerciais fora do caminho crítico comunitário |
| Documento antigo orientar implementação | este plano e ADRs são canônicos; rascunho está marcado como substituído |

## 19. Ordem imediata após autorização para implementar

1. Preservar e publicar o estado documental atual no repositório legado.
2. Verificar remoto, tags e releases antes de qualquer rename.
3. Renomear com segurança o legado e criar o novo repositório vazio.
4. Instalar CONTEXT, ADRs, plano, AGPLv3, DCO e CI no novo repositório.
5. Criar a fundação executável da Fase 1 com um teste vertical mínimo.
6. Portar regras puras e testes antes de mover integrações Electron.
7. Implementar identidade/onboarding antes de expor operações do produto em HTTP.
8. Portar Baileys como adapter, sem tipos do conector vazarem para o domínio.
9. Avançar pelas fatias apenas quando o gate anterior estiver verde.
10. Manter o desktop congelado, exceto pelo exportador e correções críticas.

Nenhuma dessas ações está autorizada apenas pela aprovação deste plano; criação, rename e
remoção de repositórios devem começar numa solicitação explícita de implementação.
