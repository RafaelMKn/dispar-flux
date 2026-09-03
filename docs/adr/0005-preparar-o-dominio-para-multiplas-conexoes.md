# Preparar o domínio para múltiplas conexões de mensageria

A primeira versão web permitirá uma Conexão de Mensageria ativa por Instalação, mas entidades e contratos dependentes de mensageria identificarão desde o início a conexão à qual pertencem. Isso preserva o escopo de paridade imediata sem tornar a futura habilitação de múltiplas conexões uma reconstrução do banco e do domínio.

## Consequences

Dados migrados do Aplicativo Legado serão associados à conexão inicial da Organização. Restrições de unicidade, consultas, eventos e caminhos de armazenamento não poderão pressupor uma conexão global, mesmo enquanto a interface permitir apenas uma.
