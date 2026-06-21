// js/admin.js — Painel de Administração

// ============================================================
// AUTH
// ============================================================

let currentSeason = null;
let currentUser   = null;
let _allPlayers   = []; // cache for editPlayerName lookup

async function initAdmin() {
  const { data, error: sessionErr } = await db.auth.getSession();
  if (sessionErr || !data?.session) {
    window.location.href = 'admin-login.html';
    return;
  }
  const session = data.session;
  currentUser = session.user;
  document.getElementById('admin-email').textContent = currentUser.email;

  currentSeason = await getActiveSeason();
  if (currentSeason) {
    document.getElementById('active-season-label').textContent =
      `Temporada ativa: ${currentSeason.name}`;
  } else {
    document.getElementById('active-season-label').textContent =
      'Nenhuma temporada ativa.';
  }

  // Carregar a tab ativa (sorteios por defeito)
  await loadDrawsTab();
}

async function logout() {
  await db.auth.signOut();
  window.location.href = 'admin-login.html';
}

// ============================================================
// TABS
// ============================================================

async function showTab(name) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');

  if (name === 'draws')       await loadDrawsTab();
  if (name === 'players')     await loadPlayersTab();
  if (name === 'seasons')     await loadSeasonsTab();
  if (name === 'leaderboard') await loadAdminLeaderboard();
}

// ============================================================
// TAB: SORTEIOS
// ============================================================

async function loadDrawsTab() {
  if (!currentSeason) {
    document.getElementById('draws-list').innerHTML =
      '<p class="text-muted text-sm">Sem temporada ativa.</p>';
    return;
  }

  const { data: draws } = await db
    .from('draws')
    .select('*')
    .eq('season_id', currentSeason.id)
    .order('draw_date', { ascending: false });

  const list = document.getElementById('draws-list');
  if (!draws || draws.length === 0) {
    list.innerHTML = '<p class="text-muted text-sm">Ainda não há sorteios registados.</p>';
    return;
  }

  list.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Data</th>
          <th>Números</th>
          <th style="text-align:right;">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${draws.map(d => `
          <tr>
            <td>${formatDate(d.draw_date)}</td>
            <td>
              <div class="balls-row">
                ${d.numbers.map(n => `<span class="ball ball-draw">${n}</span>`).join('')}
              </div>
            </td>
            <td style="text-align:right;">
              <button class="btn btn-danger btn-sm" onclick="deleteDraw('${d.id}')">
                🗑 Apagar
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

document.getElementById('draw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentSeason) {
    showAlert('alert-draws', 'Cria uma temporada primeiro.', 'error');
    return;
  }

  const dateVal = document.getElementById('draw-date').value;
  const numInputs = [...document.querySelectorAll('.draw-num')];
  const numbers = numInputs.map(i => parseInt(i.value, 10));

  const err = validateDraw(numbers);
  if (err) { showAlert('alert-draws', err, 'error'); return; }

  const { error } = await db.from('draws').insert({
    season_id: currentSeason.id,
    draw_date: dateVal,
    numbers,
  });

  if (error) {
    showAlert('alert-draws', 'Erro ao guardar sorteio.', 'error');
  } else {
    showAlert('alert-draws', 'Sorteio registado com sucesso!', 'success');
    e.target.reset();
    await loadDrawsTab();
  }
});

async function deleteDraw(drawId) {
  if (!confirm('Tens a certeza que queres apagar este sorteio?')) return;
  const { error } = await db.from('draws').delete().eq('id', drawId);
  if (error) {
    showAlert('alert-draws', 'Erro ao apagar sorteio.', 'error');
  } else {
    await loadDrawsTab();
  }
}

// ============================================================
// TAB: JOGADORES
// ============================================================

async function loadPlayersTab() {
  // Carregar todos os jogadores globais
  const { data: players } = await db
    .from('players')
    .select('id, name')
    .order('name');

  renderAllPlayers(players || []);

  // Preencher select de associação
  const select = document.getElementById('sp-player-select');
  select.innerHTML = '<option value="">Selecionar jogador...</option>' +
    (players || []).map(p => `<option value="${p.id}">${escapeAdminHtml(p.name)}</option>`).join('');

  // Carregar season_players da temporada ativa
  if (currentSeason) {
    const { data: sps } = await db
      .from('season_players')
      .select('id, key_numbers, player_id, players(name)')
      .eq('season_id', currentSeason.id)
      .order('players(name)');
    renderSeasonPlayers(sps || []);
  } else {
    document.getElementById('season-players-list').innerHTML =
      '<p class="text-muted text-sm">Sem temporada ativa.</p>';
  }
}

function renderAllPlayers(players) {
  _allPlayers = players; // store for lookup in editPlayerName
  const list = document.getElementById('all-players-list');
  if (players.length === 0) {
    list.innerHTML = '<p class="text-muted text-sm">Sem jogadores criados.</p>';
    return;
  }
  list.innerHTML = `
    <table class="table">
      <thead><tr><th>Nome</th><th style="text-align:right;">Ações</th></tr></thead>
      <tbody>
        ${players.map(p => `
          <tr>
            <td>${escapeAdminHtml(p.name)}</td>
            <td style="text-align:right;">
              <button class="btn btn-secondary btn-sm" onclick="editPlayerName('${p.id}')">
                ✏️ Editar
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderSeasonPlayers(sps) {
  const list = document.getElementById('season-players-list');
  if (sps.length === 0) {
    list.innerHTML = '<p class="text-muted text-sm">Nenhum jogador associado a esta temporada.</p>';
    return;
  }
  list.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Jogador</th>
          <th>Chave</th>
          <th style="text-align:right;">Ações</th>
        </tr>
      </thead>
      <tbody>
        ${sps.map(sp => `
          <tr>
            <td>${escapeAdminHtml(sp.players.name)}</td>
            <td class="text-sm text-muted">${[...sp.key_numbers].sort((a,b)=>a-b).join(', ')}</td>
            <td style="text-align:right; white-space:nowrap;">
              <button class="btn btn-secondary btn-sm" style="margin-right:6px;"
                onclick="editSeasonPlayerKey('${sp.id}', '${sp.key_numbers.join(',')}')">
                ✏️ Editar chave
              </button>
              <button class="btn btn-danger btn-sm"
                onclick="removeSeasonPlayer('${sp.id}')">
                🗑
              </button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function escapeAdminHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Adicionar jogador global
document.getElementById('add-player-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('new-player-name').value.trim();
  if (!name) return;

  const { error } = await db.from('players').insert({ name });
  if (error) {
    showAlert('alert-players', 'Erro ao adicionar jogador.', 'error');
  } else {
    showAlert('alert-players', `Jogador "${name}" adicionado!`, 'success');
    e.target.reset();
    await loadPlayersTab();
  }
});

// Editar nome de jogador
async function editPlayerName(playerId) {
  const player = _allPlayers.find(p => p.id === playerId);
  const currentName = player ? player.name : '';
  const newName = prompt('Novo nome do jogador:', currentName);
  if (!newName || newName.trim() === currentName.trim()) return;
  const { error } = await db
    .from('players')
    .update({ name: newName.trim() })
    .eq('id', playerId);
  if (error) {
    showAlert('alert-players', 'Erro ao atualizar nome.', 'error');
  } else {
    await loadPlayersTab();
  }
}

// Associar jogador à temporada + chave
document.getElementById('add-season-player-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentSeason) {
    showAlert('alert-season-players', 'Cria uma temporada primeiro.', 'error');
    return;
  }

  const playerId = document.getElementById('sp-player-select').value;
  const keyRaw   = document.getElementById('sp-key-input').value;

  if (!playerId) {
    showAlert('alert-season-players', 'Seleciona um jogador.', 'error');
    return;
  }

  const keyNumbers = keyRaw.split(',').map(s => parseInt(s.trim(), 10));
  const err = validateKey(keyNumbers);
  if (err) { showAlert('alert-season-players', err, 'error'); return; }

  const { error } = await db.from('season_players').insert({
    season_id: currentSeason.id,
    player_id: playerId,
    key_numbers: keyNumbers,
  });

  if (error && error.code === '23505') {
    showAlert('alert-season-players', 'Este jogador já está associado a esta temporada.', 'error');
  } else if (error) {
    showAlert('alert-season-players', 'Erro ao associar jogador.', 'error');
  } else {
    showAlert('alert-season-players', 'Jogador associado com sucesso!', 'success');
    e.target.reset();
    await loadPlayersTab();
  }
});

// Editar chave de jogador na temporada
async function editSeasonPlayerKey(spId, currentKey) {
  const newKey = prompt('Nova chave (15 números separados por vírgula):', currentKey);
  if (!newKey || newKey === currentKey) return;

  const keyNumbers = newKey.split(',').map(s => parseInt(s.trim(), 10));
  const err = validateKey(keyNumbers);
  if (err) { showAlert('alert-season-players', err, 'error'); return; }

  const { error } = await db
    .from('season_players')
    .update({ key_numbers: keyNumbers })
    .eq('id', spId);

  if (error) {
    showAlert('alert-season-players', 'Erro ao atualizar chave.', 'error');
  } else {
    await loadPlayersTab();
  }
}

// Remover jogador da temporada
async function removeSeasonPlayer(spId) {
  if (!confirm('Remover este jogador da temporada atual?')) return;
  const { error } = await db.from('season_players').delete().eq('id', spId);
  if (error) {
    showAlert('alert-season-players', 'Erro ao remover jogador.', 'error');
  } else {
    await loadPlayersTab();
  }
}

// ============================================================
// TAB: TEMPORADAS
// ============================================================

async function loadSeasonsTab() {
  // Info da temporada ativa
  const info = document.getElementById('active-season-info');
  if (currentSeason) {
    const { count: drawCount } = await db
      .from('draws')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', currentSeason.id);
    const { count: playerCount } = await db
      .from('season_players')
      .select('id', { count: 'exact', head: true })
      .eq('season_id', currentSeason.id);

    info.innerHTML = `
      <table class="table">
        <tbody>
          <tr><td class="text-muted">Nome</td><td>${escapeAdminHtml(currentSeason.name)}</td></tr>
          <tr><td class="text-muted">Início</td><td>${formatDate(currentSeason.start_date)}</td></tr>
          <tr><td class="text-muted">Sorteios</td><td>${drawCount || 0}</td></tr>
          <tr><td class="text-muted">Jogadores</td><td>${playerCount || 0}</td></tr>
        </tbody>
      </table>
    `;

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
  } else {
    info.innerHTML = '<p class="text-muted text-sm">Nenhuma temporada ativa.</p>';
  }

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
}

function openDeclareWinner() {
  document.getElementById('declare-winner-form-card').classList.remove('hidden');
}
function closeDeclareWinner() {
  document.getElementById('declare-winner-form-card').classList.add('hidden');
}
function openNewSeason() {
  document.getElementById('new-season-form-card').classList.remove('hidden');
}
function closeNewSeason() {
  document.getElementById('new-season-form-card').classList.add('hidden');
}

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

async function createNewSeason() {
  const name = document.getElementById('new-season-name').value.trim();
  if (!name) { alert('Introduz o nome da temporada.'); return; }

  // Garantir que não há outra temporada ativa (por precaução)
  const { error: deactivateErr } = await db
    .from('seasons')
    .update({ is_active: false })
    .eq('is_active', true);
  if (deactivateErr) {
    showAlert('alert-seasons', 'Erro ao desativar temporada anterior.', 'error');
    return;
  }

  const today = new Date().toISOString().split('T')[0];
  const { data: newSeason, error } = await db
    .from('seasons')
    .insert({ name, start_date: today, is_active: true })
    .select()
    .single();

  if (error) {
    showAlert('alert-seasons', 'Erro ao criar temporada.', 'error');
  } else {
    currentSeason = newSeason;
    document.getElementById('active-season-label').textContent =
      `Temporada ativa: ${newSeason.name}`;
    document.getElementById('new-season-name').value = '';
    closeNewSeason();
    await loadSeasonsTab();
  }
}

// ============================================================
// TAB: LEADERBOARD (igual ao guest.html mas dentro do admin)
// ============================================================

async function loadAdminLeaderboard() {
  if (!currentSeason) {
    document.getElementById('admin-leaderboard-list').innerHTML =
      '<p class="text-muted text-sm">Sem temporada ativa.</p>';
    return;
  }

  const { data: seasonPlayers, error: spErr } = await db
    .from('season_players')
    .select('player_id, key_numbers, players(id, name)')
    .eq('season_id', currentSeason.id);
  if (spErr) {
    document.getElementById('admin-leaderboard-list').innerHTML =
      '<p class="text-muted text-sm">Erro ao carregar jogadores.</p>';
    return;
  }

  const { data: draws, error: drawsErr } = await db
    .from('draws')
    .select('draw_date, numbers')
    .eq('season_id', currentSeason.id)
    .order('draw_date', { ascending: false });
  if (drawsErr) {
    document.getElementById('admin-leaderboard-list').innerHTML =
      '<p class="text-muted text-sm">Erro ao carregar sorteios.</p>';
    return;
  }

  // Último sorteio
  if (draws && draws.length > 0) {
    const last = draws[0];
    document.getElementById('admin-last-draw-label').textContent =
      `Último Sorteio · ${formatDate(last.draw_date)}`;
    document.getElementById('admin-last-draw-balls').innerHTML =
      last.numbers.map(n => `<span class="ball ball-draw">${n}</span>`).join('');
    document.getElementById('admin-last-draw').classList.remove('hidden');
  }

  // Leaderboard
  const MEDALS = ['🥇', '🥈', '🥉'];
  const rows = (seasonPlayers || [])
    .filter(sp => sp.players != null)
    .map(sp => {
      const { matched } = calcProgress(sp.key_numbers, draws || []);
      return {
        name: sp.players.name,
        count: matched.length,
        total: sp.key_numbers.length,
      };
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  document.getElementById('admin-player-count').textContent =
    `${rows.length} jogador${rows.length !== 1 ? 'es' : ''}`;

  document.getElementById('admin-leaderboard-list').innerHTML = rows.map((row, i) => {
    const rank = i < 3 ? MEDALS[i] : `${i + 1}.`;
    const pct  = Math.round((row.count / row.total) * 100);
    return `
      <div class="leaderboard-row" style="cursor:default;">
        <div class="leaderboard-row-top">
          <span class="leaderboard-rank">${rank}</span>
          <span class="leaderboard-name">${escapeAdminHtml(row.name)}</span>
          <span class="leaderboard-score">${row.count}/${row.total}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

// ============================================================
// ARRANQUE
// ============================================================
initAdmin();
