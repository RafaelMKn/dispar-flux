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

### Sincronizar

O botao circular no topo da lista sincroniza conversas e fotos de perfil com o celular. Use
quando alguma conversa parecer desatualizada ou as fotos nao carregarem. Ele fica
desabilitado se o WhatsApp estiver desconectado.

### Descadastro pela conversa

Quando alguem responde exatamente `SAIR`, `PARAR`, `CANCELAR`, `STOP` e afins, o app marca
esse contato como descadastrado automaticamente, em **todas** as bases. Nao e preciso fazer
nada — e nao ha como reverter sem a pessoa pedir.

> [!DICA]
> Vale responder mesmo quem pediu para sair, com uma frase curta confirmando. Custa nada e
> costuma ser a diferenca entre "sair da lista" e "denunciar o numero".

---

## Parte 2 — Configuracoes

A tela [Configuracoes](app:/config) tem sete cartoes.

### Conexao WhatsApp

Onde voce le o QR Code e ve o status da conexao. Detalhado em
[Primeiros passos](app:/docs/primeiros-passos).

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

### Sobre e aviso legal

O resumo do risco: software livre sem garantias, biblioteca nao oficial, disparo em massa
viola os Termos do WhatsApp e pode banir o numero, e envio sem consentimento pode violar a
LGPD.

---

## Para onde ir agora

- Quer reduzir o risco de ban de forma estrutural: [Disparo em massa sem tomar ban](app:/docs/disparo-seguro).
- Chip novo ou recem comprado: [Como maturar um chip de WhatsApp](app:/docs/maturacao-de-chip).
