# Não repetir envios incertos automaticamente

Quando um crash ocorrer depois do início de um envio e antes de sua confirmação, o job se tornará um Envio Incerto. A retomada automática pulará esse destinatário; o Proprietário poderá reconciliar o estado manualmente, mas o sistema privilegiará não duplicar mensagens quando não houver idempotência garantida pelo provedor.
