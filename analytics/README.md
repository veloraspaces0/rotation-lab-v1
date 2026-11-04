# Rotation Lab Analytics V1.1

**Painel:** https://veloraspaces0.github.io/rotation-lab-v1/analytics/

**Fonte:** estado prospectivo da V4.1 em https://github.com/veloraspaces0/rotation-lab-v1/blob/main/v4-1/state.json

**Separação absoluta:** os arquivos analytics/ são somente leitura. Não alteram os arquivos congelados v4-1/core.js, v4-1/runner.cjs, .github/workflows/rotation-lab-v4-1.yml, v4-1/state.json, nem a V4 anterior. O programa não faz compras ou vendas reais.


## Novidades da V1.1 (somente leitura)

Esta versão acrescenta **três avaliações de risco**, sem modificar o motor, os parâmetros congelados ou o histórico da V4.1:

1. **Freio permanente**: o painel apresenta um alerta visível quando o último snapshot da carteira tiver hardHalt=true. Exibe a primeira ocorrência, a data e o número de eventos-sombra efetivamente registrados depois desse freio. Isso é um alerta **na página**, não uma notificação push, e-mail ou Issue automática. O registro-sombra pode continuar enquanto o coletor funcionar.
2. **Tempo em drawdown**: compara equityVirtual e peakEquity nos snapshots publicados. Exibe profundidade corrente, maior queda observada, quantidade total de candles abaixo do pico e maior sequência consecutiva sem lacunas. Cada candle equivale a 4 horas observadas, **não** monitoramento intrabar. Uma ausência de candles interrompe a contagem da sequência e é informada separadamente; não atribuímos aos períodos ausentes um tempo em queda que não foi observado.
3. **Risco/retorno das operações fechadas**: utiliza apenas eventos com action.type da família SELL_, realizedPnlVirtual, netReturnPct e investedVirtual válidos. Exibe quantidade, taxa de acerto, ganho e perda médios, *payoff* (média de ganhos percentuais / módulo da média de perdas percentuais), expectativa média de retorno por operação e P&L realizado acumulado. Os retornos são percentuais do capital comprometido **em cada operação**, não do patrimônio da carteira. Sem operações fechadas, as taxas ficam como **indisponíveis**. Se não houver perdas, *payoff* não é infinito: é indefinido. Divergências entre fechamento calculado e account.closedTrades são alertadas.
4. **Relação alvo/stop informativa**: para os parâmetros atuais, meta teórica líquida de +2%, stop de −2,5% até −5%, e taxa de acerto de equilíbrio idealizada entre **55,56% e 71,43%**. Isto pressupõe que todas as operações saiam exatamente no alvo ou no stop e **não é uma previsão** de resultados.
5. **Testes adicionais**: nove casos novos cobrem baseline sem operações, drawdown com e sem lacunas, primeiro freio permanente, sinais-sombra posteriores ao freio, cálculos de expectativa/payoff, dados inválidos e funções somente leitura. Total de **20 testes automatizados**.

Observação: um alerta na página não garante ciência imediata do evento. Caso a coleta falhe, a página só pode indicar o último estado publicado pelo GitHub; não existe monitoramento contínuo independente.

## O que foi implementado

1. **Reconstrução do registro-sombra**: uma tabela de preços de fechamento é construída exclusivamente com os históricos de 120 candles de 4h incluídos nos snapshots prospectivos já gravados. Se um evento do candle-alvo de um sinal não existir, mas um evento posterior incluir o candle real de destino, o retorno é recuperado como pesquisa. Nunca são fabricados eventos da V4.1 ou trades retroativos.
2. **Sem fabricação de resultados**: quando o candle ainda não amadureceu, o retorno está *pendente*. Quando já deveria existir, mas não consta de nenhum snapshot válido, fica *indisponível*. Uma consulta posterior pode mudar o status, sem editar a cadeia original.
3. **Elegível vs. selecionado**: elegível passou nos filtros; selecionado é o melhor candidato informado pelo core no evento de origem, ou selecionado pela mesma regra de maior score entre elegíveis quando não houver candidato armazenado. Nem selecionado nem elegível significa compra efetivamente simulada.
4. **Retorno prospectivo**: para 1, 3, 6 e 12 candles de 4h (4h, 12h, 24h, 48h), rendimento teórico close-to-close, com fee+slippage por lado. O retorno ignora o spread, a latência até a execução e o risco de execução real. Todas as diferenças são percentuais, não operações reais.
5. **Comparação pareada e incerteza**: em cada instante de origem com os cinco resultados disponíveis, comparamos média dos elegíveis versus média incondicional dos cinco ativos e o candidato selecionado versus os cinco. Cada instante contribui como uma unidade pareada, não cada moeda como observação independente. Reamostragem bootstrap por blocos de tempo com tamanho máximo entre 12 candles e duas vezes o horizonte; o painel só mostra uma faixa exploratória de 90% se houver pelo menos 8 blocos calendários e 20 instantes pareados completos. Blocos contínuos são amostrados, não trades individuais. A banda não representa garantia de lucro nem elimina todos os vieses de seleção.
6. **Benchmarks transparentes**: V4.1 registrado, caixa, BTC 100%, BTC 65% + caixa 35%, 20% por ativo. Modo *Líquido se vender* estima o valor após compra e saída hipotéticas; *Apenas preço de mercado* cobra apenas custo de entrada no benchmark ainda aberto. A carteira V4.1 segue seu método original de avaliação líquido com custo hipotético de saída.
7. **Integridade**: SHA-256 da cadeia de eventos verificado no navegador antes de qualquer resultado ser apresentado. Isso é detecção de adulteração simples, não prova criptográfica contra reescrita total da cadeia, assinatura externa ou garantia da Binance.

## Como usar

1. Abra a URL do painel no iPhone.
2. Toque em **Atualizar dados** quando desejar consultar o último estado publicado no GitHub.
3. Mude o horizonte para 4, 12, 24 ou 48 horas para alternar os resumos. Observe os números de origens pareadas e blocos antes de concluir algo.
4. Compare *Líquido se vender* e *Apenas preço de mercado* nos benchmarks.
5. Se houver apenas o BASELINE, o resultado esperado é **zero observações**, sem simulação retrospectiva inventada.

## Como testar

Use Node 22+ no repositório:

    node --test analytics/tests.cjs

Os testes sintéticos verificam a recuperação de candle perdido, ausência de evidência histórica, ausência de lookahead na maturação, elegível versus selecionado, pares por origem, bootstrap reprodutível, benchmarks e imutabilidade do arquivo de origem.

## Limitações conhecidas

- Não permite concluir que há vantagem estatística sem dados novos. Uma banda de 90% é exploratória e pode ser otimista com poucos regimes de mercado.
- Sinais de moedas e horários próximos continuam correlacionados; o bootstrap usa blocos de tempo apenas como aproximação, não como comprovação de independência.
- Não há análise de *multiple testing*, seleção de parâmetros, PBO, blocos sazonalmente estratificados nem execução real de ordens.
- O algoritmo de reconstrução depende de o candle de destino aparecer em ao menos um snapshot; para buracos antigos além da janela de 120 candles, o resultado fica indisponível.
- Se a coletora ficar sem atualizar, o Analytics também fica sem dados; ele não consulta a Binance diretamente e não pode recuperar candles ausentes que nunca foram registrados.
- Dados são preços USDT; exibição R$ é somente unidade contábil, sem câmbio.
- O ramo main do GitHub ainda é a autoridade de dados; os hashes encadeados não oferecem âncora externa independente.
- Duas cotações da Binance não são duas fontes independentes.
- O script cliente baixa o estado completo e pode ficar mais lento conforme o arquivo crescer; a análise histórica não é paginação em servidor.
- A seleção do candidato em caso de ausência do campo original é aproximada por score arredondado; a auditoria identifica em texto a natureza do candidato teórico.
- Os benchmarks fixos não são rebalanceados; carteira BTC 65%/caixa 35% só tem essa proporção no marco inicial.

## Filosofia

**Não ajustar parâmetros para forçar lucro.** Primeiro preservar a integridade do monitor e a capacidade de avaliar seus resultados; em seguida formular hipóteses para uma nova versão experimental, sempre com um novo marco inicial e sem apagar a V4.1.
