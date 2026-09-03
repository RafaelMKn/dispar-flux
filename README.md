# Dispar Flux

Plataforma web *self-hosted* de mensageria ativa e relacionamento comercial (Edição Comunitária).

O Dispar Flux foi projetado para equipes que necessitam de soberania sobre sua base de contatos, histórico de conversas, campanhas de prospecção e funil de vendas, operando em infraestrutura própria ou como serviço gerenciado.

---

## 🏛️ Arquitetura e Princípios

- **Edição Comunitária (AGPLv3):** Núcleo aberto e completo para operação autônoma em servidor próprio.
- **Isolamento Estrito por Instalação:** Modelo *single-tenant* por Instalação. Cada Instalação atende exclusivamente uma Organização, com banco SQLite nativo (WAL), chaves criptográficas e armazenamento isolados.
- **Monólito Modular:** Estruturado em pacotes coesos (`domain`, `application`, `contracts`, `database`, `connector-baileys`, `storage-local`) sob processos unificados de API e Worker.
- **Conectores de Mensageria:** Suporte a conexões de WhatsApp via conector Baileys, com gerenciamento seguro de sessões e reconexão resiliente.
- **Piso de Segurança:** Proteções nativas contra banimentos, pacing adaptativo, teto diário de envios e respeito irrestrito a *opt-out* em toda a Organização.
- **CRM e Inbox Integrados:** Inbox multi-operador em tempo real (WebSocket), gestão de Leads em funis comerciais e automação de follow-up.

---

## 📚 Governança e Documentação

Toda a evolução do Dispar Flux é orientada por decisões registradas e vocabulário canônico:

- **Linguagem Ubíqua:** [`CONTEXT.md`](CONTEXT.md) define os termos oficiais (Instalação, Organização, Conector, Lead, etc.). Termos proibidos e sinônimos ambíguos estão documentados para preservar consistência técnica e de produto.
- **Plano Mestre da Plataforma Web:** [`docs/plano-mestre-self-hosted-web.md`](docs/plano-mestre-self-hosted-web.md) detalha a fundação arquitetural da versão web.
- **Fases Restantes (Paridade 100% com Desktop):** [`docs/plano-fases-restantes-paridade-100-web.md`](docs/plano-fases-restantes-paridade-100-web.md) estabelece o roteiro de execução (Fases 10 a 18) para atingir 100% de paridade com todas as telas e recursos do app desktop no navegador.
- **Arquitetura Self-Hosted e Modelo:** [`docs/arquitetura-self-hosted-e-monetizacao.md`](docs/arquitetura-self-hosted-e-monetizacao.md) descreve a separação entre a Edição Comunitária e Recursos Comerciais.
- **Decisões de Arquitetura (ADRs):** [`docs/adr/`](docs/adr/) reúne os 63 registros de decisão arquitetural (ADR 0001 a ADR 0063).
- **Design System:** [`docs/design-prompt.md`](docs/design-prompt.md) detalha diretrizes visuais e tokens de interface.

---

## 📦 Aplicativo Legado (Desktop)

O histórico completo e os releases estáveis da versão desktop em Electron foram preservados e estão disponíveis no repositório dedicado:

👉 **[RafaelMKn/dispar-flux-desktop](https://github.com/RafaelMKn/dispar-flux-desktop)**

O repositório desktop permanece arquivado para manutenções críticas e suporte à exportação do Pacote de Migração (conforme [ADR 0055](docs/adr/0055-novo-repositorio-para-a-plataforma-web.md) e [ADR 0057](docs/adr/0057-preservar-o-nome-no-novo-repositorio.md)).

---

## 🤝 Contribuições

Contribuições para o núcleo comunitário são bem-vindas. O projeto adota o **Developer Certificate of Origin (DCO)**. Veja instruções em [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## 📄 Licença

Distribuído sob os termos da **GNU Affero General Public License v3** ([AGPL-3.0-only](LICENSE)).
