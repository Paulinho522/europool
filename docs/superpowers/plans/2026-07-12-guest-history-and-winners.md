# Guest Season History, Draw History & Automatic Winners — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let guests browse past seasons, see the full draw history of the active season (not just the latest draw), and have the app automatically detect one-or-more winners (15/15 matches), close the season, and announce them.

**Architecture:** Static HTML/vanilla-JS site backed directly by Supabase (PostgreSQL) — no build step, no server, no test framework. Winner detection runs client-side inside the admin's existing "register draw" flow (the only moment progress can change), writing to a new many-to-many `season_winners` table. Guests read that table to render an announcement banner and a new season-history page.

**Tech Stack:** Vanilla HTML/CSS/JS, `@supabase/supabase-js@2` (CDN), Supabase Postgres + RLS. No npm, no bundler, no test runner.

## Global Constraints

- All UI copy is in Portuguese (pt), matching every existing page.
- RLS pattern for any new table: `SELECT` public, `INSERT/UPDATE/DELETE` restricted to `auth.role() = 'authenticated'` — same as `seasons`, `players`, `season_players`, `draws` (per `docs/superpowers/specs/2026-06-21-europool-design.md` section 3).
- Visual style: reuse existing CSS variables/classes in `css/style.css` (emerald palette, `--admin` gold `#fbbf24` for admin/winner emphasis). Do not introduce a new color palette.
- No push/email notifications — announcements are in-app only (spec section 5, out of scope item confirmed by user).
- Do not modify `player.html` / `js/player.js` — historic per-player profile view is explicitly out of scope (spec section 5).
- **No test framework exists in this repo** (`find . -iname "*test*"` returns nothing, no `package.json`). Every task's verification is manual: open the page directly in a browser (double-click the `.html` file, or serve the folder with `npx serve .` / `python -m http.server` if `file://` causes CORS issues) and confirm behavior, plus direct SQL checks in the Supabase SQL Editor where DB state must be confirmed. This matches how the rest of the project has always been verified — there is nothing to adapt away from.
- Supabase client is the global `db` object from `js/supabase-client.js`, already loaded on every page before other scripts.

---

## Task 1: Database migration — `season_winners` table

**Files:**
- Create: `season_winners_migration.sql` (repo root, alongside the existing one-off `europool_import.sql`)

**Interfaces:**
- Produces: table `season_winners(id uuid PK, season_id uuid FK→seasons, player_id uuid FK→players, created_at timestamptz)`, unique on `(season_id, player_id)`, `SELECT` public / writes authenticated-only. All later tasks read/write this table via `db.from('season_winners')`.

- [ ] **Step 1: Write the migration SQL file**

Create `season_winners_migration.sql`:

```sql
-- season_winners_migration.sql
-- Run manually in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
-- Adds support for multiple winners per season and migrates any winner
-- already recorded via the old single-winner seasons.winner_player_id column.

-- 1. Table
create table season_winners (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (season_id, player_id)
);

-- 2. Row Level Security (same pattern as seasons/players/season_players/draws)
alter table season_winners enable row level security;

create policy "season_winners_select_public" on season_winners
  for select using (true);

create policy "season_winners_write_admin" on season_winners
  for all using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- 3. Migrate any winner already declared through the old column
insert into season_winners (season_id, player_id)
select id, winner_player_id from seasons
where winner_player_id is not null
on conflict (season_id, player_id) do nothing;
```

- [ ] **Step 2: Run the migration**

Open the Supabase Dashboard for this project → SQL Editor → paste the contents of `season_winners_migration.sql` → Run.

Expected: query completes with no errors, "Success. No rows returned" (or similar) for the `create table`/`alter table`/`create policy` statements, and the final `insert` reports the number of rows migrated (0 if no winner was ever manually declared before).

- [ ] **Step 3: Verify the table and RLS in the SQL Editor**

Run:

```sql
select table_name from information_schema.tables where table_name = 'season_winners';
select policyname, cmd from pg_policies where tablename = 'season_winners';
select * from season_winners;
```

Expected: first query returns one row (`season_winners`); second query returns two policies (`season_winners_select_public` for `SELECT`, `season_winners_write_admin` for `ALL`); third query returns any migrated rows (or zero rows) with no error.

- [ ] **Step 4: Commit the migration file**

```bash
git add season_winners_migration.sql
git commit -m "feat: add season_winners table for multi-winner support"
```

---

## Task 2: Guest — full draw history for the active season

**Files:**
- Modify: `guest.html:19-25` (last-draw section)
- Modify: `js/guest.js:7-74` (`loadLeaderboard`), append new functions
- Modify: `css/style.css` (optional spacing helpers already exist — no new rules required for this task)

**Interfaces:**
- Consumes: nothing new — reuses the `draws` array `loadLeaderboard()` already fetches (`js/guest.js:30-39`), `formatDate()` from `js/utils.js:68-72`.
- Produces: `toggleDrawHistory()` (global, called from inline `onclick`), `renderDrawHistory(draws)` (module-level helper). Module-level `allDraws` array holding every draw of the active season, set inside `loadLeaderboard()`.

- [ ] **Step 1: Add the toggle button and container to `guest.html`**

Replace the last-draw block:

```html
    <!-- Último sorteio -->
    <div class="last-draw" id="last-draw-section" style="display:none;">
      <div class="last-draw-label" id="last-draw-label">Último Sorteio</div>
      <div class="balls-row" id="last-draw-balls"></div>
    </div>
```

with:

```html
    <!-- Último sorteio -->
    <div class="last-draw" id="last-draw-section" style="display:none;">
      <div class="last-draw-label" id="last-draw-label">Último Sorteio</div>
      <div class="balls-row" id="last-draw-balls"></div>
      <button type="button" class="btn btn-secondary btn-sm mt-16" id="toggle-draws-btn" onclick="toggleDrawHistory()">
        Ver histórico completo ▾
      </button>
      <div id="draw-history-list" class="hidden mt-16"></div>
    </div>
```

- [ ] **Step 2: Track all draws and add the render/toggle functions in `js/guest.js`**

Add `let allDraws = [];` near the top, next to the existing `let allRows = [];` (`js/guest.js:5`):

```js
let allRows = []; // cache para filtro de pesquisa
let allDraws = []; // cache de todos os sorteios da época ativa
```

Inside `loadLeaderboard()`, right after the existing "Mostrar último sorteio" block (`js/guest.js:41-52`), add:

```js
  allDraws = draws || [];
  document.getElementById('draw-history-list').classList.add('hidden');
  document.getElementById('toggle-draws-btn').textContent = 'Ver histórico completo ▾';
```

At the end of the file, after `renderLeaderboard()` (`js/guest.js:106`), add:

```js
function renderDrawHistory(draws) {
  return [...draws]
    .sort((a, b) => new Date(b.draw_date) - new Date(a.draw_date))
    .map(d => `
      <div class="mb-16">
        <p class="text-muted text-sm mb-8">${formatDate(d.draw_date)}</p>
        <div class="balls-row">
          ${d.numbers.map(n => `<span class="ball ball-draw">${n}</span>`).join('')}
        </div>
      </div>
    `).join('');
}

function toggleDrawHistory() {
  const list = document.getElementById('draw-history-list');
  const btn = document.getElementById('toggle-draws-btn');
  const isHidden = list.classList.contains('hidden');
  if (isHidden) {
    list.innerHTML = renderDrawHistory(allDraws);
    list.classList.remove('hidden');
    btn.textContent = 'Ocultar histórico ▴';
  } else {
    list.classList.add('hidden');
    btn.textContent = 'Ver histórico completo ▾';
  }
}
```

- [ ] **Step 3: Manually verify in the browser**

Open `guest.html` (there must be an active season with at least 2 draws registered — use the admin panel to add draws if needed). Confirm:
1. "Último Sorteio" still shows only the latest draw's balls, as before.
2. Clicking "Ver histórico completo ▾" reveals every draw of the season, most recent first, each with its date and 5 balls, and the button label changes to "Ocultar histórico ▴".
3. Clicking again hides the list and restores the button label.
4. Typing in the search box and reloading the page doesn't break the toggle (list starts hidden again on reload).

- [ ] **Step 4: Commit**

```bash
git add guest.html js/guest.js
git commit -m "feat: let guests expand full draw history of the active season"
```

---

## Task 3: Admin — automatic winner detection on draw registration

**Files:**
- Modify: `js/admin.js:109-136` (draw-form submit handler)

**Interfaces:**
- Consumes: `calcProgress(keyNumbers, draws)` from `js/utils.js:12-31`, `currentSeason` module-level variable (`js/admin.js:7`).
- Produces: `checkForWinners(seasonId)` — async function returning `string[] | null` (winner names if the season was just closed, otherwise `null`). Later tasks (5) rely on `season_winners` rows this function writes; no other task calls this function directly.

- [ ] **Step 1: Add `checkForWinners` to `js/admin.js`**

Add this function right after `loadDrawsTab()` (after `js/admin.js:107`, before the `draw-form` submit listener):

```js
async function checkForWinners(seasonId) {
  const { data: sps } = await db
    .from('season_players')
    .select('player_id, key_numbers, players(name)')
    .eq('season_id', seasonId);

  const { data: draws } = await db
    .from('draws')
    .select('draw_date, numbers')
    .eq('season_id', seasonId);

  const winners = (sps || []).filter(sp => sp.players != null).filter(sp => {
    const { matched } = calcProgress(sp.key_numbers, draws || []);
    return matched.length === 15;
  });

  if (winners.length === 0) return null;

  const { error: insertErr } = await db
    .from('season_winners')
    .upsert(
      winners.map(w => ({ season_id: seasonId, player_id: w.player_id })),
      { onConflict: 'season_id,player_id', ignoreDuplicates: true }
    );
  if (insertErr) {
    console.error('checkForWinners insert:', insertErr);
    return null;
  }

  const today = new Date().toISOString().split('T')[0];
  const { error: closeErr } = await db
    .from('seasons')
    .update({ is_active: false, end_date: today })
    .eq('id', seasonId);
  if (closeErr) {
    console.error('checkForWinners close:', closeErr);
    return null;
  }

  return winners.map(w => w.players.name);
}
```

- [ ] **Step 2: Wire it into the draw-form submit handler**

Replace the success branch of the `draw-form` listener (`js/admin.js:129-135`):

```js
  if (error) {
    showAlert('alert-draws', 'Erro ao guardar sorteio.', 'error');
  } else {
    showAlert('alert-draws', 'Sorteio registado com sucesso!', 'success');
    e.target.reset();
    await loadDrawsTab();
  }
```

with:

```js
  if (error) {
    showAlert('alert-draws', 'Erro ao guardar sorteio.', 'error');
  } else {
    e.target.reset();
    await loadDrawsTab();
    const winnerNames = await checkForWinners(currentSeason.id);
    if (winnerNames) {
      showAlert('alert-draws', `🏆 Vencedor(es): ${winnerNames.join(', ')} — temporada encerrada automaticamente.`, 'success');
      currentSeason = null;
      document.getElementById('active-season-label').textContent =
        'Temporada encerrada automaticamente. Cria uma nova temporada.';
      document.getElementById('draws-list').innerHTML =
        '<p class="text-muted text-sm">Sem temporada ativa.</p>';
    } else {
      showAlert('alert-draws', 'Sorteio registado com sucesso!', 'success');
    }
  }
```

- [ ] **Step 3: Manually verify in the browser + Supabase**

Prerequisite: create a test season in the admin panel with one player whose key is exactly the 5 numbers you're about to draw plus 10 numbers already matched by prior draws (or simpler: a season with a fresh player key of 15 chosen numbers, and register draws whose numbers are subsets of that key until all 15 are covered).

1. In the admin "Sorteios" tab, register draws until one player's key reaches 15/15 matched (check progress in the "Leaderboard" tab as you go).
2. On the draw that completes 15/15, confirm the success alert reads `🏆 Vencedor(es): <nome> — temporada encerrada automaticamente.` and the header label changes to "Temporada encerrada automaticamente. Cria uma nova temporada."
3. In the Supabase SQL Editor, run `select * from season_winners order by created_at desc limit 5;` and confirm a row exists for that season/player.
4. Run `select is_active, end_date from seasons where id = '<season_id>';` and confirm `is_active = false` and `end_date` is today.
5. Repeat with a season where **two** players both reach 15/15 on the same draw (give both players keys built from the same draw numbers) and confirm both appear in the alert message and both rows exist in `season_winners`.

- [ ] **Step 4: Commit**

```bash
git add js/admin.js
git commit -m "feat: auto-detect and record season winners when a draw completes a key"
```

---

## Task 4: Admin — multi-select manual "Declarar Vencedor"

**Files:**
- Modify: `admin.html:132-145` (declare-winner-form-card)
- Modify: `js/admin.js:440-451` (winner select population inside `loadSeasonsTab`)
- Modify: `js/admin.js:507-532` (`declareWinner`)
- Modify: `css/style.css` (add checkbox list styles)

**Interfaces:**
- Consumes: `currentSeason`, `escapeAdminHtml()` (`js/admin.js:281-288`).
- Produces: `renderWinnerCheckboxes(sps)` (module-level helper called from `loadSeasonsTab`). `declareWinner()` keeps its existing name/signature (no-arg, called from an inline `onclick`) so `admin.html:142` doesn't need to change.

- [ ] **Step 1: Add checkbox-list styles to `css/style.css`**

Append after the "Modal" section (`css/style.css:495`, before "Responsive"):

```css
/* ---- Checkbox List (multi-select vencedores) ---- */
.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
  margin-bottom: 14px;
}
.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}
```

- [ ] **Step 2: Replace the `<select>` with a checkbox container in `admin.html`**

Replace:

```html
      <div class="card hidden" id="declare-winner-form-card">
        <p class="card-title">🏆 Declarar Vencedor</p>
        <div class="form-group">
          <label class="form-label">Jogador Vencedor</label>
          <select id="winner-select" class="form-input">
            <option value="">Selecionar jogador...</option>
          </select>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-admin" onclick="declareWinner()">Confirmar Vencedor</button>
          <button class="btn btn-secondary" onclick="closeDeclareWinner()">Cancelar</button>
        </div>
      </div>
```

with:

```html
      <div class="card hidden" id="declare-winner-form-card">
        <p class="card-title">🏆 Declarar Vencedor(es)</p>
        <div class="form-group">
          <label class="form-label">Jogadores Vencedores (podes selecionar mais do que um)</label>
          <div id="winner-checkboxes" class="checkbox-list">
            <p class="text-muted text-sm">Sem jogadores nesta temporada.</p>
          </div>
        </div>
        <div style="display:flex; gap:10px;">
          <button class="btn btn-admin" onclick="declareWinner()">Confirmar Vencedor(es)</button>
          <button class="btn btn-secondary" onclick="closeDeclareWinner()">Cancelar</button>
        </div>
      </div>
```

- [ ] **Step 3: Render checkboxes instead of `<option>`s in `js/admin.js`**

Replace (`js/admin.js:440-451`):

```js
    // Preencher select do vencedor
    const { data: sps } = await db
      .from('season_players')
      .select('player_id, players(id, name)')
      .eq('season_id', currentSeason.id)
      .order('players(name)');

    const winnerSelect = document.getElementById('winner-select');
    winnerSelect.innerHTML = '<option value="">Selecionar jogador...</option>' +
      (sps || []).map(sp =>
        `<option value="${sp.player_id}">${escapeAdminHtml(sp.players.name)}</option>`
      ).join('');
```

with:

```js
    // Preencher checkboxes de vencedores
    const { data: sps } = await db
      .from('season_players')
      .select('player_id, players(id, name)')
      .eq('season_id', currentSeason.id)
      .order('players(name)');

    renderWinnerCheckboxes(sps || []);
```

Add `renderWinnerCheckboxes` right after `loadSeasonsTab()` closes (after `js/admin.js:492`, before `openDeclareWinner()`):

```js
function renderWinnerCheckboxes(sps) {
  const container = document.getElementById('winner-checkboxes');
  if (sps.length === 0) {
    container.innerHTML = '<p class="text-muted text-sm">Sem jogadores nesta temporada.</p>';
    return;
  }
  container.innerHTML = sps.map(sp => `
    <label class="checkbox-row">
      <input type="checkbox" value="${sp.player_id}">
      ${escapeAdminHtml(sp.players.name)}
    </label>
  `).join('');
}
```

- [ ] **Step 4: Rewrite `declareWinner()` to write multiple rows to `season_winners`**

Replace `js/admin.js:507-532`:

```js
async function declareWinner() {
  const winnerId = document.getElementById('winner-select').value;
  if (!winnerId) { alert('Seleciona um jogador.'); return; }
  if (!currentSeason) { alert('Sem temporada ativa.'); return; }
  if (!confirm('Confirmas a declaração deste vencedor? A temporada será encerrada.')) return;

  const today = new Date().toISOString().split('T')[0];
  const { error } = await db
    .from('seasons')
    .update({
      winner_player_id: winnerId,
      is_active: false,
      end_date: today,
    })
    .eq('id', currentSeason.id);

  if (error) {
    showAlert('alert-seasons', 'Erro ao declarar vencedor.', 'error');
  } else {
    currentSeason = null;
    document.getElementById('active-season-label').textContent =
      'Temporada encerrada. Cria uma nova temporada.';
    closeDeclareWinner();
    await loadSeasonsTab();
  }
}
```

with:

```js
async function declareWinner() {
  const checked = [...document.querySelectorAll('#winner-checkboxes input:checked')].map(el => el.value);
  if (checked.length === 0) { alert('Seleciona pelo menos um jogador.'); return; }
  if (!currentSeason) { alert('Sem temporada ativa.'); return; }
  if (!confirm(`Confirmas a declaração de ${checked.length} vencedor(es)? A temporada será encerrada.`)) return;

  const { error: winError } = await db
    .from('season_winners')
    .insert(checked.map(playerId => ({ season_id: currentSeason.id, player_id: playerId })));

  if (winError) {
    showAlert('alert-seasons', 'Erro ao declarar vencedor(es).', 'error');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const { error } = await db
    .from('seasons')
    .update({ is_active: false, end_date: today })
    .eq('id', currentSeason.id);

  if (error) {
    showAlert('alert-seasons', 'Erro ao encerrar temporada.', 'error');
  } else {
    currentSeason = null;
    document.getElementById('active-season-label').textContent =
      'Temporada encerrada. Cria uma nova temporada.';
    closeDeclareWinner();
    await loadSeasonsTab();
  }
}
```

- [ ] **Step 5: Manually verify in the browser + Supabase**

1. With an active season that has at least 2 players, open admin → Temporadas → "🏆 Declarar Vencedor(es)".
2. Confirm a scrollable checkbox list of every season player appears (not a dropdown).
3. Select two players, click "Confirmar Vencedor(es)", confirm the browser `confirm()` dialog.
4. Confirm the season closes (label changes to "Temporada encerrada...") and the form hides.
5. In Supabase SQL Editor: `select * from season_winners where season_id = '<season_id>';` — confirm two rows, one per selected player.
6. Reopen the (now closed) season's declare-winner flow is no longer reachable (no active season) — confirm the "🏆 Declarar Vencedor" button has no effect / active-season card shows no active season.

- [ ] **Step 6: Commit**

```bash
git add admin.html js/admin.js css/style.css
git commit -m "feat: support declaring multiple winners manually"
```

---

## Task 5: Admin — seasons history shows multiple winners

**Files:**
- Modify: `js/admin.js:456-491` (`loadSeasonsTab` history table)

**Interfaces:**
- Consumes: `season_winners` table (Task 1), `escapeAdminHtml()`.
- Produces: nothing consumed elsewhere — this is a leaf rendering change.

- [ ] **Step 1: Replace the history query and rendering**

Replace `js/admin.js:456-491`:

```js
  // Histórico — usar alias explícito para FK winner_player_id
  const { data: allSeasons } = await db
    .from('seasons')
    .select('id, name, start_date, end_date, winner:players!winner_player_id(name)')
    .eq('is_active', false)
    .order('created_at', { ascending: false });

  const history = document.getElementById('seasons-history');
  if (!allSeasons || allSeasons.length === 0) {
    history.innerHTML = '<p class="text-muted text-sm">Sem temporadas anteriores.</p>';
  } else {
    history.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Temporada</th>
            <th>Período</th>
            <th>Vencedor</th>
          </tr>
        </thead>
        <tbody>
          ${allSeasons.map(s => `
            <tr>
              <td>${escapeAdminHtml(s.name)}</td>
              <td class="text-sm text-muted">
                ${formatDate(s.start_date)} → ${formatDate(s.end_date)}
              </td>
              <td>
                ${s.winner ? `🏆 ${escapeAdminHtml(s.winner.name)}` : '<span class="text-muted">—</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }
```

with:

```js
  // Histórico
  const { data: allSeasons } = await db
    .from('seasons')
    .select('id, name, start_date, end_date')
    .eq('is_active', false)
    .order('created_at', { ascending: false });

  const history = document.getElementById('seasons-history');
  if (!allSeasons || allSeasons.length === 0) {
    history.innerHTML = '<p class="text-muted text-sm">Sem temporadas anteriores.</p>';
  } else {
    const { data: winners } = await db
      .from('season_winners')
      .select('season_id, players(name)')
      .in('season_id', allSeasons.map(s => s.id));

    const winnersBySeason = {};
    (winners || []).forEach(w => {
      if (!winnersBySeason[w.season_id]) winnersBySeason[w.season_id] = [];
      winnersBySeason[w.season_id].push(w.players.name);
    });

    history.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Temporada</th>
            <th>Período</th>
            <th>Vencedor(es)</th>
          </tr>
        </thead>
        <tbody>
          ${allSeasons.map(s => {
            const names = winnersBySeason[s.id] || [];
            return `
              <tr>
                <td>${escapeAdminHtml(s.name)}</td>
                <td class="text-sm text-muted">
                  ${formatDate(s.start_date)} → ${formatDate(s.end_date)}
                </td>
                <td>
                  ${names.length > 0 ? `🏆 ${names.map(escapeAdminHtml).join(', ')}` : '<span class="text-muted">—</span>'}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }
```

- [ ] **Step 2: Manually verify in the browser**

Open admin → Temporadas tab. Confirm the "Histórico de Temporadas" table shows, for the seasons closed in Tasks 3 and 4, a comma-separated list of winner names (e.g. "🏆 Ana, Rui") in the "Vencedor(es)" column, and "—" for any season closed without winners.

- [ ] **Step 3: Commit**

```bash
git add js/admin.js
git commit -m "feat: show multiple winners in admin seasons history"
```

---

## Task 6: Guest — automatic winner announcement banner

**Files:**
- Modify: `guest.html:19-25` (add banner container above last-draw section)
- Modify: `js/guest.js:7-18` (`loadLeaderboard` early-return branch), append new function
- Modify: `css/style.css` (winner-banner styling)

**Interfaces:**
- Consumes: `season_winners` (Task 1), `escapeHtml()` (`js/guest.js:108-115`), `formatDate()`.
- Produces: `showWinnerBanner()` (module-level, called only from `loadLeaderboard()`).

- [ ] **Step 1: Add the banner container to `guest.html`**

Add right after the opening `<div class="container" ...>` line (`guest.html:19`), before the last-draw section:

```html
    <!-- Anúncio de vencedor(es) -->
    <div class="card winner-banner hidden" id="winner-banner"></div>
```

- [ ] **Step 2: Add winner-banner styling to `css/style.css`**

Append after the "Last Draw Banner" section (`css/style.css:432`, before "Section Heading"):

```css
/* ---- Winner Banner ---- */
.winner-banner {
  border: 1px solid var(--admin);
  background: rgba(251, 191, 36, 0.08);
}
```

- [ ] **Step 3: Replace the no-active-season branch in `js/guest.js`**

Replace (`js/guest.js:9-14`):

```js
  // 1. Temporada ativa
  const season = await getActiveSeason();
  if (!season) {
    document.getElementById('season-badge').textContent = 'Sem temporada ativa';
    showAlert('alert-box', 'Não existe nenhuma temporada ativa de momento.', 'info');
    return;
  }
```

with:

```js
  // 1. Temporada ativa
  const season = await getActiveSeason();
  if (!season) {
    document.getElementById('season-badge').textContent = 'Sem temporada ativa';
    await showWinnerBanner();
    return;
  }
  document.getElementById('winner-banner').classList.add('hidden');
```

- [ ] **Step 4: Add `showWinnerBanner()` at the end of `js/guest.js`**

```js
async function showWinnerBanner() {
  const { data: lastSeason } = await db
    .from('seasons')
    .select('id, name, end_date')
    .eq('is_active', false)
    .order('end_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastSeason) {
    showAlert('alert-box', 'Não existe nenhuma temporada ativa de momento.', 'info');
    return;
  }

  const { data: winners } = await db
    .from('season_winners')
    .select('players(name)')
    .eq('season_id', lastSeason.id);

  const names = (winners || []).map(w => w.players.name);
  const winnerText = names.length > 0
    ? `Vencedor${names.length > 1 ? 'es' : ''}: <strong>${names.map(escapeHtml).join('</strong>, <strong>')}</strong> 🎉`
    : 'Terminou sem vencedor registado.';

  const banner = document.getElementById('winner-banner');
  banner.innerHTML = `
    <p class="card-title" style="color: var(--admin);">🏆 A Temporada "${escapeHtml(lastSeason.name)}" terminou!</p>
    <p class="text-secondary mb-16">${winnerText}</p>
    <a href="seasons.html?season_id=${lastSeason.id}" class="btn btn-admin btn-sm">Ver histórico desta temporada →</a>
  `;
  banner.classList.remove('hidden');
}
```

- [ ] **Step 5: Manually verify in the browser**

1. Ensure there is currently no active season (use one closed in Task 3 or 4, and don't create a new one yet).
2. Open `guest.html`. Confirm the gold-bordered banner appears above "Último Sorteio", reading `🏆 A Temporada "<nome>" terminou!` with the winner name(s) bolded, and a working "Ver histórico desta temporada →" link (it will 404/blank until Task 7 exists — that's expected at this point).
3. In the admin panel, create a new active season. Reload `guest.html` and confirm the banner disappears and the normal leaderboard shows instead.
4. Delete all seasons in a scratch/test project (or simulate with a fresh Supabase project) to confirm the very-first-run fallback still shows the plain "Não existe nenhuma temporada ativa de momento." info alert when no season has ever existed.

- [ ] **Step 6: Commit**

```bash
git add guest.html js/guest.js css/style.css
git commit -m "feat: announce season winners to guests automatically"
```

---

## Task 7: New "Temporadas Anteriores" page for guests

**Files:**
- Create: `seasons.html`
- Create: `js/seasons.js`
- Modify: `guest.html` (add nav link to the new page)

**Interfaces:**
- Consumes: `season_winners`, `seasons`, `season_players`, `draws` tables; `calcProgress()`, `formatDate()`, `getActiveSeason()` (unused here but loaded via `utils.js` for consistency), `showAlert()` from `js/utils.js`.
- Produces: nothing consumed elsewhere — this is a leaf page, reachable only via links.

- [ ] **Step 1: Add the nav link in `guest.html`**

Add right after the opening `<div class="container" ...>` line and the winner-banner div added in Task 6 (`guest.html`), before the last-draw section:

```html
    <!-- Navegação para épocas anteriores -->
    <div class="flex justify-between items-center mb-16">
      <a href="seasons.html" class="btn btn-secondary btn-sm">📅 Temporadas Anteriores</a>
    </div>
```

- [ ] **Step 2: Create `seasons.html`**

```html
<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EuroPool — Temporadas Anteriores</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="manifest" href="manifest.json">
  <link rel="apple-touch-icon" href="icons/icon.svg">
  <meta name="theme-color" content="#064e3b">
</head>
<body>
  <div class="topbar">
    <a href="index.html" class="topbar-logo">🍀 EuroPool</a>
    <span class="topbar-season" id="season-badge">Temporadas Anteriores</span>
  </div>

  <div class="container" style="padding-top: 20px; padding-bottom: 40px;">

    <a href="guest.html" class="back-link">← Voltar ao leaderboard</a>

    <div id="alert-box" class="alert hidden"></div>

    <!-- Vista de lista -->
    <div id="seasons-list-view">
      <p class="section-heading">Temporadas Terminadas</p>
      <div id="seasons-list"></div>
    </div>

    <!-- Vista de detalhe -->
    <div id="season-detail-view" class="hidden">
      <a href="seasons.html" class="back-link">← Voltar às temporadas</a>

      <div class="card winner-banner" id="detail-winner-banner"></div>

      <div class="card">
        <p class="card-title">🎱 Sorteios desta Temporada</p>
        <div id="detail-draws-list"></div>
      </div>

      <p class="section-heading" id="detail-player-count"></p>
      <div id="detail-leaderboard-list"></div>
    </div>

  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="js/supabase-client.js"></script>
  <script src="js/utils.js"></script>
  <script src="js/seasons.js"></script>
  <script>if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');</script>
  <script src="js/pwa-install.js"></script>
</body>
</html>
```

- [ ] **Step 3: Create `js/seasons.js`**

```js
// js/seasons.js — Temporadas Anteriores (só leitura)

const MEDALS = ['🥇', '🥈', '🥉'];

async function init() {
  const params = new URLSearchParams(window.location.search);
  const seasonId = params.get('season_id');
  if (seasonId) {
    await loadSeasonDetail(seasonId);
  } else {
    await loadSeasonsList();
  }
}

async function loadSeasonsList() {
  const { data: seasons, error } = await db
    .from('seasons')
    .select('id, name, start_date, end_date')
    .eq('is_active', false)
    .order('end_date', { ascending: false });

  if (error) {
    showAlert('alert-box', 'Erro ao carregar temporadas.', 'error');
    return;
  }

  const list = document.getElementById('seasons-list');
  if (!seasons || seasons.length === 0) {
    list.innerHTML = '<div class="card"><p class="text-muted">Ainda não há temporadas terminadas.</p></div>';
    return;
  }

  const { data: winners } = await db
    .from('season_winners')
    .select('season_id, players(name)')
    .in('season_id', seasons.map(s => s.id));

  const winnersBySeason = {};
  (winners || []).forEach(w => {
    if (!winnersBySeason[w.season_id]) winnersBySeason[w.season_id] = [];
    winnersBySeason[w.season_id].push(w.players.name);
  });

  list.innerHTML = seasons.map(s => {
    const names = winnersBySeason[s.id] || [];
    const winnerLine = names.length > 0
      ? `🏆 ${names.map(escapeHtml).join(', ')}`
      : '<span class="text-muted">Sem vencedor registado</span>';
    return `
      <a href="seasons.html?season_id=${s.id}" class="leaderboard-row">
        <div class="leaderboard-row-top">
          <span class="leaderboard-name">${escapeHtml(s.name)}</span>
        </div>
        <p class="text-muted text-sm mb-8">${formatDate(s.start_date)} → ${formatDate(s.end_date)}</p>
        <p class="text-sm">${winnerLine}</p>
      </a>
    `;
  }).join('');
}

async function loadSeasonDetail(seasonId) {
  const { data: season, error: seasonErr } = await db
    .from('seasons')
    .select('id, name, start_date, end_date')
    .eq('id', seasonId)
    .maybeSingle();

  if (seasonErr || !season) {
    showAlert('alert-box', 'Temporada não encontrada.', 'error');
    return;
  }

  document.getElementById('seasons-list-view').classList.add('hidden');
  document.getElementById('season-detail-view').classList.remove('hidden');
  document.getElementById('season-badge').textContent = season.name;

  const { data: winners } = await db
    .from('season_winners')
    .select('players(name)')
    .eq('season_id', seasonId);

  const names = (winners || []).map(w => w.players.name);
  const winnerText = names.length > 0
    ? `Vencedor${names.length > 1 ? 'es' : ''}: <strong>${names.map(escapeHtml).join('</strong>, <strong>')}</strong> 🎉`
    : 'Terminou sem vencedor registado.';

  document.getElementById('detail-winner-banner').innerHTML = `
    <p class="card-title" style="color: var(--admin);">🏆 ${escapeHtml(season.name)}</p>
    <p class="text-muted text-sm mb-8">${formatDate(season.start_date)} → ${formatDate(season.end_date)}</p>
    <p class="text-secondary">${winnerText}</p>
  `;

  const { data: draws } = await db
    .from('draws')
    .select('draw_date, numbers')
    .eq('season_id', seasonId)
    .order('draw_date', { ascending: false });

  const drawsList = document.getElementById('detail-draws-list');
  if (!draws || draws.length === 0) {
    drawsList.innerHTML = '<p class="text-muted text-sm">Sem sorteios registados.</p>';
  } else {
    drawsList.innerHTML = draws.map(d => `
      <div class="mb-16">
        <p class="text-muted text-sm mb-8">${formatDate(d.draw_date)}</p>
        <div class="balls-row">
          ${d.numbers.map(n => `<span class="ball ball-draw">${n}</span>`).join('')}
        </div>
      </div>
    `).join('');
  }

  const { data: seasonPlayers } = await db
    .from('season_players')
    .select('key_numbers, player_id, players(name)')
    .eq('season_id', seasonId);

  const rows = (seasonPlayers || [])
    .filter(sp => sp.players != null)
    .map(sp => {
      const { matched } = calcProgress(sp.key_numbers, draws || []);
      return { name: sp.players.name, count: matched.length, total: sp.key_numbers.length };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  document.getElementById('detail-player-count').textContent =
    `${rows.length} jogador${rows.length !== 1 ? 'es' : ''}`;

  document.getElementById('detail-leaderboard-list').innerHTML = rows.map((row, i) => {
    const rank = i < 3 ? MEDALS[i] : `${i + 1}.`;
    const pct = Math.round((row.count / row.total) * 100);
    return `
      <div class="leaderboard-row" style="cursor:default;">
        <div class="leaderboard-row-top">
          <span class="leaderboard-rank">${rank}</span>
          <span class="leaderboard-name">${escapeHtml(row.name)}</span>
          <span class="leaderboard-score">${row.count}/${row.total}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

init();
```

- [ ] **Step 4: Manually verify in the browser**

1. From `guest.html`, click "📅 Temporadas Anteriores". Confirm it navigates to `seasons.html` and lists every closed season (from Tasks 3/4 testing) with period and winner(s).
2. Click a season card. Confirm the URL becomes `seasons.html?season_id=<id>`, the list view hides, the detail view shows: gold winner banner with correct name(s), every draw of that season (most recent first), and a full leaderboard with correct `X/15` counts and progress bars matching what you saw in the admin leaderboard for that season while it was active.
3. Click "← Voltar às temporadas". Confirm it returns to the list view.
4. Go back to `guest.html` — the winner banner's "Ver histórico desta temporada →" link (added in Task 6) now correctly opens this season's detail view.
5. Test a season that was closed with **zero** winners (if one exists from earlier testing, or close one manually via the Supabase SQL Editor: `update seasons set is_active=false, end_date=current_date where id='<id>';` without inserting into `season_winners`) — confirm it shows "Sem vencedor registado" / "Terminou sem vencedor registado." instead of breaking.

- [ ] **Step 5: Commit**

```bash
git add seasons.html js/seasons.js guest.html
git commit -m "feat: add guest-facing previous seasons history page"
```

---

## Post-plan check

After all 7 tasks: open `guest.html` end-to-end as a guest — browse the active leaderboard, expand the draw history, follow the link to a past season, and (if you closed a season during testing) see the automatic winner banner. Open `admin.html` — register a draw that produces two simultaneous 15/15 winners and confirm the season closes and both names appear everywhere (draw success alert, seasons history table, guest banner, seasons.html detail page).
