# Architecture Decision Records

Estas decisões sustentam o [`Plano Mestre`](../plano-mestre-self-hosted-web.md). Em caso de divergência com o rascunho anterior de arquitetura, o Plano Mestre, o [`CONTEXT.md`](../../CONTEXT.md) e estes ADRs são canônicos.

## Índice por tema

- **0001–0003 — Produto:** open core, conectores e transição do desktop.
- **0004–0014 — Fundação:** isolamento, conexões futuras, acesso, SQLite, migração, runtime, storage e fronteira comunitária.
- **0015–0026 — Plataforma web:** REST/WebSocket, imagem OCI, backup, convites, fuso, chaves, instalação, updates, integrações, Web Push e retenção.
- **0027–0033 — Operação segura:** filas, envios incertos, proprietários, auditoria, exclusões, telemetria e arquiteturas suportadas.
- **0034–0045 — Domínio:** Contatos, Bases, Campanhas, Funis, Leads, Conversas, opt-out, atribuição de respostas e privacidade.
- **0046–0050 — Confiabilidade:** backup incremental, sessões, supply chain, HTTPS e observabilidade.
- **0051–0056 — Execução:** fatias verticais, extensões comerciais, rollback, gate 1.0 e separação dos repositórios.
- **0057–0063 — Oferta e lançamento:** nomes, metas operacionais, planos, Piso de Segurança, Região de Dados, DCO e pilotos.

Os arquivos usam numeração sequencial e são imutáveis após aceitos. Uma mudança posterior deve criar outro ADR e, quando necessário, indicar qual decisão foi substituída.
