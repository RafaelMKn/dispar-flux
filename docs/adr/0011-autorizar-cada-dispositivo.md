# Exigir autorização de cada dispositivo

Além de autenticar o membro com credenciais locais, a Instalação só concluirá o acesso em um Dispositivo Autorizado. O primeiro navegador reivindicará a Instalação com um código de uso único, criará o Proprietário e se tornará autorizado; novos navegadores gerarão uma Solicitação de Acesso que poderá ser aprovada pela interface de um dispositivo já autorizado, com recuperação administrativa disponível no servidor.

## Considered Options

Permitir credenciais em qualquer navegador seria mais simples, mas ofereceria menos proteção a um painel capaz de disparar mensagens e acessar conversas. Pareamento sem contas eliminaria senhas, porém enfraqueceria a identidade individual necessária para papéis e futura auditoria.
