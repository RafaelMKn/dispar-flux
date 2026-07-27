# Prompt de Design — Dispar Flux

> Cole o conteúdo abaixo (da linha `---` em diante) em uma conversa nova com o Claude
> para gerar o design system e as telas do app.

---

# Briefing de Design — Dispar Flux

Você é um designer de produto sênior especializado em apps desktop. Preciso do **design system completo e das 4 telas** de um app que já existe em código. Entregue decisões concretas e implementáveis, não conceitos vagos.

## 1. O produto

**Dispar Flux** — app desktop **open-source para Windows** (Electron + React + TypeScript + Tailwind) para gestão de campanhas de mensagens no WhatsApp a partir da base de contatos própria do usuário.

- **Usuário**: pessoa de vendas/marketing de PME brasileira. Não é técnica. Usa o app por horas, em telas de 1366×768 até 2560×1440.
- **Trabalho principal**: importar uma base de contatos → configurar uma campanha → disparar com ritmo seguro → responder quem retornar.
- **Tom**: ferramenta de trabalho séria e calma. Precisa transmitir **controle e confiança**, porque o usuário está operando algo com risco real (banimento de número, LGPD). Nada de "growth hacking agressivo".
- **Idioma da interface**: **português do Brasil**. Escreva todos os textos em pt-BR real — sem lorem ipsum, sem inglês.

## 2. Direção visual

Estética do **app do Claude no macOS**: minimalismo quente, muito espaço em branco, hierarquia por tipografia e espaçamento (não por caixas e bordas grossas), cromo de interface quase invisível, foco total no conteúdo.

Paleta: **laranja quente + preto**. Ponto crítico de execução:

- O **fundo deve ler como laranja quente**, usando uma rampa de tons pêssego/creme/terracota — **não** um laranja saturado chapado atrás de texto corrido (isso cansa a vista e quebra contraste).
- O **laranja saturado** é reservado para acento: ações primárias, estados ativos, foco, dados destacados.
- **Preto quente (near-black)** para texto e para as superfícies do modo escuro.
- Entregue **modo claro (padrão) e modo escuro**, ambos completos.

Ponto de partida de paleta (ajuste se justificar, mas mantenha a temperatura quente):

**Claro**
```
--surface-base     #FBEFE5   /* fundo do app — pêssego quente */
--surface-raised   #FFF9F4   /* cards, campos */
--surface-sunken   #F5E2D3   /* sidebar, áreas encaixadas */
--border           #E8D1BE
--border-subtle    #EFDFD1
--accent           #D97757   /* terracota — ação primária */
--accent-hover     #C4633F
--accent-strong    #B54F2C
--ink              #1A1614   /* texto primário — preto quente */
--ink-secondary    #6B5D54
--ink-tertiary     #9A8B80
--success          #4F7A52
--warning          #B8862B
--danger           #A8322A   /* crimson, NÃO laranja */
```

**Escuro**
```
--surface-base     #14100E
--surface-raised   #1E1917
--surface-sunken   #0E0B0A
--border           #2E2724
--accent           #E08A67   /* laranja elevado p/ contraste no escuro */
--ink              #F5EFE9
--ink-secondary    #B5A79D
```

Entregue os tokens como **CSS custom properties** + o trecho de `theme.extend` para `tailwind.config.js`.

## 3. Fundamentos

- **Tipografia**: stack de sistema (`Segoe UI Variable`, `Segoe UI`, system-ui) — é um app Windows. Escala: 12 / 13 / 14 / 16 / 20 / 24 / 32. Pesos apenas 400 / 500 / 600. Line-height 1.5 corpo, 1.2 títulos. **Numerais tabulares** em métricas, contadores e tabelas. Opcional: uma serif apenas em títulos de empty state.
- **Espaçamento**: grid base 4px. Use 4 / 8 / 12 / 16 / 24 / 32 / 48. Seja generoso — respiro é a assinatura dessa estética.
- **Raio**: 6px (botões, inputs), 10px (cards), 14px (modais), 999px (pills/badges). Moderadamente arredondado, não tudo em cápsula.
- **Elevação**: hierarquia por **borda de 1px + tom de superfície**, não por sombra. Sombra no máximo `0 1px 2px rgba(26,22,20,.06)`. Só modais e toasts podem ter sombra flutuante real.
- **Movimento**: 120–180ms, ease-out. Sutil. Respeite `prefers-reduced-motion`.
- **Ícones**: lucide-react, traço 1.5–2px, tamanhos 16/18/20.

## 4. Layout e responsividade

O app é uma janela redimensionável (hoje mínimo 940×640; projete resistindo até **720px de largura** para podermos baixar esse mínimo).

- **Sidebar** de navegação: 240px fixa, com as 4 seções. Abaixo de ~900px, colapsa para trilha de ícones de 64px (com tooltip).
- **Conteúdo**: formulários e configurações com largura máxima ~1120px e centralizados; chat e tabelas ocupam a largura toda.
- Breakpoints: `<900px` sidebar em trilha + grids de 2 colunas viram 1; `<1100px` o chat vira painel único com navegação de volta; `≥1400px` trava a largura máxima e aumenta as calhas.
- Nenhuma tela pode gerar scroll horizontal. Tabelas largas rolam dentro do próprio container.

## 5. As 4 telas (especifique cada uma)

### 5.1 Disparo — *tela mais importante*
Fluxo em seções verticais numeradas, tudo em uma página (sem wizard modal):
1. **Base de destino** — seletor com nome da base e contagem de contatos válidos.
2. **Modo de mensagem** — 4 *radio-cards* selecionáveis, com ícone e uma linha de explicação:
   - **Fixa** — texto único com variáveis
   - **Alternada** — várias mensagens completas em rodízio
   - **Alternada por parágrafo** — sorteia 1 variação de cada parágrafo
   - **IA** — a IA escreve conforme o prompt do usuário
3. **Conteúdo** — o editor muda conforme o modo:
   - *Fixa*: textarea + **chips de variável** clicáveis (`[nome]`, e campos extras do CSV)
   - *Alternada*: lista de blocos de mensagem, adicionar/remover/reordenar
   - *Alternada por parágrafo*: 3 grupos (P1, P2, P3), cada um com N variações, e um **contador de combinações** em destaque: "3 × 3 × 3 = 27 mensagens únicas"
   - *IA*: campo de prompt + badge do modelo ativo + botão "gerar amostra"
4. **Ritmo (anti-ban)** — intervalo mín/máx entre mensagens, descanso a cada N envios, duração do descanso, teto diário. **Crucial**: mostre um resumo em linguagem natural, tipo "≈120 msgs/h · pausa de 5 min a cada 40 envios · máx. 300/dia".
5. **Revisar e disparar** — painel de **preview** com mensagens já renderizadas (navegável entre amostras) e o botão de disparo.

**Estado em execução**: barra de progresso, contadores (enviado / falhou / pulado / restante), log ao vivo por contato, e controles pausar / retomar / cancelar. Desenhe também os estados **pausado** e **concluído**.

Inclua um **aviso de risco** (Termos do WhatsApp + LGPD) presente e legível, mas discreto — um callout, não um alarme vermelho.

### 5.2 Base de Dados
- Lista de bases (cards ou tabela): nome, total de contatos, válidos/inválidos, opt-outs, data de criação.
- Criar base; renomear; excluir (com confirmação).
- **Importação de CSV** em modal de 3 passos: (1) soltar/selecionar arquivo, (2) **mapear colunas** com selects + tabela de preview das primeiras linhas, (3) resumo antes de confirmar (quantos válidos, duplicados, telefones inválidos).
- Tabela de contatos: busca, filtros (válido / inválido / opt-out), paginação, toggle de opt-out por linha.
- Ação "validar no WhatsApp" com progresso.

### 5.3 Configurações
Seções em cards:
- **Conexão WhatsApp** — área emoldurada para o **QR Code** + pill de status (desconectado / pareando / conectado) + botão desconectar.
- **Inteligência Artificial** — select de empresa → select de modelo (dependente) → campo de chave de API mascarado, com estado "chave salva" e botão testar.
- **Envio** — os parâmetros padrão de ritmo (mesmos controles da tela de Disparo).
- **Sobre / Aviso legal**.

### 5.4 Conversas (inbox)
- Painel de lista: busca + itens com avatar, nome, trecho da última mensagem, horário, badge de não lidas.
- Thread: bolhas (recebida = superfície elevada; enviada = tom de acento), divisores de data, indicador de status de envio.
- Compositor: textarea que cresce + botão enviar.
- Empty state ("selecione uma conversa").

## 6. Biblioteca de componentes

Especifique com todos os estados (default / hover / active / focus / disabled / loading / erro):
botão (primário, secundário, ghost, perigo), input, select, textarea, toggle, checkbox, radio-card, badge/pill, status dot, barra de progresso, tabela, modal, toast, tooltip, empty state, callout/banner, tabs, item de navegação, avatar, skeleton.

## 7. Acessibilidade — requisito, não opcional

- WCAG **AA**: texto normal ≥ 4.5:1, texto grande e elementos de UI ≥ 3:1.
- **Atenção ao laranja**: `#D97757` sobre fundo creme dá ~3:1 — **reprova para texto pequeno**. Portanto: (a) laranja de acento serve para preenchimentos, bordas e texto grande; (b) para texto pequeno "laranja" use um tom escurecido (~`#A8451F`); (c) no botão primário, escolha e **valide** uma das opções: texto near-black sobre laranja, ou fill escurecido (`#B54F2C`) com texto branco. Declare os ratios calculados.
- Foco sempre visível (anel de 2px com offset), navegação completa por teclado.
- Status (enviado / falhou / pulado) **nunca só por cor** — combine com ícone ou forma.

## 8. Não faça

- Glassmorphism, blur, gradientes chamativos, neon, sombras pesadas.
- Laranja saturado chapado atrás de texto corrido.
- **Verde WhatsApp** (`#25D366`) — o app não deve se passar pela marca; o design atual usa esse verde e ele deve sair.
- Roxo/azul como clichê de "IA".
- Emoji no lugar de ícone.
- Densidade de dashboard corporativo: sem grades de cards apertadas, sem bordas duplas, sem tabelas zebradas.

## 9. Entregáveis

1. **Tokens**: CSS custom properties (claro + escuro) e o `theme.extend` do Tailwind.
2. **Fundamentos**: tipografia, espaçamento, raio, elevação, movimento — como regras aplicáveis.
3. **Componentes**: especificação com estados e as classes Tailwind correspondentes.
4. **As 4 telas** em **claro e escuro**, nas larguras **1440px, 1100px e 820px**.
5. **Estados por tela**: vazio, carregando, erro, sucesso e (no Disparo) em execução/pausado.
6. Um parágrafo curto de racional por decisão não óbvia, e a **tabela de ratios de contraste** validando o item 7.

Prefiro receber isso como **HTML+Tailwind autocontido e navegável** (um arquivo, com alternador de tema claro/escuro e as telas navegáveis), para eu conseguir avaliar em tamanho real e portar direto para os componentes React.
