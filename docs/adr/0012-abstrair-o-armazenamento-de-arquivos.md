# Abstrair o armazenamento de arquivos

A primeira versão guardará mídias e avatares em um volume local da Instalação, por trás de um contrato de armazenamento que poderá receber implementações S3 compatíveis, como R2 ou MinIO. O domínio e a interface web usarão identificadores e URLs autorizadas, nunca caminhos absolutos do servidor.

## Consequences

O volume local será a opção padrão da Edição Comunitária. Object storage poderá ser habilitado posteriormente sem alterar mensagens ou telas, desde que as operações de leitura, escrita, remoção e streaming permaneçam definidas pelo mesmo contrato.
