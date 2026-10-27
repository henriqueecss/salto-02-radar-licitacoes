# Decisões

Registro das decisões do projeto, com as alternativas descartadas. As três primeiras são as que mais moldam o sistema.

## 1. Qual endpoint consultar

**Escolha:** `/v1/contratacoes/proposta`, filtrando por UF e por modalidade (6 pregão eletrônico, 8 dispensa, 4 concorrência eletrônica).

**Por quê:** esse endpoint devolve o que está com proposta aberta **agora**, não importa quando foi publicado. Se o job falhar na segunda, o edital continua aberto na terça e entra no resumo. Nada se perde por causa de um dia ruim. O preço é que o mesmo edital volta todo dia, e por isso a deduplicação é obrigatória.

**Medido na prática (22 e 23/10/2026):** cerca de 3.000 contratações abertas em MG nas três modalidades (2.132 de pregão eletrônico, 355 de dispensa e 519 de concorrência), o que dá cerca de 61 páginas. O `tamanhoPagina` máximo aceito é 50: com 100 e com 500 a API devolve 400, embora um manual antigo fale em 500.

**Descartadas:**
- `/v1/contratacoes/publicacao` (publicados ontem): tem volume pequeno por dia, mas exige uma chamada por modalidade, e um dia de falha vira um buraco permanente, a não ser que se mantenha uma janela de reprocessamento. Para este problema, perder edital é o pior erro possível.
- Os dois endpoints juntos: seria mais robusto, mas dobra código e chamadas sem ganho claro sobre o `/proposta`.

## 2. Como filtrar

**Escolha:** regras com pontuação sobre o texto normalizado (minúsculo, sem acento, espaços unificados).

| Tipo de termo | Peso | Exemplos |
|---|---|---|
| forte | +3 | "sistema web", "fábrica de software", "aplicativo móvel", "sítio eletrônico", "UST", "código-fonte" |
| fraco | +1 | "desenvolvimento", "sistema", "portal", "manutenção" |
| exclusão | −3 | "aquisição", "locação", "CFTV", "pneus", "engenharia", "fornecimento de sistema" |
| veto | −100 | "licenciamento", "licença", "SaaS", "software como serviço", "cessão de uso" |

Um edital é aprovado com 3 pontos ou mais. A pontuação também ordena o resumo e explica a decisão: o `npm run evaluate` mostra quais termos pesaram em cada item.

**Por quê:** é explicável, dá para ajustar o limiar para priorizar recall e entrega a "pontuação de aderência" (que era um extra) sem esforço adicional.

**O que aconteceu:** o filtro bateu 100% de recall e de precisão nos 40 exemplos rotulados logo de cara. Num dia real, a precisão foi de **40%**. As regras tinham sido escritas para os 40 exemplos. O ajuste foi feito por **categoria de erro**, e não edital por edital:
- licença e SaaS viraram **veto**: a empresa decidiu que software pronto fica fora mesmo quando vem com desenvolvimento junto;
- o prefixo da plataforma de disputa ("[Portal de Compras Públicas] -", "[LICITANET] -") passou a ser removido antes da pontuação, porque a palavra "portal" fazia hidrojateamento parecer site;
- "fornecimento de sistema/solução", "abastecimento" e "cartão magnético" viraram exclusão.

**Descartadas:**
- Palavra-chave com lista de exclusão binária: é mais simples, mas um único termo de exclusão derruba um edital bom e não há ranking.
- Modelo estatístico (TF-IDF, Naive Bayes): com 40 exemplos ele decora o conjunto, não explica a decisão e exigiria dependência nova. Um LLM fica como extra.

## 3. Onde guardar o estado entre execuções

**Escolha:** um arquivo SQLite (`radar.db`) commitado numa branch separada, `state`, montada como `git worktree` dentro do job.

**Por quê:** é grátis, cada execução vira um commit auditável, e o histórico fica pronto para uma futura página web. A branch separada mantém a `main` limpa, sem commits de bot misturados com o código. O `git push` usa a credencial que o `actions/checkout` já configura, sem token na URL.

**Regra importante:** o estado só é gravado **depois** que o Telegram confirma o envio. Se o envio falhar, os editais voltam na próxima execução. O pior caso é receber um edital repetido, nunca perder um.

**Biblioteca:** `node:sqlite`, embutido no Node. Não adiciona dependência e não precisa compilar binário nativo no runner. No Node 22 ele ainda emite aviso de experimental; no Node 24 LTS, usado no CI, é estável. O `better-sqlite3` foi descartado por ser dependência nativa.

**Descartadas:**
- Cache ou artifact do Actions: o cache é removido depois de 7 dias sem uso e o artifact expira em 90 dias. Quando o estado some, o bot reenvia tudo.
- Banco externo gratuito (Turso, Supabase): é o mais robusto, mas exige conta, mais um segredo e um terceiro. É exagero para o tamanho do problema.
- JSON em vez de SQLite: daria um diff legível, mas a stack pede SQLite e a consulta por chave fica mais simples assim.

## 4. Como lidar com a API lenta ou instável

**Escolha:**
- timeout de 30 s por requisição (`AbortSignal.timeout`);
- até 5 tentativas; repete em 5xx, 429, timeout e erro de rede; não repete em 4xx, que é erro de quem pediu;
- backoff exponencial com jitter (1 s, 2 s, 4 s...) para falhas comuns;
- no **429**, respeita o header `Retry-After` se vier; senão espera 10 s, 20 s, 40 s...;
- pausa de 1 s entre páginas;
- se uma página falhar de vez, a coleta inteira aborta: nada é enviado nem gravado, e o job termina com erro (o GitHub avisa por e-mail).

**Por que o 429 tem tratamento próprio:** na primeira execução contra a API real, o PNCP começou a devolver 429 depois de 8 páginas seguidas, e o backoff de 1, 2 e 4 s não bastava para sair do bloqueio. As fixtures não mostravam isso, porque só o teste de verdade revelou o problema. Com a pausa entre páginas e a espera maior, a coleta completa passou: 7 das cerca de 61 páginas foram bloqueadas, e todas passaram na terceira tentativa, depois de esperar 10 s e 20 s.

**Descartada:** enviar um resumo parcial com aviso de "coleta incompleta". Algo chegaria naquele dia, mas o estado ficaria pela metade e a mensagem poderia confundir. Como o endpoint `/proposta` torna o job idempotente, abortar e tentar de novo no dia seguinte não perde nada.

## 5. Formato da mensagem

**Escolha:** um resumo por dia, ordenado por pontuação. Cada edital mostra objeto (cortado em 350 caracteres), órgão, município, modalidade, valor ("sigiloso ou não informado" quando vem zero), prazo e link para a página do edital no PNCP. Editais que encerram em até 3 dias recebem a marca "[encerra em breve]". Valor estimado a partir de R$ 5 milhões recebe "[porte alto]" e vai para o fim do resumo, porque contratos desse tamanho costumam exigir atestados e estrutura que uma software house pequena não tem. Quando não há nada novo, o bot avisa "Nenhum edital novo hoje", o que também prova que o job rodou.

**Limite do Telegram:** quando o resumo passa de 4.096 caracteres, ele é dividido entre editais, nunca no meio de um, e as partes são numeradas (1/2, 2/2). Entre uma mensagem e outra há uma pausa de 1,1 s, e um 429 do Telegram é tratado respeitando o `retry_after`.

**HTML em vez de MarkdownV2:** o MarkdownV2 exige escapar 18 caracteres e quebra fácil com textos de edital; o HTML só exige escapar `<`, `>`, `&` e aspas.

**Descartada:** uma mensagem por edital. Daria para encaminhar cada edital sozinho, mas num dia cheio vira enxurrada e esbarra no limite de envio do Telegram.

**Porte alto só rotula:** um teto de valor (`RADAR_VALOR_MAXIMO`) tiraria o edital do resumo com base numa estimativa que o órgão pode errar ou esconder. Com o rótulo, o edital continua visível e o valor decide quem olha primeiro.

## 6. LLM como segunda etapa do filtro

**Escolha:** as regras continuam como primeira peneira, e um LLM gratuito julga os editais que elas aprovaram **e** os que elas rejeitaram mas têm vocabulário de TI (sistema, software, site, plataforma...). A decisão final é do LLM; sem veredito, vale a regra. O provedor é o Groq com o modelo `qwen/qwen3.8-27b`, chamado pela API `/chat/completions` no formato da OpenAI com o `fetch` nativo, sem dependência nova.

**Por quê:** num dia real, as regras sozinhas aprovaram gestão de frota por cartão (o texto citava "aplicativos móveis") e não tinham como avaliar textos que não usam os termos fortes. Uma lista de palavras não entende o contexto, e um modelo de linguagem entende. Mandar também os rejeitados com vocabulário de TI deixa o LLM **recuperar recall**, e não só melhorar a precisão.

**Como cabe no plano gratuito** (limites medidos nos cabeçalhos da resposta em 23/10/2026: 1.000 requisições por dia, 8.000 tokens por minuto e, no `qwen`, só 1.000 tokens de **saída** por minuto):
- **lotes de 20 editais por chamada**, com JSON compacto e motivo de até 8 palavras: cerca de 27 tokens de saída por edital;
- **um lote por minuto**, com teto de 800 tokens de saída por pedido. Sem esse teto, o Groq estima a saída pelo pior caso e recusa o pedido antes de rodar;
- **cada edital é julgado uma vez só**: o veredito fica na tabela `classificacoes` do SQLite, e um edital que continua aberto no dia seguinte não gasta outra chamada;
- **no máximo 200 editais por execução**, com os aprovados pelas regras primeiro. O primeiro dia tem cerca de 340 candidatos, então o resto fica para o dia seguinte. Dali em diante entram só algumas dezenas por dia.

**Falhas:** chave inválida, cota esgotada ou API fora interrompem a classificação, e os editais ficam com a decisão das regras. Um `Retry-After` acima de 2 minutos é tratado como cota esgotada, e o job não fica dormindo. JSON inválido (o Groq devolve 400 `json_validate_failed`) perde só aquele lote. O LLM nunca derruba o job nem faz um edital sumir.

**Perfil:** serviço de sistema ou plataforma digital **conta** como oportunidade quando o texto não pede licença, locação ou cessão de uso de um produto pronto. A empresa pode construir e operar a solução (por exemplo, a bilheteria da vaquejada de Januária e o sistema do cemitério de Andrelândia na amostra real). Licença e cessão de uso de software pronto continuam fora.

**Modelos comparados** no conjunto real de 20 editais, mesmo prompt:

| Modelo | Resultado |
|---|---|
| `openai/gpt-oss-120b` | instável: precisão de 80%, 66,7% e 100% em três execuções iguais. Errou "sistema de registro de preços" de peças automotivas e a frota por cartão |
| `openai/gpt-oss-20b` | o Groq recusou o lote por JSON inválido (`json_validate_failed`) |
| `qwen/qwen3.8-27b` | 100% de recall e de precisão em todas as execuções, nos dois conjuntos, com lotes de 10 e de 20 |

**Teste completo num dia real (23/10/2026, sem enviar):** 3.066 contratações coletadas, 355 candidatas ao LLM, 200 julgadas sem falha (dois 429 absorvidos pelo retry) e 155 adiadas, como previsto. A frota por cartão saiu do resumo. Um erro apareceu: um edital de geotecnologia foi aprovado com o motivo "Licenciamento de sistemas web e mobile", o que contradiz o prompt. Esse erro vai para a próxima amostra rotulada, e não para um ajuste feito às pressas no prompt.

**Descartadas:**
- API paga (Anthropic, OpenAI): melhor qualidade e limites folgados, mas a empresa quer custo zero.
- Gemini gratuito: em 2026 o Google cortou o plano grátis e tirou os limites da documentação. É instável demais para um job diário.
- GitHub Models: usaria o próprio `GITHUB_TOKEN` no Actions, mas os limites são pouco documentados. Fica como alternativa, e a troca é só mudar `LLM_BASE_URL` e `LLM_MODEL`.
- Modelo local (Ollama) no runner: só caberia um modelo pequeno rodando em CPU, lento e fraco para esse julgamento.
- Um edital por chamada: 340 chamadas no primeiro dia e o limite de tokens por minuto estourado.
- LLM só nos aprovados pelas regras: mais barato, mas não recupera nenhum edital que as regras perderam.

## Outras decisões

- **Mesmo edital, dois ids:** em 27/10/2026 o resumo trouxe o mesmo edital duas vezes, um com o prefixo "[Portal de Compras Públicas]" e outro sem, com ids e encerramentos (09:00 e 08:59) diferentes. Agora órgão, objeto sem prefixo e valor, normalizados (sem acento, caixa e pontuação), formam uma chave guardada no SQLite. Vale dentro da mesma coleta e entre execuções, e bancos antigos recebem a coluna e o histórico na abertura. O risco é descartar dois editais legítimos de mesmo órgão, objeto e valor, que é raro e aceitável para quem prioriza não repetir.
- **Ajuste do prompt (27/10/2026):** a empresa desenvolve software, web, aplicativos e automações, não presta infraestrutura e quer serviços que não exijam comparecimento. O LLM aprovou operação de infraestrutura de TIC (TJMG, R$ 181 milhões) e consultoria de LGPD, e rejeitou, numa rodada, o e-Cidade por "sistema pronto licenciado", que o texto não diz. O prompt passou a excluir infraestrutura de TIC (a menos que o texto peça desenvolvimento ou evolução de software) e consultoria que não entrega software, e a incluir manutenção evolutiva de sistema que o órgão já usa. Uma primeira versão da cláusula de objeto misto trouxe de volta o edital de geotecnologia da amostra real (100% para 80% de precisão); ela foi estreitada para "parte central do contrato, não item acessório de engenharia ou serviço jurídico". A fronteira entre o GeoBIM e o SIG de Presidente Olegário é fina, e o ajuste foi feito olhando esses casos. O filtro não precisa acertar 100%: um falso positivo custa a leitura, e o que ele deve cortar é o que claramente não é TI ou está na lista do que a empresa não presta.
- **Presencial só rotula:** o edital que indica trabalho presencial continua no resumo com o aviso "[presencial]", porque a empresa prefere decidir lendo o edital. A detecção olha só o texto do objeto (presencial, in loco, posto de trabalho, técnico residente, operação assistida), e a exigência costuma estar no termo de referência, que o radar não lê. O rótulo é uma ajuda, não uma garantia.

- **Prazo de mentira:** quando abertura e encerramento caem em 31/12 do mesmo dia, o prazo é tratado como "a confirmar no edital", e não como data real. Prazo ausente ou suspeito nunca exclui um edital.
- **Valor:** zero ou ausente vira `null`, aparece como "sigiloso ou não informado" e nunca é excluído pela faixa de valor.
- **Link:** como `linkSistemaOrigem` vem nulo com frequência, o link é montado a partir do `numeroControlePNCP`: `18278051000145-1-000133/2026` vira `pncp.gov.br/app/editais/18278051000145/2026/133`.
- **Medição honesta:** a amostra real foi rotulada às cegas (o CSV não mostra o que o filtro achou) e inclui editais rejeitados com vocabulário de TI, que é onde um falso negativo se esconderia. A medição "antes" foi feita com o código do commit anterior ao ajuste.
