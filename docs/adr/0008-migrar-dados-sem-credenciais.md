# Migrar dados e arquivos sem credenciais

O Aplicativo Legado produzirá um Pacote de Migração contendo banco, histórico e mídias para importação na plataforma web. Credenciais do WhatsApp e chaves secretas não atravessarão esse pacote: a Conexão de Mensageria será pareada novamente e as chaves serão reinseridas após a importação, evitando transportar material sensível dependente do Windows ou manter sockets concorrentes.
