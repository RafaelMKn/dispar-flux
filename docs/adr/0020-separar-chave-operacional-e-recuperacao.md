# Separar a chave operacional da chave de recuperação

A Instalação usará uma chave operacional gerada no bootstrap para proteger segredos ativos e uma Chave de Recuperação distinta, apresentada uma vez ao Proprietário e mantida fora da VPS, para criptografar Backups de Recuperação. O Serviço Gerenciado guardará chaves de recuperação em um cofre externo.

## Consequences

A chave usada para recuperar um backup não poderá estar contida no próprio artefato nem depender exclusivamente do volume protegido por ele. Perder a Chave de Recuperação tornará os backups correspondentes irrecuperáveis.
