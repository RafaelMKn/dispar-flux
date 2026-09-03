# Separar migração portátil de recuperação de desastre

O Pacote de Migração continuará portátil e sem segredos. O Backup de Recuperação será um artefato distinto e criptografado que incluirá SQLite, mídias, configurações e credenciais `wa-auth` para restaurar a mesma Instalação; avatares regeneráveis e logs ficarão fora por padrão.

## Consequences

A Edição Comunitária permitirá criar e baixar backups localmente. O Serviço Gerenciado automatizará cópias externas e retenção, sem transformar credenciais operacionais em um pacote de migração comum.
