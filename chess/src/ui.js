import { CONFIG } from './config.js';
import { ATTACK, DEFENSE, isInCheck, kingSquare, pieceId, squareName, tokenId } from './rules.js';

const SYMBOL = { N: '♞', R: '♜', B: '♝', Q: '♛', K: '♚' };

const REASON = {
  plant: 'Король Т дошёл до\u00A0F.',
  mate: 'Мат.',
  stalemate: 'Пат. В\u00A0макете это победа защиты.',
  moves: '20\u00A0ходов прошли, защита удержала F.',
  flag: 'Время вышло.',
  resign: 'Сдача.',
};

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function glyph(code, draggable) {
  const id = pieceId(code);
  const tone = code > 0 ? '#e6d2b0' : '#9ec0ef';
  const label = `${CONFIG.pieces[id].name}, ${code > 0 ? 'атака' : 'защита'}`;
  const attr = draggable ? ` data-token="${tokenId(code)}"` : '';
  return `<span class="token ${code > 0 ? 't' : 'ct'}${draggable ? '' : ' frozen'}"${attr} role="img" aria-label="${esc(label)}" style="color:${tone}">${SYMBOL[id]}</span>`;
}

function visual(index, humanSide) {
  const file = index % 5;
  const rank = (index / 5) | 0;
  if (humanSide === ATTACK) return { col: file, row: 4 - rank };
  return { col: 4 - file, row: rank };
}

function sideAccusative(side) {
  return side === ATTACK ? 'атаку' : 'защиту';
}

function bar(state, side) {
  const active = state.phase === 'play' && state.pos.side === side;
  const yours = side === state.humanSide;
  let status = '';
  if (active && state.busy) status = 'Считает…';
  else if (active && yours) status = 'Ваш ход';
  else if (active) status = 'Ход соперника';
  const hot = state.clocks[side] < 10000 ? ' hot' : '';
  return `
    <div class="bar ${side === ATTACK ? 'attack' : 'defense'}${active ? ' active' : ''}">
      <div>
        <b>${side === ATTACK ? 'Т' : 'КТ'}</b>
        <span>${side === ATTACK ? 'атака' : 'защита'}${yours ? ' · вы' : ''}</span>
      </div>
      <strong class="clock${hot}" data-clock="${side}">${formatClock(state.clocks[side])}</strong>
      <em>${esc(status)}</em>
    </div>
  `;
}

function board(state) {
  const human = state.humanSide;
  const checkSquare = state.phase === 'play' && isInCheck(state.pos.board, state.pos.side)
    ? kingSquare(state.pos.board, state.pos.side)
    : -1;
  const hintAt = new Map((state.hints || []).map((hint) => [hint.square, hint.kind]));
  const cells = [];
  for (let index = 0; index < 25; index += 1) {
    const spot = visual(index, human);
    const name = squareName(index);
    const file = index % 5;
    const rank = (index / 5) | 0;
    const classes = ['sq', (file + rank) % 2 === 0 ? 'dark' : 'light'];
    if (index === state.pos.plant) classes.push('plant');
    if (index === checkSquare) classes.push('in-check');
    if (state.lastMove && (index === state.lastMove.from || index === state.lastMove.to)) classes.push('last');
    const hint = hintAt.get(name);
    if (hint) classes.push(hint);
    if (state.selected && state.pos.board[index] && tokenId(state.pos.board[index]) === state.selected) {
      classes.push('is-selected');
    }
    const piece = state.pos.board[index];
    const draggable = piece && state.canMove && pieceSideMatches(piece, state.humanSide);
    const token = piece ? glyph(piece, draggable) : '';
    const mark = index === state.pos.plant ? '<span class="plant-mark">F</span><span class="plant-caption">плент</span>' : '';
    cells.push(`<div class="${classes.join(' ')}" data-zone="${name}" style="grid-column:${spot.col + 2};grid-row:${spot.row + 1}" aria-label="${name.toUpperCase()}">${mark}${token}</div>`);
  }
  const ranks = [];
  const files = [];
  for (let row = 0; row < 5; row += 1) {
    const rank = human === ATTACK ? 5 - row : row + 1;
    const file = human === ATTACK ? 'ABCDE'[row] : 'EDCBA'[row];
    ranks.push(`<div class="coord rank" style="grid-column:1;grid-row:${row + 1}">${rank}</div>`);
    files.push(`<div class="coord file" style="grid-column:${row + 2};grid-row:6">${file}</div>`);
  }
  return `<div class="board-wrap"><div class="grid" data-board>${ranks.join('')}${cells.join('')}${files.join('')}</div></div>`;
}

function pieceSideMatches(code, side) {
  return (code > 0 ? ATTACK : DEFENSE) === side;
}

function resultBlock(state) {
  if (state.phase === 'play') return '';
  const winner = state.result.winner === 'attack' ? 'атаки' : 'защиты';
  const matchOver = state.phase === 'match';
  let title = `Победа ${winner}`;
  if (matchOver) {
    title = state.score.attack === state.score.defense
      ? 'Ничья в\u00A0матче'
      : `Матч выиграла ${state.score.attack > state.score.defense ? 'атака' : 'защита'}`;
  }
  const next = matchOver
    ? '<button type="button" data-action="again">Новый матч</button>'
    : '<button type="button" data-action="next">Следующая партия</button>';
  return `
    <section class="result">
      <h2>${title}</h2>
      <p>${esc(REASON[state.result.reason] || '')}</p>
      <p class="analysis">${esc(state.analysis || '')}</p>
      ${next}
    </section>
  `;
}

export function render(state) {
  const app = document.querySelector('#app');
  const attackGoal = state.humanSide === ATTACK;
  const level = CONFIG.levels[state.levelId];
  app.innerHTML = `
    <div class="screen">
      <aside class="panel story">
        <p class="logo"><span>CS</span><span class="two">2</span> <small>MINI CHESS</small></p>
        <h1>Захватите<br>плент</h1>
        <p class="lead">${attackGoal
          ? 'Доведите короля Т до\u00A0F. Мат партию не заканчивает.'
          : 'Не пускайте короля на\u00A0F 20\u00A0ходов.'}</p>
        <div class="facts">
          <div><b>5×5</b><span>компактно, больше тактики</span></div>
          <div><b>2+1</b><span>быстрые партии</span></div>
        </div>
        <p class="warn">Король не может войти под\u00A0шах.</p>
        <a class="back" href="../">Сборка Dust2</a>
      </aside>
      <main class="stage">
        ${bar(state, state.humanSide ^ 1)}
        ${board(state)}
        <p class="note" data-note>${esc(state.note || '')}</p>
        ${bar(state, state.humanSide)}
      </main>
      <aside class="panel scoreboard">
        <p class="kicker">Матч до\u00A0${CONFIG.match.winsNeeded}\u00A0побед</p>
        <p class="score"><span>${state.score.attack}</span><i>:</i><span>${state.score.defense}</span></p>
        <p class="sub">Партия ${state.game}\u00A0/ ${CONFIG.match.maxGames} · Т\u00A0: КТ</p>
        <p class="who">В\u00A0этой партии вы за\u00A0${sideAccusative(state.humanSide)}. Дальше стороны меняются.</p>
        <div class="goals">
          <div class="goal attack"><b>Т\u00A0/ атака</b><span>Только король на\u00A0F</span></div>
          <div class="goal defense"><b>КТ\u00A0/ защита</b><span>Удержание ${CONFIG.maxMoves}\u00A0ходов</span></div>
        </div>
        <p class="moveno">Ход ${Math.min(state.pos.fullmove, CONFIG.maxMoves)}\u00A0/ ${CONFIG.maxMoves}</p>
        <div class="segment" role="group" aria-label="Сила бота">
          ${Object.values(CONFIG.levels).map((item) => `
            <button type="button" data-action="level" data-arg="${item.id}" class="${item.id === state.levelId ? 'on' : ''}">${esc(item.name)}</button>
          `).join('')}
        </div>
        <p class="level-note">${esc(level.note)}</p>
        <div class="sides">
          <button type="button" data-action="side" data-arg="attack">Новый матч за\u00A0Т</button>
          <button type="button" data-action="side" data-arg="defense">Новый матч за\u00A0КТ</button>
        </div>
        <button type="button" class="resign" data-action="resign" ${state.phase === 'play' ? '' : 'disabled'}>Сдаться</button>
        ${resultBlock(state)}
      </aside>
    </div>
  `;
}

export function paintHints(state) {
  const boardNode = document.querySelector('[data-board]');
  if (!boardNode) return;
  boardNode.querySelectorAll('[data-zone]').forEach((cell) => {
    cell.classList.remove('hint-move', 'hint-capture', 'hint-plant', 'is-selected');
  });
  for (const hint of state.hints || []) {
    boardNode.querySelector(`[data-zone="${hint.square}"]`)?.classList.add(hint.kind);
  }
  if (state.selected) {
    boardNode.querySelector(`[data-token="${state.selected}"]`)?.closest('[data-zone]')?.classList.add('is-selected');
  }
  const note = document.querySelector('[data-note]');
  if (note) note.textContent = state.note || '';
}

export const FLIGHT_MS = 460;

export function flightDuration() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  return FLIGHT_MS;
}

export function flyPiece(flight) {
  if (!flight || flightDuration() === 0) return;
  const board = document.querySelector('[data-board]');
  if (!board) return;
  const from = board.querySelector(`[data-zone="${squareName(flight.from)}"]`);
  const to = board.querySelector(`[data-zone="${squareName(flight.to)}"]`);
  const token = to?.querySelector('.token:not(.ghost)');
  if (!from || !to || !token) return;
  if (flight.captured) {
    const ghost = document.createElement('span');
    ghost.className = 'token ghost';
    ghost.style.color = flight.captured > 0 ? '#e6d2b0' : '#9ec0ef';
    ghost.textContent = SYMBOL[pieceId(flight.captured)];
    to.appendChild(ghost);
    requestAnimationFrame(() => ghost.classList.add('gone'));
  }
  const fromBox = from.getBoundingClientRect();
  const toBox = to.getBoundingClientRect();
  const dx = (fromBox.left + fromBox.width / 2) - (toBox.left + toBox.width / 2);
  const dy = (fromBox.top + fromBox.height / 2) - (toBox.top + toBox.height / 2);
  to.classList.add('flight-dest');
  token.style.zIndex = '6';
  token.style.transition = 'none';
  token.style.transform = `translate(${dx}px, ${dy}px)`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      token.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(.2, .75, .2, 1)`;
      token.style.transform = 'translate(0, 0)';
    });
  });
}

export function paintClocks(state) {
  for (const side of [ATTACK, DEFENSE]) {
    const node = document.querySelector(`[data-clock="${side}"]`);
    if (!node) continue;
    node.textContent = formatClock(state.clocks[side]);
    node.classList.toggle('hot', state.clocks[side] < 10000);
  }
}
