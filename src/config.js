// Все числа баланса живут здесь. Движок, бот и интерфейс читают только этот объект.

export const CONFIG = {
  map: {
    id: 'dust2',
    name: 'Dust2',
    viewBox: { x: 0, y: 0, width: 640, height: 670 },
    cells: {
      LONG: { label: 'Лонг', x: 12, y: 10, w: 196, h: 200, owner: 'attack' },
      PLANTA: { label: 'Плент A', x: 222, y: 10, w: 196, h: 200, plant: true, owner: 'defense' },
      CTSPAWN: { label: 'КТ-спавн', x: 432, y: 10, w: 196, h: 200, owner: 'defense' },
      TSPAWN: { label: 'Т-спавн', x: 12, y: 228, w: 196, h: 200, owner: 'attack' },
      SHORT: { label: 'Шорт', x: 222, y: 228, w: 196, h: 200, owner: 'defense' },
      PLANTB: { label: 'Плент B', x: 432, y: 228, w: 196, h: 200, plant: true, owner: 'defense' },
      TUNNEL: { label: 'Туннель', x: 12, y: 446, w: 196, h: 200, owner: 'attack' },
      MID: { label: 'Центр', x: 222, y: 446, w: 196, h: 200, owner: 'attack' },
    },
  },

  edges: [
    ['TSPAWN', 'LONG'],
    ['TSPAWN', 'MID'],
    ['TSPAWN', 'TUNNEL'],
    ['LONG', 'PLANTA'],
    ['MID', 'SHORT'],
    ['MID', 'CTSPAWN'],
    ['SHORT', 'PLANTA'],
    ['TUNNEL', 'PLANTB'],
    ['PLANTA', 'CTSPAWN'],
    ['PLANTB', 'CTSPAWN'],
  ],

  cellOrder: ['LONG', 'PLANTA', 'CTSPAWN', 'TSPAWN', 'SHORT', 'PLANTB', 'TUNNEL', 'MID'],
  spawns: { attack: 'TSPAWN', defense: 'CTSPAWN' },
  plantTie: 'PLANTA',

  weapons: {
    pistol: { id: 'pistol', name: 'Пистолет', cost: 0, strength: 1 },
    smg: { id: 'smg', name: 'ПП', cost: 1200, strength: 2 },
    rifle: { id: 'rifle', name: 'Автомат', cost: 2700, strength: 3 },
  },
  weaponOrder: ['pistol', 'smg', 'rifle'],
  armor: { id: 'armor', name: 'Броник', cost: 800 },

  utility: {
    smoke: { id: 'smoke', name: 'Дымовая', cost: 300, penalty: 2 },
    flash: { id: 'flash', name: 'Световая', cost: 200 },
  },
  utilityOrder: ['smoke', 'flash'],

  economy: {
    startMoney: 800,
    winReward: 3000,
    lossBase: 1400,
    lossStreakStep: 500,
    maxLossStreakSteps: 3,
  },

  rules: {
    attackFighters: 5,
    defenseFighters: 5,
    movesPerRound: 3,
    holdMultiplier: 1.5,
    maxUtility: 2,
    winsNeeded: 3,
    maxRounds: 5,
    compareEpsilon: 1e-9,
  },

  ui: {
    playbackStepMs: 1100,
    dragThreshold: 8,
  },

  rosters: {
    attack: ['Змей', 'Таран', 'Искра', 'Тень', 'Звезда'],
    defense: ['Якорь', 'Сдвиг', 'Пост', 'Дозор', 'Бегун'],
  },

  routes: {
    attack: [
      {
        id: 'fast-a',
        weight: 30,
        moves: [
          ['LONG', 'LONG', 'LONG', 'LONG', 'LONG'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
        ],
      },
      {
        id: 'fast-b',
        weight: 30,
        moves: [
          ['TUNNEL', 'TUNNEL', 'TUNNEL', 'TUNNEL', 'TUNNEL'],
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
        ],
      },
      {
        id: 'slow-a',
        weight: 2,
        moves: [
          ['MID', 'MID', 'MID', 'MID', 'MID'],
          ['SHORT', 'SHORT', 'SHORT', 'SHORT', 'SHORT'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
        ],
      },
      {
        id: 'split',
        weight: 1,
        moves: [
          ['LONG', 'LONG', 'LONG', 'TUNNEL', 'TUNNEL'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTB', 'PLANTB'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTB', 'PLANTB'],
        ],
      },
      {
        id: 'mid',
        weight: 2,
        moves: [
          ['MID', 'MID', 'MID', 'MID', 'LONG'],
          ['MID', 'MID', 'MID', 'SHORT', 'PLANTA'],
          ['MID', 'MID', 'MID', 'PLANTA', 'PLANTA'],
        ],
      },
    ],
    defense: [
      {
        id: 'hold-a',
        weight: 30,
        moves: [
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
        ],
      },
      {
        id: 'hold-b',
        weight: 30,
        moves: [
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
        ],
      },
      {
        id: 'split',
        weight: 2,
        moves: [
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTB', 'PLANTB'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTB', 'PLANTB'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTB', 'PLANTB'],
        ],
      },
      {
        id: 'mid-anchor',
        weight: 2,
        moves: [
          ['MID', 'MID', 'PLANTA', 'PLANTA', 'PLANTB'],
          ['MID', 'SHORT', 'PLANTA', 'PLANTA', 'PLANTB'],
          ['MID', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTB'],
        ],
      },
      {
        id: 'late-long',
        weight: 1,
        moves: [
          ['PLANTA', 'PLANTA', 'MID', 'PLANTB', 'CTSPAWN'],
          ['LONG', 'PLANTA', 'SHORT', 'PLANTB', 'PLANTA'],
          ['LONG', 'LONG', 'PLANTA', 'PLANTB', 'LONG'],
        ],
      },
    ],
  },
};
