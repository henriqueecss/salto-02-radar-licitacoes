# Sobre os dados

## A API de consultas do PNCP

Pública, sem autenticação. Documentação interativa: https://pncp.gov.br/api/consulta/swagger-ui/index.html

Endpoints de contratações (todos GET, todos exigem `pagina`, começando em 1):

| endpoint | para que serve | parâmetros obrigatórios |
|---|---|---|
| `/v1/contratacoes/proposta` | contratações com recebimento de propostas aberto | `dataFinal`, `pagina` |
| `/v1/contratacoes/publicacao` | contratações publicadas num período | `dataInicial`, `dataFinal`, `codigoModalidadeContratacao`, `pagina` |
| `/v1/contratacoes/atualizacao` | contratações atualizadas num período | os mesmos de `/publicacao` |

- Datas nos parâmetros: `aaaammdd` (ex.: `20261023`).
- Filtros opcionais: `uf`, `codigoMunicipioIbge`, `cnpj`, `codigoModalidadeContratacao` (opcional só em `/proposta`).
- `tamanhoPagina`: o swagger atual diz mínimo 10 e máximo 50. Um manual antigo fala em 500. Confirme na prática antes de decidir.
- A resposta vem com `data` (lista), `totalRegistros`, `totalPaginas`, `numeroPagina` e `paginasRestantes`.

Exemplo real (consulta de 22/10/2026): `/v1/contratacoes/proposta?dataFinal=20261231&codigoModalidadeContratacao=6&uf=MG&pagina=1&tamanhoPagina=10` devolveu 2.132 registros em 214 páginas. Ou seja, só pregões eletrônicos abertos em MG já passam de duas mil contratações. Paginação não é detalhe.

## Campos que importam

| campo | exemplo |
|---|---|
| `numeroControlePNCP` | `18338152000164-1-000055/2026` (chave única: CNPJ do órgão, sequencial, ano) |
| `objetoCompra` | texto livre do objeto |
| `valorTotalEstimado` | `105736.68` |
| `modalidadeId`, `modalidadeNome` | `6`, `Pregão - Eletrônico` |
| `dataAberturaProposta`, `dataEncerramentoProposta` | `2026-11-03T09:00:00` (sem fuso; é horário de Brasília) |
| `situacaoCompraId`, `situacaoCompraNome` | `1`, `Divulgada no PNCP` |
| `orgaoEntidade.razaoSocial`, `orgaoEntidade.cnpj` | `MUNICIPIO DE CORONEL PACHECO` |
| `unidadeOrgao.municipioNome`, `unidadeOrgao.ufSigla`, `unidadeOrgao.codigoIbge` | `Coronel Pacheco`, `MG`, `3119609` |
| `linkSistemaOrigem` | link do sistema onde a disputa acontece, ou `null` |

## Códigos de modalidade

1 Leilão eletrônico · 2 Diálogo competitivo · 3 Concurso · 4 Concorrência eletrônica · 5 Concorrência presencial · 6 Pregão eletrônico · 7 Pregão presencial · 8 Dispensa de licitação · 9 Inexigibilidade · 10 Manifestação de interesse · 11 Pré-qualificação · 12 Credenciamento · 13 Leilão presencial

Para software sob medida, as mais comuns são 6 (pregão eletrônico), 8 (dispensa) e 4 (concorrência eletrônica).

## Armadilhas reais (vistas na amostra de 22/10/2026)

- **Datas de mentira:** contratações com abertura e encerramento iguais e cravados em `2026-12-31`, um valor de preenchimento. Não dá para confiar cegamente no prazo.
- **Texto sujo:** `objetoCompra` com espaços no começo, quebras de linha no meio e tudo em caixa alta.
- **Link vazio:** `linkSistemaOrigem` vem `null` com frequência. Monte o link da página do edital no PNCP a partir do `numeroControlePNCP` (abra um edital no navegador para confirmar o formato da URL).
- **Valor zero ou ausente:** a lei permite orçamento sigiloso. Não descarte o edital por isso.
- **Situação muda:** um edital já enviado pode ser suspenso ou revogado depois. Avisar disso fica como extra.
- **Volume e lentidão:** milhares de registros e uma API pública que às vezes demora ou falha.

## Armadilhas do GitHub Actions

- O `cron` do `schedule` usa UTC. 8h em Brasília é `0 11 * * 1-5`.
- Execuções agendadas podem atrasar em horários de pico.
- Em repositórios públicos, o GitHub desativa workflows agendados depois de 60 dias sem atividade no repositório.

## `objetos_rotulados.csv`

40 objetos de compra fictícios, no estilo dos reais: 15 relevantes e 25 não relevantes. A coluna `armadilha` mostra a palavra que engana um filtro ingênuo (como "sistema" em sistema de abastecimento de água, ou "site" em publicação no site do diário oficial).
