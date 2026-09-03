# Fazer backups incrementais e verificáveis

Backups de Recuperação combinarão snapshots frequentes do banco, configurações e `wa-auth` com cópia incremental e deduplicada das mídias imutáveis. A política inicial oferecerá 7 retenções diárias, 4 semanais e 6 mensais, validará integridade automaticamente e exigirá testes periódicos de restauração no Serviço Gerenciado.

## Consequences

Um backup só poderá ser anunciado como saudável depois de verificar manifesto, criptografia e objetos referenciados. Retenção e destino permanecerão configuráveis pela Organização dentro das capacidades da edição utilizada.
