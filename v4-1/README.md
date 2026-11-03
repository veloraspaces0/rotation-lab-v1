# Rotation Lab V4.1 — experimento prospectivo auditável

**Somente capital virtual. Não se conecta à corretora, não executa ordens nem converte USDT/BRL.**

## Links
- Painel: https://veloraspaces0.github.io/rotation-lab-v1/v4-1/
- Estado: https://github.com/veloraspaces0/rotation-lab-v1/blob/main/v4-1/state.json
- GitHub Actions: https://github.com/veloraspaces0/rotation-lab-v1/actions/workflows/rotation-lab-v4-1.yml
- V4 anterior: https://veloraspaces0.github.io/rotation-lab-v1/v4/ (preservada)

## Auditoria independente — correções

1. Preço: duas leituras do ticker, bookTicker e 1m fechado na Binance. Divergências rejeitadas; sem ordens simuladas se qualquer qualidade falhar. São endpoints da mesma Binance, não fontes independentes; movimentos reais extremos também podem ser rejeitados.
2. Evidência: carteira virtual com freio permanente de 6% e registro-sombra contínuo dos cinco ativos sem respeitar freio ou mínimo de ordem. Resultados teóricos com horizontes de 1/3/6/12 candles apenas após maturação. Não são trades efetivos.
3. Atrasos: novas compras bloqueadas depois de 90 minutos; vendas podem ocorrer depois disso com preço contemporâneo validado. Três cron jobs por ciclo e três tentativas de push, sem backfill nem duplicação.
4. Auditoria: cada evento armazena 120 preços de fechamento para cada ativo, indicadores, cotações validadas, decisões e atrasos. SHA-256 de core.js, runner.cjs e do workflow, além da configuração, congelado no BASELINE. GitHub registra histórico de commits, mas hashing por si só não impede reescrita com recálculo. Sem âncora externa independente.
5. Entrada/saída: preço esticado acima da média só bloqueia entrada. O filtro de saída usa regra própria de enfraquecimento em dois candles.

## Arquivos

- v4-1/core.js: regras, hashes, entradas e sinais-sombra congelados
- v4-1/runner.cjs: Binance e qualidade de dados
- v4-1/tests.cjs: 16 testes de regressão
- v4-1/state.json: histórico prospectivo append-only (Git commits)
- .github/workflows/rotation-lab-v4-1.yml: agendamento, validação e retries
- v4-1/analysis.js: benchmarks de pesquisa, sem afetar as decisões
- v4-1/index.html e app.js: painel read-only

## Benchmark e metodologia

Compara V4.1 com BTC 100%, 100% em caixa, BTC 65% + caixa 35% e distribuição igual entre os cinco criptoativos. Os benchmarks são hipotéticos e usam custos simulados. Retornos dos sinais-sombra são close-to-close, não execuções disponíveis após o fechamento; sobreposições temporais tornam as amostras dependentes.

Amostra inicial prospectiva é zero; apenas novas observações após ativação contam. Em 30 dias revisar cobertura do cron e integridade; em 60 dias observar retorno dos sinais-sombra; em 90 dias avaliar evidência, admitindo conclusão inconclusiva. Não operar capital real com base nestas medições.

## Limites restantes

- Não implementa backtest plurianual nem âncora externa em serviço independente.
- Freio de 6% não é proteção garantida contra gaps. Não existe stop real na Binance.
- R$30 de mínimo por ordem é apenas regra interna ilustrativa.
- GitHub Actions pode atrasar, falhar ou ser suspenso; inspecione os logs.
- Alterar core.js, runner.cjs ou workflow depois de ativado bloqueia novas avaliações e exige uma nova linha de experimento.

Nenhum arquivo da V4 antiga foi modificado para criar esta versão.