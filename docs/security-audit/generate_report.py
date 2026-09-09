import os
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

# Paleta oficial do relatório
PALETTE = {
    'critica': colors.HexColor('#B91C1C'),
    'alta': colors.HexColor('#EA580C'),
    'media': colors.HexColor('#D97706'),
    'baixa': colors.HexColor('#2563EB'),
    'ponto_forte': colors.HexColor('#059669'),
    'bg_light': colors.HexColor('#F8FAFC'),
    'card_bg': colors.HexColor('#F1F5F9'),
    'border': colors.HexColor('#CBD5E1'),
    'text_primary': colors.HexColor('#0F172A'),
    'text_secondary': colors.HexColor('#334155'),
    'text_muted': colors.HexColor('#64748B'),
    'primary_dark': colors.HexColor('#0F172A'),
    'accent': colors.HexColor('#0284C7'),
}

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        if self._pageNumber == 1:
            # Capa não recebe cabeçalho nem rodapé
            return

        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(PALETTE['text_muted'])

        # Cabeçalho
        self.drawString(2 * cm, A4[1] - 1.4 * cm, "Relatório de Auditoria de Segurança — Dispar Flux")
        self.drawRightString(A4[0] - 2 * cm, A4[1] - 1.4 * cm, "Edição Comunitária Web 1.0")
        self.setStrokeColor(PALETTE['border'])
        self.setLineWidth(0.5)
        self.line(2 * cm, A4[1] - 1.55 * cm, A4[0] - 2 * cm, A4[1] - 1.55 * cm)

        # Rodapé
        self.line(2 * cm, 1.55 * cm, A4[0] - 2 * cm, 1.55 * cm)
        self.drawString(2 * cm, 1.1 * cm, "Confidencial • Auditoria de Código-Fonte")
        page_str = f"Página {self._pageNumber} de {page_count}"
        self.drawRightString(A4[0] - 2 * cm, 1.1 * cm, page_str)
        self.restoreState()

def generate_charts(output_dir):
    os.makedirs(output_dir, exist_ok=True)
    
    # 1. Gráfico de Rosca por Severidade
    sev_labels = ['Crítica', 'Alta', 'Média', 'Baixa']
    sev_counts = [2, 3, 7, 1]
    sev_colors = ['#B91C1C', '#EA580C', '#D97706', '#2563EB']
    
    fig, ax = plt.subplots(figsize=(4.0, 2.7), subplot_kw=dict(aspect="equal"))
    wedges, texts, autotexts = ax.pie(
        sev_counts, 
        labels=None, 
        autopct=lambda pct: f"{int(round(pct*sum(sev_counts)/100))}" if pct > 0 else '',
        startangle=140,
        colors=sev_colors,
        pctdistance=0.75,
        wedgeprops=dict(width=0.45, edgecolor='white', linewidth=2)
    )
    for at in autotexts:
        at.set_color('white')
        at.set_weight('bold')
        at.set_fontsize(10)
    
    ax.legend(
        wedges, [f"{l}: {c}" for l, c in zip(sev_labels, sev_counts)],
        title="Severidade",
        loc="center left",
        bbox_to_anchor=(0.88, 0.5),
        frameon=False,
        fontsize=8.5,
        title_fontsize=9.5
    )
    plt.tight_layout()
    donut_path = os.path.join(output_dir, 'chart_donut_severity.png')
    plt.savefig(donut_path, dpi=240, bbox_inches='tight', transparent=True)
    plt.close()

    # 2. Gráfico de Barras por Categoria
    cat_names = [
        '1. Banco sem Tranca\n(Isolamento)',
        '2. Permissão no\nNavegador (RBAC)',
        '3. IDOR\n(Parâmetros)',
        '4. Chaves Expostas\n(Hardcode)',
        '5. Inputs sem\nTratamento (CSV Inj.)'
    ]
    cat_counts = [4, 3, 5, 3, 1]
    cat_colors = ['#EA580C', '#B91C1C', '#D97706', '#EA580C', '#D97706']

    fig, ax = plt.subplots(figsize=(5.2, 2.7))
    bars = ax.barh(cat_names[::-1], cat_counts[::-1], color=cat_colors[::-1], height=0.55, edgecolor='none')
    ax.set_xlim(0, max(cat_counts) + 1.5)
    ax.spines['top'].set_visible(False)
    ax.spines['right'].set_visible(False)
    ax.spines['bottom'].set_visible(False)
    ax.spines['left'].set_color('#CBD5E1')
    ax.xaxis.set_visible(False)
    ax.tick_params(axis='y', labelsize=7.5, length=0)
    
    for bar in bars:
        w = bar.get_width()
        ax.text(w + 0.15, bar.get_y() + bar.get_height()/2, f'{int(w)}', 
                va='center', ha='left', fontsize=8.5, fontweight='bold', color='#0F172A')

    plt.tight_layout()
    bar_path = os.path.join(output_dir, 'chart_bar_category.png')
    plt.savefig(bar_path, dpi=240, bbox_inches='tight', transparent=True)
    plt.close()

    return donut_path, bar_path

def build_pdf(filename="docs/security-audit/relatorio-auditoria-seguranca.pdf"):
    out_dir = os.path.dirname(os.path.abspath(filename))
    donut_path, bar_path = generate_charts(out_dir)

    doc = SimpleDocTemplate(
        filename,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm
    )

    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'CoverTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=23,
        leading=28,
        textColor=PALETTE['primary_dark']
    )
    subtitle_style = ParagraphStyle(
        'CoverSubtitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=11,
        leading=15,
        textColor=PALETTE['text_secondary']
    )
    h1_style = ParagraphStyle(
        'H1',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=18,
        textColor=PALETTE['primary_dark'],
        spaceAfter=6,
        keepWithNext=True
    )
    h2_style = ParagraphStyle(
        'H2',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=14,
        textColor=PALETTE['accent'],
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )
    body_style = ParagraphStyle(
        'Body',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=PALETTE['text_primary'],
        spaceAfter=5
    )
    body_bold = ParagraphStyle(
        'BodyBold',
        parent=body_style,
        fontName='Helvetica-Bold'
    )
    meta_style = ParagraphStyle(
        'Meta',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=11,
        textColor=PALETTE['text_muted']
    )
    issue_code_style = ParagraphStyle(
        'IssueMarkdown',
        parent=styles['Normal'],
        fontName='Courier',
        fontSize=7,
        leading=9.2,
        textColor=colors.HexColor('#0F172A'),
        backColor=PALETTE['bg_light'],
        borderPadding=6
    )

    badge_critica = ParagraphStyle('BadgeCrit', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=1)
    badge_alta = ParagraphStyle('BadgeAlta', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=1)
    badge_media = ParagraphStyle('BadgeMed', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=1)
    badge_baixa = ParagraphStyle('BadgeBaixa', fontName='Helvetica-Bold', fontSize=8, textColor=colors.white, alignment=1)

    story = []

    # =========================================================================
    # CAPA
    # =========================================================================
    story.append(Spacer(1, 0.8 * cm))
    tag_data = [[
        Paragraph("<font color='#0284C7'><b>AUDITORIA TÉCNICA DE SEGURANÇA DA INFORMAÇÃO • CÓDIGO-FONTE</b></font>", meta_style)
    ]]
    t_tag = Table(tag_data, colWidths=[17 * cm])
    t_tag.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), PALETTE['bg_light']),
        ('PADDING', (0,0), (-1,-1), 4),
        ('LINEBELOW', (0,0), (-1,-1), 1.5, PALETTE['accent']),
    ]))
    story.append(t_tag)
    story.append(Spacer(1, 0.6 * cm))

    story.append(Paragraph("Relatório de Auditoria de Segurança", title_style))
    story.append(Paragraph("<font color='#0284C7'><b>Dispar Flux</b> — Edição Comunitária Web 1.0</font>", title_style))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph("Avaliação Estrita de Código-Fonte, Controle de Acesso, Isolamento de Dados e Superfície de Ataque", subtitle_style))
    story.append(Spacer(1, 0.8 * cm))

    # Tabela com Metadados da Auditoria
    meta_table_data = [
        [Paragraph("<b>Data da Auditoria:</b>", body_style), Paragraph("08 de Setembro de 2026", body_style)],
        [Paragraph("<b>Escopo Auditado:</b>", body_style), Paragraph("Repositório completo: <code>apps/server</code>, <code>apps/web</code>, <code>packages/*</code>, <code>deploy/*</code>", body_style)],
        [Paragraph("<b>Versão Auditada:</b>", body_style), Paragraph("Dispar Flux v0.0.1 (Commit <code>3c1f2a6</code> / Paridade 100% Web 1.0)", body_style)],
        [Paragraph("<b>Classificação:</b>", body_style), Paragraph("Documento Técnico de Segurança / Uso Restrito", body_style)],
        [Paragraph("<b>Metodologia:</b>", body_style), Paragraph("Auditoria estática profunda (White-box Source Code Audit), mapeamento sistemático de rotas e verificação cruzada UI vs API.", body_style)],
    ]
    t_meta = Table(meta_table_data, colWidths=[3.8 * cm, 13.2 * cm])
    t_meta.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), PALETTE['bg_light']),
        ('BOX', (0,0), (-1,-1), 0.5, PALETTE['border']),
        ('INNERGRID', (0,0), (-1,-1), 0.5, PALETTE['border']),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('PADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 0.6 * cm))

    # Nota Metodológica
    story.append(Paragraph("Nota Metodológica e Mapeamento da Stack", h2_style))
    stack_desc = """
    Antes de iniciar a revisão, a stack do projeto foi integralmente identificada para mapear os vetores de teste:
    <br/><br/>
    • <b>Linguagem & Runtime:</b> TypeScript / JavaScript executado no Node.js 22 LTS.<br/>
    • <b>Framework Backend:</b> Servidor modular nativo em <code>node:http</code> e <code>ws</code> (WebSocket).<br/>
    • <b>Banco de Dados & ORM:</b> SQLite nativo via <code>node:sqlite</code> (DatabaseSync) em modo WAL, com queries SQL puras e transações explícitas.<br/>
    • <b>Mecanismo de Auth/RBAC:</b> Sessões autenticadas por SHA-256 tokens em cookies/Bearer, onboarding por <code>claim.token</code>, autorização de dispositivos (<code>authorized_devices</code>) e matriz de papéis (<code>owner</code> vs <code>operator</code>) definida em <code>packages/auth/src/rbac</code>.<br/>
    • <b>Frontend:</b> Single Page Application (SPA) em React 18, Vite 6, Tailwind CSS 3.4 e React Router DOM 7.<br/>
    • <b>Infraestrutura & Deploy:</b> Dockerfile multi-stage, Docker Compose com Caddy (TLS/HTTPS reverso e rede isolada) e script <code>install.sh</code> com permissões 0700/0600.<br/><br/>
    <b>Adaptação das 5 Categorias para a Stack Detectada:</b><br/>
    1. <i>Banco sem Tranca:</i> No SQLite nativo, a ausência de RLS exige filtros manuais estritos de <code>organization_id</code> em todas as consultas SQL de listagem, agregação e busca.<br/>
    2. <i>Permissão no Navegador:</i> Cruzamento entre os botões e páginas condicionadas por <code>currentMember.role === 'owner'</code> na SPA React e a validação do token/role nos endpoints do <code>server.ts</code> e <code>api-router.ts</code>.<br/>
    3. <i>IDOR:</i> Checagem exaustiva de cada handler de rota com parâmetros de path/body (<code>baseId</code>, <code>leadId</code>, <code>campaignId</code>, <code>appointmentId</code>) sem validação da titularidade da organização.<br/>
    4. <i>Chaves Expostas:</i> Busca de fallbacks em texto plano (ex: <code>flux_default_recovery_key_...</code>), validações ausentes de startup e variáveis de ambiente fracas no Compose.<br/>
    5. <i>Inputs sem Tratamento:</i> Avaliação de XSS no React (verificação de ausência de <code>dangerouslySetInnerHTML</code> e URLs <code>javascript:</code>) e injeção de fórmulas CSV (Formula Injection) na exportação de contatos.
    """
    story.append(Paragraph(stack_desc, body_style))

    story.append(PageBreak())

    # =========================================================================
    # RESUMO EXECUTIVO
    # =========================================================================
    story.append(Paragraph("1. Resumo Executivo", h1_style))
    story.append(Paragraph(
        "A auditoria de segurança identificou um total de <b>13 achados acionáveis</b>, variando de severidade Baixa a Crítica. "
        "O núcleo do Dispar Flux exibe excelentes práticas de engenharia em criptografia de dados em repouso (AES-256-GCM com PBKDF2), "
        "hashing de senhas (Argon2id/Scrypt), cabeçalhos defensivos (CSP estrita) e sanitização automática de PII em logs de telemetria. "
        "No entanto, existem <b>vulnerabilidades estruturais críticas</b> no controle de acesso e autorização que comprometem a segurança da instalação.",
        body_style
    ))
    story.append(Spacer(1, 0.3 * cm))

    # Tabela Resumo de Severidade
    summary_counts_data = [
        [
            Paragraph("<font color='#B91C1C'><b>CRÍTICA</b></font>", body_bold),
            Paragraph("<font color='#EA580C'><b>ALTA</b></font>", body_bold),
            Paragraph("<font color='#D97706'><b>MÉDIA</b></font>", body_bold),
            Paragraph("<font color='#2563EB'><b>BAIXA</b></font>", body_bold),
            Paragraph("<font color='#059669'><b>PONTOS FORTES</b></font>", body_bold),
        ],
        [
            Paragraph("<font size=13 color='#B91C1C'><b>2</b></font>", badge_critica),
            Paragraph("<font size=13 color='#EA580C'><b>3</b></font>", badge_alta),
            Paragraph("<font size=13 color='#D97706'><b>7</b></font>", badge_media),
            Paragraph("<font size=13 color='#2563EB'><b>1</b></font>", badge_baixa),
            Paragraph("<font size=13 color='#059669'><b>7</b></font>", ParagraphStyle('PFCnt', fontName='Helvetica-Bold', fontSize=13, alignment=1, textColor=PALETTE['ponto_forte'])),
        ]
    ]
    t_sum_cards = Table(summary_counts_data, colWidths=[3.4 * cm] * 5)
    t_sum_cards.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), PALETTE['card_bg']),
        ('BOX', (0,0), (-1,-1), 1, PALETTE['border']),
        ('INNERGRID', (0,0), (-1,-1), 0.5, PALETTE['border']),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('PADDING', (0,0), (-1,-1), 5),
    ]))
    story.append(t_sum_cards)
    story.append(Spacer(1, 0.4 * cm))

    # Gráficos lado a lado
    charts_table_data = [
        [
            Paragraph("<b>Distribuição por Severidade</b>", h2_style),
            Paragraph("<b>Achados por Categoria Auditada</b>", h2_style)
        ],
        [
            Image(donut_path, width=7.2 * cm, height=4.8 * cm),
            Image(bar_path, width=9.5 * cm, height=4.8 * cm)
        ]
    ]
    t_charts = Table(charts_table_data, colWidths=[7.5 * cm, 9.5 * cm])
    t_charts.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('PADDING', (0,0), (-1,-1), 0),
    ]))
    story.append(t_charts)
    story.append(Spacer(1, 0.3 * cm))

    story.append(PageBreak())

    # =========================================================================
    # PONTOS FORTES E PONTOS FRACOS
    # =========================================================================
    story.append(Paragraph("2. Pontos Fortes e Pontos Fracos da Aplicação", h1_style))
    story.append(Paragraph("Comprovação de cobertura de código e análise comparativa de postura defensiva:", body_style))
    story.append(Spacer(1, 0.2 * cm))

    pf_data = [
        [
            Paragraph("<font color='#059669'><b>✓ PONTOS FORTES DETECTADOS (COMPROVADOS NO CÓDIGO)</b></font>", body_bold),
        ],
        [
            Paragraph(
                "<b>1. Sanitização Avançada de Logs e PII:</b> Implementação em <code>packages/security/src/pii-sanitizer.ts</code> com ofuscação por Regex de telefones (+55 11 9...), E.164, e-mails, tokens, senhas e corpos de mensagens antes da gravação de logs (ADR 0050).<br/>"
                "<b>2. Content Security Policy (CSP) Rigorosa:</b> Configurada em <code>packages/security/src/headers.ts</code> com <code>script-src 'self'</code>, <code>frame-ancestors 'none'</code>, eliminando execução de scripts inline não autorizados.<br/>"
                "<b>3. Ausência de XSS no Frontend:</b> A SPA React utiliza interpolação segura de JSX. O renderizador <code>react-markdown</code> aplica <code>urlTransform</code> seguro derivado de <code>defaultUrlTransform</code>, bloqueando URLs <code>javascript:</code> e <code>data:</code>.<br/>"
                "<b>4. Criptografia Robusta em Backups:</b> O módulo <code>packages/migration/src/backup.ts</code> utiliza AES-256-GCM com chave derivada via PBKDF2 (100.000 iterações) e salt criptográfico seguro de 16 bytes.<br/>"
                "<b>5. Piso de Segurança Inviolável (Safety Floor):</b> Garantido em <code>packages/campaigns</code> e <code>apps/server/src/server.ts</code>, rejeitando campanhas com intervalo inferior a 15s ou teto diário superior a 500 mensagens.<br/>"
                "<b>6. Proteção contra Crash em Envios Incertos:</b> Implementação do ADR 0028 em <code>recoverInFlightJobs()</code>, transicionando disparos interrompidos para status <code>unknown</code> e impedindo disparos duplicados após reboot.<br/>"
                "<b>7. Hardening de Infraestrutura:</b> Docker Compose com Caddy e aplicação rodando em rede bridge interna isolada (<code>dispar-net</code>), sem expor a porta 3000 do Node diretamente para a Internet.",
                body_style
            )
        ]
    ]
    t_pf = Table(pf_data, colWidths=[17 * cm])
    t_pf.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F0FDF4')),
        ('BOX', (0,0), (-1,-1), 1, PALETTE['ponto_forte']),
        ('PADDING', (0,0), (-1,-1), 7),
    ]))
    story.append(t_pf)
    story.append(Spacer(1, 0.3 * cm))

    pw_data = [
        [
            Paragraph("<font color='#B91C1C'><b>⚠ PONTOS FRACOS E RISCOS CENTRAIS</b></font>", body_bold),
        ],
        [
            Paragraph(
                "<b>1. Desvio Crítico de Aprovação de Dispositivos:</b> A rota <code>/api/v1/devices/approve</code> foi exposta em <code>server.ts</code> sem autenticação e forjando <code>actorRole: 'owner'</code>, permitindo aprovação de qualquer dispositivo por qualquer atacante.<br/>"
                "<b>2. Ausência Total de Verificação RBAC no Servidor:</b> O pacote <code>@dispar-flux/auth</code> possui a classe <code>RbacGuard</code> e matriz de permissões pronta, mas ela nunca foi ligada aos endpoints da API. Qualquer operador autenticado pode apagar bases, deslogar WhatsApp e disparar campanhas.<br/>"
                "<b>3. Endpoints Administrativos sem Autenticação:</b> Rotas sensíveis de contatos, campanhas, importação e backup foram posicionadas antes da checagem de sessão em <code>server.ts</code>.<br/>"
                "<b>4. IDOR Sistemático em Entidades do Domínio:</b> Deleção e alteração de bases, regras de follow-up, leads e agenda aceitam IDs arbitrários no path sem filtrar por <code>organization_id</code>.<br/>"
                "<b>5. Chave de Recuperação Padrão no Código-Fonte:</b> Fallback estático <code>'flux_default_recovery_key_32_bytes_long_!!'</code> em <code>server.ts</code> sem validação de startup em produção.<br/>"
                "<b>6. CSV Formula Injection:</b> A exportação de contatos em CSV não neutraliza comandos iniciados por <code>=</code>, <code>+</code>, <code>-</code> ou <code>@</code>.",
                body_style
            )
        ]
    ]
    t_pw = Table(pw_data, colWidths=[17 * cm])
    t_pw.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#FEF2F2')),
        ('BOX', (0,0), (-1,-1), 1, PALETTE['critica']),
        ('PADDING', (0,0), (-1,-1), 7),
    ]))
    story.append(t_pw)

    story.append(PageBreak())

    # =========================================================================
    # TABELA DETALHADA DE ACHADOS
    # =========================================================================
    story.append(Paragraph("3. Tabela Detalhada de Achados de Segurança", h1_style))
    story.append(Paragraph("Lista exaustiva, arquivo por arquivo e linha por linha, de todas as vulnerabilidades identificadas:", body_style))
    story.append(Spacer(1, 0.2 * cm))

    def make_chip(sev_text, bg_color):
        p = Paragraph(f"<b>{sev_text}</b>", ParagraphStyle('Chip', fontName='Helvetica-Bold', fontSize=7, textColor=colors.white, alignment=1))
        t = Table([[p]], colWidths=[2.2 * cm])
        t.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), bg_color),
            ('ALIGN', (0,0), (-1,-1), 'CENTER'),
            ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
            ('TOPPADDING', (0,0), (-1,-1), 2),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ]))
        return t

    findings = [
        (
            "CRÍTICA", PALETTE['critica'],
            "apps/server/src/server.ts:686-705",
            "<b>Bypass de Autenticação e RBAC na Aprovação de Dispositivos:</b> A UI esconde o botão para operadores, mas o backend expõe <code>/api/v1/devices/approve</code> sem autenticação e forja <code>actorRole: 'owner'</code>, permitindo aprovação de qualquer dispositivo não autorizado."
        ),
        (
            "CRÍTICA", PALETTE['critica'],
            "apps/server/src/server.ts:708-895",
            "<b>Rotas Operacionais e de Backup Expostas sem Autenticação:</b> Rotas de contatos (708), campanhas (726), opt-out/reauth (794, 818), migração (852) e backup (863, 877) foram declaradas antes do middleware de autenticação, acessíveis sem token."
        ),
        (
            "ALTA", PALETTE['alta'],
            "apps/server/src/api-router.ts:65-89",
            "<b>Ausência Total de Verificação de Papéis (RBAC) no Backend:</b> Embora exista a matriz em <code>permissions.ts</code> e <code>RbacGuard</code>, nenhuma rota de <code>api-router.ts</code> valida se o chamador possui o papel de <code>owner</code> para ações destrutivas ou de envio."
        ),
        (
            "ALTA", PALETTE['alta'],
            "apps/server/src/server.ts:135",
            "<b>Chave de Recuperação Padrão Hardcoded com Fallback Fraco:</b> O servidor define <code>'flux_default_recovery_key_32_bytes_long_!!'</code> se <code>RECOVERY_KEY</code> estiver ausente, tornando os backups de desastre descriptografáveis publicamente."
        ),
        (
            "ALTA", PALETTE['alta'],
            "apps/server/src/api-router.ts:412-418",
            "<b>IDOR na Deleção e Gestão de Bases de Contatos:</b> <code>DELETE /api/v1/bases/:id</code> e rotas associadas executam consultas diretamente por <code>id = ?</code> sem verificar <code>organization_id = getOrgId()</code>."
        ),
        (
            "ALTA", PALETTE['alta'],
            "apps/server/src/api-router.ts:927, 983",
            "<b>Resolução de Contatos sem Filtro de Organização:</b> No Inbox e no envio manual, a busca é realizada apenas por <code>normalized_phone = ?</code>, podendo cruzar contatos entre organizações no banco compartilhado."
        ),
        (
            "MÉDIA", PALETTE['media'],
            "apps/server/src/api-router.ts:833, 888-894",
            "<b>Consultas de Listagem sem Filtro de Organização:</b> Listagem de campanhas (linha 833) e conversas do Inbox (linha 889) realizam <code>SELECT *</code> sem <code>WHERE organization_id = ?</code>."
        ),
        (
            "MÉDIA", PALETTE['media'],
            "apps/server/src/api-router.ts:911, 917",
            "<b>Agregações Globais de Métricas sem Isolamento:</b> Total de mensagens não lidas e total de leads somam dados de toda a tabela sem filtrar pela organização ativa."
        ),
        (
            "MÉDIA", PALETTE['media'],
            "apps/server/src/api-router.ts:650, 749, 790",
            "<b>Pausa e Cancelamento de Campanhas sem Validação de Tenant:</b> Comandos de interrupção de disparo atuam sobre o primeiro registro global em status <code>running</code>."
        ),
        (
            "MÉDIA", PALETTE['media'],
            "apps/server/src/api-router.ts:1071-1088",
            "<b>IDOR na Atualização de Leads no CRM Kanban:</b> Alteração de estágio e anotações comerciais de leads no CRM por ID sem validar posse da organização."
        ),
        (
            "MÉDIA", PALETTE['media'],
            "apps/server/src/api-router.ts:1148-1180",
            "<b>IDOR na Modificação e Exclusão de Compromissos da Agenda:</b> Conclusão, edição e deleção de agendamentos diretamente por <code>id</code> sem conferir <code>organization_id</code>."
        ),
        (
            "MÉDIA", PALETTE['media'],
            "apps/server/src/api-router.ts:1218-1249",
            "<b>IDOR em Regras de Automação Follow-up (Cron):</b> Edição, ativação e remoção de regras de follow-up por ID sem verificar tenant."
        ),
        (
            "MÉDIA", PALETTE['media'],
            "packages/campaigns/src/csv/csv-exporter.ts:77-87",
            "<b>CSV Formula Injection na Exportação de Contatos:</b> Valores iniciados por <code>=</code>, <code>+</code>, <code>-</code>, <code>@</code> não são prefixados com apóstrofo, permitindo execução de código ao abrir no Excel."
        ),
        (
            "BAIXA", PALETTE['baixa'],
            "deploy/compose.yaml:27-28",
            "<b>Fallback Inseguro de Segredos Vazios no Docker Compose:</b> A sintaxe <code>${RECOVERY_KEY:-}</code> atribui string vazia caso a variável falte no <code>.env</code>, gerando chaves vazias em vez de falha no boot."
        ),
    ]

    table_data = [[
        Paragraph("<b>Sev.</b>", body_bold),
        Paragraph("<b>Arquivo:Linha</b>", body_bold),
        Paragraph("<b>Descrição da Falha e Impacto</b>", body_bold),
    ]]

    for sev_text, sev_color, loc, desc in findings:
        chip = make_chip(sev_text, sev_color)
        loc_p = Paragraph(f"<code>{loc}</code>", ParagraphStyle('Loc', fontName='Courier', fontSize=7, leading=9, textColor=PALETTE['text_secondary']))
        desc_p = Paragraph(desc, ParagraphStyle('Desc', fontName='Helvetica', fontSize=7.2, leading=9.5, textColor=PALETTE['text_primary']))
        table_data.append([chip, loc_p, desc_p])

    t_findings = Table(table_data, colWidths=[2.5 * cm, 4.8 * cm, 9.7 * cm])
    t_findings.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), PALETTE['bg_light']),
        ('BOX', (0,0), (-1,-1), 0.5, PALETTE['border']),
        ('INNERGRID', (0,0), (-1,-1), 0.5, PALETTE['border']),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('PADDING', (0,0), (-1,-1), 3),
    ]))
    story.append(t_findings)

    story.append(PageBreak())

    # =========================================================================
    # RECOMENDAÇÕES PRIORIZADAS
    # =========================================================================
    story.append(Paragraph("4. Plano de Correção e Recomendações Priorizadas", h1_style))
    story.append(Paragraph("Ações imediatas estruturadas por criticidade para mitigar as vulnerabilidades:", body_style))
    story.append(Spacer(1, 0.2 * cm))

    recs = [
        (
            "Prioridade P1 (Imediata — 24 horas)",
            PALETTE['critica'],
            "<b>1. Autenticação e Autorização Estrita em <code>/api/v1/devices/approve</code>:</b> Exigir sessão autenticada válida, extrair o <code>memberId</code> exclusivamente da sessão (nunca do body), verificar se <code>member.role === 'owner'</code> e validar se o dispositivo pertence à organização do proprietário.<br/>"
            "<b>2. Proteger Todas as Rotas de <code>server.ts</code>:</b> Mover ou aplicar o middleware de autenticação antes dos handlers de contatos, campanhas, opt-out, reautorização, migração e backup. Nenhuma rota de mutação de dados pode operar de forma não autenticada."
        ),
        (
            "Prioridade P2 (Curto Prazo — 48 horas)",
            PALETTE['alta'],
            "<b>3. Conectar o <code>RbacGuard</code> ao Pipeline de Rotas da API:</b> Integrar a classe existente <code>RbacGuard</code> aos endpoints de <code>api-router.ts</code>. Bloquear operadores com status 403 Forbidden nas rotas de bases, campanhas, configurações, backup e desconexão de WhatsApp.<br/>"
            "<b>4. Rejeição de Chaves Padrão em Produção (Fail-Fast Startup):</b> Adicionar validação no método <code>start()</code> que lance exceção fatal se <code>nodeEnv === 'production'</code> e a chave de recuperação for o default hardcoded ou tiver menos de 32 bytes.<br/>"
            "<b>5. Mitigação Universal de IDOR:</b> Refatorar todas as queries <code>SELECT</code>, <code>UPDATE</code> e <code>DELETE</code> que recebem IDs para incluir obrigatoriamente a cláusula <code>AND organization_id = ?</code>."
        ),
        (
            "Prioridade P3 (Médio Prazo — Próxima Release)",
            PALETTE['media'],
            "<b>6. Sanitização de Fórmulas na Exportação CSV:</b> Modificar a função <code>escapeCsvValue</code> em <code>packages/campaigns/src/csv/csv-exporter.ts</code> para prefixar com apóstrofo (<code>'</code>) qualquer valor textual que inicie com <code>=</code>, <code>+</code>, <code>-</code>, <code>@</code>, <code>\\t</code> ou <code>\\r</code>.<br/>"
            "<b>7. Correção do Docker Compose:</b> Alterar no <code>compose.yaml</code> as variáveis de segredo para <code>${RECOVERY_KEY:?Erro: RECOVERY_KEY obrigatoria}</code>, forçando o Compose a recusar subir se a variável estiver ausente."
        )
    ]

    for p_title, p_color, p_content in recs:
        p_table_data = [
            [Paragraph(f"<font color='{p_color.hexval()}'><b>{p_title}</b></font>", body_bold)],
            [Paragraph(p_content, body_style)]
        ]
        t_p = Table(p_table_data, colWidths=[17 * cm])
        t_p.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), PALETTE['bg_light']),
            ('BOX', (0,0), (-1,-1), 1, p_color),
            ('PADDING', (0,0), (-1,-1), 5),
        ]))
        story.append(t_p)
        story.append(Spacer(1, 0.3 * cm))

    story.append(PageBreak())

    # =========================================================================
    # ISSUES PARA O GITHUB (MARKDOWN COMPLETO)
    # =========================================================================
    story.append(Paragraph("5. Issues para o GitHub (Prontas para Copiar e Colar)", h1_style))
    story.append(Paragraph(
        "Abaixo estão formatados os blocos completos de issues para criação no GitHub, contendo evidência, "
        "impacto, sugestão de código e critérios de aceite detalhados.",
        body_style
    ))
    story.append(Spacer(1, 0.2 * cm))

    issues_markdown = [
        """--- ISSUE 1 ---
## [Segurança] Bypass de Autenticação e RBAC na Aprovação de Dispositivos
**Labels sugeridas:** `security`, `severidade: crítica`

### Descrição do Problema
O frontend restringe a exibição do botão "Autorizar Acesso" de novos navegadores em `apps/web/src/pages/ConfigPage.tsx` exclusivamente para membros com papel de Proprietário (`currentMember?.role === 'owner'`).
Contudo, no backend (`apps/server/src/server.ts`, linhas 686–705), a rota correspondente (`POST /api/v1/devices/approve` e `POST /api/v1/auth/devices/approve`) foi declarada sem exigir qualquer token de autenticação e sem validar a sessão do chamador.
Pior: o código lê um parâmetro opcional `body.ownerMemberId`, busca qualquer proprietário no banco de dados (`ownerRow?.id`) e executa a aprovação forjando `actorRole: 'owner'`.

### Evidência de Código
Arquivo: `apps/server/src/server.ts`, linhas 686–705:
```typescript
if (method === 'POST' && (pathname === '/api/v1/devices/approve' || pathname === '/api/v1/auth/devices/approve')) {
  const body = await this.sizeLimits.readJson<{ deviceId: string; approve: boolean; ownerMemberId?: string }>(req);
  const ownerRow = this.db!.prepare("SELECT id FROM members WHERE role = 'owner' LIMIT 1").get() as { id: string } | undefined;
  const orgRow = this.db!.prepare('SELECT id FROM organizations LIMIT 1').get() as { id: string } | undefined;

  const ownerId = body.ownerMemberId || ownerRow?.id || 'owner_default';
  const approved = this.deviceService.approveDevice({
    deviceId: body.deviceId,
    approvedByMemberId: ownerId,
    actorRole: 'owner',
    organizationId: orgRow?.id || 'org_default',
  });
  ...
}
```

### Impacto
Qualquer operador não privilegiado ou atacante externo que alcance a API pode enviar uma requisição POST com o ID de um dispositivo não autorizado e obter aprovação imediata com privilégios de Proprietário, quebrando o modelo de confiança de dispositivos (ADR 0011 e ADR 0022).

### Sugestão de Correção
1. Extrair e validar o token de sessão usando `this.extractToken(req)`.
2. Validar se `authContext.member.role === 'owner'`. Caso contrário, retornar `403 Forbidden`.
3. Utilizar o `authContext.member.id` e `authContext.member.organizationId` verificados na sessão, rejeitando IDs recebidos no payload.

### Critérios de Aceite
- [ ] Requisições não autenticadas para `/api/v1/devices/approve` retornam `401 Unauthorized`.
- [ ] Requisições feitas por membros com papel `operator` retornam `403 Forbidden`.
- [ ] Apenas requisições autenticadas de um `owner` aprovam dispositivos da sua própria organização.
- [ ] Teste automatizado de regressão cobrindo o bloqueio implementado.
--- FIM ISSUE 1 ---""",

        """--- ISSUE 2 ---
## [Segurança] Rotas de Escrita Administrativas e Backups Expostas sem Autenticação
**Labels sugeridas:** `security`, `severidade: crítica`

### Descrição do Problema
No arquivo `apps/server/src/server.ts`, diversos endpoints de mutação profunda de dados foram declarados antes da invocação do roteador de API (`handleApiRoutes`) e não contêm chamadas a `extractToken()` nem validação de sessão. Qualquer cliente HTTP pode criar contatos, criar campanhas, aplicar opt-out, importar arquivos de migração e gerar/restaurar backups no servidor.

### Evidência de Código
Arquivo: `apps/server/src/server.ts`:
- Linhas 708–723: `POST /api/v1/contacts` (cria contato sem auth)
- Linhas 726–791: `POST /api/v1/campaigns` (cria campanha sem auth)
- Linhas 794–816: `POST /api/v1/contacts/:id/opt-out` (registra opt-out sem auth)
- Linhas 818–849: `POST /api/v1/contacts/:id/reauthorize` (reautoriza contato confiando em `body.actorMemberId`)
- Linhas 852–860: `POST /api/v1/migration/import` (importa pacote de migração sem auth)
- Linhas 863–875: `POST /api/v1/backup/create` (gera backup no disco sem auth)
- Linhas 877–895: `POST /api/v1/backup/restore` (restaura backup e sobrescreve SQLite sem auth)

### Impacto
Comprometimento total da integridade e confidencialidade da instalação. Um atacante sem credenciais pode disparar restaurações maliciosas, apagar dados operacionais e poluir a base de campanhas.

### Sugestão de Correção
Mover a lógica dessas rotas para dentro de `api-router.ts` ou envolver os blocos em um helper de verificação de sessão obrigatória (`this.requireAuth(req, res)`).

### Critérios de Aceite
- [ ] Todas as rotas citadas rejeitam chamadas sem token com `401 Unauthorized`.
- [ ] Rotas de backup e migração exigem adicionalmente permissão `owner`.
- [ ] Testes de integração confirmando o bloqueio de requisições anônimas.
--- FIM ISSUE 2 ---""",

        """--- ISSUE 3 ---
## [Segurança] Ausência de Verificação RBAC nas Rotas da API de Negócio
**Labels sugeridas:** `security`, `severidade: alta`

### Descrição do Problema
O pacote `@dispar-flux/auth` define uma matriz de permissões (`Permission.CONNECTIONS_MANAGE`, `Permission.BASES_MANAGE`, `Permission.CAMPAIGNS_MANAGE`) e implementa a classe `RbacGuard` e `assertPermission`. No entanto, em `apps/server/src/api-router.ts`, o roteador apenas valida se o chamador possui um token (`authContext`), mas nunca verifica `authContext.member.role`.

### Evidência de Código
Arquivo: `apps/server/src/api-router.ts`, linhas 65–89:
```typescript
if (token) {
  try {
    authContext = server.sessionService.validateToken(token);
  } catch { ... }
}
if (hasOwner && !authContext) {
  sendJson(res, 401, { error: 'Unauthorized', message: 'Autenticação necessária.' });
  return true;
}
// Nenhuma verificação de authContext.member.role nos handlers subsequentes!
```
Rotas afetadas: `POST /api/v1/whatsapp/logout`, `DELETE /api/v1/bases/:id`, `POST /api/v1/campaigns/start`, etc.

### Impacto
Um usuário com papel de `operator` pode realizar qualquer ação restrita ao `owner`, incluindo deslogar o WhatsApp da empresa, apagar listas de clientes e disparar campanhas em massa não autorizadas.

### Sugestão de Correção
Criar e aplicar um middleware/helper `requireRole(authContext, 'owner')` em todos os endpoints administrativos mapeados em `packages/auth/src/rbac/permissions.ts`.

### Critérios de Aceite
- [ ] Membros com papel `operator` recebem `403 Forbidden` ao tentar iniciar/pausar campanhas, apagar bases ou alterar conexões de mensageria.
- [ ] Proprietários (`owner`) continuam operando normalmente.
- [ ] Cobertura de testes para perfil de operador em endpoints restritos.
--- FIM ISSUE 3 ---""",

        """--- ISSUE 4 ---
## [Segurança] Chave de Recuperação com Fallback Hardcoded e Ausência de Validação de Startup
**Labels sugeridas:** `security`, `severidade: alta`

### Descrição do Problema
Em `apps/server/src/server.ts` (linha 135), a propriedade `recoveryKey` possui como fallback padrão uma string fixa em texto claro no código:
`'flux_default_recovery_key_32_bytes_long_!!'`.
Além disso, em `deploy/compose.yaml` (linha 27), a variável é definida como `RECOVERY_KEY=${RECOVERY_KEY:-}`, fornecendo string vazia se omitida do `.env`.
Não há verificação no boot que impeça a inicialização em ambiente de produção sem uma chave forte gerada.

### Evidência de Código
Arquivo: `apps/server/src/server.ts`, linha 135:
```typescript
this.recoveryKey = options.recoveryKey ?? process.env.RECOVERY_KEY ?? 'flux_default_recovery_key_32_bytes_long_!!';
```

### Impacto
Backups criptografados gerados em instâncias que utilizam a chave padrão podem ser descriptografados instantaneamente por qualquer pessoa com acesso ao arquivo de backup, expondo todo o histórico de mensagens, contatos e credenciais do WhatsApp.

### Sugestão de Correção
1. Remover o fallback hardcoded.
2. Adicionar validação de startup no método `start()` de `server.ts` e em `loadConfig()`: se `nodeEnv === 'production'`, exigir chave criptográfica com no mínimo 32 caracteres e rejeitar valores conhecidos.
3. No `compose.yaml`, trocar `${RECOVERY_KEY:-}` por `${RECOVERY_KEY:?RECOVERY_KEY obrigatoria}`.

### Critérios de Aceite
- [ ] O servidor recusa inicializar em produção se `RECOVERY_KEY` for a chave padrão ou estiver ausente.
- [ ] O script de inicialização loga advertência em modo desenvolvimento caso use fallback.
--- FIM ISSUE 4 ---""",

        """--- ISSUE 5 ---
## [Segurança] IDOR Sistemático nas Operações por ID (Bases, Leads, Agenda e Cron)
**Labels sugeridas:** `security`, `severidade: alta`

### Descrição do Problema
Diversas rotas de busca, alteração e exclusão recebem identificadores UUID pela URL e executam instruções SQL diretamente no banco de dados SQLite sem validar se o registro pertence à organização do usuário autenticado.

### Evidência de Código
Arquivo: `apps/server/src/api-router.ts`:
- Linha 415: `DELETE FROM bases WHERE id = ?`
- Linhas 1075 e 1085: `UPDATE leads SET ... WHERE id = ?`
- Linhas 1153, 1168, 1177: `UPDATE/DELETE appointments WHERE id = ?`
- Linhas 1228, 1238, 1246: `UPDATE/DELETE follow_up_rules WHERE id = ?`

### Impacto
Em cenários onde múltiplos bancos ou migrações compartilham dados, ou se houver reaproveitamento de rotas, usuários podem alterar e deletar recursos pertencentes a outras organizações ou bases.

### Sugestão de Correção
Adicionar a cláusula `AND organization_id = ?` em todas as instruções SQL de mutação e consulta individual, passando `getOrgId()` como parâmetro.

### Critérios de Aceite
- [ ] Todas as operações `WHERE id = ?` passam a conter `WHERE id = ? AND organization_id = ?`.
- [ ] Tentativas de manipular recursos com ID de outra organização retornam `404 Not Found`.
--- FIM ISSUE 5 ---""",

        """--- ISSUE 6 ---
## [Segurança] Vulnerabilidade a CSV Formula Injection na Exportação de Bases
**Labels sugeridas:** `security`, `severidade: média`

### Descrição do Problema
O componente `CsvExporter` (`packages/campaigns/src/csv/csv-exporter.ts`, linhas 77–87) escapa apenas aspas e delimitadores, mas não neutraliza células que começam com caracteres de execução de fórmulas de planilhas (`=`, `+`, `-`, `@`, `\t`, `\r`).
Como nomes e campos importados de contatos podem ser fornecidos por formulários públicos ou terceiros, payloads maliciosos podem ser injetados na base.

### Evidência de Código
Arquivo: `packages/campaigns/src/csv/csv-exporter.ts`, linhas 77–87:
```typescript
function escapeCsvValue(val: string, delimiter: string): string {
  if (
    val.includes(delimiter) ||
    val.includes('"') ||
    val.includes('\n') ||
    val.includes('\r')
  ) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
```

### Impacto
Quando um operador exporta os contatos da base em `.csv` e abre o arquivo no Microsoft Excel ou LibreOffice, fórmulas maliciosas (ex: `=HYPERLINK()`, `=CMD|...`) são executadas no computador do operador, podendo causar vazamento de dados ou execução remota de código.

### Sugestão de Correção
Se o valor iniciar com `=`, `+`, `-`, `@`, `\t` ou `\r`, prefixar com um apóstrofo `'` antes de aplicar a formatação de escape.

### Critérios de Aceite
- [ ] Valores que iniciam com `=`, `+`, `-`, `@` recebem apóstrofo prefixado na exportação.
- [ ] Testes unitários em `csv-import-export.test.ts` validando a neutralização de fórmulas.
--- FIM ISSUE 6 ---"""
    ]

    for issue_text in issues_markdown:
        issue_box_data = [[
            Paragraph(issue_text.replace('\n', '<br/>'), issue_code_style)
        ]]
        t_issue = Table(issue_box_data, colWidths=[17 * cm])
        t_issue.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,-1), PALETTE['bg_light']),
            ('BOX', (0,0), (-1,-1), 0.8, PALETTE['border']),
            ('PADDING', (0,0), (-1,-1), 5),
        ]))
        story.append(t_issue)
        story.append(Spacer(1, 0.3 * cm))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"[OK] Relatório gerado com sucesso: {filename}")

if __name__ == "__main__":
    pdf_dest = "docs/security-audit/relatorio-auditoria-seguranca.pdf"
    if len(sys.argv) > 1:
        pdf_dest = sys.argv[1]
    build_pdf(pdf_dest)
