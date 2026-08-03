# Seu primeiro disparo

A tela [Disparo](app:/disparo) e dividida em cinco passos, na ordem em que voce precisa
pensar neles. Este tutorial percorre os cinco e explica o que cada campo faz de verdade.

> [!AVISO]
> Antes de rodar a primeira campanha, confira: o numero e **dedicado** e ja esta
> **maturado**, e todo mundo na base **autorizou** o contato. Se alguma dessas tres coisas
> nao e verdade, leia [Disparo em massa sem tomar ban](app:/docs/disparo-seguro) primeiro —
> o problema nao vai estar nos ajustes desta tela.

---

## Antes de comecar

Tres coisas precisam estar prontas, senao o botao **Iniciar disparo** fica desabilitado. O
proprio app diz qual esta faltando, no cartao final da tela:

1. WhatsApp conectado em [Configuracoes](app:/config).
2. Uma base escolhida.
3. Pelo menos um contato **valido** nessa base — ver [Montar a base de contatos](app:/docs/base-de-contatos).

---

## Passo 1 — Base de destino

Escolha qual base recebe a campanha. Embaixo do nome aparece o resumo: total de contatos,
validos, invalidos, nao verificados e descadastrados.

So entram no disparo os contatos **validos e sem descadastro**. Se o numero de validos
estiver baixo, o lugar de resolver e a [Base de Dados](app:/base), nao aqui.

---

## Passo 2 — Modo de mensagem

Quatro modos, do mais arriscado para o mais seguro:

| Modo                        | O que faz                                                      | Quando usar                                               |
| --------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- |
| **Fixa**                    | Um texto unico, com as variaveis do contato.                   | Testes e listas muito pequenas.                           |
| **Alternada**               | Voce escreve varias mensagens completas e o app faz rodizio.   | Quando ja existem versoes prontas do mesmo aviso.         |
| **Alternada por paragrafo** | Cada paragrafo tem varias versoes e o app sorteia uma de cada. | **O padrao recomendado.** Muita variacao, pouco trabalho. |
| **IA**                      | A IA escreve cada mensagem a partir do seu prompt.             | Ainda nao disponivel (chega na Fase 3).                   |

Mandar o mesmo texto identico para centenas de numeros e o padrao mais facil de detectar
que existe. Mesmo com pouca vontade de escrever, o modo por paragrafo resolve: tres
paragrafos com tres variacoes cada ja dao 27 mensagens diferentes.

---

## Passo 3 — Conteudo

O que aparece aqui depende do modo escolhido no passo 2.

### Variaveis

Em qualquer modo, o texto aceita variaveis entre colchetes:

| Escreva           | Vira                                                              |
| ----------------- | ----------------------------------------------------------------- |
| `[nome]`          | O nome do contato.                                                |
| `[empresa]`       | Qualquer coluna extra importada do CSV, pelo nome da coluna.      |
| `[nome\|cliente]` | O nome do contato; se ele nao tiver nome, usa `cliente` no lugar. |

Se o contato nao tem nome e voce nao definiu um substituto, o app **limpa a frase sozinho**
em vez de mandar "Oi , tudo bem?".

### Modo Fixa

Um campo de texto. Escreva a mensagem e pronto.

### Modo Alternada

Um cartao por mensagem. Use **Adicionar mensagem** para criar variacoes e a lixeira para
remover. O app distribui as mensagens em rodizio entre os contatos.

### Modo Alternada por paragrafo

Cada cartao e um **paragrafo** da mensagem, e dentro dele voce escreve varias **variacoes**
daquele trecho. O app sorteia uma variacao de cada paragrafo e monta a mensagem final.

- **+ variacao** adiciona uma linha ao paragrafo atual.
- **Adicionar paragrafo** cria um novo bloco.
- Ao lado, o app mostra a conta em tempo real: `3 × 3 × 3 = 27 mensagens unicas`.

Exemplo com tres paragrafos:

```
Paragrafo 1 (saudacao)
  Oi [nome], tudo bem?
  Ola [nome], como voce esta?
  Bom dia [nome]!

Paragrafo 2 (motivo)
  Aqui e a Marina, da Cortez Moveis.
  Sou a Marina, atendo pela Cortez Moveis.
  Meu nome e Marina e trabalho na Cortez Moveis.

Paragrafo 3 (pedido + saida)
  Posso te mandar as condicoes desta semana? Se preferir nao receber, responda SAIR.
  Queria te mostrar o que separamos para julho. Responda SAIR para nao receber mais.
  Tem um minuto para eu te passar as novidades? Responda SAIR se nao quiser receber.
```

> [!DICA]
> Deixe o pedido de descadastro em **todas** as variacoes do ultimo paragrafo. Alem de ser
> a parte legal da coisa, quem tem como sair costuma sair em vez de denunciar — e denuncia
> pesa muito mais para o WhatsApp do que um bloqueio.

---

## Passo 4 — Ritmo

Quatro campos que controlam a velocidade do envio. Eles comecam com os valores padrao
definidos em [Configuracoes -> Envio](app:/config); mudar aqui vale so para esta campanha.

| Campo                         | O que faz                                                                                             |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Intervalo minimo (ms)**     | Menor pausa entre duas mensagens.                                                                     |
| **Intervalo maximo (ms)**     | Maior pausa. O app sorteia um valor entre o minimo e o maximo a cada envio.                           |
| **Descansar a cada N envios** | De quantas em quantas mensagens o app faz uma pausa longa.                                            |
| **Teto diario**               | Maximo de mensagens no dia, somando **todas** as campanhas. Ao bater o teto, a campanha para sozinha. |

Os valores sao em milissegundos: 8000 = 8 segundos, 20000 = 20 segundos, 300000 = 5
minutos.

Ter minimo e maximo diferentes nao e detalhe: intervalo fixo e assinatura de robo. O app
tambem manda o indicador de **"digitando"** por um tempo aleatorio antes de cada mensagem,
automaticamente.

> [!NOTA]
> Numero recem maturado nao aguenta o padrao de fabrica (8s a 20s, teto de 300). A tabela
> de ritmo por fase esta em [Como maturar um chip de WhatsApp](app:/docs/maturacao-de-chip).

---

## Passo 5 — Revisar e disparar

### Nome da campanha

Opcional, mas ajuda a se achar no historico depois. Ex.: `Condicoes de julho`.

### Quem vai receber

Uma tabela com a conta final:

- **Vao receber** — os contatos elegiveis.
- **Fora: nao validados no WhatsApp** — resolve rodando a validacao na [Base de Dados](app:/base).
- **Fora: descadastrados** — nao ha o que resolver, e para ser assim mesmo.
- **Fora: ja receberam antes** — so aparece com a caixa abaixo marcada.

A caixa **Pular contatos que ja receberam mensagem desta base em campanhas anteriores** vem
desmarcada, porque as vezes reenviar e intencional (uma oferta nova, por exemplo). Marque
quando a campanha for uma primeira abordagem.

O botao de recalcular, ao lado do titulo, refaz a conta se voce mexeu na base em outra aba.

### Amostras

Abaixo da tabela o app mostra mensagens de exemplo **ja renderizadas com dados reais dos
contatos**. Leia todas antes de disparar: e aqui que aparece o `[cidad]` escrito errado, o
paragrafo que ficou repetitivo e o "Oi ," de quem esta sem nome.

### Disparar

Clique em **Iniciar disparo**. Se o botao estiver desabilitado, o texto ao lado dele diz o
motivo.

---

## Enquanto a campanha roda

No topo da tela aparece um cartao com o progresso:

- Barra e contadores: **enviados**, **na fila**, **pulados**, **falharam**, **indeterminados**.
- **Pausar** interrompe na hora, sem esperar o intervalo terminar.
- **Retomar** continua de onde parou, sem reenviar para quem ja recebeu.
- **Cancelar** encerra a campanha.
- **Ver detalhes por contato** abre a lista completa, com filtro por status e o motivo de
  cada falha.

Fechar a janela **nao para o disparo**: o app vai para a bandeja do sistema e continua
enviando. Para encerrar de verdade, use **Sair** no menu do icone da bandeja.

### O status "indeterminado"

Quando o app e encerrado no meio de um envio, aquela mensagem fica como **indeterminada**:
pode ter chegado ou nao. O app **nao reenvia automaticamente**, de proposito — mandar de
novo para quem ja recebeu aumenta a chance de denuncia.

---

## Sinais de que e hora de parar

Pare a campanha e nao reinicie no mesmo dia se:

- as falhas comecarem a se acumular no meio do envio;
- o WhatsApp desconectar sozinho mais de uma vez;
- chegarem varias respostas negativas seguidas nas [Conversas](app:/inbox).

Retomar por cima de um sinal desses e o jeito mais rapido de perder o numero. O detalhe de
cada sinal esta em [Disparo em massa sem tomar ban](app:/docs/disparo-seguro).

---

## Proximo passo

Depois do disparo vem a parte que quase todo mundo esquece: **responder**. Siga para
[Conversas e Configuracoes](app:/docs/conversas-e-configuracoes).
