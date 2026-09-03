# Empacotar servidor e interface em uma imagem

A imagem OCI oficial conterá o monólito modular e os arquivos compilados da SPA. O Docker Compose de referência adicionará Caddy, volume persistente e configuração da Instalação; proxies alternativos continuarão possíveis, mas frontend, API e workers internos serão versionados como uma única unidade.

## Consequences

O deployment comunitário terá poucos componentes e uma versão coerente entre UI e API. Módulos comerciais precisarão de um mecanismo de empacotamento separado sem quebrar a imagem AGPLv3 do núcleo.
