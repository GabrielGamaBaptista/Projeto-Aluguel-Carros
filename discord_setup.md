# Configurar Claude Code remoto via Discord (Channels Plugin)

## Contexto
Interagir com o Claude Code remotamente pelo Discord, enviando mensagens ao bot e recebendo respostas — sem precisar estar no terminal. Abordagem: **Channels Plugin** (integracao oficial, research preview) rodando localmente no Windows.

## Pre-requisitos

1. **Instalar Bun** (runtime necessario para o plugin Discord)
   - Ir em https://bun.sh e seguir instrucoes para Windows
   - Verificar: `bun --version`

2. **Claude Code atualizado** (v2.1.80+)
   - Verificar: `claude --version`

## Passo a passo

### Etapa 1 — Criar Bot no Discord Developer Portal
1. Acessar https://discord.com/developers/applications
2. Clicar **New Application** → dar nome (ex: "BapCar Claude")
3. Ir em **Bot** → **Reset Token** → copiar o token
4. Em **Privileged Gateway Intents**, ativar **Message Content Intent**
5. Ir em **OAuth2 > URL Generator**:
   - Scope: `bot`
   - Permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History, Attach Files, Add Reactions
6. Copiar URL gerada → abrir no browser → adicionar bot ao seu servidor Discord

### Etapa 2 — Instalar o Plugin no Claude Code
```bash
/plugin marketplace add anthropics/claude-plugins-official
/plugin install discord@claude-plugins-official
/reload-plugins
```

### Etapa 3 — Configurar o Token do Bot
```bash
/discord:configure SEU_BOT_TOKEN_AQUI
```
(Salva em `~/.claude/channels/discord/.env`)

### Etapa 4 — Iniciar Claude Code com Channels
Sair da sessao atual e reiniciar:
```bash
claude --channels plugin:discord@claude-plugins-official
```

### Etapa 5 — Parear sua Conta Discord
1. No Discord, enviar DM para o bot com qualquer mensagem
2. O bot responde com um **codigo de pareamento**
3. No terminal do Claude Code:
```bash
/discord:access pair CODIGO_AQUI
/discord:access policy allowlist
```

### Etapa 6 — Usar!
- Enviar mensagens ao bot no Discord
- Claude Code recebe, processa, e responde no Discord
- O terminal mostra as tool calls em tempo real

## Limitacoes importantes

| Limitacao | Impacto |
|-----------|---------|
| Terminal precisa ficar aberto | Se fechar o terminal, o bot para de responder |
| Permission prompts bloqueiam | Se Claude pedir permissao no terminal e voce nao estiver la, trava ate aprovar |
| Sem persistencia entre sessoes | Se reiniciar Claude Code, precisa reconectar |
| Research preview | Sintaxe pode mudar em versoes futuras |

## Dicas para uso no Windows

- Manter o Windows Terminal aberto com a sessao Claude Code
- Considerar usar `--dangerously-skip-permissions` **apenas se confiar** nos comandos que vai enviar (auto-aprova tudo)
- Se quiser rodar "semi-background": minimizar a janela do terminal (nao fechar)

## Verificacao

1. Enviar mensagem ao bot no Discord → deve responder
2. Pedir algo como "list files in current directory" → deve executar e retornar resultado
3. Verificar no terminal que as tool calls aparecem em tempo real
