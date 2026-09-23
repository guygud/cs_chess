import { CONFIG } from './config.js';

export const ATTACK = 0;
export const DEFENSE = 1;

export const KNIGHT = 1;
export const ROOK = 2;
export const BISHOP = 3;
export const QUEEN = 4;
export const KING = 5;

const CODE = { N: KNIGHT, R: ROOK, B: BISHOP, Q: QUEEN, K: KING };
const NAME = ['', 'N', 'R', 'B', 'Q', 'K'];

const KNIGHT_DELTAS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KING_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const ROOK_DELTAS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DELTAS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export function fileOf(square) {
  return square % 5;
}

export function rankOf(square) {
  return (square / 5) | 0;
}

export function square(file, rank) {
  return rank * 5 + file;
}

export function parseSquare(name) {
  const file = name.toLowerCase().charCodeAt(0) - 97;
  const rank = Number(name[1]) - 1;
  if (file < 0 || file > 4 || rank < 0 || rank > 4) {
    throw new Error(`Нет клетки ${name}`);
  }
  return square(file, rank);
}

export function squareName(index) {
  return CONFIG.files[fileOf(index)] + (rankOf(index) + 1);
}

export function pieceCode(id) {
  return CODE[id];
}

export function pieceId(code) {
  return NAME[Math.abs(code)];
}

export function pieceSide(code) {
  return code > 0 ? ATTACK : DEFENSE;
}

export function otherSide(side) {
  return side ^ 1;
}

function onBoard(file, rank) {
  return file >= 0 && file < 5 && rank >= 0 && rank < 5;
}

function hops(from, deltas) {
  const file = fileOf(from);
  const rank = rankOf(from);
  const list = [];
  for (const [df, dr] of deltas) {
    const nextFile = file + df;
    const nextRank = rank + dr;
    if (onBoard(nextFile, nextRank)) list.push(square(nextFile, nextRank));
  }
  return list;
}

const KNIGHT_TO = Array.from({ length: 25 }, (_, from) => hops(from, KNIGHT_DELTAS));
const KING_TO = Array.from({ length: 25 }, (_, from) => hops(from, KING_DELTAS));

function firstOnRay(board, from, df, dr) {
  let file = fileOf(from) + df;
  let rank = rankOf(from) + dr;
  while (onBoard(file, rank)) {
    const piece = board[square(file, rank)];
    if (piece) return piece;
    file += df;
    rank += dr;
  }
  return 0;
}

export function isAttacked(board, target, bySide) {
  const sign = bySide === ATTACK ? 1 : -1;
  for (const from of KNIGHT_TO[target]) {
    if (board[from] === sign * KNIGHT) return true;
  }
  for (const from of KING_TO[target]) {
    if (board[from] === sign * KING) return true;
  }
  for (const [df, dr] of ROOK_DELTAS) {
    const piece = firstOnRay(board, target, df, dr);
    if (piece === sign * ROOK || piece === sign * QUEEN) return true;
  }
  for (const [df, dr] of BISHOP_DELTAS) {
    const piece = firstOnRay(board, target, df, dr);
    if (piece === sign * BISHOP || piece === sign * QUEEN) return true;
  }
  return false;
}

export function kingSquare(board, side) {
  const target = side === ATTACK ? KING : -KING;
  for (let index = 0; index < 25; index += 1) {
    if (board[index] === target) return index;
  }
  return -1;
}

export function isInCheck(board, side) {
  const king = kingSquare(board, side);
  if (king < 0) return false;
  return isAttacked(board, king, otherSide(side));
}

function pushSlide(board, from, side, deltas, out) {
  const file = fileOf(from);
  const rank = rankOf(from);
  const own = side === ATTACK ? 1 : -1;
  for (const [df, dr] of deltas) {
    let nextFile = file + df;
    let nextRank = rank + dr;
    while (onBoard(nextFile, nextRank)) {
      const to = square(nextFile, nextRank);
      const occupant = board[to];
      if (occupant === 0) {
        out.push({ from, to });
      } else {
        if (occupant * own < 0 && Math.abs(occupant) !== KING) out.push({ from, to });
        break;
      }
      nextFile += df;
      nextRank += dr;
    }
  }
}

export function pseudoMoves(board, side) {
  const out = [];
  const own = side === ATTACK ? 1 : -1;
  for (let from = 0; from < 25; from += 1) {
    const piece = board[from];
    if (piece * own <= 0) continue;
    const code = Math.abs(piece);
    if (code === KNIGHT) {
      for (const to of KNIGHT_TO[from]) {
        const occupant = board[to];
        if (occupant * own <= 0 && Math.abs(occupant) !== KING) out.push({ from, to });
      }
    } else if (code === KING) {
      for (const to of KING_TO[from]) {
        const occupant = board[to];
        if (occupant * own <= 0 && Math.abs(occupant) !== KING) out.push({ from, to });
      }
    } else if (code === ROOK) {
      pushSlide(board, from, side, ROOK_DELTAS, out);
    } else if (code === BISHOP) {
      pushSlide(board, from, side, BISHOP_DELTAS, out);
    } else if (code === QUEEN) {
      pushSlide(board, from, side, ROOK_DELTAS, out);
      pushSlide(board, from, side, BISHOP_DELTAS, out);
    }
  }
  return out;
}

function leavesKingSafe(board, move, side) {
  const next = board.slice();
  next[move.to] = next[move.from];
  next[move.from] = 0;
  return !isInCheck(next, side);
}

export function legalMoves(pos) {
  if (pos.result) return [];
  if (pos.moves) return pos.moves;
  const pseudo = pseudoMoves(pos.board, pos.side);
  pos.moves = pseudo.filter((move) => leavesKingSafe(pos.board, move, pos.side));
  return pos.moves;
}

export function legalMovesFrom(pos, from) {
  return legalMoves(pos).filter((move) => move.from === from);
}

export function createPosition(config = CONFIG) {
  const board = new Int8Array(25);
  for (const item of config.setup.attack) {
    board[parseSquare(item.square)] = CODE[item.piece];
  }
  for (const item of config.setup.defense) {
    board[parseSquare(item.square)] = -CODE[item.piece];
  }
  return {
    board,
    side: ATTACK,
    fullmove: 1,
    plant: parseSquare(config.plant),
    result: null,
  };
}

function settle(next, mover, config) {
  const king = kingSquare(next.board, ATTACK);
  if (king === next.plant && mover === ATTACK) {
    return { winner: 'attack', reason: 'plant' };
  }
  // Мат не победа: сторона под шахом без хода просто пропускает очередь.
  // Иначе партия решается шахом, и до F никто не идёт.
  for (let skips = 0; skips < 2; skips += 1) {
    next.moves = undefined;
    const moves = legalMoves(next);
    if (moves.length > 0) {
      if (next.side === ATTACK && next.fullmove > config.maxMoves) {
        return { winner: 'defense', reason: 'moves' };
      }
      return null;
    }
    if (!isInCheck(next.board, next.side)) {
      return { winner: config.stalemateWinner, reason: 'stalemate' };
    }
    const skipped = next.side;
    next.side = otherSide(skipped);
    if (skipped === DEFENSE) next.fullmove += 1;
    next.moves = undefined;
  }
  return { winner: 'defense', reason: 'stalemate' };
}

export function makeMove(pos, move, config = CONFIG) {
  const board = pos.board.slice();
  const piece = board[move.from];
  if (!piece) throw new Error('На клетке нет фигуры');
  board[move.to] = piece;
  board[move.from] = 0;
  const next = {
    board,
    side: otherSide(pos.side),
    fullmove: pos.side === DEFENSE ? pos.fullmove + 1 : pos.fullmove,
    plant: pos.plant,
    result: null,
  };
  next.result = settle(next, pos.side, config);
  return next;
}

export function moveNotation(pos, move) {
  const id = pieceId(pos.board[move.from]);
  const letter = CONFIG.pieces[id].letter;
  const mark = pos.board[move.to] ? '×' : '–';
  return `${letter}${squareName(move.from)}${mark}${squareName(move.to)}`;
}

export function perft(pos, depth) {
  if (depth === 0) return 1;
  if (pos.result) return 0;
  let total = 0;
  for (const move of legalMoves(pos)) {
    total += perft(makeMove(pos, move), depth - 1);
  }
  return total;
}

function mix(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0);
  };
}

const random = mix(0x5c2a11);
const ZOBRIST = Array.from({ length: 10 * 25 }, () => (BigInt(random()) << 32n) | BigInt(random()));
const Z_SIDE = (BigInt(random()) << 32n) | BigInt(random());
const Z_MOVE = Array.from({ length: 32 }, () => (BigInt(random()) << 32n) | BigInt(random()));

export function hashPos(pos) {
  let hash = 0n;
  for (let index = 0; index < 25; index += 1) {
    const piece = pos.board[index];
    if (!piece) continue;
    const kind = Math.abs(piece) - 1;
    const row = piece > 0 ? kind : 5 + kind;
    hash ^= ZOBRIST[row * 25 + index];
  }
  if (pos.side === DEFENSE) hash ^= Z_SIDE;
  hash ^= Z_MOVE[pos.fullmove] ?? 0n;
  return hash;
}

export function tokenId(code) {
  const side = code > 0 ? 't' : 'ct';
  return `${side}-${pieceId(code).toLowerCase()}`;
}

export function findToken(board, id) {
  for (let index = 0; index < 25; index += 1) {
    if (board[index] && tokenId(board[index]) === id) return index;
  }
  return -1;
}
