# Contribuindo com o Dispar Flux

Agradecemos o interesse em contribuir com o **Dispar Flux (Edição Comunitária)**!

---

## 📜 Developer Certificate of Origin (DCO)

Conforme estabelecido na [ADR 0062](docs/adr/0062-aceitar-contribuicoes-com-dco.md), o Dispar Flux adota o **Developer Certificate of Origin (DCO)** versão 1.1 para aceitar contribuições ao núcleo comunitário.

Ao enviar um commit ou pull request, você certifica que tem o direito de licenciar o código sob os termos da licença **AGPL-3.0-only**.

### Como assinar seus commits

Basta adicionar a flag `-s` (`--signoff`) em cada commit:

```bash
git commit -s -m "feat(domain): adicionar validação de fuso operacional"
```

Isso incluirá automaticamente ao final da mensagem de commit a linha:

```text
Signed-off-by: Seu Nome <seu-email@exemplo.com>
```

---

## 🏛️ Diretrizes de Código e Arquitetura

1. **Linguagem Ubíqua:** Consulte sempre o [`CONTEXT.md`](CONTEXT.md) para garantir que nomes de classes, tabelas, rotas e comentários utilizem os termos canônicos (ex: *Instalação*, *Organização*, *Conector*, *Opt-out*).
2. **Decisões Arquiteturais:** Familiarize-se com as decisões documentadas em [`docs/adr/`](docs/adr/). Mudanças que alterem premissas de arquitetura devem ser acompanhadas de uma proposta de novo ADR.
3. **Isolamento e Segurança:** O núcleo comunitário é estritamente *single-tenant* por Instalação e preserva o *Piso de Segurança* anti-ban.
