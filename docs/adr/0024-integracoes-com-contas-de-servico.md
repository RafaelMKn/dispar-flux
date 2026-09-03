# Autenticar integrações com contas de serviço

Integrações usarão Contas de Serviço com tokens revogáveis e escopos explícitos, sem reutilizar cookies ou identidades de membros. Webhooks de saída serão assinados, terão tentativas controladas e registrarão seu resultado de entrega.

## Consequences

A autorização deverá ser aplicada pelo mesmo domínio de permissões da API, distinguindo atores humanos e não humanos. Uma chave global irrestrita por Instalação não será oferecida.
