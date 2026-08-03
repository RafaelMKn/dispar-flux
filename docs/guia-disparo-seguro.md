# Guia de disparo em massa sem API oficial (e sem tomar ban)

> [!NOTA]
> Pesquisa de campo: Reddit, Hacker News, GitHub e web, janela de 04/07/2026 a 03/08/2026.
> Escrito para o Dispar Flux (Baileys embutido), mas o conteudo vale para Evolution API,
> whatsapp-web.js, WPPConnect e qualquer solucao nao oficial. Se voce ainda nao rodou uma
> campanha, comece por [Seu primeiro disparo](app:/docs/primeiro-disparo).

## Aviso que precisa vir antes de tudo

Nao existe metodo "sem tomar ban". Existe metodo com risco baixo o suficiente para a
operacao valer a pena. Toda biblioteca nao oficial (Baileys, whatsapp-web.js, WPPConnect,
Evolution na engine Baileys) dirige o protocolo multi-device por engenharia reversa, o que
viola os Termos de Uso da Meta por definicao. O numero e sempre descartavel do ponto de
vista de risco, e a conta pode cair sem aviso e sem recurso.

O que este guia entrega: as praticas que, segundo quem opera isso hoje, derrubam o risco de
banimento de "semanas" para "meses", e a lista honesta do que virou mito.

---

## 1. O que mudou em 2026

O jogo endureceu. Os tres fatos que mudam o desenho da operacao:

**A deteccao virou comportamental, nao mais so volumetrica.** A analise da Achiya sobre 50+
casos descreve deteccao em camadas: fingerprint de dispositivo no momento do registro,
analise de comportamento durante o envio, sinais de denuncia de usuarios e casamento de
padrao de conteudo. O update de 2026 acrescentou uma metrica nova e brutal para quem faz
disparo frio: **contagem de mensagens nao respondidas**. Mandar 500 mensagens que ninguem
responde e um sinal por si so, independente do intervalo entre elas.

**O teto caiu.** Relatos em comunidades de automacao descrevem numeros que antes sustentavam
1.000 mensagens/dia sendo banidos com 40-50 envios. As issues
[#1870 "Banimento Constante"](https://github.com/evolution-foundation/evolution-api/issues/1870)
e [#439](https://github.com/evolution-foundation/evolution-api/issues/439) do Evolution API
sao o registro publico disso, e apontam que **mensagens identicas em sequencia** sao o
gatilho mais rapido.

**A vida util de uma biblioteca nao oficial e curta.** A estimativa que circula entre
desenvolvedores e de 2 a 8 semanas entre uma tecnica de contorno aparecer e ser detectada.
Trate a stack como algo que precisa de manutencao continua, nao como infraestrutura estavel.

E o alerta de seguranca do periodo: em abril de 2026 o pacote `lotusbail`, vendido como
"anti-ban" e com 56 mil downloads, foi confirmado exfiltrando credenciais de sessao e
roubando mensagens. **Nao instale pacote "antiban" de terceiro.** Ele tem acesso total a sua
sessao autenticada.

---

## 2. A decisao que vem antes da tecnica: oficial ou nao oficial

Vale calcular, porque muita gente evita a API oficial por um custo que na pratica e menor do
que perder o numero principal.

|                    | API Oficial (Cloud API)                                                                           | Nao oficial (Baileys e afins)                |
| ------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Risco de ban       | Suspensao por qualidade, com aviso e apelacao                                                     | Banimento permanente, sem aviso, sem recurso |
| Custo por mensagem | Marketing R$ 0,40-0,55; Utility R$ 0,06-0,09; Auth R$ 0,03-0,05; Service (resposta em 24h) gratis | Zero                                         |
| Custo fixo         | Mensalidade de BSP, tipicamente R$ 97-997                                                         | Chip + servidor                              |
| Franquia           | 1.000 conversas gratis/mes                                                                        | -                                            |
| Limite diario      | Tiers de 1.000 / 10.000 / 100.000 conversas, sobe conforme Quality Rating                         | Nao documentado, definido pela heuristica    |
| Template           | Aprovacao previa obrigatoria                                                                      | Texto livre                                  |
| Legalidade         | Dentro dos Termos                                                                                 | Viola os Termos                              |

O ponto de corte pratico:

- **Notificacao transacional** (pedido, boleto, agendamento, 2FA): vai de oficial. Utility a
  R$ 0,06-0,09 e barato demais para justificar risco de ban.
- **Atendimento e resposta a quem te chamou**: pode ser nao oficial com risco muito baixo,
  porque a conversa e iniciada pelo contato. Esse e o caso de uso para o qual o Baileys foi
  desenhado.
- **Marketing frio para base comprada**: nao existe caminho seguro. Nem oficial (a Meta
  suspende por taxa de bloqueio) nem nao oficial (ban rapido). Se o plano depende disso, o
  problema e a lista, nao a ferramenta.

Na pratica, a arquitetura mais robusta e **hibrida**: oficial para o que e critico e
transacional, nao oficial para relacionamento com base propria e opt-in real.

---

## 3. O fator numero 1 nao e tecnico: e a lista

Isso e o que separa quem opera ha anos de quem queima chip por mes. A deteccao mais dificil
de enganar e a que vem dos **usuarios**: bloqueio e denuncia. Nenhum intervalo aleatorio
salva um numero que recebe 3% de denuncia.

Regras nao negociaveis:

1. **So envie para quem deu opt-in explicito.** Isso nao e etiqueta, e exigencia da LGPD e
   dos proprios Termos do WhatsApp. Alem do ban da Meta, ha exposicao a sancao da ANPD.
2. **Base com mais de 6 meses parada: refaca o opt-in.** Double opt-in — uma mensagem de
   confirmacao, e quem nao responde em 7 dias sai da lista. Parece desperdicio de base;
   e o que evita a onda de bloqueios que derruba a reputacao no primeiro disparo.
3. **Nunca compre base.** Lista comprada tem numero invalido, numero de denunciante
   profissional e gente que nunca ouviu falar de voce. E o caminho mais rapido para o ban.
4. **Opt-out tem que funcionar de verdade e ser instantaneo.** Palavra-chave visivel na
   mensagem ("responda SAIR"), e a saida precisa valer para todas as campanhas futuras.
5. **Limpe numeros invalidos antes de enfileirar.** Enviar para numero que nao existe no
   WhatsApp e sinal de lista comprada.

No Dispar Flux, os itens 4 e 5 ja sao aplicados sozinhos: o descadastro e reconferido no
momento do envio (e nao no momento em que a fila foi montada), contato marcado como "nao
existe" fica de fora, e o destino usado e sempre o que o proprio WhatsApp devolveu na
validacao — nunca um numero montado a mao com nono digito.

---

## 4. Higiene do numero

**Chip novo nao dispara.** Numero recem-registrado com volume alto e o perfil mais banido que
existe. O aquecimento serve para o numero acumular historico de conversa bidirecional antes
de qualquer campanha.

Aquecimento que funciona (7 a 14 dias, nao 2):

- Dias 1-2: nenhum envio em massa. Conversas reais, com resposta, entre 5 e 10 contatos
  conhecidos. Preencher foto, nome e descricao do perfil.
- Dias 3-5: 20 a 30 mensagens/dia, ainda para contatos que respondem. Entrar em 1 ou 2 grupos
  legitimos.
- Dias 6-10: 50 a 80 mensagens/dia, comecando a incluir contatos da base com opt-in.
- Dia 11+: subir gradualmente ate o teto operacional. Nunca dobrar de um dia para o outro.

O que importa no aquecimento nao e o numero de mensagens enviadas, e a **taxa de resposta**.
Um numero que envia 50 e recebe 30 respostas parece humano. Um que envia 200 e recebe 2
parece bot, independente do intervalo.

Outros pontos de higiene:

- **Um chip por dispositivo/sessao.** Multiplas sessoes na mesma maquina compartilham
  fingerprint.
- **IP residencial ou fixo e estavel.** Trocar de IP a cada reconexao e sinal.
- **Nao reconecte em loop.** Sessao que cai e volta o tempo todo chama atencao.
- **Perfil completo.** Numero sem foto e sem nome enviando em volume e perfil de descartavel.
- **Backup da sessao.** Perder a sessao e ter que reparear repetidamente aumenta risco.

---

## 5. Cadencia e volume

Aqui e onde o Dispar Flux ja te da os controles certos, em
[Configuracoes -> Envio](app:/config). Os padroes de fabrica sao:

| Campo                     | Padrao            |
| ------------------------- | ----------------- |
| Intervalo minimo          | 8000 ms (8s)      |
| Intervalo maximo          | 20000 ms (20s)    |
| Descansar a cada N envios | 40                |
| Duracao do descanso       | 300000 ms (5 min) |
| Teto diario               | 300               |

Esse perfil e razoavel para um numero **maduro**. Para chip novo, ele e agressivo demais.
Perfis sugeridos:

| Fase                             | Intervalo min/max | Descansar a cada | Duracao do descanso | Teto diario |
| -------------------------------- | ----------------- | ---------------- | ------------------- | ----------- |
| Chip novo (dias 1-10)            | 45s / 120s        | 15               | 15 min              | 40          |
| Aquecendo (dias 11-25)           | 20s / 60s         | 25               | 10 min              | 120         |
| Maduro (30+ dias, sem incidente) | 8s / 20s          | 40               | 5 min               | 300         |
| Maduro e conservador             | 15s / 45s         | 30               | 8 min               | 200         |

Regras de cadencia que valem em qualquer fase:

- **Intervalo fixo e assinatura de bot.** O app ja sorteia um valor entre o minimo e o
  maximo justamente por isso; nunca deixe os dois campos com o mesmo valor.
- **Respeite janela horaria humana.** Disparo as 3h da manha nao tem explicacao legitima.
  Fique entre 9h e 20h, horario local do destinatario.
- **Nao dispare todo dia no mesmo horario com o mesmo volume.** Variacao de dia para dia
  importa tanto quanto variacao entre mensagens.
- **"Digitando" antes de enviar** deixa o envio menos mecanico — o app ja faz isso sozinho,
  por um tempo aleatorio de 0,9 a 2,5 segundos antes de cada mensagem.
- **Fim de semana e feriado**: volume menor ou zero.

---

## 6. Conteudo da mensagem

Mensagens identicas em sequencia sao o gatilho citado nominalmente nas issues do Evolution
API. Combater isso tem tres camadas:

**1. Spintax por paragrafo.** O Dispar Flux ja suporta: no passo 2 da tela de
[Disparo](app:/disparo), escolha o modo **Alternada por paragrafo** — o app sorteia uma
variacao de cada bloco e monta a mensagem. Escreva 3 a 4 variacoes de
cada paragrafo — com 4 paragrafos de 3 variacoes voce tem 81 mensagens distintas, o
suficiente para uma campanha de algumas centenas nao repetir texto.

**2. Personalizacao real.** Nome, cidade, ultimo pedido. Alem de variar o texto, aumenta a
taxa de resposta, que e a metrica que mais protege o numero.

**3. Estrutura da mensagem.**

- **Sem link na primeira mensagem.** Link em mensagem fria e o maior amplificador de risco.
  Mande o contexto, e o link so depois que a pessoa responder.
- **Sem encurtador** (bit.ly e afins). Se precisar de link, use dominio proprio.
- **Sem midia pesada em disparo frio.** Texto primeiro.
- **Identifique-se na primeira linha.** "Aqui e a Maria da [empresa]" reduz denuncia.
- **Lembre o opt-in.** "Voce cadastrou seu numero no nosso site em marco" corta bloqueio.
- **Opt-out visivel.** Uma linha no fim, sempre.
- **Sem caixa alta, sem excesso de emoji, sem "PROMOCAO IMPERDIVEL".** Casamento de padrao de
  conteudo e uma das camadas de deteccao.

Um teste util: leia a mensagem em voz alta. Se soa como algo que uma pessoa mandaria para
outra, esta ok. Se soa como panfleto, vai virar denuncia.

---

## 7. Arquitetura da operacao

**Nao concentre tudo em um numero.** O numero principal da empresa — aquele que esta no
Google, no site, no cartao — nunca deve rodar campanha. Se ele cair, o prejuizo nao e o
disparo, e o atendimento.

Desenho recomendado:

- 1 numero **principal** (atendimento, recebe resposta, nunca dispara em massa).
- 2 a 3 numeros **operacionais** para campanha, cada um com sua sessao e seu aquecimento.
- Distribua a base entre eles em vez de esgotar um. Tres numeros a 100/dia sao muito mais
  seguros que um a 300/dia.
- Mantenha 1 numero em **quarentena aquecida**, pronto para entrar se outro cair.

**Sinais de alerta que exigem parada imediata:**

- Mensagens ficando em um traco (nao entregues) para varios contatos seguidos.
- Queda subita na taxa de resposta em relacao a campanhas anteriores.
- Aviso in-app do WhatsApp sobre uso de app nao oficial.
- Desconexoes repetidas da sessao sem motivo de rede.
- Aumento de contatos que bloqueiam (visivel indiretamente: mensagens que param de ter
  confirmacao de leitura).

Ao ver qualquer um: **pause a campanha** (o motor tem pause interrompivel, nao precisa
esperar o intervalo terminar), deixe o numero so recebendo por 48-72h e nao retome no mesmo
volume.

**Se banir:** ban temporario costuma resolver em 24-72h; permanente, 3 a 7 dias uteis de
analise e raramente reverte para numero que rodava automacao nao oficial. Nao tente reativar
o mesmo numero em outro dispositivo — isso confirma o padrao. Ative o numero de quarentena e
faca o post-mortem: qual campanha, qual lista, qual cadencia.

---

## 8. Mitos que custam chip

- **"Chip aquecido nao toma ban."** Falso. Aquecimento reduz o risco no inicio; nao imuniza.
  Numero aquecido que dispara para base fria toma ban igual.
- **"Pacote antiban resolve."** Falso e perigoso. O caso `lotusbail` (56 mil downloads,
  roubando sessao) mostra o risco real. Alem disso, ninguem de fora tem acesso a heuristica
  da Meta para "burlar" nada.
- **"Se eu usar proxy/VPN, nao rastreiam."** A deteccao principal e comportamental e de
  conteudo, nao de IP. VPN residencial instavel piora, nao melhora.
- **"Intervalo grande resolve tudo."** Intervalo e uma variavel entre varias. Mensagem
  identica para base fria com 60s de intervalo ainda toma ban.
- **"API nao oficial e ilegal."** Nao e crime; e violacao contratual dos Termos de Uso. O
  risco juridico real esta na LGPD (base sem consentimento), nao no uso da biblioteca.

---

## 9. Checklist antes de cada campanha

**Lista**

- [ ] Todos os contatos tem opt-in registrado e datado
- [ ] Base com mais de 6 meses passou por double opt-in
- [ ] Opt-outs anteriores foram aplicados
- [ ] Numeros validados no WhatsApp (nenhum contato "nao verificado" na base)

**Numero**

- [ ] Aquecimento concluido para a fase (7-14 dias se novo)
- [ ] Perfil com foto, nome e descricao
- [ ] Nenhum incidente nos ultimos 7 dias
- [ ] Nao e o numero principal de atendimento

**Mensagem**

- [ ] 3+ variacoes por paragrafo no spintax
- [ ] Personalizacao com pelo menos um campo real
- [ ] Sem link na primeira mensagem
- [ ] Identificacao de quem esta falando
- [ ] Linha de opt-out

**Cadencia**

- [ ] Perfil de delay compativel com a maturidade do numero
- [ ] Intervalo minimo diferente do maximo
- [ ] Teto diario definido e abaixo do limite da fase
- [ ] Janela horaria entre 9h e 20h

**Operacao**

- [ ] Alguem acompanhando os primeiros 30 envios
- [ ] Numero reserva aquecido e disponivel
- [ ] Criterio de parada combinado com a equipe

---

## 10. Onde configurar cada coisa no Dispar Flux

| Pratica                                       | Onde                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| Intervalo aleatorio min/max                   | [Configuracoes](app:/config) -> Envio: **Intervalo minimo** e **Intervalo maximo (ms)** |
| Descanso periodico                            | Mesma secao: **Descansar a cada N envios** e **Duracao do descanso (ms)**               |
| Teto diario (conta todas as campanhas do dia) | Mesma secao: **Teto diario**                                                            |
| Ritmo so para uma campanha                    | [Disparo](app:/disparo), passo 4 (**Ritmo**) — nao altera o padrao                      |
| Variacao de texto                             | [Disparo](app:/disparo), passo 2: modo **Alternada por paragrafo**                      |
| Opt-out                                       | Automatico na resposta, e manual em [Base de Dados](app:/base). Reconferido no envio    |
| Validacao de numero                           | [Base de Dados](app:/base) -> **Validar no WhatsApp**                                   |
| "Digitando" antes do envio                    | Automatico, 900-2500ms aleatorios                                                       |
| Pausar sem esperar o intervalo                | Botao **Pausar** no cartao de progresso — interrompe na hora                            |
| Retomar sem reenviar                          | Botao **Retomar**; a fila e persistente e sabe quem ja recebeu                          |

### Limitacoes de hoje, e como contornar

Duas coisas o app ainda nao faz por voce. Nenhuma impede a operacao, mas as duas exigem
disciplina manual:

1. **Nao ha janela horaria.** Nada bloqueia um envio as 3h da manha, que e um dos sinais
   mais faceis de detectar. Enquanto isso, controle o horario na mao: nao inicie campanha
   longa no fim do dia e acompanhe o teto diario para ela nao terminar de madrugada.
2. **Nao ha rotacao entre numeros.** A arquitetura de multiplos chips da secao 7 e manual:
   uma base por numero, uma campanha por vez, trocando a conexao em
   [Configuracoes](app:/config). Da trabalho, mas e o que mais reduz risco quando o volume
   cresce.

---

## Resumo em cinco linhas

1. A lista importa mais que a tecnica. Opt-in real e o unico anti-ban que escala.
2. Chip novo nao dispara. 7 a 14 dias de aquecimento com conversa bidirecional.
3. Cadencia aleatoria, teto baixo, janela humana. Intervalo fixo e assinatura de bot.
4. Mensagem variada, personalizada, sem link na primeira, com opt-out visivel.
5. Nunca concentre no numero principal. Tenha reserva aquecida e criterio de parada.

Para volume transacional recorrente, o calculo racional continua sendo migrar para a API
oficial: R$ 0,06 a R$ 0,09 por mensagem utility e mais barato que reconstruir uma operacao
depois de perder o numero.
