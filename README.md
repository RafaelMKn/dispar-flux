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

## Telas

1. **Conversas** (Fase 2) — inbox para responder dentro do app.
2. **Disparo** — configura a campanha: base, modo de mensagem (fixa, alternada, alternada
   por parágrafo, IA), intervalos e descanso.
3. **Base de Dados** — cadastra bases de contatos, importa CSV (Fase 1), valida números.
4. **Configurações** — conexão do WhatsApp (QR), provedor/modelo/chave de IA e parâmetros
   padrão de envio.

## Stack

- **Electron** (shell) + **electron-vite** (build)
- **React + TypeScript + Tailwind** (renderer), com o design system em tokens CSS
  (`src/renderer/src/index.css`) e tema **claro/escuro** — ver [docs/design-prompt.md](docs/design-prompt.md)
- **Baileys** (`@whiskeysockets/baileys`) para o WhatsApp — Fase 1
- **SQLite** via **sql.js** (WASM, sem build nativo) + **drizzle-orm** (dados locais)
- **safeStorage** (DPAPI) para segredos criptografados
- **electron-builder** (instalador NSIS para Windows)

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
npm run dist        # gera instalador NSIS em dist/
```

## Roadmap

- **Fase 0 — Fundação** ✅ scaffold, IPC, SQLite, safeStorage, shell das 4 telas.
- **Fase 1 — MVP** conexão por QR, import CSV, motor de mensagens (fixa/rotação/spintax),
  motor de disparo com pacing/anti-ban, tela de config completa.
- **Fase 2 — Inbox** conversas em tempo real, opt-out automático ("SAIR").
- **Fase 3 — Extras** modo IA com pré-geração, mídia, métricas, code signing.

## Licença

[MIT](LICENSE). Software fornecido "como está", sem garantias. Você é o único responsável
pelo uso em conformidade com os Termos do WhatsApp e a legislação aplicável (LGPD etc.).
