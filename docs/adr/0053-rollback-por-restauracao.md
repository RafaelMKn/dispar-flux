# Fazer rollback restaurando versão e dados

Migrations de produção avançarão apenas. Antes de atualizar, a Instalação entrará em manutenção e criará um Backup de Recuperação verificado; se a atualização falhar, o procedimento oficial restaurará em conjunto o backup anterior e a imagem anterior, em vez de executar migrations destrutivas de retorno.
