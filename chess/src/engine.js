import { CONFIG } from './config.js';
import {
  ATTACK,
  BISHOP,
  DEFENSE,
  KING,
  KNIGHT,
  QUEEN,
  ROOK,
  hashPos,
  isAttacked,
  isInCheck,
  kingSquare,
  legalMoves,
  makeMove,
  pseudoMoves,
} from './rules.js';

export const MATE = 100000;
const MATE_FLOOR = 90000;
const INF = 1000000;
const TIMEOUT = Symbol('timeout');

const VALUE = {
  [KNIGHT]: CONFIG.values.N,
  [ROOK]: CONFIG.values.R,
  [BISHOP]: CONFIG.values.B,
  [QUEEN]: CONFIG.values.Q,
  [KING]: CONFIG.values.K,
};

let table = new Map();
let killers = [];
let nodes = 0;
let deadline = 0;

function timedOut() {
  nodes += 1;
  if ((nodes & 127) === 0 && Date.now() >= deadline) throw TIMEOUT;
}

function storeScore(score, ply) {
  if (score > MATE_FLOOR) return score + ply;
  if (score < -MATE_FLOOR) return score - ply;
  return score;
}

function readScore(score, ply) {
  if (score > MATE_FLOOR) return score - ply;
  if (score < -MATE_FLOOR) return score + ply;
  return score;
}

export function isForcedScore(score) {
  return Math.abs(score) > MATE_FLOOR;
}

export function forcedWinner(score, side) {
  if (!isForcedScore(score)) return null;
  const winner = score > 0 ? side : side ^ 1;
  return winner === ATTACK ? 'attack' : 'defense';
}

export function attackScore(score, side) {
  return side === ATTACK ? score : -score;
}

function chebyshev(from, to) {
  const df = Math.abs((from % 5) - (to % 5));
  const dr = Math.abs(((from / 5) | 0) - ((to / 5) | 0));
  return Math.max(df, dr);
}

function movesLeft(pos) {
  return CONFIG.maxMoves - pos.fullmove + (pos.side === ATTACK ? 1 : 0);
}

export function evaluate(pos) {
  let score = 0;
  for (let index = 0; index < 25; index += 1) {
    const piece = pos.board[index];
    if (!piece) continue;
    const value = VALUE[Math.abs(piece)];
    score += piece > 0 ? value : -value;
  }
  const king = kingSquare(pos.board, ATTACK);
  const distance = king < 0 ? 4 : chebyshev(king, pos.plant);
  score -= distance * CONFIG.eval.kingStep;
  if (distance > movesLeft(pos)) score -= CONFIG.eval.unreachable;
  if (isAttacked(pos.board, pos.plant, DEFENSE)) score -= CONFIG.eval.plantAttack;
  if (isAttacked(pos.board, pos.plant, ATTACK)) score += CONFIG.eval.plantDefense;
  const attackMoves = pseudoMoves(pos.board, ATTACK).length;
  const defenseMoves = pseudoMoves(pos.board, DEFENSE).length;
  score += (attackMoves - defenseMoves) * CONFIG.eval.mobility;
  if (isAttacked(pos.board, king, DEFENSE)) score -= 40;
  const defender = kingSquare(pos.board, DEFENSE);
  if (defender >= 0 && isAttacked(pos.board, defender, ATTACK)) score += 40;
  return pos.side === ATTACK ? score : -score;
}

function terminalScore(pos, ply) {
  const winner = pos.result.winner === 'attack' ? ATTACK : DEFENSE;
  const magnitude = MATE - ply;
  return winner === pos.side ? magnitude : -magnitude;
}

function tactical(pos, move) {
  if (pos.board[move.to]) return true;
  return pos.side === ATTACK && pos.board[move.from] === KING && move.to === pos.plant;
}

function victimValue(pos, move) {
  const victim = Math.abs(pos.board[move.to]);
  if (!victim) return 0;
  const attacker = Math.abs(pos.board[move.from]);
  return 10000 + VALUE[victim] * 10 - VALUE[attacker];
}

function sameMove(left, right) {
  return left && right && left.from === right.from && left.to === right.to;
}

function orderMoves(pos, moves, hint, ply) {
  const killer = killers[ply] || [];
  return moves
    .map((move) => {
      let rank = 0;
      if (sameMove(move, hint)) rank = 1000000;
      else if (pos.board[move.to]) rank = victimValue(pos, move);
      else if (sameMove(move, killer[0])) rank = 5000;
      else if (sameMove(move, killer[1])) rank = 4000;
      else if (pos.board[move.from] === KING && pos.side === ATTACK) {
        const before = chebyshev(move.from, pos.plant);
        const after = chebyshev(move.to, pos.plant);
        if (after < before) rank = 200;
      }
      return { move, rank };
    })
    .sort((left, right) => right.rank - left.rank)
    .map((item) => item.move);
}

function rememberKiller(ply, move) {
  const slot = killers[ply];
  if (!slot || sameMove(slot[0], move)) return;
  slot[1] = slot[0];
  slot[0] = move;
}

function qsearch(pos, alpha, beta, ply) {
  if (pos.result) return terminalScore(pos, ply);
  timedOut();
  if (ply > 48) return evaluate(pos);
  const check = isInCheck(pos.board, pos.side);
  if (!check) {
    const stand = evaluate(pos);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }
  const moves = orderMoves(
    pos,
    legalMoves(pos).filter((move) => check || tactical(pos, move)),
    null,
    ply,
  );
  for (const move of moves) {
    const score = -qsearch(makeMove(pos, move), -beta, -alpha, ply + 1);
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(pos, depth, alpha, beta, ply) {
  if (pos.result) return terminalScore(pos, ply);
  timedOut();
  const key = hashPos(pos);
  const cached = table.get(key);
  const alphaStart = alpha;
  if (cached && cached.depth >= depth) {
    const value = readScore(cached.score, ply);
    if (cached.flag === 0) return value;
    if (cached.flag === 1 && value >= beta) return value;
    if (cached.flag === 2 && value <= alpha) return value;
  }
  if (depth <= 0) return qsearch(pos, alpha, beta, ply);

  const moves = orderMoves(pos, legalMoves(pos), cached?.move, ply);
  if (!moves.length) {
    const winner = CONFIG.stalemateWinner === 'attack' ? ATTACK : DEFENSE;
    const magnitude = MATE - ply;
    return winner === pos.side ? magnitude : -magnitude;
  }

  let best = -INF;
  let bestMove = moves[0];
  for (const move of moves) {
    const child = makeMove(pos, move);
    const extend = !child.result && isInCheck(child.board, child.side) && ply < 20 ? 1 : 0;
    const score = -negamax(child, depth - 1 + extend, -beta, -alpha, ply + 1);
    if (score > best) {
      best = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
    if (alpha >= beta) {
      if (!pos.board[move.to]) rememberKiller(ply, move);
      break;
    }
  }

  let flag = 0;
  if (best <= alphaStart) flag = 2;
  else if (best >= beta) flag = 1;
  table.set(key, { depth, score: storeScore(best, ply), flag, move: bestMove });
  return best;
}

function searchRoot(pos, depth, hint) {
  const moves = orderMoves(pos, legalMoves(pos), hint, 0);
  if (!moves.length) return null;
  let alpha = -INF;
  const beta = INF;
  let best = -INF;
  let bestMove = moves[0];
  const scored = [];
  for (const move of moves) {
    timedOut();
    const child = makeMove(pos, move);
    const score = -negamax(child, depth - 1, -beta, -alpha, 1);
    scored.push({ move, score });
    if (score > best) {
      best = score;
      bestMove = move;
    }
    if (score > alpha) alpha = score;
  }
  return { move: bestMove, score: best, scored };
}

export function search(pos, options = {}) {
  if (pos.result) return null;
  table = new Map();
  killers = Array.from({ length: 64 }, () => [null, null]);
  nodes = 0;
  deadline = Date.now() + (options.timeMs ?? 1000);
  const maxDepth = options.maxDepth ?? 12;
  let best = null;
  try {
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const found = searchRoot(pos, depth, best?.move);
      if (found) best = found;
      if (best && isForcedScore(best.score)) break;
    }
  } catch (error) {
    if (error !== TIMEOUT) throw error;
  }
  if (!best) {
    const moves = legalMoves(pos);
    if (!moves.length) return null;
    best = {
      move: moves[0],
      score: evaluate(pos),
      scored: [{ move: moves[0], score: evaluate(pos) }],
    };
  }
  let chosen = best.move;
  const margin = options.randomMargin ?? 0;
  if (margin > 0) {
    const pool = best.scored.filter((item) => item.score >= best.score - margin);
    chosen = pool[Math.floor(Math.random() * pool.length)].move;
  }
  return { from: chosen.from, to: chosen.to, score: best.score, nodes };
}
