# Tratar WebSocket como sinal e REST como fonte da verdade

Eventos WebSocket notificarão o navegador sobre mudanças, mas não constituirão um log durável. Ao conectar ou reconectar, a interface relerá pela API REST os estados relevantes de campanhas, inbox, CRM e conexão, garantindo convergência mesmo quando um evento for perdido.
