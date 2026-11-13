# Clawd-Usage-HUD: decisões do protótipo

Aprovadas por Bali em 2026-11-11, a partir de `prototipo.html` (abrir no navegador; seletores de superfície, situação e pose no topo).

## O que é
Uma faixa acima do prompt com o uso da sessão (janela de 5 horas, semana, contexto e cache), os subagentes e as sessões que esta sessão abriu.

## Cartão
- Rei Clawd à esquerda, centralizado na altura do cartão, com o que está fazendo escrito embaixo. São 14 poses; a coroa não pode ser cortada quando ele pula.
- Três barras do mesmo comprimento, porcentagens na mesma coluna: **Janela 5h**, **Semana** (limite semanal, `seven_day`) e **Contexto**.
- Contexto em camadas: conversa, ferramentas e arquivos. Sem "sistema". Legenda só quando há trabalho ou o contexto está alto.
- Cache na mesma linha da legenda, à direita, pequeno e discreto: verde quente com contagem regressiva, amarelo nos últimos 5 min, azul frio ("a próxima mensagem relê tudo").
- Sem barra do plano e sem botão de handoff.

## Ocultar
- Tudo começa oculto em toda sessão nova: o cartão numa linha (Rei pequeno, 5h, Semana, Contexto, cache e contagem) e as duas seções fechadas. Não guarda o estado entre sessões.
- Três botões independentes: o do cartão, o de **Subagentes** e o de **Sessões que esta abriu**.

## Sessões em paralelo
- Só as sessões aninhadas, isto é, as que esta sessão abriu (galho `└` como na barra lateral). Sessões soltas não aparecem mais, mesmo com o processo vivo.
- Risco a verificar primeiro: como o mod descobre a sessão-mãe de uma sessão aninhada.

## Superfícies
- Desktop, VS Code e terminal. Desktop e VS Code usam o mesmo desenho; o VS Code empilha as colunas por ser estreito.
- Terminal: sem a linha "Rei Clawd"; 5h, semana e contexto numa linha só, cache no fim; colunas de largura fixa, com `[■ Parar]` e `[▾ Ocultar]` na mesma coluna.

## Automação do cache
- Sessão parada, faltando 5 min para o cache esfriar e sem mensagem de Bali: o mod manda à própria sessão (`$.prompt.submit`) o pedido para pausar a tarefa e atualizar as pendências conforme as regras da pasta (listas do Brain ou `.memory/` do projeto).
- Dispara uma vez por período parado; volta a valer depois da próxima mensagem de Bali. Aparece na conversa como mensagem do mod.
