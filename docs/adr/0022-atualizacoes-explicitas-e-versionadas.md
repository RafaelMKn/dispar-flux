# Aplicar atualizações explícitas e versionadas

Cada Instalação fixará uma versão SemVer da imagem e só atualizará após confirmação administrativa. O fluxo criará um Backup de Recuperação, baixará a imagem escolhida e aplicará migrations; a Edição Comunitária receberá comando e aviso de atualização, enquanto o Serviço Gerenciado fará rollout gradual entre Instalações.

## Consequences

A tag `latest` não será usada como mecanismo de atualização automática. Releases precisarão declarar compatibilidade, mudanças de schema e caminho de rollback ou restauração.
