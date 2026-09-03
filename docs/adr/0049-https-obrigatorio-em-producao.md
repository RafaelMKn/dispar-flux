# Exigir HTTPS em produção

O Caddy será a entrada pública da implantação de referência e o processo da aplicação ficará restrito à rede interna do Compose. Produção exigirá HTTPS, cookies seguros, proteção CSRF, limites de requisição e headers de segurança; HTTP direto será aceito somente em `localhost` para desenvolvimento.
