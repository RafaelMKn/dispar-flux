# Dispar Flux

O Dispar Flux é uma plataforma de mensageria ativa e relacionamento comercial que pode ser operada pela própria comunidade ou consumida como serviço gerenciado.

## Language

**Edição Comunitária**:
A distribuição aberta e gratuita do Dispar Flux, que qualquer pessoa pode instalar e operar em infraestrutura própria.
_Avoid_: versão grátis, versão local

**Serviço Gerenciado**:
A oferta comercial na qual a operação da infraestrutura do Dispar Flux é realizada como serviço para o cliente.
_Avoid_: versão paga, SaaS

**Plano Compartilhado**:
A modalidade do Serviço Gerenciado em que várias Instalações isoladas utilizam a mesma VPS administrada pelo provedor.
_Avoid_: multi-tenant, banco compartilhado

**Plano Dedicado**:
A modalidade do Serviço Gerenciado em que uma Instalação utiliza infraestrutura exclusiva do cliente.
_Avoid_: Instalação comunitária, VPS compartilhada

**Região de Dados**:
A localização declarada em que os dados ativos e backups de uma Instalação gerenciada devem permanecer, salvo acordo explícito em contrário.
_Avoid_: região do servidor, localização automática

**Instalação**:
Uma execução isolada do Dispar Flux, com dados, arquivos, segredos e processos próprios, que atende exatamente uma Organização.
_Avoid_: tenant, conta

**Organização**:
A empresa ou grupo que possui uma Instalação e compartilha seus contatos, campanhas, conversas e funil.
_Avoid_: workspace, cliente

**Recurso Comercial**:
Uma capacidade empresarial licenciada separadamente da Edição Comunitária.
_Avoid_: recurso premium, trava paga

**Pacote de Migração**:
Um arquivo portátil produzido pelo Aplicativo Legado com os dados e arquivos necessários para transferir a operação para uma Instalação web, sem credenciais de mensageria nem chaves secretas.
_Avoid_: backup, cópia do AppData

**Backup de Recuperação**:
Uma cópia criptografada dos dados, arquivos, configurações e credenciais necessária para restaurar a mesma Instalação após uma perda.
_Avoid_: Pacote de Migração, exportação

**Chave de Recuperação**:
O segredo mantido fora da Instalação que permite abrir seus Backups de Recuperação.
_Avoid_: senha do usuário, chave operacional

**Conector de Mensageria**:
A integração que vincula uma instalação do Dispar Flux a um provedor ou protocolo de mensagens.
_Avoid_: motor do WhatsApp, conexão do chip

**Conexão de Mensageria**:
Um vínculo autenticado entre uma Organização e uma identidade de mensagens por meio de um Conector de Mensageria.
_Avoid_: sessão, chip, instância do WhatsApp

**Proprietário**:
O membro responsável por administrar a Organização, suas Conexões de Mensageria, campanhas, bases e configurações.
_Avoid_: superadmin, dono da conta

**Operador**:
O membro que trabalha nas conversas, no funil e na agenda da Organização sem administrar suas configurações estruturais.
_Avoid_: atendente, SDR

**Dispositivo Autorizado**:
Um navegador reconhecido pela Organização e aprovado para concluir o acesso de um membro após sua autenticação.
_Avoid_: sessão, usuário confiável

**Solicitação de Acesso**:
O pedido criado quando um membro autenticado tenta entrar por um navegador que ainda não é um Dispositivo Autorizado.
_Avoid_: convite, pedido de login

**Convite de Acesso**:
Uma autorização de uso único e validade limitada, criada pelo Proprietário para que uma pessoa se torne membro da Organização com um papel definido.
_Avoid_: cadastro, senha temporária

**Conta de Serviço**:
Uma identidade não humana criada pela Organização para permitir que uma integração use capacidades explicitamente autorizadas.
_Avoid_: usuário de API, chave global

**Fuso Operacional**:
O fuso horário IANA escolhido pela Organização para interpretar agenda, cron, limites diários e janelas de envio.
_Avoid_: fuso do servidor, horário local

**Política de Retenção**:
As regras escolhidas pela Organização que determinam por quanto tempo cada categoria de dado permanece disponível antes de sua eliminação.
_Avoid_: limpeza, expiração geral

**Contato**:
Uma pessoa identificada por telefone normalizado dentro da Organização, independentemente de quantas Bases ou Conexões de Mensageria se relacionem com ela.
_Avoid_: linha da planilha, destinatário

**Base**:
Uma coleção nomeada de Contatos reunida para uma finalidade e procedência declaradas.
_Avoid_: lista de contatos, planilha

**Participação na Base**:
A associação entre um Contato e uma Base, que preserva os campos importados específicos daquela origem.
_Avoid_: Contato duplicado, linha

**Campanha**:
Uma operação de Envio Automatizado cujo público e conteúdo são fixados em um snapshot no início da execução.
_Avoid_: disparo, fila

**Funil**:
Uma sequência ordenada de etapas usada pela Organização para acompanhar o relacionamento comercial com seus Leads.
_Avoid_: Kanban, quadro

**Lead**:
A participação de um Contato em um Funil, única dentro desse Funil e independente da Conexão de Mensageria usada para falar com ele.
_Avoid_: Contato, cartão

**Conversa**:
O histórico de mensagens trocadas entre um Contato e a Organização por meio de uma Conexão de Mensageria específica.
_Avoid_: chat, JID

**Opt-out**:
A manifestação de um Contato que impede Envios Automatizados por qualquer Base ou Conexão de Mensageria da Organização.
_Avoid_: bloqueio, descadastro da lista

**Supressão Pseudonimizada**:
O identificador não exibível preservado após a eliminação de um Contato para impedir que o mesmo telefone volte a receber Envios Automatizados.
_Avoid_: Contato anonimizado, telefone bloqueado

**Reautorização**:
Uma nova manifestação do Contato ou um registro justificado de permissão renovada que encerra seu Opt-out.
_Avoid_: desbloqueio, resposta

**Perfil Canônico**:
Os atributos do Contato editados deliberadamente por um membro, mantidos sem apagar valores provenientes de Bases ou Conectores de Mensageria.
_Avoid_: último valor, perfil do WhatsApp

**Envio Automatizado**:
Uma mensagem produzida por campanha ou follow-up e submetida ao pacing e ao teto diário da Conexão de Mensageria.
_Avoid_: disparo manual, resposta

**Piso de Segurança**:
O conjunto de proteções contra abuso, rajadas e recontato que limita configurações de envio e não pode ser desativado pelo Proprietário.
_Avoid_: configuração padrão, anti-ban

**Resposta Manual**:
Uma mensagem escrita por um Operador durante uma conversa e enviada sem aguardar a fila de Envio Automatizado.
_Avoid_: disparo, campanha individual

**Envio Incerto**:
Um job interrompido sem evidência suficiente para concluir se a mensagem foi aceita pelo provedor, que não pode ser repetido automaticamente.
_Avoid_: falha, pendente

**Registro de Auditoria**:
O registro de quem realizou uma ação relevante, qual ação ocorreu, sobre qual alvo e em que momento.
_Avoid_: log, histórico de mensagens

**Aplicativo Legado**:
A distribuição desktop do Dispar Flux mantida temporariamente para correções críticas e migração para a plataforma web.
_Avoid_: versão atual, app antigo
