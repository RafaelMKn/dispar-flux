# Dispar Flux

App desktop **open-source** para Windows para gestão de campanhas de mensagens no
WhatsApp a partir da sua própria base de contatos. Construído com **Electron + React +
TypeScript**, com o WhatsApp rodando **embutido** no app via
[Baileys](https://github.com/WhiskeySockets/Baileys) (sem servidor externo) e banco
**SQLite** local.

> ⚠️ **Aviso importante — leia antes de usar.** Esta ferramenta usa uma biblioteca
> **não-oficial** do WhatsApp (Baileys). Disparo em massa **viola os Termos de Serviço do
> WhatsApp** e pode levar ao **banimento permanente** do número — a Meta raramente reverte.
> Além disso, enviar mensagens para pessoas que **não deram consentimento (opt-in)** pode
> violar a **LGPD** e caracterizar spam. **O risco é inteiramente seu.** Use número
> dedicado, volume baixo, mensagens personalizadas e sempre ofereça descadastro (opt-out).
> Nenhuma técnica anti-ban elimina o risco.

## Instalação (usuário final)

1. Abra a página de
   [releases](https://github.com/RafaelMKn/dispar-flux/releases/latest).
2. Em **Assets**, baixe o `Dispar-Flux-Setup-<versão>.exe`.
3. Execute o arquivo. A instalação é por usuário, em
   `%LOCALAPPDATA%\Programs\dispar-flux` — **não pede senha de administrador**.

Depois disso o app avisa sozinho quando sair versão nova: aparece uma faixa no topo da
janela com o botão **Baixar agora** e, quando o download termina, **Reiniciar e
instalar**. Nada é baixado sem você mandar, e a instalação fica bloqueada enquanto houver
disparo em andamento. Você também pode conferir manualmente em **Configurações →
Atualizações**. Seus dados (base de contatos, sessão do WhatsApp, configurações) ficam em
`%APPDATA%\dispar-flux` e não são tocados pela atualização.

> ⚠️ **O Windows vai mostrar um aviso azul.** O instalador **não é assinado
> digitalmente** — um certificado de code signing custa centenas de dólares por ano e este
> é um projeto gratuito. Ao abrir o `.exe` você verá _"O Windows protegeu o seu
> computador"_: clique em **Mais informações** → **Executar assim mesmo**. O navegador
> também pode avisar que o arquivo "não é baixado com frequência" — escolha **Manter**.
>
> Se preferir conferir antes de instalar: o código-fonte está todo aqui e o instalador é
> gerado publicamente pelo GitHub Actions (aba **Actions**) a partir da tag
> correspondente — dá para comparar o binário do release com o do run que o produziu.

## Telas

1. **Conversas** — inbox para responder dentro do app: texto, emojis, imagens, vídeos,
   documentos e áudios (inclusive gravar nota de voz), com foto de perfil dos contatos e
   confirmação de leitura sincronizada com o celular.
2. **Disparo** — configura a campanha: base, modo de mensagem (fixa, alternada, alternada
   por parágrafo, IA), intervalos e descanso.
3. **Base de Dados** — cadastra bases de contatos, importa CSV (Fase 1), valida números.
4. **Configurações** — conexão do WhatsApp (QR), provedor/modelo/chave de IA, parâmetros
   padrão de envio e comportamento em segundo plano.
5. **Documentação** — tutoriais de uso e os guias de risco, lidos dentro do próprio app.
   O conteúdo vem dos arquivos em [`docs/`](docs), renderizados com sumário navegável,
   busca e links que levam direto para a tela citada no texto.

## Rodar em segundo plano

O disparo não depende da janela estar aberta. Ao fechar a janela, o app se recolhe para a
bandeja do sistema (ao lado do relógio) e a campanha continua enviando. O ícone mostra o
progresso e traz atalhos para **pausar**, **retomar** e **sair** — sair pelo menu do ícone
é o que encerra o app de verdade.

Você recebe uma notificação do sistema quando a campanha termina, quando ela para por ter
batido o teto diário e quando o WhatsApp desconecta no meio do envio.

Em **Configurações → Rodar em segundo plano** dá para desligar isso (aí o X encerra o app,
interrompendo o disparo) e para ligar o **início junto com o sistema**, que sobe o app
minimizado na bandeja.

## Stack

- **Electron** (shell) + **electron-vite** (build)
- **React + TypeScript + Tailwind** (renderer), com o design system em tokens CSS
  (`src/renderer/src/index.css`) e tema **claro/escuro** — ver [docs/design-prompt.md](docs/design-prompt.md)
- **Baileys** (`baileys`) para o WhatsApp — Fase 1
- **SQLite** via **sql.js** (WASM, sem build nativo) + **drizzle-orm** (dados locais)
- **safeStorage** (DPAPI) para segredos criptografados
- **electron-builder** (instalador NSIS para Windows) + **electron-updater**
  (atualização automática via GitHub Releases)

## Desenvolvimento

```bash
npm install
npm run dev
```

> O SQLite roda via **sql.js** (WebAssembly), então **não há compilação nativa** — não é
> preciso Visual Studio nem `electron-rebuild`.

Outros comandos:

```bash
npm run typecheck   # checagem de tipos (main + renderer)
npm run test        # testes unitarios (vitest)
npm run dist        # gera instalador NSIS em dist/ (nao publica nada)
```

> A atualização automática fica **desativada em desenvolvimento** (não existe
> `app-update.yml` fora do app instalado). Para testá-la de verdade é preciso instalar uma
> versão e publicar uma mais nova.

## Publicando uma versão

```bash
npm version patch -m "Release v%s"   # bump + commit + tag v0.1.2
git push --follow-tags               # a tag dispara .github/workflows/release.yml
```

O workflow roda em `windows-latest`, confere que a tag bate com a `version` do
`package.json`, roda typecheck/lint/testes e publica no GitHub Releases três arquivos: o
instalador, o `.blockmap` (download diferencial) e o **`latest.yml`** — o manifesto que o
`electron-updater` lê no PC do usuário para comparar versões e validar o `sha512` do
download.

> **O release precisa deixar de ser rascunho.** O electron-builder cria o release como
> _draft_, e draft não aparece na API pública: o updater dos usuários recebe 404 e
> ninguém atualiza. Confira os três assets e clique em **Publish release** (ou
> `gh release edit v0.1.2 --draft=false`). Para publicar direto nos próximos, adicione
> `releaseType: release` ao bloco `publish` do `electron-builder.yml`.

## Roadmap

- **Fase 0 — Fundação** ✅ scaffold, IPC, SQLite, safeStorage, shell das 4 telas.
- **Fase 1 — MVP** conexão por QR, import CSV, motor de mensagens (fixa/rotação/spintax),
  motor de disparo com pacing/anti-ban, tela de config completa.
- **Fase 2 — Inbox** ✅ conversas em tempo real, opt-out automático ("SAIR"), mídia
  (imagem/vídeo/documento/áudio), nota de voz, foto de perfil e sincronização de
  histórico e de leitura.
- **Fase 3 — Extras** modo IA com pré-geração, métricas, code signing.

## Licença

[MIT](LICENSE). Software fornecido "como está", sem garantias. Você é o único responsável
pelo uso em conformidade com os Termos do WhatsApp e a legislação aplicável (LGPD etc.).
