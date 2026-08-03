# Como maturar um chip de WhatsApp (tutorial dia a dia)

> Pesquisa de campo: Reddit, Hacker News, GitHub e web, janela de 04/07/2026 a 03/08/2026.
> Complemento do [Guia de disparo em massa sem API oficial](./guia-disparo-seguro.md): aquele
> cobre a operacao inteira, este cobre so a fase que vem antes dela — transformar um numero
> recem-registrado em um numero que aguenta campanha.

## Antes de comecar: o que maturar resolve e o que nao resolve

Maturar (ou aquecer) um chip e construir historico de uso antes de o numero ser usado para
volume. O objetivo nao e "enganar o filtro": e produzir os sinais que uma conta legitima
produz naturalmente — conversa nos dois sentidos, contatos que respondem, presenca em grupos,
midia trocada, dias sem envio nenhum.

**O que maturar resolve:** o risco elevado dos primeiros dias. Numero novo e a faixa de maior
enforcement — os relatos convergem em 10 dias como a janela critica, e a maior parte dos bans
de chip novo acontece dentro dela.

**O que maturar nao resolve:** lista ruim. Um chip maturado por 30 dias disparando para base
comprada cai igual — so demora um pouco mais. Aquecimento compra tolerancia, nao imunidade.
Se a sua lista nao tem opt-in, pule este guia e resolva a lista primeiro (secao 3 do guia de
disparo).

Este documento assume Baileys / biblioteca nao oficial, que e o caso do Dispar Flux. Se voce
usa a API oficial (Cloud API), a secao 7 explica por que quase nada disto se aplica a voce.

---

## 1. Preparacao do numero (dia 0)

Errar aqui invalida o aquecimento inteiro, porque a Meta faz fingerprint de dispositivo no
momento do registro.

- **Chip fisico proprio, ativo e recarregado.** Numero virtual/VoIP barato e o padrao mais
  associado a ban rapido. Se o SMS de verificacao chegou por um servico de numero descartavel,
  o numero ja nasce marcado.
- **Um aparelho (ou uma sessao) por numero.** Nao registre cinco chips no mesmo aparelho, na
  mesma rede, na mesma hora. Isso e o padrao classico de fazenda de contas.
- **IP residencial no registro.** Registrar por VPN de datacenter ou por servidor cloud e um
  sinal negativo forte.
- **Perfil completo antes de qualquer mensagem.** Foto, nome do negocio, descricao, horario.
  Conta sem foto e sem nome parece descartavel — porque geralmente e.
- **Decida agora se e WhatsApp comum ou Business.** Business com catalogo e mensagem de
  saudacao configurada e coerente com uso comercial; trocar de app no meio do aquecimento
  reinicia parte do historico.
- **Nao conecte na automacao ainda.** Dias 1 a 3 sao de uso humano, no celular, na mao.

---

## 2. O protocolo de 21 dias

Tres fases. Os numeros abaixo sao a sintese conservadora do que circula entre operadores
brasileiros; quando as fontes divergem (uma sugere 100-150/dia ja na semana 1, outra sugere
10-20/dia), este guia adota a mais baixa, porque o custo de errar para baixo e tempo e o custo
de errar para cima e o chip.

### Fase 1 — Nascimento digital (dias 1 a 3)

O chip nem sabe que e ferramenta de trabalho.

- 10 a 20 mensagens por dia, **manuais**, para contatos reais que vao responder: familia,
  socios, equipe, amigos.
- Conversa de verdade, com ida e volta. Uma mensagem que recebe resposta vale mais que dez
  entregues.
- Varie o formato: texto, audio curto, foto, figurinha, reacao.
- Salve os contatos na agenda, e peca para eles salvarem o seu.
- Entre em 2 ou 3 grupos comuns (familia, bairro, trabalho) e fale neles.
- Publique um status. Conta que posta status parece pessoa.
- **Zero automacao, zero link, zero conteudo comercial.**

### Fase 2 — Rotina e credibilidade (dias 4 a 9)

- 25 a 50 mensagens por dia, ainda majoritariamente manuais.
- Comece a misturar contatos que ja te conhecem mas nao sao intimos: clientes antigos,
  fornecedores. Continue exigindo resposta.
- Receba pelo menos 1 chamada de voz de WhatsApp e faca outra. Chamada e sinal forte de conta
  humana.
- Mantenha a atividade distribuida no dia — nao 50 mensagens em 20 minutos.
- A partir do dia 7 voce pode conectar a sessao na ferramenta, **so para receber e responder**.
  Nao dispare nada.
- **Tire um dia de folga nesta fase.** Conta real tem dia parado. Atividade uniforme e diaria e
  assinatura de robo.

### Fase 3 — Maturacao e ramp up (dias 10 a 21)

Aqui entra o envio ativo, com escada.

| Dias  | Volume/dia                      | Tipo de contato                | Ferramenta                 |
| ----- | ------------------------------- | ------------------------------ | -------------------------- |
| 10-12 | 20 a 30                         | Reativacao de clientes antigos | Manual ou campanha pequena |
| 13-15 | 50 a 80                         | Base morna com opt-in          | Campanha, cadencia lenta   |
| 16-18 | 80 a 120                        | Base com opt-in                | Campanha                   |
| 19-21 | 120 a 200                       | Base com opt-in                | Campanha                   |
| 22+   | ate o dailyCap do perfil maduro | Operacao normal                | Campanha                   |

Durante toda a fase 3, **mantenha o ruido de fundo**: as conversas humanas das fases 1 e 2 nao
podem parar. O que derruba chip nesta etapa nao e o volume, e o perfil "so envia, nunca
recebe".

---

## 3. As metricas que decidem se o chip esta maturando ou morrendo

Acompanhe estas quatro. Elas valem mais que contar dias.

**Taxa de resposta.** A metrica mais importante. O update de 2026 acrescentou contagem de
mensagens nao respondidas como sinal proprio: 500 envios que ninguem responde e problema por
si so, independente do intervalo. Abaixo de 10% de resposta em disparo frio, pare e conserte a
lista antes de subir volume.

**Taxa de bloqueio e denuncia.** Nao e visivel diretamente no Baileys, mas aparece como queda
de entrega e, na API oficial, como Quality Rating. Qualquer suspeita de bloqueio em massa: pare
no mesmo dia.

**Contatos que salvaram seu numero.** Numero salvo na agenda do destinatario e o sinal mais
forte de legitimidade que existe. Peca isso explicitamente nas primeiras conversas.

**Proporcao enviadas/recebidas.** Meta pratica durante o aquecimento: nunca passe de 3 enviadas
para cada 1 recebida. Em disparo maduro isso e impossivel, mas quanto mais perto voce ficar,
mais tempo o chip dura.

---

## 4. Grupos de aquecimento: o que sao e quando usam contra voce

Grupos de aquecimento sao grupos onde varios operadores colocam chips novos para trocar
mensagens entre si. Sao gratuitos, populares no Brasil e resolvem um problema real: gerar
trafego bidirecional quando voce nao tem contatos reais para conversar.

Onde eles ajudam: movimento, mensagens recebidas, presenca em grupo, custo zero.

Onde eles atrapalham:

- Todo mundo no grupo tem chip novo. Um cluster de numeros novos conversando so entre si e um
  padrao identificavel, nao um disfarce.
- Ninguem salva o numero de ninguem, e nao ha conversa individual — o sinal mais valioso fica
  de fora.
- Se um numero do grupo for denunciado em massa, o grupo inteiro vira vizinhanca ruim.

Recomendacao pratica: use como **complemento** dos dias 1 a 9, no maximo 2 grupos, nunca como
substituto de conversa real. Se a sua unica fonte de aquecimento e grupo de aquecimento, o chip
esta sendo movimentado, mas nao esta ganhando reputacao.

---

## 5. Os erros que matam chip em aquecimento

Ordenados por frequencia nos relatos:

1. **Disparar antes do dia 10.** O erro mais comum e o mais caro.
2. **Mensagem identica em sequencia.** Gatilho citado nominalmente nas issues do Evolution API,
   e vale igual em chip novo. Use spintax desde a primeira campanha.
3. **Link na primeira mensagem fria.** Amplificador de risco numero um em conta jovem.
4. **Encurtador de URL.** bit.ly e afins em mensagem fria de chip novo e combinacao ruim.
5. **Importar 5.000 contatos de uma vez no dia 1.** Salvar agenda gigante de golpe e
   comportamento de ferramenta, nao de pessoa.
6. **Atividade robotica constante.** Mesmo horario, mesmo volume, todo dia, inclusive domingo.
7. **Trocar de aparelho/IP no meio do aquecimento.** Reinicia a confianca de fingerprint.
8. **Reusar um numero que ja tomou ban.** Numero recuperado de bloqueio volta para a faixa de
   risco maximo e precisa de aquecimento mais longo que um numero virgem, nao mais curto.

---

## 6. Configuracao no Dispar Flux por fase

Os padroes de `src/main/settings.ts` (`delayMinMs: 8000`, `delayMaxMs: 20000`, `restEveryN: 40`,
`restDurationMs: 300000`, `dailyCap: 300`) sao perfil de numero **maduro**. Para chip em
aquecimento, ajuste em Configuracoes -> Envio:

| Fase                        | delayMin/Max | restEveryN | restDuration | dailyCap |
| --------------------------- | ------------ | ---------- | ------------ | -------- |
| Dias 1-9 (nao dispara)      | —            | —          | —            | 0        |
| Dias 10-12                  | 60s / 150s   | 10         | 20 min       | 30       |
| Dias 13-15                  | 45s / 120s   | 15         | 15 min       | 80       |
| Dias 16-18                  | 30s / 90s    | 20         | 12 min       | 120      |
| Dias 19-21                  | 20s / 60s    | 25         | 10 min       | 200      |
| Maduro (22+, sem incidente) | 8s / 20s     | 40         | 5 min        | 300      |

Complementos que ja existem no app e importam mais em chip novo:

- **Spintax por paragrafo** (editor de mensagem, modo paragrafo) — obrigatorio desde a primeira
  campanha do dia 10.
- **"Digitando" antes do envio** — automatico, 900-2500ms aleatorios.
- **Validacao de numero** (`waValid` / `jid`) — disparar para numero inexistente e desperdicio
  de reputacao; limpe a base antes.
- **Fila persistente** (`campaign_jobs`) — permite pausar no meio sem reenviar, que e o que
  voce vai querer fazer ao primeiro sinal ruim.

Duas lacunas que afetam especificamente o aquecimento: nao ha **janela horaria** (nada impede
um disparo as 3h) nem **rotacao entre numeros**. Enquanto isso, controle o horario manualmente
e nao deixe campanha longa terminar de madrugada.

---

## 7. Se voce usa a API oficial, quase nada disto se aplica

Na Cloud API o aquecimento e outro jogo, e vale saber porque muda o calculo de migrar:

- Os limites sao **por Business Portfolio**, nao por numero — mudanca de outubro/2025. Numero
  novo adicionado a um portfolio ja estabelecido **herda o tier existente** e pode enviar em
  volume desde o primeiro dia. Aquecimento manual vira desnecessario.
- Portfolio sem verificacao de negocio comeca em 250 mensagens/24h. Depois da verificacao, o
  Tier 1 hoje e de 2.000 usuarios unicos/24h.
- O avanco de tier e avaliado a cada 6 horas e exige usar pelo menos 50% do limite atual numa
  janela movel de 7 dias, mantendo Quality Rating aceitavel.
- Quality Rating vermelho bloqueia o avanco de tier, mas desde 2026 nao causa mais downgrade
  automatico se nao houver violacao de politica — voce ganha tempo para corrigir.
- Em compensacao, opt-in e template aprovado sao obrigatorios, e a LGPD entra no calculo:
  enviar sem consentimento derruba o Quality Rating, gera limitacao e expoe a multa.

Ou seja: na via oficial voce troca "aquecer chip" por "manter reputacao de portfolio". Para
volume transacional recorrente, continua sendo o caminho racional.

---

## 8. Checklist de maturacao

**Dia 0**

- [ ] Chip fisico proprio, nao virtual
- [ ] Registro em IP residencial, um numero por aparelho/sessao
- [ ] Perfil completo (foto, nome, descricao)
- [ ] Decidido: WhatsApp comum ou Business

**Dias 1-3**

- [ ] 10-20 mensagens/dia manuais com resposta real
- [ ] Formatos variados (audio, foto, figurinha, reacao)
- [ ] 2-3 grupos comuns, com participacao
- [ ] Contatos salvos nos dois sentidos
- [ ] Nenhum conteudo comercial

**Dias 4-9**

- [ ] 25-50 mensagens/dia
- [ ] Pelo menos 1 chamada de voz recebida e 1 feita
- [ ] Sessao conectada so para receber/responder (a partir do dia 7)
- [ ] Um dia de folga no periodo

**Dias 10-21**

- [ ] Escada de volume conforme a tabela da secao 2
- [ ] Spintax ativo em toda campanha
- [ ] Conversa humana mantida em paralelo
- [ ] Taxa de resposta acompanhada diariamente
- [ ] Criterio de parada definido antes de comecar

**Antes de considerar o chip maduro (dia 22+)**

- [ ] 21 dias sem nenhum bloqueio temporario
- [ ] Taxa de resposta acima de 10% nas ultimas campanhas
- [ ] Base atual com opt-in verificavel
- [ ] Existe um chip reserva em aquecimento para substituir este

---

## Resumo em cinco linhas

1. Os 10 primeiros dias sao a faixa de maior risco. Nesse periodo o chip conversa, nao dispara.
2. Conversa bidirecional e o sinal que constroi reputacao; volume sem resposta e o que a destroi.
3. Suba volume em escada (20-30, 50-80, 80-120, 120-200) e mantenha o ruido de fundo humano.
4. Grupo de aquecimento e complemento, nunca substituto de conversa real.
5. Aquecimento compra tolerancia, nao imunidade — sem opt-in, o chip cai de qualquer forma.
