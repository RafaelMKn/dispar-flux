# Isolar cada organização em uma instalação

Cada Instalação atenderá exatamente uma Organização e terá banco, arquivos, segredos e processos isolados. O Serviço Gerenciado poderá executar várias Instalações independentes na mesma VPS para aproveitar recursos sem introduzir tenancy compartilhada no domínio nem ampliar o impacto de uma falha de isolamento.

## Considered Options

Uma plataforma multi-tenant compartilhada reduziria o número de deployments, mas exigiria que toda consulta, arquivo, sessão e evento carregasse e validasse um tenant. Uma VPS exclusiva por cliente ofereceria isolamento físico maior, porém desperdiçaria recursos em organizações pequenas.
