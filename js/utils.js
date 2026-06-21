// js/utils.js
// Funções partilhadas entre todas as páginas

/**
 * Calcula os números acertados de um jogador cruzando a sua chave
 * com todos os sorteios da temporada.
 *
 * @param {number[]} keyNumbers - Array de 15 números do jogador
 * @param {Array<{numbers: number[], draw_date: string}>} draws - Sorteios da temporada
 * @returns {{ matched: number[], pending: number[], matchDates: Object }}
 */
function calcProgress(keyNumbers, draws) {
  // Para cada número da chave, encontrar a data do primeiro sorteio que o contém
  const matchDates = {};
  const sortedDraws = [...draws].sort(
    (a, b) => new Date(a.draw_date) - new Date(b.draw_date)
  );

  for (const draw of sortedDraws) {
    for (const n of draw.numbers) {
      if (keyNumbers.includes(n) && !matchDates[n]) {
        matchDates[n] = draw.draw_date;
      }
    }
  }

  const matched = keyNumbers.filter(n => matchDates[n] !== undefined);
  const pending = keyNumbers.filter(n => matchDates[n] === undefined);

  return { matched, pending, matchDates };
}

/**
 * Valida uma chave de 15 números (1–50, sem repetição).
 * @param {number[]} numbers
 * @returns {string|null} mensagem de erro ou null se válido
 */
function validateKey(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 15)
    return 'A chave deve ter exatamente 15 números.';
  if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > 50))
    return 'Todos os números devem estar entre 1 e 50.';
  if (new Set(numbers).size !== 15)
    return 'A chave não pode ter números repetidos.';
  return null;
}

/**
 * Valida um sorteio de 5 números (1–50, sem repetição).
 * @param {number[]} numbers
 * @returns {string|null} mensagem de erro ou null se válido
 */
function validateDraw(numbers) {
  if (!Array.isArray(numbers) || numbers.length !== 5)
    return 'O sorteio deve ter exatamente 5 números.';
  if (numbers.some(n => !Number.isInteger(n) || n < 1 || n > 50))
    return 'Todos os números devem estar entre 1 e 50.';
  if (new Set(numbers).size !== 5)
    return 'O sorteio não pode ter números repetidos.';
  return null;
}

/**
 * Formata uma data ISO (YYYY-MM-DD) para dd/mm/yyyy.
 * @param {string} isoDate
 * @returns {string}
 */
function formatDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

/**
 * Obtém a temporada ativa do Supabase.
 * @returns {Promise<Object|null>}
 */
async function getActiveSeason() {
  const { data, error } = await db
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .maybeSingle();
  if (error) { console.error('getActiveSeason:', error); return null; }
  return data;
}

/**
 * Mostra uma mensagem de alerta num elemento com id dado.
 * @param {string} elementId
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 */
function showAlert(elementId, message, type = 'info') {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = message;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}
