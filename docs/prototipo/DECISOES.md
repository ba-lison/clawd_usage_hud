# Clawd-Usage-HUD: decisões do protótipo

Aprovadas por Bali em 2026-11-11, a partir de `prototipo.html` (abrir no navegador; seletores de superfície, situação e pose no topo).

## O que é
Um mod só, no lugar do `usage-hud` e da `tripulacao`, que serão desinstalados quando este entrar. Código 100% próprio; as ideias externas (composição do contexto, relógio do cache) foram adaptadas.

## Cartão
- Rei Clawd à esquerda, centralizado na altura do cartão, com o que está fazendo escrito embaixo. As 14 poses do usage-hud continuam todas; a coroa não pode ser cortada quando ele pula.
- Três barras do mesmo comprimento, porcentagens na mesma coluna: **Janela 5h**, **Semana** (limite semanal, `seven_day`) e **Contexto**.
- Contexto em camadas: conversa, ferramentas e arquivos. Sem "sistema". Legenda só quando há trabalho ou o contexto está alto.
- Cache na mesma linha da legenda, à direita, pequeno e discreto: verde quente com contagem regressiva, amarelo nos últimos 5 min, azul frio ("a próxima mensagem relê tudo").
- Sem barra do plano. Sem botão de handoff (removido de vez, com a sugestão em 50%, o Compactar e o Retomar).

## Ocultar
- Tudo começa oculto em toda sessão nova: o cartão numa linha (Rei pequeno, 5h, Semana, Contexto, cache e contagem) e as duas seções fechadas. Não guarda o estado entre sessões.
- Três botões independentes: o do cartão, o de **Subagentes** e o de **Sessões que esta abriu**.

## Sessões em paralelo
- Só as sessões aninhadas, isto é, as que esta sessão abriu (galho `└` como na barra lateral). Sessões soltas não aparecem mais, mesmo com o processo vivo.
- Limpar os arquivos velhos de `~/.claude/tripulacao/sessoes/`.
- Risco a verificar primeiro: como o mod descobre a sessão-mãe de uma sessão aninhada.

## Superfícies
- Desktop, VS Code e terminal. Desktop e VS Code usam o mesmo desenho; o VS Code empilha as colunas por ser estreito.
- Terminal: sem a linha "Rei Clawd"; 5h, semana e contexto numa linha só, cache no fim; colunas de largura fixa, com `[■ Parar]` e `[▾ Ocultar]` na mesma coluna.

## Automação do cache
- Sessão parada, faltando 5 min para o cache esfriar e sem mensagem de Bali: o mod manda à própria sessão (`$.prompt.submit`) o pedido para pausar a tarefa e atualizar as pendências conforme as regras da pasta (listas do Brain ou `.memory/` do projeto).
- Dispara uma vez por período parado; volta a valer depois da próxima mensagem de Bali. Aparece na conversa como mensagem do mod.
