// Все числа прототипа живут здесь. Правила, движок и экран читают только этот объект.

export const CONFIG = {
  size: 5,
  files: ['a', 'b', 'c', 'd', 'e'],
  plant: 'a2',
  maxMoves: 20,
  // Пат не описан в макете. Как и «поровну — защите» в сборке Dust2, отдаём его защите.
  stalemateWinner: 'defense',

  clock: {
    seconds: 120,
    increment: 1,
  },

  match: {
    winsNeeded: 2,
    maxGames: 3,
  },

  pieces: {
    N: { letter: 'К', name: 'конь' },
    R: { letter: 'Л', name: 'ладья' },
    B: { letter: 'С', name: 'слон' },
    Q: { letter: 'Ф', name: 'ферзь' },
    K: { letter: 'Кр', name: 'король' },
  },

  // Оценка от лица атаки. Расстояние короля Т до F — главный член.
  values: { N: 320, R: 500, B: 330, Q: 900, K: 0 },
  eval: {
    kingStep: 220,
    plantAttack: 160,
    plantDefense: 50,
    mobility: 6,
    unreachable: 900,
  },

  levels: {
    strong: {
      id: 'strong',
      name: 'Разрядник',
      note: 'считает глубоко',
      timeMs: 1000,
      maxDepth: 12,
      randomMargin: 0,
    },
    casual: {
      id: 'casual',
      name: 'Казуал',
      note: 'ходит неточно',
      timeMs: 80,
      maxDepth: 2,
      randomMargin: 80,
    },
  },
  defaultLevel: 'strong',

  setup: {
    attack: [
      { square: 'a1', piece: 'N' },
      { square: 'b1', piece: 'R' },
      { square: 'c1', piece: 'Q' },
      { square: 'd1', piece: 'K' },
      { square: 'e1', piece: 'B' },
    ],
    defense: [
      { square: 'a5', piece: 'N' },
      { square: 'b5', piece: 'R' },
      { square: 'c5', piece: 'Q' },
      { square: 'd5', piece: 'K' },
      { square: 'e5', piece: 'B' },
    ],
  },
};
