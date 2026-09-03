# Usar SQLite nativo por instalação

Cada Instalação usará um banco SQLite próprio por meio de um driver nativo, com WAL e migrations versionadas. Essa escolha preserva a operação em processo único, reduz o consumo de recursos quando várias Instalações compartilham uma VPS e mantém a Edição Comunitária simples de instalar; o `sql.js` em memória do Aplicativo Legado não será usado no servidor.

## Considered Options

PostgreSQL por Instalação aumentaria o custo operacional sem uma necessidade atual de múltiplos escritores. Manter SQLite na Edição Comunitária e PostgreSQL no Serviço Gerenciado criaria dois comportamentos de persistência e duplicaria a superfície de testes.
