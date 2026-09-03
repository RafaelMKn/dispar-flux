# Expor REST e eventos WebSocket

O servidor oferecerá uma API REST versionada e documentada por OpenAPI, enquanto mudanças em tempo real serão entregues por WebSocket. Uploads usarão multipart e mídias serão servidas por HTTP autorizado com streaming e Range, mantendo o contrato acessível ao frontend, à n8n e a outros clientes sem acoplamento ao React.

## Considered Options

tRPC reduziria código entre o frontend e o servidor, mas acoplaria a interface pública ao ecossistema TypeScript. GraphQL adicionaria uma camada de schema e resolução desnecessária para os fluxos atuais.
