# Exigir migração em estado seguro

O Aplicativo Legado só produzirá um Pacote de Migração quando não houver envio em execução. Campanhas, filas e resultados serão preservados, mas filas importadas entrarão pausadas e exigirão confirmação explícita antes de qualquer retomada; jobs em estado incerto continuarão `unknown` e nunca serão reenviados automaticamente.

## Consequences

O exportador deverá interromper inicializações de campanha durante a captura e registrar um manifesto consistente. A importação será recusada quando a Instalação de destino já contiver dados incompatíveis ou quando o pacote falhar na validação de integridade.
