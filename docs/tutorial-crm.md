# Acompanhar os leads: Kanban, Agenda e Cron

Disparar e a parte facil. O que separa uma campanha que vira venda de uma que vira ruido e
o que acontece **depois** do envio. Essas tres telas sao o CRM do Dispar Flux, e elas so
ganham conteudo depois que a primeira campanha sai.

> [!NOTA]
> Se voce ainda nao rodou nenhuma campanha, comece por
> [Seu primeiro disparo](app:/docs/primeiro-disparo). Sem disparo nao existe lead, e as
> tres telas ficam vazias.

---

## 1. Como o lead nasce

Voce nao cadastra lead na mao. O fluxo e automatico:

1. A campanha envia para um contato. **No instante em que o envio e confirmado**, o app cria
   um cartao para essa pessoa no [Kanban](app:/kanban), na coluna de entrada.
2. A pessoa responde. O cartao anda sozinho para a coluna de em andamento.
3. Dali em diante quem move o cartao e voce, arrastando.

Duas regras evitam que o funil se encha de cartao que nao e lead de verdade:

- **So quem esta numa base.** Mensagem de quem nao esta em nenhuma base de disparo e
  ignorada pelo CRM. Sem isso o Kanban viraria um espelho da agenda do celular, e qualquer
  conhecido mandando "oi" viraria lead.
- **Resposta automatica nao conta.** Mensagem que volta rapido demais para ser humana e
  descartada como movimento de funil — e a mensagem de ausencia do WhatsApp Business, nao a
  pessoa. O ajuste esta em [Configuracoes -> CRM](app:/config) e vale a pena entender antes
  de mexer (secao 5).

Em nenhum dos dois casos a mensagem some: ela continua aparecendo normalmente em
[Conversas](app:/inbox). O que muda e so se o cartao anda de coluna.

---

## 2. Kanban

### As colunas

O app comeca com cinco: **Aguardando resposta**, **Em andamento**, **Negociacao**, **Ganho**
e **Perdido**.

As duas primeiras tem um selo: **entrada** e **automatico**. Sao as que a automacao usa — o
lead nasce na primeira e vai para a segunda quando o cliente responde. Voce pode **renomear**
as duas (o papel viaja com a coluna, nao com o nome), mas nao apagar. As outras tres sao
comuns e voce mexe a vontade.

O botao **Colunas**, no topo direito, abre o gerenciador: criar, renomear, reordenar com as
setas e apagar. Ao apagar, os leads daquela coluna vao para outra — o app diz para qual
antes de confirmar.

> [!DICA]
> Vale adaptar as colunas ao seu processo em vez de forcar o processo nas colunas padrao.
> Um funil de orcamento, por exemplo, costuma pedir uma coluna "Proposta enviada" entre
> _Em andamento_ e _Negociacao_.

### Os cartoes

Cada cartao mostra, alem do nome e telefone:

| O que aparece     | Significa                                                                          |
| ----------------- | ---------------------------------------------------------------------------------- |
| Tempo (ex.: `3d`) | Ha quanto tempo esse lead esta parado, contado do ultimo contato de qualquer lado. |
| Contador azul     | Mensagens nao lidas dessa pessoa.                                                  |
| `sem resposta`    | O disparo saiu e a pessoa nunca respondeu.                                         |
| `N follow-ups`    | Quantas mensagens automaticas o Cron ja mandou para ela.                           |
| `descadastrado`   | Pediu para sair. Nao recebe mais nada, nem disparo nem follow-up.                  |
| `N automaticas`   | Respostas descartadas por chegarem rapido demais para serem humanas.               |

Arraste o cartao para mover de coluna. No topo da tela, tres contadores resumem o funil:
quantos estao sem resposta, quantos responderam e o total.

### O cartao aberto

Clicar no cartao abre a ficha do lead, com telefone, coluna atual, base de origem, campanha
que o trouxe, quando o disparo saiu, quando veio a primeira resposta, quantos follow-ups
foram enviados e quantas respostas automaticas foram descartadas.

Dali voce pode:

- **Abrir conversa** — pula direto para essa conversa em [Conversas](app:/inbox).
- **Agendar compromisso** — cria um item na [Agenda](app:/agenda) ja vinculado ao lead.
- **Anotacoes** — campo livre para o que ficou combinado. Clique em **Salvar**.
- **Remover do CRM** — tira o cartao do funil. A conversa e o contato na base continuam
  intactos.

---

## 3. Agenda

Um calendario mensal com duas coisas no mesmo lugar:

- **Compromissos** que voce marcou (ponto azul), pelo botao **Novo compromisso** ou pelo
  cartao do lead no Kanban.
- **Follow-ups previstos** (ponto laranja) — o que as regras do Cron ainda vao disparar.
  Sao so previsao: nao da para editar por aqui, o lugar deles e o [Cron](app:/cron).

Ponto cinza e compromisso ja concluido.

Clique num dia para ver a lista embaixo do calendario, com horario, titulo e os botoes de
concluir e apagar. As setas no topo do calendario andam de mes.

### Notificacao

Na hora marcada o app avisa por **notificacao do sistema**, mesmo com a janela fechada e o
app na bandeja. Isso vale tambem enquanto uma campanha esta rodando.

> [!DICA]
> O compromisso mais util nao e "ligar para o cliente" — e o que voce prometeu na conversa.
> Anote no cartao do lead o que ficou combinado e agende no mesmo gesto: sao dois cliques,
> e e a diferenca entre lembrar e nao lembrar.

---

## 4. Cron

Regras de follow-up automatico: "X horas sem resposta, manda a mensagem Y". E a tela mais
util e a mais perigosa das tres.

> [!AVISO]
> Follow-up automatico e o tipo de envio que mais irrita quem nao pediu contato — e
> irritacao vira denuncia, que e o sinal que mais pesa contra o seu numero. Prefira prazos
> largos, no maximo um ou dois degraus, e horario comercial. Detalhe em
> [Disparo em massa sem tomar ban](app:/docs/disparo-seguro).

### Criar uma regra

Clique em **Nova regra** e preencha:

| Campo                  | O que faz                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| **Nome da regra**      | So para voce se achar. Ex.: `Primeira cobranca`.                                            |
| **Horas sem resposta** | Contadas a partir do **ultimo contato nosso** — o disparo original ou o follow-up anterior. |
| **Maximo por lead**    | Quantos follow-ups a mesma pessoa pode receber no total (limite de 5).                      |
| **Base**               | Restringe a regra a uma base, ou deixa em **Todas as bases**.                               |
| **Dias permitidos**    | Os dias da semana em que a regra pode disparar. Nenhum dia marcado = a regra nunca roda.    |
| **A partir de / Ate**  | A faixa de horario. Fora dela o envio **espera a janela abrir**, nao e cancelado.           |
| **Mensagem**           | **Mensagem fixa** ou **Variacoes alternadas**, que o app sorteia a cada envio.              |

A contagem partir do ultimo contato nosso e o que faz "a cada 48h, ate 3 vezes" virar tres
mensagens espacadas, e nao tres de uma vez no segundo dia.

> [!DICA]
> Use **Variacoes alternadas** sempre. Texto identico repetido e o gatilho de deteccao mais
> facil que existe, e num follow-up automatico ele se repete por definicao.

### O cartao da regra

Cada regra mostra o resumo (`48 h sem resposta · ate 2 envios · Clientes 2026`), a janela de
horario, e duas informacoes que valem mais que o resto:

- **N elegivel(is) agora** — quantos leads a regra pegaria neste instante. Confira isso
  antes de ativar: se o numero esta alto demais, o prazo esta curto demais.
- **abre em ...** — quando a janela de horario volta a abrir, se estiver fechada agora.

A chave **Ativa / Pausada** liga e desliga sem apagar a regra. **Disparar agora** executa na
hora, ignorando a janela de horario — e uma decisao explicita sua, diferente do agendador
decidindo sozinho de madrugada. O botao fica desabilitado quando nao ha ninguem elegivel.

### O que o follow-up herda do disparo manual

O Cron **nao tem motor de envio proprio**. Ele monta a fila e entrega para o mesmo motor do
disparo manual, o que significa que tudo isto continua valendo:

- o intervalo aleatorio e os descansos de [Configuracoes -> Envio](app:/config);
- o **teto diario**, somando follow-up e disparo manual;
- a reconferencia de descadastro no instante do envio;
- a retomada de onde parou depois de um encerramento no meio do caminho.

O follow-up aparece no historico como uma campanha comum, com o nome `Follow-up: <regra>`.

### Quando a regra nao roda

O agendador acorda a cada cinco minutos e adia — nao cancela — nestes casos:

- **WhatsApp desconectado.** Tenta de novo no proximo ciclo.
- **Ja existe campanha em execucao.** Uma campanha por vez e regra do motor; o follow-up
  espera em vez de competir com o disparo que voce iniciou na mao.
- **Fora da janela de horario.** Espera a janela abrir.

Como o app continua rodando na bandeja, isso acontece com a janela fechada tambem — que e o
ponto: o follow-up nao pode depender de alguem estar olhando a tela.

---

## 5. A janela de resposta automatica

Em [Configuracoes -> CRM](app:/config) ha um campo so: **Janela de resposta automatica
(ms)**. Resposta que chega ate esse tempo depois do envio nao move o cartao no Kanban.

O motivo e concreto: muita conta comercial tem mensagem de ausencia configurada, e ela volta
em fracao de segundo. Sem essa regra, todo disparo pareceria ter 100% de taxa de resposta —
e a taxa de resposta e justamente a metrica que diz se a sua lista presta.

- O padrao pega so o que e obviamente automatico.
- Aumentar demais faz voce **perder resposta de gente de verdade**, que e o erro caro.
- `0` desliga a regra.

Quantas respostas foram descartadas aparece no cartao do lead, como `N automaticas` — se
esse numero estiver alto num lead que voce sabe que respondeu, a janela esta grande demais.

---

## 6. Uma rotina que funciona

1. **Todo dia**, abra o [Kanban](app:/kanban) e olhe os cartoes com mais tempo parado na
   coluna de em andamento. Sao conversas mornas esfriando.
2. **Responda antes de automatizar.** Conversa de gente vale mais para a reputacao do numero
   do que qualquer ajuste de intervalo.
3. **Uma regra de Cron so**, com prazo largo (48h ou mais) e no maximo dois envios. Duas
   regras que pegam o mesmo lead viram duas mensagens seguidas para a mesma pessoa.
4. **Agende o que voce prometeu**, no cartao do lead, na hora em que prometeu.
5. **Arraste para Perdido** sem pena. Funil cheio de lead morto esconde o que importa.

---

## Para onde ir agora

- Ajustar o ritmo e as protecoes: [Conversas e Configuracoes](app:/docs/conversas-e-configuracoes).
- Reduzir o risco de ban de forma estrutural: [Disparo em massa sem tomar ban](app:/docs/disparo-seguro).
