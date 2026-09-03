# Isolar integrações em conectores de mensageria

O primeiro conector da plataforma web continuará usando Baileys para preservar o comportamento atual do produto. A integração será isolada atrás de um contrato de conector para permitir a futura entrada da API oficial da Meta sem transformar os dois transportes em requisito da primeira versão web.

## Consequences

Os fluxos de campanha, inbox e CRM não podem depender diretamente de tipos ou eventos exclusivos do Baileys. Diferenças de capacidade entre conectores deverão ser representadas explicitamente, pois a API oficial não oferece a mesma experiência de pareamento, histórico e envio.
