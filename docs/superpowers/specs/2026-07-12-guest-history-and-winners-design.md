# EuroPool — Histórico de Épocas, Sorteios e Vencedores Automáticos
**Data:** 2026-07-12
**Estado:** Aprovado para implementação

---

## 1. Visão Geral

Estende o menu do convidado (`guest.html`) com três funcionalidades:

1. **Temporadas anteriores** — convidados podem consultar épocas terminadas (leaderboard, sorteios e vencedor(es)).
2. **Histórico completo de sorteios** — convidados deixam de ver só o último sorteio da época ativa; podem expandir a lista completa.
3. **Deteção e anúncio automático de vencedor(es)** — quando um ou mais jogadores completam as 15 chaves, o sistema regista-os automaticamente como vencedores (suportando múltiplos), encerra a época, e anuncia-os aos convidados.

Este documento assume o modelo de dados e a arquitetura descritos em `docs/superpowers/specs/2026-06-21-europool-design.md` e detalha apenas o que muda.

---

## 2. Modelo de Dados

### 2.1 Nova tabela `season_winners`

O esquema atual suporta apenas um vencedor por época (`seasons.winner_player_id`, FK única). Para suportar múltiplos vencedores simultâneos, introduz-se uma relação muitos-para-muitos:

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid (PK) | Identificador único |
| `season_id` | uuid (FK → seasons) | Época a que pertence |
| `player_id` | uuid (FK → players) | Jogador vencedor |
| `created_at` | timestamptz | Auto |

> **Constraint:** `UNIQUE(season_id, player_id)` — evita duplicar o mesmo vencedor na mesma época.

### 2.2 Migração de dados existentes

`seasons.winner_player_id` deixa de ser a fonte de verdade para leitura (mantém-se a coluna por retrocompatibilidade, mas nada volta a lê-la depois desta migração). É necessário migrar os vencedores já declarados manualmente:

```sql
-- 1. Criar a tabela
create table season_winners (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (season_id, player_id)
);

-- 2. RLS (mesmo padrão das restantes tabelas)
alter table season_winners enable row level security;
create policy "season_winners_select_public" on season_winners
  for select using (true);
create policy "season_winners_write_admin" on season_winners
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 3. Migrar vencedores já declarados
insert into season_winners (season_id, player_id)
select id, winner_player_id from seasons
where winner_player_id is not null
on conflict (season_id, player_id) do nothing;
```

Este SQL é corrido manualmente no Supabase SQL Editor pelo utilizador (não existe CLI/migrations no projeto — mesmo processo usado para criar as tabelas originais).

---

## 3. Lógica de Negócio

### 3.1 Deteção automática de vencedor(es)

**Momento do trigger:** logo após o admin registar um novo sorteio com sucesso (`js/admin.js`, handler do `draw-form`, hoje em `admin.js:109-136`). É o único momento em que o progresso de um jogador pode mudar, e é uma ação de escrita já feita pelo admin autenticado — não há verificação client-side vinda de convidados anónimos.

**Fluxo (nova função `checkForWinners(seasonId)`):**
1. Buscar `season_players` (com `key_numbers`, `player_id`) e todos os `draws` da época.
2. Para cada jogador, calcular `calcProgress(key_numbers, draws)` (função já existente em `js/utils.js`).
3. Filtrar jogadores com `matched.length === 15`.
4. Se a lista não estiver vazia:
   - Inserir uma linha em `season_winners` por cada vencedor (`on conflict do nothing`, para não duplicar caso a função seja chamada mais que uma vez).
   - Atualizar `seasons`: `is_active = false`, `end_date = hoje`.
   - Mostrar alerta ao admin: `🏆 Vencedor(es): Nome1, Nome2 — temporada encerrada automaticamente.`
   - Repor `currentSeason = null` e atualizar o rótulo da época ativa (mesmo padrão já usado em `declareWinner()`).
5. Se a lista estiver vazia, não faz nada (fluxo normal continua).

**Empates:** se mais do que um jogador atingir 15/15 no mesmo sorteio, todos são inseridos como vencedores da mesma época — não há critério de desempate.

### 3.2 Declarar Vencedor manual (fallback)

Mantido no tab "Temporadas" para correções/casos excecionais, mas atualizado para consistência:
- O `<select>` único passa a lista de checkboxes (permite selecionar 0, 1 ou vários jogadores).
- Ao confirmar, insere uma linha em `season_winners` por jogador selecionado e fecha a época (mesmo efeito colateral do fluxo automático).
- Deixa de escrever em `seasons.winner_player_id`.

### 3.3 Leitura de vencedores

Qualquer ecrã que hoje lê `winner:players!winner_player_id(name)` passa a fazer um `select` a `season_winners` com join a `players`, agrupando por `season_id` no cliente (uma época pode ter 0, 1 ou N vencedores). Afeta:
- `js/admin.js` → `loadSeasonsTab()` (histórico de épocas, `admin.js:456-491`).
- Novo `js/seasons.js` (ver secção 4.3).
- `js/guest.js` (banner de anúncio, ver secção 4.2).

---

## 4. Interface — Convidado

### 4.1 Histórico completo de sorteios (época ativa)

Em `guest.html`, por baixo da secção "Último Sorteio" (`guest.html:22-25`), é adicionado um botão **"Ver histórico completo ▾"**. Ao clicar, expande uma lista com todos os sorteios da época ativa (data + 5 bolas), ordenados do mais recente para o mais antigo.

Não é necessária nenhuma query adicional: `js/guest.js` já busca o array completo de `draws` (`guest.js:30-39`) só para calcular progresso — passa a também ser usado para preencher esta lista, guardado em variável para o toggle.

### 4.2 Anúncio automático de vencedor(es)

Em `js/guest.js` → `loadLeaderboard()`, quando `getActiveSeason()` devolve `null` (hoje mostra apenas o alerta genérico "Não existe nenhuma temporada ativa", `guest.js:10-14`):

1. Buscar a época mais recente com `is_active = false`, ordenada por `end_date` decrescente, limite 1.
2. Se existir, buscar os seus vencedores em `season_winners` (join `players`).
3. Mostrar um banner de destaque (novo, estilo diferenciado — dourado/celebração) acima do leaderboard:
   > 🏆 A Temporada "Temporada 3" terminou! Vencedor(es): **Ana**, **Rui** 🎉
   > [Ver histórico desta temporada →]
4. O link aponta para `seasons.html?season_id=<id>`.

Este banner desaparece automaticamente assim que o admin criar uma nova época ativa (o fluxo normal de `loadLeaderboard()` volta a aplicar-se, sem necessidade de nenhum flag "já anunciado").

### 4.3 Página "Temporadas Anteriores" (`seasons.html`, novo ficheiro + `js/seasons.js`)

Acesso a partir de um novo link em `guest.html` (junto ao topbar/último sorteio): **"📅 Temporadas Anteriores"**.

**Vista de lista (default):**
- Cards/tabela com todas as épocas `is_active = false`, ordenadas por `end_date` decrescente.
- Cada item: nome da época, período (`start_date` → `end_date`), vencedor(es) (🏆 nomes, ou "Sem vencedor registado" se a época foi fechada sem vitória).
- Clicar num item navega para `seasons.html?season_id=<id>`.

**Vista de detalhe** (quando há `season_id` na query string):
- Botão "← Voltar" para a lista.
- Banner do(s) vencedor(es) da época (mesmo estilo da secção 4.2).
- Lista de todos os sorteios dessa época (data + 5 bolas), mais recente primeiro.
- Leaderboard completo dessa época: mesma renderização do leaderboard do convidado (posição, nome, `X/15`, barra de progresso), calculado com `calcProgress` sobre os `draws` e `season_players` dessa época — reaproveita a lógica já existente em `guest.js`/`admin.js`, sem pesquisa nem clique para perfil individual (fora de âmbito — ver secção 5).

Todas as leituras desta página são públicas (RLS `SELECT` já é público em `seasons`, `season_players`, `draws`, e passa a ser em `season_winners`).

---

## 5. Fora de Âmbito (YAGNI)

- **Perfil individual (`player.html`) de épocas antigas** — a vista de detalhe da época mostra o leaderboard completo, não a grelha 15 bolas por jogador. Pode ser adicionado depois se for pedido.
- **Notificações push/email** do anúncio de vencedor — mantém-se fora de âmbito (já decidido no design original). O "anúncio automático" é um banner dentro da app, visível a quem a abrir.
- **Critério de desempate** entre vencedores simultâneos — todos os que chegam a 15/15 no mesmo sorteio são vencedores em pé de igualdade.
- **Reabrir uma época já fechada automaticamente** (ex: admin apagar o sorteio que gerou o vencedor) — não há lógica de reversão; se necessário, é uma correção manual direta na base de dados.

---

## 6. Critérios de Sucesso

- [ ] Convidado consegue ver a lista de épocas anteriores e o respetivo vencedor(es).
- [ ] Convidado consegue abrir o detalhe de uma época antiga e ver leaderboard + sorteios dessa época.
- [ ] Convidado consegue expandir o histórico completo de sorteios da época ativa (não só o último).
- [ ] Quando um jogador atinge 15/15, é automaticamente registado como vencedor ao admin registar o sorteio correspondente, e a época fecha sozinha.
- [ ] Se mais do que um jogador atingir 15/15 com o mesmo sorteio, todos ficam registados como vencedores dessa época.
- [ ] Assim que uma época fecha automaticamente, os convidados veem um banner de anúncio do(s) vencedor(es) ao abrir `guest.html`, até o admin criar a próxima época.
- [ ] O fallback manual "Declarar Vencedor" continua a funcionar e suporta selecionar vários jogadores.
- [ ] Histórico de épocas no painel admin mostra corretamente 0, 1 ou vários vencedores por época.
