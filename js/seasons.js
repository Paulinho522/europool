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
