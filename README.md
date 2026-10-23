# Radar de licitações

Job diário que consulta o Portal Nacional de Contratações Públicas (PNCP), filtra os editais de desenvolvimento de software abertos em Minas Gerais e manda um resumo no Telegram.

Case 2 de 15 do meu desafio de portfólio: problemas reais resolvidos com código.

## O problema

Uma pequena software house desenvolve sites, sistemas web e aplicativos. Prefeituras e câmaras compram exatamente isso por licitação, e os editais saem todo dia no PNCP. Só que ninguém na empresa tem tempo de olhar o portal: num dia comum há mais de 3.000 contratações com proposta aberta só em MG, e quase todas são de merenda, pneu, obra e material de escritório. Os editais bons passam sem ninguém ver.

## A solução

Todo dia útil, às 8h, um workflow do GitHub Actions:

1. consulta o endpoint `/v1/contratacoes/proposta` do PNCP, que lista as contratações com proposta aberta, com paginação, timeout e retry;
2. normaliza os registros (texto sujo, datas sem fuso, valor sigiloso, prazo de mentira);
3. aplica os critérios objetivos (situação, prazo, UF e faixa de valor);
4. descarta o que já foi enviado, guardado num SQLite;
5. decide a relevância em duas etapas: regras com pontuação, e depois um LLM gratuito (Groq) que julga o que as regras aprovaram e o que elas rejeitaram mas tem vocabulário de TI;
6. manda um resumo diário em HTML para o Telegram, com o motivo de cada edital, dividido em partes de até 4.096 caracteres;
7. grava o estado numa branch separada (`state`).

Exemplo de item no resumo:

```
1. Contratação de empresa especializada para prestação de serviços de sítio eletrônico e serviços de hospedagem.
SERVICO AUTONOMO DE AGUA E ESGOTO · Três Pontas/MG
Pregão - Eletrônico · Valor estimado: R$ 19.430,00
Encerra: 27/10/2026 08:00
Motivo: Prestação de serviços de site
Ver no PNCP
```

## Arquitetura

```
GitHub Actions (cron 0 11 * * 1-5 = 8h em Brasília)
  │
  ├─ restaura state/radar.db da branch state
  │
  ├─ pncp/client.ts      GET /proposta por modalidade, página a página
  │                      timeout 30 s, retry com backoff, pausa contra o limite de taxa
  ├─ pncp/normalize.ts   Contratação → Edital (texto limpo, datas, link do PNCP)
  ├─ filter/criteria.ts  situação = 1, prazo, UF, faixa de valor
  ├─ store/db.ts         remove o que já foi enviado (node:sqlite)
  ├─ filter/relevance.ts pontuação por termos (fortes, fracos, exclusão, veto)
  ├─ llm/classify.ts     segunda opinião em lotes de 20, com veredito guardado no SQLite
  ├─ telegram/format.ts  resumo em HTML, ordenado por pontuação
  ├─ telegram/client.ts  sendMessage, respeitando retry_after
  │
  └─ grava o estado e faz commit na branch state (só depois do envio dar certo)
```

O pipeline (`src/pipeline.ts`) recebe coleta, envio e banco por injeção. Por isso o teste ponta a ponta roda sem rede, com respostas reais do PNCP gravadas em `tests/fixtures/`.

```
src/
  config.ts          variáveis de ambiente
  main.ts            ponto de entrada do job
  pipeline.ts        orquestração
  eval.ts            leitura de CSV rotulado e cálculo de recall/precisão
  http.ts            timeout, retry e backoff, usados pelo PNCP e pelo LLM
  pncp/              cliente do PNCP e normalização
  filter/            texto, critérios e relevância
  llm/               classificação por LLM (API compatível com a da OpenAI)
  store/             SQLite
  telegram/          formatação e envio
scripts/
  record-fixtures.ts grava respostas reais da API para os testes
  evaluate.ts        mede recall e precisão num CSV rotulado (--llm para incluir o LLM)
  record-llm-fixture.ts grava uma resposta real do LLM para os testes
  sample-real-day.ts monta a amostra de um dia real para rotulagem manual
tests/               Vitest, um arquivo por módulo
data/                40 objetos rotulados (fictícios, no estilo dos reais)
avaliacao/           amostra real rotulada manualmente
```

## Decisões principais

Os detalhes, com as alternativas descartadas, estão em [DECISOES.md](DECISOES.md).

| Decisão | Escolha | Por quê, em uma linha |
|---|---|---|
| Endpoint | `/proposta` (abertas agora) | se o job falhar um dia, nada se perde: o edital continua aberto no dia seguinte |
| Filtro | regras com pontuação | explicável, ajustável para priorizar recall e já dá a pontuação de aderência |
| LLM | Groq gratuito como segunda etapa, em lotes e com cache | entende o contexto que a lista de palavras não pega, sem custo |
| Estado | SQLite commitado na branch `state` | grátis, auditável e não polui a `main` |
| API instável | timeout, backoff e, se a coleta falhar, nada é enviado nem gravado | o job é idempotente: a próxima execução recupera tudo |
| Mensagem | um resumo diário | não vira spam; quando passa de 4.096 caracteres, é dividido sem cortar edital |

## Resultados

A meta era **recall de 100%** (nenhuma oportunidade perdida) e **precisão de pelo menos 85%**. Recall vem primeiro porque os erros têm custos assimétricos: um edital irrelevante custa 10 segundos de leitura, um edital bom perdido pode custar um contrato.

| Conjunto | Filtro | Recall | Precisão |
|---|---|---|---|
| 40 objetos rotulados (`data/`) | regras | 100% (15/15) | 100% (15/15) |
| mesmos 40 | regras + LLM | 100% (15/15) | 100% (15/15) |
| 20 editais reais de 23/10/2026 | regras antes do ajuste | 100% (4/4) | **40%** (4/10) |
| mesmos 20 editais | regras depois do ajuste | 100% (4/4) | 80% (4/5) |
| mesmos 20 editais | regras + LLM (`qwen/qwen3.8-27b`) | 100% (4/4) | 100% (4/4) |

O resultado com LLM se repetiu em quatro execuções, com lotes de 10 e de 20.

Num teste completo com o PNCP do mesmo dia, sem enviar nada, o LLM julgou 200 dos 355 candidatos (os outros ficaram para a execução seguinte) e aprovou 8 editais. A frota por cartão saiu. Mas um edital de geotecnologia foi aprovado com o motivo "Licenciamento de sistemas web e mobile", o que contradiz o próprio prompt. Ou seja, o LLM também erra, e a próxima amostra rotulada precisa medir isso.

**Como ler esses números:**

- **Os 100% no conjunto rotulado não provam nada sozinhos.** As regras foram escritas olhando esses 40 exemplos, então o filtro decorou o conjunto. Ele bateu 100% e 100% de primeira, e por isso mesmo não dava para confiar.
- **O dia real mostrou o tamanho do problema.** Rodando no PNCP de verdade, o filtro aprovou 15 de 3.027 editais, e a maioria era licença de software pronto, SaaS ou gestão de frota por cartão. Os editais reais têm armadilhas que o conjunto rotulado não tem. Por exemplo, alguns órgãos começam o texto com "[Portal de Compras Públicas] -", e a palavra "portal" fazia um edital de hidrojateamento parecer site.
- **O ajuste corrigiu categorias, não editais.** Licença e SaaS viraram veto, "fornecimento de sistema" virou exclusão e o prefixo da plataforma passou a ser removido antes da pontuação. Os 80% são otimistas, porque o ajuste foi feito depois de ver parte desses editais. Ainda falta medir numa amostra nova.
- **O recall real tem pouca evidência.** A amostra pegou 10 aprovados e 10 dos 337 rejeitados que tinham vocabulário de TI (sistema, software, site...). Não achar nenhum relevante entre esses 10 não garante que não haja outros nos 327 restantes.
- **O LLM tirou o falso positivo que as regras não conseguiam tirar**: a gestão de frota por cartão, que cita "aplicativos móveis". Mas são 20 editais, e a diferença é de um item. Outro modelo gratuito testado, o `gpt-oss-120b`, variou entre 66,7% e 100% de precisão no mesmo conjunto, com o mesmo prompt. Por isso o modelo escolhido foi o que se manteve estável.
- **O gabarito é de uma pessoa só.** A rotulagem foi feita às cegas, sem ver o que o filtro achou, mas uma única vez e com objetos ambíguos de verdade. Exemplo: um contrato de TI que mistura suporte, rede e desenvolvimento. Se esse item for marcado como "não", a precisão cai para 30% antes do ajuste e 60% depois.

## Como rodar

Requisitos: Node 22.13 ou mais novo (o CI usa o Node 24 LTS, em que o `node:sqlite` é estável).

```bash
git clone https://github.com/henriqueecss/salto-02-radar-licitacoes.git
cd salto-02-radar-licitacoes
npm ci
cp .env.example .env    # preencha TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID
```

| Comando | O que faz |
|---|---|
| `npm test` | roda os testes (sem rede) |
| `npm run lint` | ESLint + checagem de tipos |
| `npm run evaluate` | recall e precisão no conjunto rotulado, com a pontuação de cada item |
| `npm run evaluate -- avaliacao/amostra_dia_real.csv --llm` | o mesmo, com regras + LLM, mostrando o motivo de cada veredito |
| `RADAR_DRY_RUN=1 npm start` | coleta de verdade e imprime o resumo no terminal, sem enviar nem gravar |
| `npm start` | execução completa: coleta, envia e grava o estado |
| `npm run sample-real-day` | monta uma amostra de 20 editais reais para rotular |

Configuração (no `.env` ou em Settings → Variables do repositório):

| Variável | Padrão | |
|---|---|---|
| `RADAR_UF` | `MG` | UF consultada |
| `RADAR_VALOR_MINIMO` / `RADAR_VALOR_MAXIMO` | `0` / sem limite | faixa de valor; valor zero ou ausente nunca exclui, porque o orçamento pode ser sigiloso |
| `RADAR_MODALIDADES` | `6,8,4` | pregão eletrônico, dispensa e concorrência eletrônica |
| `API_KEY` | vazio | chave do LLM; sem ela, o filtro usa só as regras |
| `LLM_BASE_URL` | `https://api.groq.com/openai/v1` | qualquer API compatível com `/chat/completions` da OpenAI |
| `LLM_MODEL` | `qwen/qwen3.8-27b` | modelo usado na classificação |

Para o job agendado, cadastre `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` e `API_KEY` (chave gratuita em console.groq.com) em Settings → Secrets and variables → Actions. Para disparar na hora, use Actions → Radar diario → Run workflow.

## Limitações e próximos passos

- Medir de novo a precisão, com e sem LLM, numa amostra nova que nenhum dos dois viu.
- O plano gratuito do Groq muda sem aviso. Se ele apertar, a troca de provedor é só de configuração (`LLM_BASE_URL` e `LLM_MODEL`).
- Avisar quando um edital já enviado for suspenso ou revogado (a situação muda depois da publicação).
- Uma página web com histórico e filtros, lendo o SQLite da branch `state`.
- O GitHub desativa workflows agendados em repositórios públicos depois de 60 dias sem atividade.
