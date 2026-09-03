# Manter uma fila de automação por conexão

Cada Conexão de Mensageria terá uma fila serial para Envios Automatizados, compartilhada por campanhas e follow-ups e sujeita ao mesmo pacing e teto diário. Respostas Manuais serão enviadas imediatamente fora dessa fila e não consumirão o teto de prospecção, embora continuem registradas e dependam de uma conexão saudável.

## Consequences

A primeira versão continuará executando uma campanha automatizada por conexão. Quando múltiplas conexões forem habilitadas, filas distintas poderão avançar simultaneamente sem misturar limites ou estado.
