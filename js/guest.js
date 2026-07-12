// js/guest.js — Leaderboard público (só leitura)

const MEDALS = ['🥇', '🥈', '🥉'];

let allRows = []; // cache para filtro de pesquisa
let allDraws = []; // cache de todos os sorteios da época ativa

async function loadLeaderboard() {
  // 1. Temporada ativa
  const season = await getActiveSeason();
  if (!season) {
    document.getElementById('season-badge').textContent = 'Sem temporada ativa';
    await showWinnerBanner();
    return;
  }
  document.getElementById('winner-banner').classList.add('hidden');

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

  allDraws = draws || [];
  document.getElementById('draw-history-list').classList.add('hidden');
  document.getElementById('toggle-draws-btn').textContent = 'Ver histórico completo ▾';

  // 5. Calcular progresso de cada jogador
  allRows = (seasonPlayers || [])
    .filter(sp => sp.players != null) // skip orphaned rows
    .map(sp => {
      const { matched } = calcProgress(sp.key_numbers, draws || []);
      return {
        playerId: sp.player_id,
        name: sp.players.name,
        count: matched.length,
        total: sp.key_numbers.length,
      };
    }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Re-apply any search query that was typed during load
  const currentQuery = document.getElementById('search-input').value.trim().toLowerCase();
  if (currentQuery) {
    renderLeaderboard(allRows.filter(r => r.name.toLowerCase().includes(currentQuery)));
  } else {
    renderLeaderboard(allRows);
  }
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
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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

// Pesquisa em tempo real
document.getElementById('search-input').addEventListener('input', e => {
  const query = e.target.value.trim().toLowerCase();
  const filtered = query
    ? allRows.filter(r => r.name.toLowerCase().includes(query))
    : allRows;
  renderLeaderboard(filtered);
});

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

// Arranque
loadLeaderboard();
