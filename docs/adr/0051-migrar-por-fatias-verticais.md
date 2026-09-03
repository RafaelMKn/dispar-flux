# Migrar por fatias verticais

A transição usará o contrato de aplicação hoje representado por `DisparApi` como seam entre interface e capacidades do sistema. Cada fatia atravessará persistência, domínio, REST/WebSocket e UI com testes compartilhados antes da próxima, na ordem geral: autenticação, conexão, contatos, campanhas, inbox e mídia, CRM e agenda, cron, migração e deploy.

## Considered Options

Uma reescrita completa esconderia problemas de integração até o fim. Converter IPCs mecanicamente para HTTP preservaria pressupostos inseguros do ambiente local e exporia operações sem autenticação ou autorização adequadas.
