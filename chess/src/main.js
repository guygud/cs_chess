import { CONFIG } from './config.js';
import { bindDrag } from '../../src/dnd.js';
import { MATE, attackScore, forcedWinner } from './engine.js';
import { analysisText } from './report.js';
import {
  ATTACK,
  DEFENSE,
  KING,
  createPosition,
  findToken,
  isInCheck,
  legalMovesFrom,
  makeMove,
  moveNotation,
  parseSquare,
  pseudoMoves,
  squareName,
} from './rules.js';
import { flightDuration, flyPiece, paintClocks, paintHints, render } from './ui.js';

const state = {
  playerSide: ATTACK,
  humanSide: ATTACK,
  levelId: CONFIG.defaultLevel,
  game: 1,
  score: { attack: 0, defense: 0 },
  pos: createPosition(),
  clocks: {},
  stamp: 0,
  holdClock: false,
  selected: null,
  hints: [],
  note: '',
  history: [],
  lastMove: null,
  phase: 'play',
  busy: true,
  result: null,
  analysis: '',
  canMove: false,
  flight: null,
  turn: 0,
};

let worker = null;
let requestId = 0;
let unbind = () => {};

function freshClocks() {
  const ms = CONFIG.clock.seconds * 1000;
  return { [ATTACK]: ms, [DEFENSE]: ms };
}

function levelOptions() {
  const level = CONFIG.levels[state.levelId];
  return {
    timeMs: level.timeMs,
    maxDepth: level.maxDepth,
    randomMargin: level.randomMargin,
  };
}

function think(pos, options) {
  if (!worker) {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  }
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      if (event.data.id !== id) return;
      cleanup();
      resolve(event.data.result);
    };
    const onError = (event) => {
      cleanup();
      reject(event.error || new Error(event.message || 'Движок остановился'));
    };
    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage({
      id,
      pos: {
        board: Array.from(pos.board),
        side: pos.side,
        fullmove: pos.fullmove,
        plant: pos.plant,
        result: pos.result,
      },
      options,
    });
  });
}

function crash(error) {
  const app = document.querySelector('#app');
  const note = document.createElement('pre');
  note.className = 'crash';
  note.textContent = error?.message || 'Ошибка скрипта';
  app.prepend(note);
}

function draw() {
  const flight = state.flight;
  state.flight = null;
  unbind();
  render(state);
  const board = document.querySelector('[data-board]');
  if (!board) return;
  if (flight) flyPiece(flight);
  unbind = bindDrag(board, {
    onTap: select,
    onDrag: select,
    onDrop: drop,
    onZone: (zone) => {
      if (!state.selected) return;
      drop(state.selected, zone);
    },
  }, { threshold: 8 });
}

function syncClock() {
  if (state.phase !== 'play' || state.holdClock || !state.pos) return;
  const now = performance.now();
  state.clocks[state.pos.side] -= now - state.stamp;
  state.stamp = now;
}

function clearSelection() {
  state.selected = null;
  state.hints = [];
  state.note = '';
}

function hintKind(from, to) {
  if (state.pos.board[from] === KING && to === state.pos.plant) return 'hint-plant';
  if (state.pos.board[to]) return 'hint-capture';
  return 'hint-move';
}

function select(id) {
  if (!state.canMove) return;
  if (state.selected === id) {
    clearSelection();
    paintHints(state);
    return;
  }
  const from = findToken(state.pos.board, id);
  if (from < 0) return;
  const moves = legalMovesFrom(state.pos, from);
  state.selected = id;
  state.hints = moves.map((move) => ({ square: squareName(move.to), kind: hintKind(from, move.to) }));
  if (moves.length) {
    state.note = '';
  } else if (isInCheck(state.pos.board, state.pos.side)) {
    state.note = 'Шах. Эта фигура его не снимает.';
  } else if (pseudoMoves(state.pos.board, state.pos.side).some((move) => move.from === from)) {
    state.note = 'Фигура связана.';
  } else {
    state.note = 'Хода нет.';
  }
  paintHints(state);
}

function drop(id, zone) {
  if (!state.canMove) {
    draw();
    return;
  }
  const from = findToken(state.pos.board, id);
  const move = zone && from >= 0
    ? legalMovesFrom(state.pos, from).find((item) => squareName(item.to) === zone)
    : null;
  if (!move) {
    clearSelection();
    draw();
    return;
  }
  commitHuman(move);
}

function finish(result) {
  if (state.phase !== 'play') return;
  state.turn += 1;
  state.phase = 'over';
  state.busy = false;
  state.canMove = false;
  state.holdClock = false;
  clearSelection();
  state.result = result;
  state.score[result.winner] += 1;
  const reached = state.score[result.winner] >= CONFIG.match.winsNeeded;
  if (reached || state.game >= CONFIG.match.maxGames) state.phase = 'match';
  state.analysis = analysisText(state.history);
  draw();
}

function flag() {
  const side = state.pos.side;
  state.clocks[side] = 0;
  finish({ winner: side === ATTACK ? 'defense' : 'attack', reason: 'flag' });
}

function playEngineMove(thought) {
  if (state.phase !== 'play' || !thought) return;
  syncClock();
  if (state.clocks[state.pos.side] <= 0) {
    flag();
    return;
  }
  const prev = state.pos;
  const move = { from: thought.from, to: thought.to };
  const next = makeMove(prev, move);
  state.clocks[prev.side] += CONFIG.clock.increment * 1000;
  state.lastMove = move;
  state.pos = next;
  state.note = `Соперник: ${moveNotation(prev, move)}`;
  state.flight = { from: move.from, to: move.to, captured: prev.board[move.to] };
  state.stamp = performance.now();
  const prior = state.history[state.history.length - 1];
  const entry = {
    san: moveNotation(prev, move),
    fullmove: prev.fullmove,
    by: prev.side,
    attackScore: prior?.attackScore ?? attackScore(thought.score, prev.side),
    forced: prior?.forced ?? forcedWinner(thought.score, prev.side),
  };
  if (next.result && next.result.reason !== 'flag' && next.result.reason !== 'resign') {
    entry.forced = next.result.winner;
    entry.attackScore = next.result.winner === 'attack' ? MATE : -MATE;
  }
  state.history.push(entry);
  if (next.result) {
    finish(next.result);
    return;
  }
  releaseTurn(next, state.turn);
}

function releaseTurn(next, token) {
  const opponentSkipped = next.side !== state.humanSide;
  state.busy = opponentSkipped;
  state.canMove = false;
  draw();
  window.setTimeout(async () => {
    if (token !== state.turn || state.phase !== 'play') return;
    if (!opponentSkipped) {
      state.busy = false;
      state.canMove = true;
      draw();
      return;
    }
    state.busy = true;
    state.canMove = false;
    draw();
    let thought;
    try {
      thought = await think(state.pos, levelOptions());
    } catch (error) {
      crash(error);
      return;
    }
    if (token !== state.turn || state.phase !== 'play') return;
    playEngineMove(thought);
  }, flightDuration());
}

async function commitHuman(move) {
  if (!state.canMove || state.phase !== 'play') return;
  const token = state.turn;
  syncClock();
  if (state.clocks[state.pos.side] <= 0) {
    flag();
    return;
  }
  const prev = state.pos;
  const next = makeMove(prev, move);
  state.clocks[prev.side] += CONFIG.clock.increment * 1000;
  state.lastMove = move;
  state.pos = next;
  clearSelection();
  state.stamp = performance.now();
  const entry = {
    san: moveNotation(prev, move),
    fullmove: prev.fullmove,
    by: prev.side,
    attackScore: 0,
    forced: null,
  };
  if (next.result) {
    entry.forced = next.result.winner;
    entry.attackScore = next.result.winner === 'attack' ? MATE : -MATE;
    state.history.push(entry);
    finish(next.result);
    return;
  }
  state.history.push(entry);
  if (next.side === state.humanSide) {
    state.note = 'У соперника нет хода.';
    state.busy = false;
    state.canMove = true;
    draw();
    return;
  }
  state.busy = true;
  state.canMove = false;
  draw();
  let thought;
  try {
    thought = await think(next, levelOptions());
  } catch (error) {
    crash(error);
    return;
  }
  if (token !== state.turn || state.phase !== 'play') return;
  entry.attackScore = attackScore(thought.score, next.side);
  entry.forced = forcedWinner(thought.score, next.side);
  playEngineMove(thought);
}

async function startGame() {
  const token = ++state.turn;
  state.humanSide = state.game % 2 === 1 ? state.playerSide : state.playerSide ^ 1;
  state.pos = createPosition();
  state.clocks = freshClocks();
  state.stamp = performance.now();
  state.holdClock = state.humanSide === state.pos.side;
  clearSelection();
  state.history = [];
  state.lastMove = null;
  state.result = null;
  state.analysis = '';
  state.phase = 'play';
  state.busy = true;
  state.canMove = false;
  draw();
  let thought;
  try {
    thought = await think(state.pos, levelOptions());
  } catch (error) {
    crash(error);
    return;
  }
  if (token !== state.turn || state.phase !== 'play') return;
  if (!thought) {
    crash(new Error('Движок не вернул ход'));
    return;
  }
  state.history.push({
    san: null,
    fullmove: state.pos.fullmove,
    attackScore: attackScore(thought.score, state.pos.side),
    forced: forcedWinner(thought.score, state.pos.side),
  });
  state.holdClock = false;
  state.stamp = performance.now();
  if (state.pos.side !== state.humanSide) {
    playEngineMove(thought);
    return;
  }
  state.busy = false;
  state.canMove = true;
  draw();
}

const actions = {
  level(id) {
    if (!CONFIG.levels[id] || id === state.levelId) return;
    state.levelId = id;
    draw();
  },
  side(name) {
    state.playerSide = name === 'defense' ? DEFENSE : ATTACK;
    state.game = 1;
    state.score = { attack: 0, defense: 0 };
    startGame();
  },
  resign() {
    if (state.phase !== 'play') return;
    finish({
      winner: state.humanSide === ATTACK ? 'defense' : 'attack',
      reason: 'resign',
    });
  },
  next() {
    if (state.phase !== 'over') return;
    state.game += 1;
    startGame();
  },
  again() {
    state.game = 1;
    state.score = { attack: 0, defense: 0 };
    startGame();
  },
};

document.querySelector('#app').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  actions[button.dataset.action]?.(button.dataset.arg);
});

window.addEventListener('error', (event) => {
  crash(event.error || new Error(event.message || 'Ошибка скрипта'));
});

setInterval(() => {
  if (state.phase !== 'play') return;
  syncClock();
  paintClocks(state);
  if (!state.holdClock && state.clocks[state.pos.side] <= 0) flag();
}, 200);

startGame();
