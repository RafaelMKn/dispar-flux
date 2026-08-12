# Conversas e Configuracoes

Duas telas que costumam ficar de lado e nao deveriam: [Conversas](app:/inbox), onde a
campanha vira conversa de verdade, e [Configuracoes](app:/config), onde ficam os ajustes
que afetam todos os disparos.

---

## Parte 1 — Conversas

### Por que responder importa

Campanha que so envia e nunca responde e a definicao de spam para o WhatsApp. Conversa
bidirecional — gente escrevendo de volta e voce respondendo — e o sinal mais forte de que
aquele numero e usado por uma pessoa. Alem disso, quem responde e quem esta interessado:
deixar sem resposta joga fora o unico retorno que a campanha deu.

### A tela

A esquerda fica a lista de conversas, com foto de perfil, ultima mensagem, horario e um
contador de nao lidas. A direita, a conversa aberta. Em janelas estreitas (abaixo de
1100px) as duas viram uma so: abrir uma conversa esconde a lista, e a seta no topo volta.

O numero ao lado de **Conversas** na barra lateral e o total de mensagens nao lidas. Ele
zera quando voce abre a conversa.

### Base de leads x Todas

Acima da lista ha dois filtros. **Base de leads** e o padrao e mostra so os numeros que
estao em alguma base importada ou no CRM — que e quem interessa numa ferramenta de
prospeccao. **Todas** mostra a inbox inteira, incluindo conversas pessoais.

A lista carrega 100 conversas por vez. Para achar algo fora dessa janela, use o campo de
busca: ele procura no banco, nao so no que esta na tela.

### Responder

O campo de texto fica embaixo. **Enter** envia; **Shift+Enter** quebra linha.

| Botao           | O que faz                                                          |
| --------------- | ------------------------------------------------------------------ |
| Carinha (emoji) | Abre o seletor de emoji.                                           |
| Clipe (anexar)  | **Imagem ou video**, **Documento** ou **Arquivo de audio**.        |
| Microfone       | Grava uma nota de voz. Aparece quando o campo de texto esta vazio. |
| **Enviar**      | Aparece no lugar do microfone assim que voce escreve algo.         |

Durante a gravacao aparece o cronometro e um botao para **descartar** a nota antes de
enviar.

### De onde vem o historico

O grosso do historico **nao** e buscado depois: ele chega de uma vez so, logo depois de voce
escanear o QR. E o WhatsApp que decide quanto mandar, e a decisao depende de como o app se
identificou **naquele pareamento**:

| Como a conexao se identificou     | Quanto o WhatsApp manda |
| --------------------------------- | ----------------------- |
| Navegador (versoes ate a 0.3.0)   | cerca de **3 meses**    |
| Cliente desktop (0.3.1 em diante) | cerca de **1 ano**      |

Isso e negociado **uma unica vez**, no pareamento, e nao muda a cada vez que o app conecta.
Se voce ja usava o Dispar Flux antes da 0.3.1, sua conexao continua na faixa curta ate voce
refazer o pareamento — e o card **Conexao WhatsApp**, em Configuracoes, avisa quando esse e
o caso.

> [!NOTA]
> **Refazer o pareamento nao apaga nada seu.** Encerrar a sessao remove so as credenciais da
> conexao; conversas, mensagens, anexos ja baixados, leads, campanhas e agendamentos ficam
> onde estao. E como as mensagens sao identificadas pelo id que o WhatsApp da a elas, o
> pacote novo nao duplica o que voce ja tem — ele so preenche o que faltava.
>
> Para refazer: **Configuracoes → Conexao WhatsApp → Encerrar sessao → Gerar QR e conectar**.
> Depois disso, o aparelho vai listar o Dispar Flux como um **Mac** em Dispositivos
> conectados. E so o nome da plataforma que o app anuncia — e justamente ela que faz o
> WhatsApp liberar o pacote maior.

### Contato aparecendo duas vezes

O WhatsApp esta trocando a forma de identificar as conversas: em vez do numero,
ele passa a usar um identificador interno (um "LID"), que nao tem relacao nenhuma com
o telefone. Enquanto o app nao sabia disso, a mesma pessoa podia virar **duas conversas** —
uma com o numero e outra com um "numero" que na verdade era esse identificador.

A partir da 0.3.2 o app junta as duas sozinho, e vai descobrindo a traducao conforme
conversa e valida numeros. Nao ha nada a fazer: as conversas duplicadas somem ao abrir o app,
e o historico das duas fica junto na que sobra. Se ainda restar alguma, ela some depois que o
app conseguir descobrir de quem e aquele identificador — o **Copiar diagnostico** mostra
quantas faltam, no campo `lidChats`.

### Buscar historico antigo

Ha tres botoes diferentes, e a confusao entre eles e comum:

| Botao                                | Onde fica                  | O que faz                                                                  |
| ------------------------------------ | -------------------------- | -------------------------------------------------------------------------- |
| Circular, no topo da lista           | Cabecalho de **Conversas** | Atualiza a lista e as fotos de perfil. Nao busca historico.                |
| **Sincronizar base**                 | Ao lado dos filtros        | Puxa a conversa **completa** de cada numero da base de leads, uma por vez. |
| Circular, no topo da conversa aberta | Cabecalho da conversa      | Sincroniza so essa conversa: **7 dias**, **30 dias** ou **completa**.      |

> [!NOTA]
> **Quem responde por historico antigo e o seu celular, nao o servidor do WhatsApp.** O
> pedido vai para o aparelho pareado, que monta e envia um pacote — entao ele precisa estar
> ligado, com internet e com o WhatsApp aberto. E por isso que a busca e lenta: podem ser
> varios minutos por conversa, e as vezes a resposta simplesmente nao vem.
>
> Por isso o app **nao trava esperando**. Ele diz que o pedido foi enviado e segue; quando o
> pacote chega, as mensagens entram sozinhas na conversa e um aviso aparece na tela. Voce
> nao precisa clicar de novo.
>
> Como essa busca depende do aparelho, ela e o **plano B**. O caminho confiavel para ter a
> inbox batendo com o celular e o pacote do pareamento, descrito acima.

Ao abrir uma conversa pouco sincronizada, o app ja puxa sozinho os ultimos 7 dias (30 se o
numero esta na base), uma vez por sessao. Rolando a conversa para cima, ele carrega de 50 em
50 e vai pedindo o que veio antes.

> [!NOTA]
> **Uma conversa que so tem o que voce disparou nao tem como ser buscada.** Para pedir o
> passado, o app precisa apontar para uma mensagem que o **celular** conhece — e a mensagem
> que o proprio app gravou ao enviar nao serve, porque ela nasce aqui, nao no aparelho.
> Nesses casos a tela avisa que a conversa ainda nao tem ponto de partida. Ela ganha um
> assim que o celular mandar a primeira mensagem, ou quando o contato responder.

Se uma sincronizacao nao anda, o primeiro passo e **Configuracoes → Conexao WhatsApp →
Copiar diagnostico**. O bloco copiado traz a versao do WhatsApp Web em uso, com que
plataforma a sessao se pareou, quantas tentativas de reconexao houve e os ultimos lotes de
historico que chegaram — que e como se sabe se o WhatsApp esta mandando alguma coisa.

Ele **nao** inclui suas mensagens nem os numeros dos seus contatos (dos lotes vai so a
quantidade de conversas), e o numero conectado sai mascarado. Pode colar num chat de
suporte.

Para investigar mais fundo, rode o app com `DISPAR_WA_LOG_LEVEL=debug`: o log passa a
mostrar o detalhe da conversa com o celular. As linhas sobre historico ja aparecem no log
normal, mesmo sem essa variavel — o caminho do arquivo vem no diagnostico.

Anexo de mensagem antiga **nao baixa sozinho** — com o historico completo isso seriam varios
GB. Ele fica pendente e baixa quando voce clica. Mensagem nova continua baixando imagem,
audio e figurinha automaticamente.

Grupos ficam fora da inbox, por serem ruido numa ferramenta de prospeccao.

### Descadastro pela conversa

Quando alguem responde exatamente `SAIR`, `PARAR`, `CANCELAR`, `STOP` e afins, o app marca
esse contato como descadastrado automaticamente, em **todas** as bases. Nao e preciso fazer
nada — e nao ha como reverter sem a pessoa pedir.

> [!DICA]
> Vale responder mesmo quem pediu para sair, com uma frase curta confirmando. Custa nada e
> costuma ser a diferenca entre "sair da lista" e "denunciar o numero".

---

## Parte 2 — Configuracoes

A tela [Configuracoes](app:/config) tem oito cartoes.

### Conexao WhatsApp

Onde voce le o QR Code e ve o status da conexao. Detalhado em
[Primeiros passos](app:/docs/primeiros-passos).

Tambem e aqui que fica o **Copiar diagnostico** (veja acima) e, quando a sessao foi pareada
por uma versao antiga do app, o aviso sobre refazer o pareamento para receber o historico
maior.

### Inteligencia artificial

Provedor, modelo e chave de API para o modo **IA** da tela de Disparo. Esse modo ainda nao
esta disponivel (chega na Fase 3), entao o cartao existe para deixar tudo configurado
antes. A chave e guardada criptografada pelo proprio Windows, nao em texto puro.

### Envio

Os valores **padrao** de ritmo. Toda campanha nova comeca com eles; mudar aqui nao afeta
uma campanha ja em andamento, e mudar na tela de Disparo nao altera este padrao.

| Campo                         | Padrao de fabrica | Significa                                                |
| ----------------------------- | ----------------- | -------------------------------------------------------- |
| **Intervalo minimo (ms)**     | 8000 (8s)         | Menor pausa entre duas mensagens.                        |
| **Intervalo maximo (ms)**     | 20000 (20s)       | Maior pausa; o app sorteia entre o minimo e o maximo.    |
| **Descansar a cada N envios** | 40                | De quantas em quantas mensagens ocorre a pausa longa.    |
| **Duracao do descanso (ms)**  | 300000 (5 min)    | Quanto dura essa pausa.                                  |
| **Teto diario**               | 300               | Maximo de mensagens por dia, somando todas as campanhas. |

Clique em **Salvar parametros** para aplicar.

> [!AVISO]
> Esses padroes sao perfil de numero **maduro**. Chip novo com teto de 300 e o roteiro mais
> curto para perder o numero — veja a tabela por fase em
> [Como maturar um chip de WhatsApp](app:/docs/maturacao-de-chip).

### CRM

Um campo so: **Janela de resposta automatica (ms)**. Resposta que chega ate esse tempo
depois do envio nao move o cartao no [Kanban](app:/kanban) — e a mensagem automatica de
ausencia do WhatsApp Business, nao o cliente. A mensagem continua aparecendo normalmente em
[Conversas](app:/inbox). Use `0` para desligar a regra. Clique em **Salvar CRM** para
aplicar.

### Rodar em segundo plano

- **Continuar rodando ao fechar a janela** — ligado, fechar a janela esconde o app na
  bandeja e o disparo continua; para encerrar de vez, use **Sair** no menu do icone.
  Desligado, o **X** encerra o app e interrompe o disparo.
- **Iniciar junto com o sistema** — o app sobe minimizado na bandeja quando o computador
  liga, sem abrir a janela.

As duas chaves salvam sozinhas, sem botao.

### Atualizacoes

Mostra a versao instalada e o estado da verificacao. **Procurar atualizacoes** checa na
hora. Quando ha versao nova, a faixa no topo da janela traz **Baixar agora** e, depois,
**Reiniciar e instalar**. A instalacao fica bloqueada enquanto houver disparo em andamento.

No modo de desenvolvimento a atualizacao automatica nao funciona — so no app instalado.

### Avancado: versao do WhatsApp Web

Ao conectar, o app anuncia uma versao do WhatsApp Web — e ele descobre sozinho qual usar.
Quando o WhatsApp passa a recusar versoes antigas, a conexao falha com o codigo **405**
antes mesmo de o QR aparecer, e a tela avisa isso.

Esse campo existe para o dia em que a descoberta automatica falhar: fixando aqui uma versao
aceita, da para voltar a conectar sem esperar uma atualizacao do app. Use o formato de tres
numeros (`2.3000.1035194821`) e deixe em branco para voltar ao automatico. Vale na proxima
conexao.

### Sobre e aviso legal

O resumo do risco: software livre sem garantias, biblioteca nao oficial, disparo em massa
viola os Termos do WhatsApp e pode banir o numero, e envio sem consentimento pode violar a
LGPD.

---

## Para onde ir agora

- Acompanhar quem respondeu e automatizar o follow-up: [Acompanhar os leads](app:/docs/crm).
- Quer reduzir o risco de ban de forma estrutural: [Disparo em massa sem tomar ban](app:/docs/disparo-seguro).
- Chip novo ou recem comprado: [Como maturar um chip de WhatsApp](app:/docs/maturacao-de-chip).
