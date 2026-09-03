# Executar cada instalação como monólito modular

Cada Instalação executará API HTTP, eventos em tempo real, Conectores de Mensageria, campanhas e scheduler em um único processo servidor. Módulos e contratos internos permanecerão separados para permitir evolução, mas a primeira versão evitará coordenação distribuída e manterá uma única autoridade sobre o SQLite, o socket Baileys e cada fila de envio.

## Consequences

Uma Instalação não poderá ser escalada horizontalmente iniciando réplicas concorrentes. O runtime deverá impedir uma segunda execução sobre o mesmo diretório de dados e encerrar de forma graciosa para preservar filas e conexões.
