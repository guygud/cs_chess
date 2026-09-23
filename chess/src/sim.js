import { CONFIG } from './config.js';
import { search } from './engine.js';
import { analysisText } from './report.js';
import {
  ATTACK,
  DEFENSE,
  KING,
  KNIGHT,
  QUEEN,
  ROOK,
  createPosition,
  hashPos,
  isInCheck,
  legalMoves,
  makeMove,
  parseSquare,
  perft,
  squareName,
} from './rules.js';

let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`ok  ${message}`);
    return;
  }
  failed += 1;
  console.error(`FAIL  ${message}`);
}

function bare(board, side, fullmove = 1) {
  return {
    board,
    side,
    fullmove,
    plant: parseSquare(CONFIG.plant),
    result: null,
  };
}

function put(entries, side, fullmove) {
  const board = new Int8Array(25);
  for (const [name, code] of entries) board[parseSquare(name)] = code;
  return bare(board, side, fullmove);
}

function hasMove(pos, from, to) {
  return legalMoves(pos).some((move) => squareName(move.from) === from && squareName(move.to) === to);
}

const start = createPosition();
const opening = legalMoves(start).map((move) => `${squareName(move.from)}-${squareName(move.to)}`).sort();
assert(opening.length === 20, `в старте 20 легальных ходов (сейчас ${opening.length})`);
assert(hasMove(start, 'c1', 'd2'), 'ферзь может сыграть c1–d2');
assert(hasMove(start, 'b1', 'b3'), 'ладья может сыграть b1–b3');
assert(!hasMove(start, 'd1', 'c2'), 'король не идёт на c2: клетка под ферзём с c5');
assert(!hasMove(start, 'd1', 'c1'), 'король не ест свою фигуру');

const blockedPlant = put([
  ['b2', KING],
  ['e5', -KING],
  ['a5', -ROOK],
], ATTACK);
assert(!hasMove(blockedPlant, 'b2', 'a2'), 'король не входит на F под шахом');

const plant = put([
  ['b1', KING],
  ['e5', -KING],
], ATTACK);
const planted = makeMove(plant, { from: parseSquare('b1'), to: parseSquare('a2') });
assert(planted.result?.winner === 'attack' && planted.result.reason === 'plant', 'король Т на F выигрывает сразу');

const mate = put([
  ['a5', -KING],
  ['b5', QUEEN],
  ['c4', KING],
], DEFENSE);
assert(legalMoves(mate).length === 0 && isInCheck(mate.board, DEFENSE), 'под шахом без хода ходить нечем, но это ещё не победа');

const mateInOne = put([
  ['a5', -KING],
  ['b3', QUEEN],
  ['c4', KING],
], ATTACK);
const skippedMate = makeMove(mateInOne, { from: parseSquare('b3'), to: parseSquare('b5') });
assert(skippedMate.result == null && skippedMate.side === ATTACK, 'мат защите пропускает её ход, партия идёт дальше');
const foundMate = search(mateInOne, { timeMs: 200, maxDepth: 3, randomMargin: 0 });
const afterSearch = foundMate && makeMove(mateInOne, foundMate);
assert(foundMate && afterSearch?.result?.reason !== 'mate', 'движок не завершает партию матом');

const stalemate = put([
  ['a5', -KING],
  ['b3', ROOK],
  ['b2', KNIGHT],
  ['e1', KING],
], DEFENSE);
assert(legalMoves(stalemate).length === 0 && !isInCheck(stalemate.board, DEFENSE), 'пат: ходов нет и шаха нет');
const beforeStale = put([
  ['a5', -KING],
  ['c3', ROOK],
  ['b2', KNIGHT],
  ['e1', KING],
], ATTACK);
const stalemated = makeMove(beforeStale, { from: parseSquare('c3'), to: parseSquare('b3') });
assert(stalemated.result?.reason === 'stalemate' && stalemated.result.winner === 'defense', 'ход в пат засчитывается защите');

const pinned = put([
  ['e1', KING],
  ['e2', ROOK],
  ['e5', -ROOK],
  ['a5', -KING],
], ATTACK);
assert(!hasMove(pinned, 'e2', 'd2'), 'связанная ладья не сходит с линии');
assert(hasMove(pinned, 'e2', 'e3'), 'по линии связки ходить можно');

const hold = put([
  ['a1', KING],
  ['e5', -KING],
], DEFENSE, 20);
const held = makeMove(hold, { from: parseSquare('e5'), to: parseSquare('e4') });
assert(held.result?.winner === 'defense' && held.result.reason === 'moves', 'после 20-го хода защита забирает партию');

const later = put([
  ['a5', -KING],
  ['b3', QUEEN],
  ['c4', KING],
], ATTACK, 20);
const matedOnLast = makeMove(later, { from: parseSquare('b3'), to: parseSquare('b5') });
assert(matedOnLast.result?.reason === 'moves' && matedOnLast.result.winner === 'defense', 'мат на последнем ходу не заменяет F: 20 ходов уже вышли');

const depth1 = perft(start, 1);
const depth2 = perft(start, 2);
const depth3 = perft(start, 3);
assert(depth1 === 20, `perft 1 = 20 (сейчас ${depth1})`);
assert(depth2 === 307, `perft 2 = 307 (сейчас ${depth2})`);
assert(depth3 === 5143, `perft 3 = 5143 (сейчас ${depth3})`);

const shifted = { ...start, board: start.board.slice(), fullmove: 4, result: null };
assert(hashPos(start) !== hashPos(shifted), 'ключ позиции включает номер хода');
const flipped = { ...start, board: start.board.slice(), side: DEFENSE, result: null };
assert(hashPos(start) !== hashPos(flipped), 'ключ позиции включает сторону');

let pos = createPosition();
let steps = 0;
let illegal = 0;
while (!pos.result && steps < 80) {
  const choice = search(pos, { timeMs: 50, maxDepth: 2, randomMargin: 0 });
  if (!choice || !hasMove(pos, squareName(choice.from), squareName(choice.to))) {
    illegal += 1;
    break;
  }
  pos = makeMove(pos, choice);
  steps += 1;
}
assert(illegal === 0 && pos.result, `бот против бота заканчивает партию легальными ходами (${steps} полуходов, ${pos.result?.reason})`);

assert(
  analysisText([{ forced: null }, { san: 'Лb1–b3', fullmove: 2, forced: null }])
    .includes('не увидел'),
  'без форсированного исхода строка разбора так и говорит',
);
assert(
  analysisText([{ forced: 'attack' }]).includes('до первого хода'),
  'форсированный старт называется до первого хода',
);
assert(
  analysisText([
    { forced: null },
    { san: 'Фc1–d2', fullmove: 1, forced: 'attack' },
  ]).includes('Фc1–d2'),
  'строка разбора называет ход, после которого исход стал точным',
);

if (failed) {
  console.error(`\n${failed} проверок не сошлись`);
  process.exit(1);
}
console.log('\nВсе проверки сошлись');
