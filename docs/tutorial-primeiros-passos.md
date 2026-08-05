# Primeiros passos no Dispar Flux

Este e o tutorial de entrada. Em uns 15 minutos voce instala o app, conecta o seu WhatsApp
e entende para que serve cada tela. Nao precisa saber nada de tecnico.

> [!PERIGO]
> O Dispar Flux conversa com o WhatsApp por uma biblioteca **nao oficial**. Disparo em
> massa viola os Termos de Servico do WhatsApp e pode **banir o numero de forma
> permanente** — a Meta quase nunca reverte. Mandar mensagem para quem nao autorizou
> tambem pode violar a LGPD e caracterizar spam. Use numero dedicado, volume baixo e
> sempre ofereca descadastro. Nenhuma tecnica elimina o risco, e ele e todo seu.

---

## 1. Instalar o app

1. Abra a pagina de [releases do projeto](https://github.com/RafaelMKn/dispar-flux/releases/latest).
2. Em **Assets**, baixe o arquivo `Dispar-Flux-Setup-<versao>.exe`.
3. Execute o arquivo. A instalacao e por usuario, em
   `%LOCALAPPDATA%\Programs\dispar-flux`, e **nao pede senha de administrador**.

### O aviso azul do Windows

O instalador nao e assinado digitalmente (um certificado custa centenas de dolares por ano
e este projeto e gratuito). O Windows vai mostrar _"O Windows protegeu o seu
computador"_ — clique em **Mais informacoes** e depois em **Executar assim mesmo**. Se o
navegador avisar que o arquivo "nao e baixado com frequencia", escolha **Manter**.

> [!NOTA]
> Seus dados (base de contatos, sessao do WhatsApp e configuracoes) ficam em
> `%APPDATA%\dispar-flux`. Atualizar o app nao mexe neles.

---

## 2. Conhecer as telas

A barra da esquerda tem cinco itens. Se a janela ficar estreita, ela encolhe e mostra so os
icones — o nome aparece ao passar o mouse.

| Tela                         | Para que serve                                                          |
| ---------------------------- | ----------------------------------------------------------------------- |
| [Conversas](app:/inbox)      | Responder quem respondeu. Texto, emoji, foto, video, documento e audio. |
| [Disparo](app:/disparo)      | Montar e executar a campanha, em cinco passos.                          |
| [Base de Dados](app:/base)   | Cadastrar bases, importar CSV e validar numeros.                        |
| [Configuracoes](app:/config) | Conectar o WhatsApp, ajustar o ritmo padrao e o comportamento do app.   |
| [Documentacao](app:/docs)    | Estes guias.                                                            |

No rodape da barra ficam o botao de **tema claro/escuro** e um ponto colorido que mostra se
o WhatsApp esta conectado.

---

## 3. Conectar o seu WhatsApp

O app nao usa a API oficial: ele se conecta como se fosse o WhatsApp Web, lendo um QR Code.
A sessao fica salva, entao voce so faz isto uma vez.

1. Va em [Configuracoes](app:/config).
2. No cartao **Conexao WhatsApp**, clique em **Gerar QR e conectar**. O QR Code aparece no
   quadrado da esquerda e o status muda para **Aguardando leitura do QR**.
3. No celular, abra o WhatsApp e va em **Configuracoes** (ou **Ajustes**) ->
   **Dispositivos conectados** -> **Conectar um dispositivo**.
4. Aponte a camera para o QR Code na tela do computador.
5. O status vira **Conectado** e o app mostra o numero pareado. O ponto no rodape da barra
   lateral fica verde, com o texto "WhatsApp conectado".

> [!DICA]
> Use um numero **dedicado** para o disparo, nunca o numero principal da empresa. Se ele
> for banido, voce perde a conta daquele numero — e leva junto o historico de conversas.
> Se o chip e novo, pare por aqui e leia [Como maturar um chip de WhatsApp](app:/docs/maturacao-de-chip)
> antes de disparar qualquer coisa.

### Os dois botoes que parecem iguais

- **Desconectar** encerra a conexao mas mantem o pareamento. Basta clicar em **Gerar QR e
  conectar** para voltar, sem QR novo.
- **Encerrar sessao** apaga o pareamento. O numero some da lista de dispositivos conectados
  do celular e, para usar de novo, e preciso ler um QR Code outra vez.

---

## 4. O caminho ate o primeiro disparo

A ordem importa: o app so deixa disparar quando cada peca esta no lugar.

1. **Conectar o WhatsApp** em [Configuracoes](app:/config) — feito no passo anterior.
2. **Criar uma base e importar contatos** em [Base de Dados](app:/base). Ver
   [Montar a base de contatos](app:/docs/base-de-contatos).
3. **Validar os numeros no WhatsApp**, ainda na mesma tela. Contato nao validado nao entra
   no disparo.
4. **Montar a campanha** em [Disparo](app:/disparo). Ver
   [Seu primeiro disparo](app:/docs/primeiro-disparo).

---

## 5. Rodar em segundo plano

O disparo nao depende da janela estar aberta. Ao fechar a janela, o app se recolhe para a
bandeja do sistema (ao lado do relogio) e a campanha continua enviando. O icone mostra o
progresso e tem atalhos para **pausar**, **retomar** e **sair** — e o **sair** do menu do
icone que encerra o app de verdade.

Voce recebe uma notificacao do sistema quando:

- a campanha termina;
- a campanha para por ter batido o teto diario;
- o WhatsApp desconecta no meio do envio.

Em [Configuracoes -> Rodar em segundo plano](app:/config) da para desligar esse
comportamento (ai o **X** encerra o app e interrompe o disparo) e para ligar o inicio junto
com o sistema, que sobe o app ja minimizado na bandeja.

---

## 6. Atualizacoes

O app avisa sozinho quando sai versao nova: aparece uma faixa no topo da janela com o botao
**Baixar agora** e, quando o download termina, **Reiniciar e instalar**. Nada e baixado sem
voce mandar, e a instalacao fica bloqueada enquanto houver disparo em andamento.

Para conferir manualmente, va em [Configuracoes -> Atualizacoes](app:/config).

---

## Proximo passo

Siga para [Montar a base de contatos](app:/docs/base-de-contatos), que e onde a maior parte
do resultado (e do risco) se decide.
