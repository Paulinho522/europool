// js/player.js — Perfil do jogador (só leitura)

async function loadPlayerProfile() {
  // 1. Ler player_id da URL
  const params = new URLSearchParams(window.location.search);
  const playerId = params.get('player_id');

  if (!playerId) {
    showAlert('alert-box', 'Jogador não especificado.', 'error');
    return;
  }

  // 2. Temporada ativa
  const season = await getActiveSeason();
  if (!season) {
    showAlert('alert-box', 'Nenhuma temporada ativa.', 'info');
    return;
  }

  document.getElementById('season-badge').textContent = season.name;

  // 3. Dados do jogador nesta temporada
  const { data: sp, error: spErr } = await db
    .from('season_players')
    .select('key_numbers, players(name)')
    .eq('season_id', season.id)
    .eq('player_id', playerId)
    .maybeSingle();

  if (spErr || !sp) {
    showAlert('alert-box', 'Jogador não encontrado nesta temporada.', 'error');
    return;
  }

  // 4. Sorteios da temporada
  const { data: draws, error: dErr } = await db
    .from('draws')
    .select('draw_date, numbers')
    .eq('season_id', season.id)
    .order('draw_date', { ascending: true });

  if (dErr) {
    showAlert('alert-box', 'Erro ao carregar sorteios.', 'error');
    return;
  }

  // 5. Calcular progresso
  const { matched, pending, matchDates } = calcProgress(sp.key_numbers, draws || []);
  const count = matched.length;
  const total = sp.key_numbers.length;
  const pct   = Math.round((count / total) * 100);

  // 6. Preencher o DOM
  document.getElementById('player-name').textContent = sp.players.name;
  document.getElementById('season-name').textContent = season.name;
  document.getElementById('score-display').textContent = `${count}/${total}`;
  document.getElementById('progress-bar').style.width = `${pct}%`;
  document.title = `EuroPool — ${sp.players.name}`;

  // 7. Mensagem motivacional (≤ 3 pendentes)
  if (pending.length > 0 && pending.length <= 3) {
    const msg = document.getElementById('motivation-msg');
    msg.textContent = pending.length === 1
      ? '🔥 Falta apenas 1 número!'
      : `🔥 Faltam apenas ${pending.length} números!`;
    msg.classList.remove('hidden');
  }

  // 8. Grelha de bolas (ordenadas numericamente)
  const sortedKey = [...sp.key_numbers].sort((a, b) => a - b);
  const grid = document.getElementById('balls-grid');
  grid.innerHTML = sortedKey.map(n => {
    const isMatched = matchDates[n] !== undefined;
    const cls = isMatched ? 'ball ball-matched' : 'ball ball-pending';
    const title = isMatched
      ? `Acertado em ${formatDate(matchDates[n])}`
      : 'Pendente';
    return `<span class="${cls}" title="${title}">${n}</span>`;
  }).join('');

  // 9. Tabela histórico de acertos
  const tbody = document.getElementById('match-history-body');
  if (matched.length === 0) {
    document.getElementById('match-history-card').style.display = 'none';
  } else {
    const sortedMatched = [...matched].sort(
      (a, b) => new Date(matchDates[a]) - new Date(matchDates[b])
    );
    tbody.innerHTML = sortedMatched.map(n => `
      <tr>
        <td><span class="ball ball-matched" style="width:28px;height:28px;font-size:0.8rem;">${n}</span></td>
        <td>${formatDate(matchDates[n])}</td>
      </tr>
    `).join('');
  }

  // 10. Mostrar conteúdo
  document.getElementById('profile-content').classList.remove('hidden');
}

loadPlayerProfile();
