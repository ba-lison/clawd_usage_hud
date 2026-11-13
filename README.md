<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/hero-grafite.svg">
  <img src="assets/hero-papel.svg" alt="Clawd-Usage-HUD · O uso da sessão do Claude Code numa faixa acima do prompt" width="100%">
</picture>

<h1 align="center">Clawd-Usage-HUD</h1>

<p align="center">Mod do Claude Code que mostra, numa faixa acima do prompt, quanto da janela de 5 horas, da semana e do contexto a sessão já usou, junto com os subagentes e as sessões que ela abriu.</p>

<p align="center">
  <img alt="versão: 0.1.1" src="https://img.shields.io/badge/vers%C3%A3o-0.1.1-4C6972?style=flat-square&amp;labelColor=202725">
  <img alt="ambiente: Claude Code" src="https://img.shields.io/badge/ambiente-Claude%20Code-5C6554?style=flat-square&amp;labelColor=202725">
  <a href="LICENSE"><img alt="licença: proprietária" src="https://img.shields.io/badge/licen%C3%A7a-propriet%C3%A1ria-5C6554?style=flat-square&amp;labelColor=202725"></a>
</p>

<p align="center">
  <a href="#começar-a-usar">Começar a usar</a> &nbsp; / &nbsp;
  <a href="#demonstração-e-recursos">Ver recursos</a> &nbsp; / &nbsp;
  <a href="#documentação-e-ajuda">Documentação</a>
</p>

---

## Sobre o projeto

Quem passa o dia no Claude Code costuma descobrir o limite de uso tarde: a janela de 5 horas acaba no meio de uma tarefa, o contexto enche sem aviso e o cache esfria enquanto você está longe do computador. O Clawd-Usage-HUD mostra esses números numa faixa logo acima da caixa de mensagem.

À esquerda fica o Rei Clawd, um personagem que muda de pose conforme o que a sessão faz: lendo arquivos, editando, rodando comandos no terminal, orquestrando subagentes. São 14 poses ao todo. Ao lado dele há três barras, uma para a janela de 5 horas, uma para o limite semanal e uma para o contexto. Embaixo aparecem os subagentes em andamento e as sessões que esta sessão abriu, com o modelo, o uso e a ação atual de cada um.

Toda sessão nova começa com a faixa recolhida numa linha.

## Demonstração e recursos

![Faixa do Clawd-Usage-HUD aberta no app desktop, com o cartão de uso, dois subagentes e duas sessões abertas](assets/demo-hud.png)

<sub>Captura do protótipo da interface (<code>docs/prototipo/prototipo.html</code>), no cenário "Trabalhando com subagentes". Os valores são fictícios.</sub>

### O que você consegue fazer

- Ver quanto já gastou da janela de 5 horas e da semana, a que horas cada uma renova e quanto tempo falta.
- Ver o contexto dividido em conversa, ferramentas e arquivos. A legenda aparece quando há trabalho em andamento ou o contexto está alto.
- Saber o estado do cache pela cor: verde com contagem regressiva enquanto está quente, amarelo nos últimos 5 minutos e azul quando a próxima mensagem vai reler tudo.
- Não perder o trabalho quando o cache está para esfriar. Se a sessão estiver parada e faltarem 5 minutos, o mod pede à própria sessão que atualize as pendências conforme as regras da pasta, uma vez a cada período parado.
- Acompanhar subagentes e sessões abertas por esta, com modelo, uso do contexto, tempo e ação atual, e parar qualquer um deles pelo botão Parar.
- Recolher separadamente o cartão, a lista de subagentes e a de sessões.
- Usar no app desktop, no VS Code (com as colunas empilhadas) e no terminal, onde tudo cabe numa linha.

## Começar a usar

O mod é instalado como um marketplace local do Claude Code, a partir de uma cópia deste repositório.

1. Clone o repositório numa pasta da sua máquina (o acesso é restrito).
2. Em `~/.claude/settings.json`, registre a pasta como marketplace e ligue o plugin:

```json
{
  "extraKnownMarketplaces": {
    "clawd-usage-hud": {
      "source": { "source": "directory", "path": "CAMINHO/DA/PASTA/clawd-usage-hud" }
    }
  },
  "enabledPlugins": {
    "clawd-usage-hud@clawd-usage-hud": true
  }
}
```

3. Abra uma sessão nova do Claude Code. A faixa aparece recolhida acima do prompt, e o botão Mostrar abre o cartão.

### Estrutura

| Pasta | Conteúdo |
| --- | --- |
| `.claude-plugin/` | Manifesto do plugin e do marketplace |
| `hooks/` | Registro do mod (`register.tsx`), desenho do Rei Clawd, cartão e leitura das sessões |
| `types/` | Contrato do estado que o cartão desenha |
| `tests/` | Testes do cartão, do cache e das sessões aninhadas |
| `docs/prototipo/` | Protótipo da interface e decisões de desenho |

## Documentação e ajuda

| Assunto | Onde consultar |
| --- | --- |
| Decisões de interface e comportamento | [docs/prototipo/DECISOES.md](docs/prototipo/DECISOES.md) |
| Protótipo navegável (abrir no navegador) | [docs/prototipo/prototipo.html](docs/prototipo/prototipo.html) |
| Formato do estado do mod | [types/index.d.ts](types/index.d.ts) |

### Créditos e materiais de terceiros

Claude e Claude Code são marcas da Anthropic. Este mod não é afiliado à Anthropic.

## Autoria e licença

Desenvolvido por [Alison Cruz](https://github.com/ba-lison) · **BALISON**.

Software proprietário da **BALISON**. Todos os direitos reservados; uso, cópia ou distribuição dependem de autorização prévia e por escrito. Veja o [arquivo LICENSE](LICENSE).

---

<p align="center">
  <a href="https://github.com/ba-lison">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/assinatura-grafite.svg">
      <img src="assets/assinatura-papel.svg" alt="Alison · BALISON" width="280" height="28">
    </picture>
  </a>
  <br>
  <sub>Tecnologia com traço humano.</sub>
</p>
