# Montar a base de contatos

A tela [Base de Dados](app:/base) e onde ficam os contatos que vao receber o disparo. Este
tutorial cobre o caminho inteiro: criar a base, montar a planilha, importar, validar os
numeros e entender por que um contato as vezes nao recebe.

> [!AVISO]
> Importe apenas contatos que **autorizaram** receber suas mensagens. Lista comprada,
> raspada de site ou "extraida de grupo" e a causa numero um de banimento — e a que nenhum
> ajuste de intervalo resolve, porque quem denuncia e a pessoa, nao o algoritmo.

---

## 1. Criar uma base

Uma base e um grupo de contatos com um nome. Voce pode ter varias (por regiao, por origem
do lead, por campanha) e o disparo sempre aponta para uma delas.

1. Va em [Base de Dados](app:/base).
2. No campo **Nova base**, escreva um nome que voce va reconhecer daqui a tres meses. Ex.:
   `Clientes 2026 — Sudeste`.
3. Clique em **Criar base**.

A base aparece na lista com um resumo embaixo do nome: total de contatos, quantos sao
validos, invalidos, nao verificados e descadastrados. Clique nela (ou em **Abrir**) para
entrar.

---

## 2. Montar a planilha

Clique em **Baixar modelo CSV**, no canto superior direito da tela. O app salva um arquivo
`modelo-contatos-dispar-flux.csv` ja preparado para abrir certo no Excel em portugues, com
as colunas:

| Coluna     | Obrigatoria | Para que serve                            |
| ---------- | ----------- | ----------------------------------------- |
| `nome`     | nao         | Personalizacao: vira a variavel `[nome]`. |
| `telefone` | **sim**     | O numero de destino.                      |
| `empresa`  | nao         | Exemplo de campo extra: vira `[empresa]`. |
| `cidade`   | nao         | Exemplo de campo extra: vira `[cidade]`.  |

Preencha no Excel e salve mantendo o formato CSV.

### Formato do telefone

Pode escrever do jeito que estiver na sua planilha. O app entende todas estas formas e
converte para o padrao internacional:

```
(11) 98765-4210
11987654210
5511987654210
+55 51 3255-4210
```

O que **nao** entra: celula vazia, texto junto do numero (`11987654210 ramal 3`) e numeros
que nao existem no plano de numeracao. Esses viram contato **invalido** na importacao.

> [!NOTA]
> O app nao adiciona nem remove o nono digito por conta propria. Quem decide qual e o
> numero real no WhatsApp e o proprio WhatsApp, na validacao do passo 4 — mexer nisso por
> fora e a causa classica de mandar mensagem para a pessoa errada.

### Colunas extras viram variaveis

Qualquer coluna alem de `nome` e `telefone` pode ser importada como **campo extra** e usada
na mensagem entre colchetes. Se a planilha tem uma coluna `cidade`, a mensagem pode dizer
`Oi [nome], vi que voce e de [cidade]`. Nomes de coluna com espaco ou acento funcionam, mas
dao mais trabalho de escrever depois — prefira nomes curtos e simples.

---

## 3. Importar o CSV

1. Abra a base e clique em **Importar CSV**.
2. Clique em **Escolher arquivo** e selecione a planilha. O app detecta sozinho o separador
   (`,` ou `;`) e a codificacao, inclusive arquivos do Excel em portugues, que costumam vir
   em latin1 e quebrariam os acentos.
3. Na tela **Mapear colunas**, diga qual coluna e o **telefone** (unica obrigatoria), qual
   e o **nome**, e marque as colunas extras que voce quer levar junto.
4. Clique em **Importar contatos**.

No fim aparece um relatorio: quantos foram importados, quantos eram duplicados (o mesmo
numero ja existia na base) e quantos tinham telefone invalido.

> [!DICA]
> Importou errado? Nao ha "desfazer" da importacao. Se a base ficou desorganizada, e mais
> rapido excluir a base inteira e importar de novo — o botao da lixeira, na lista de bases,
> pede confirmacao e diz quantos contatos serao apagados.

---

## 4. Validar os numeros no WhatsApp

Importar so garante que o numero **existe como numero**. Validar garante que ele **tem
WhatsApp**. Disparar para numero sem WhatsApp e desperdicio de reputacao do chip, e o app
nao deixa: contato nao validado fica de fora da campanha.

1. Conecte o WhatsApp em [Configuracoes](app:/config), se ainda nao estiver conectado — o
   botao **Validar no WhatsApp** fica desabilitado sem conexao.
2. Abra a base e clique em **Validar no WhatsApp**.
3. Acompanhe a barra de progresso. A verificacao acontece **em lotes, com pausa**, porque
   consultar muitos numeros de uma vez e, para o WhatsApp, um sinal claro de spam.

Rode a validacao sempre que importar contatos novos. Numeros ja verificados nao sao
consultados de novo.

---

## 5. Ler os filtros

Dentro da base, os botoes acima da tabela filtram os contatos:

| Filtro              | Significa                                                                      |
| ------------------- | ------------------------------------------------------------------------------ |
| **Todos**           | Tudo o que existe na base.                                                     |
| **Validos**         | Verificados e com WhatsApp. **Sao os unicos que recebem o disparo.**           |
| **Invalidos**       | Verificados e sem WhatsApp, ou telefone que nao passou na leitura da planilha. |
| **Nao verificados** | Ainda nao passaram pela validacao. Nao recebem nada ate serem validados.       |
| **Descadastrados**  | Pediram para sair. Nunca recebem, mesmo que estejam validos.                   |

O campo de busca ao lado filtra por nome ou telefone dentro do filtro escolhido.

---

## 6. Descadastro (opt-out)

Descadastro e o unico item desta lista que e obrigacao legal, nao boa pratica. Ha dois
caminhos:

- **Automatico**: quando alguem responde exatamente `SAIR`, `PARAR`, `CANCELAR`,
  `DESCADASTRAR`, `STOP` e afins, o app marca o contato como descadastrado sozinho. A regra
  e conservadora de proposito: a mensagem inteira precisa ser a palavra. Quem escreve "vou
  sair mais tarde" continua na base.
- **Manual**: na coluna **Acoes** da tabela de contatos, o botao **Descadastrar** marca o
  contato (e vira **Reativar** para desfazer). Use quando o pedido chega por outro canal —
  telefone, e-mail, WhatsApp de outro numero. O descadastro vale para **todas as bases**,
  nao so para a que esta aberta.

Contato descadastrado e reconferido no momento do envio, entao mesmo uma campanha ja em
andamento respeita quem pediu para sair no meio do caminho.

---

## 7. Exportar

O botao **Exportar CSV**, na barra de filtros, gera um arquivo com os contatos da base no
mesmo formato do modelo, incluindo o status de cada um. Serve para backup, para conferir a
lista fora do app ou para levar a base para outro lugar.

Se a base tem colunas extras, a caixa **Mostrar colunas do CSV** exibe esses campos na
tabela — util para conferir se `[cidade]` e `[empresa]` chegaram preenchidos antes de
usa-los na mensagem.

---

## Problemas comuns

| Sintoma                                       | Causa provavel                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| "O arquivo parece vazio ou nao tem cabecalho" | A primeira linha do CSV precisa ser o cabecalho com os nomes das colunas.                   |
| Acentos aparecem como `JoÃ£o`                 | Planilha salva em outra codificacao. Comece pelo **modelo CSV** do app e preencha por cima. |
| Muitos contatos importados como invalidos     | A coluna mapeada como telefone nao era a coluna do telefone, ou os numeros estao sem DDD.   |
| **Validar no WhatsApp** desabilitado          | WhatsApp desconectado, ou nao ha nenhum contato pendente de verificacao.                    |
| A campanha diz "Nenhum contato elegivel"      | Os contatos estao como **nao verificados**. Rode a validacao.                               |

---

## Proximo passo

Com a base validada, siga para [Seu primeiro disparo](app:/docs/primeiro-disparo).
