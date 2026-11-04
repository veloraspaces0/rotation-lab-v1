# Rotation Lab V4.1.1 — auditor independente, sem mutação
A V4.1.1 é uma camada **read-only** de verificação; não altera o motor congelado V4.1, o workflow agendado, os parâmetros, os eventos nem o state.json.

## Por que não alterar o core.js diretamente?
O hash do BASELINE cobre core.js, runner.cjs e o workflow V4.1. Alterá-los faria runCycle bloquear o registro prospectivo. Esta implementação preserva a cadeia e adiciona validações independentes.

## Verificação
```sh
node --test v4-1/tests.cjs
node --test analytics/tests.cjs
node --test v4-1-1/tests.cjs
node v4-1-1/integrity.cjs
```

O auditor valida a cadeia SHA-256 original, o hash da configuração congelada, o hash dos arquivos do motor, a sequência contínua, os horários monotônicos e a classificação de sinais dentro e fora da janela de 90 minutos.

`latestClosedMinute` é um seletor robusto de candles 1m para uma **versão futura** do runner; não é conectado ao coletor V4.1 congelado. `classifySignals` é diagnóstico separado, não altera métricas nem a interface do analytics V1.

## Limites
SHA-256 não é assinatura externa. O auditor confia no BASELINE versionado no Git e nos arquivos locais. O audit workflow em PR pode usar state.json de um snapshot anterior ao main; uma auditoria atual deve rodar no main mais recente. O processo não recupera candles perdidos, não garante latência do Actions, não fornece validação independente da Binance nem comprova rentabilidade. Não utilizar capital real.

Não arquivamos eventos: isso exige migração de esquema e verificadores, e não é seguro fazê-lo silenciosamente.
