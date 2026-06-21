// js/guest.js — Leaderboard público (só leitura)

const MEDALS = ['🥇', '🥈', '🥉'];

let allRows = []; // cache para filtro de pesquisa

async function loadLeaderboard() {
  // 1. Temporada ativa
  const season = await getActiveSeason();
  if (!season) {
    document.getElementById('season-badge').textContent = 'Sem temporada ativa';
    showAlert('alert-box', 'Não existe nenhuma temporada ativa de momento.', 'info');
    return;
  }

  document.getElementById('season-badge').textContent = `${season.name} · Ativa`;

  // 2. Jogadores desta temporada
  const { data: seasonPlayers, error: spErr } = await db
    .from('season_players')
    .select('id, key_numbers, player_id, players(id, name)')
    .eq('season_id', season.id);

  if (spErr) {
    showAlert('alert-box', 'Erro ao carregar jogadores.', 'error');
    return;
  }

  // 3. Sorteios desta temporada (ordem cronológica descrescente para o último)
  const { data: draws, error: dErr } = await db
    .from('draws')
    .select('id, draw_date, numbers')
    .eq('season_id', season.id)
    .order('draw_date', { ascending: false });

  if (dErr) {
    showAlert('alert-box', 'Erro ao carregar sorteios.', 'error');
    return;
  }

  // 4. Mostrar último sorteio
  if (draws && draws.length > 0) {
    const last = draws[0];
    const section = document.getElementById('last-draw-section');
    const label   = document.getElementById('last-draw-label');
    const ballsEl = document.getElementById('last-draw-balls');
    label.textContent = `Último Sorteio · ${formatDate(last.draw_date)}`;
    ballsEl.innerHTML = last.numbers
      .map(n => `<span class="ball ball-draw">${n}</span>`)
      .join('');
    section.style.display = 'block';
  }

  // 5. Calcular progresso de cada jogador
  allRows = (seasonPlayers || []).map(sp => {
    const { matched } = calcProgress(sp.key_numbers, draws || []);
    return {
      playerId: sp.player_id,
      name: sp.players.name,
      count: matched.length,
      total: sp.key_numbers.length,
    };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  renderLeaderboard(allRows);
}

function renderLeaderboard(rows) {
  const list = document.getElementById('leaderboard-list');
  const empty = document.getElementById('empty-state');
  const count = document.getElementById('player-count');

  count.textContent = `${rows.length} jogador${rows.length !== 1 ? 'es' : ''}`;

  if (rows.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.innerHTML = rows.map((row, i) => {
    const rank = i < 3 ? MEDALS[i] : `${i + 1}.`;
    const pct  = Math.round((row.count / row.total) * 100);
    return `
      <a href="player.html?player_id=${row.playerId}" class="leaderboard-row">
        <div class="leaderboard-row-top">
          <span class="leaderboard-rank">${rank}</span>
          <span class="leaderboard-name">${escapeHtml(row.name)}</span>
          <span class="leaderboard-score">${row.count}/${row.total}</span>
        </div>
        <div class="progress-bar-wrap">
          <div class="progress-bar-fill" style="width: ${pct}%"></div>
        </div>
      </a>
    `;
  }).join('');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Pesquisa em tempo real
document.getElementById('search-input').addEventListener('input', e => {
  const query = e.target.value.trim().toLowerCase();
  const filtered = query
    ? allRows.filter(r => r.name.toLowerCase().includes(query))
    : allRows;
  renderLeaderboard(filtered);
});

// Arranque
loadLeaderboard();
