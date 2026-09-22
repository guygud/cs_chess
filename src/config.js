// Все числа баланса живут здесь. Движок, бот и интерфейс читают только этот объект.

export const CONFIG = {
  map: {
    id: 'dust2',
    name: 'Dust2',
    viewBox: { x: 0, y: 0, width: 850, height: 862 },
    cells: {
      UPTUNNEL: { label: 'Верхние туннели', x: 12, y: 10, w: 196, h: 200, owner: 'attack' },
      TSPAWN: { label: 'Т-спавн', x: 222, y: 10, w: 196, h: 200, owner: 'attack' },
      OUTLONG: { label: 'Выход на лонг', x: 432, y: 10, w: 196, h: 200, owner: 'attack' },
      PLANTB: { label: 'Плент B', x: 12, y: 224, w: 196, h: 200, plant: true, owner: 'attack' },
      LOWTUNNEL: { label: 'Нижние туннели', x: 222, y: 224, w: 196, h: 200, owner: 'defense' },
      MID: { label: 'Центр', x: 432, y: 224, w: 196, h: 200, owner: 'defense' },
      LONG: { label: 'Лонг', x: 642, y: 224, w: 196, h: 200, owner: 'defense' },
      BDOORS: { label: 'Двери B', x: 12, y: 438, w: 196, h: 200, owner: 'defense' },
      SHORT: { label: 'Шорт', x: 432, y: 438, w: 196, h: 200, owner: 'defense' },
      PLANTA: { label: 'Плент A', x: 642, y: 438, w: 196, h: 200, plant: true, owner: 'attack' },
      CTSPAWN: { label: 'КТ-спавн', x: 222, y: 652, w: 196, h: 200, owner: 'defense' },
    },
  },

  edges: [
    ['TSPAWN', 'UPTUNNEL'],
    ['TSPAWN', 'MID'],
    ['TSPAWN', 'OUTLONG'],
    ['UPTUNNEL', 'LOWTUNNEL'],
    ['LOWTUNNEL', 'PLANTB'],
    ['LOWTUNNEL', 'MID'],
    ['PLANTB', 'BDOORS'],
    ['BDOORS', 'CTSPAWN'],
    ['MID', 'SHORT'],
    ['MID', 'CTSPAWN'],
    ['LOWTUNNEL', 'CTSPAWN'],
    ['SHORT', 'PLANTA'],
    ['SHORT', 'CTSPAWN'],
    ['OUTLONG', 'LONG'],
    ['LONG', 'PLANTA'],
    ['LONG', 'CTSPAWN'],
  ],

  cellOrder: [
    'UPTUNNEL', 'TSPAWN', 'OUTLONG',
    'PLANTB', 'LOWTUNNEL', 'MID', 'LONG',
    'BDOORS', 'SHORT', 'PLANTA',
    'CTSPAWN',
  ],
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
    movesPerRound: 4,
    holdMultiplier: 1.5,
    // В узкой клетке нормально стреляют двое, третий достаёт углом вполсилы,
    // остальные стоят за спинами и в бою не считаются — но гибнут и ловят гранаты.
    stackFull: 2,
    stackExtra: 0.5,
    stackShooters: 3,
    // Защита считает угрозой атаку на пленте и на пути к нему (в шагах).
    threatRange: 2,
    maxUtility: 2,
    winsNeeded: 3,
    maxRounds: 5,
    compareEpsilon: 1e-9,
  },

  ui: {
    playbackStepMs: 1100,
    dragThreshold: 8,
    buySeconds: 45,
    moveSeconds: 30,
  },

  rosters: {
    attack: ['Змей', 'Таран', 'Искра', 'Тень', 'Звезда'],
    defense: ['Якорь', 'Сдвиг', 'Пост', 'Дозор', 'Бегун'],
  },

  routes: {
    attack: [
      {
        id: 'split-a',
        weight: 16,
        moves: [
          ['OUTLONG', 'OUTLONG', 'OUTLONG', 'UPTUNNEL', 'UPTUNNEL'],
          ['LONG', 'LONG', 'LONG', 'LOWTUNNEL', 'LOWTUNNEL'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTB', 'PLANTB'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTB', 'PLANTB'],
        ],
      },
      {
        id: 'split-b',
        weight: 16,
        moves: [
          ['OUTLONG', 'OUTLONG', 'UPTUNNEL', 'UPTUNNEL', 'UPTUNNEL'],
          ['LONG', 'LONG', 'LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL'],
          ['PLANTA', 'PLANTA', 'PLANTB', 'PLANTB', 'PLANTB'],
          ['PLANTA', 'PLANTA', 'PLANTB', 'PLANTB', 'PLANTB'],
        ],
      },
      {
        id: 'flex',
        weight: 8,
        moves: [
          ['MID', 'MID', 'MID', 'OUTLONG', 'UPTUNNEL'],
          ['SHORT', 'SHORT', 'LOWTUNNEL', 'LONG', 'LOWTUNNEL'],
          ['PLANTA', 'PLANTA', 'PLANTB', 'PLANTA', 'PLANTB'],
          ['PLANTA', 'PLANTA', 'PLANTB', 'PLANTA', 'PLANTB'],
        ],
      },
      {
        id: 'four-a',
        weight: 6,
        moves: [
          ['OUTLONG', 'OUTLONG', 'OUTLONG', 'OUTLONG', 'UPTUNNEL'],
          ['LONG', 'LONG', 'LONG', 'LONG', 'LOWTUNNEL'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTB'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTB'],
        ],
      },
      {
        id: 'four-b',
        weight: 6,
        moves: [
          ['OUTLONG', 'UPTUNNEL', 'UPTUNNEL', 'UPTUNNEL', 'UPTUNNEL'],
          ['LONG', 'LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL'],
          ['PLANTA', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
          ['PLANTA', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
        ],
      },
      {
        id: 'fast-a-long',
        weight: 4,
        moves: [
          ['OUTLONG', 'OUTLONG', 'OUTLONG', 'OUTLONG', 'OUTLONG'],
          ['LONG', 'LONG', 'LONG', 'LONG', 'LONG'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
        ],
      },
      {
        id: 'fast-a-short',
        weight: 4,
        moves: [
          ['MID', 'MID', 'MID', 'MID', 'MID'],
          ['SHORT', 'SHORT', 'SHORT', 'SHORT', 'SHORT'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
          ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
        ],
      },
      {
        id: 'fast-b-tunnel',
        weight: 4,
        moves: [
          ['UPTUNNEL', 'UPTUNNEL', 'UPTUNNEL', 'UPTUNNEL', 'UPTUNNEL'],
          ['LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL'],
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
        ],
      },
      {
        id: 'fast-b-mid',
        weight: 4,
        moves: [
          ['MID', 'MID', 'MID', 'MID', 'MID'],
          ['LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL'],
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
          ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
        ],
      },
    ],
    defense: [
      {
        id: 'both',
        weight: 26,
        moves: [
          ['LONG', 'LONG', 'SHORT', 'LOWTUNNEL', 'MID'],
          ['LONG', 'LONG', 'SHORT', 'LOWTUNNEL', 'MID'],
          ['LONG', 'LONG', 'SHORT', 'LOWTUNNEL', 'MID'],
          ['LONG', 'LONG', 'SHORT', 'LOWTUNNEL', 'MID'],
        ],
      },
      {
        id: 'lanes',
        weight: 12,
        moves: [
          ['LONG', 'LONG', 'SHORT', 'SHORT', 'MID'],
          ['LONG', 'LONG', 'SHORT', 'SHORT', 'MID'],
          ['LONG', 'LONG', 'SHORT', 'SHORT', 'MID'],
          ['LONG', 'LONG', 'SHORT', 'SHORT', 'MID'],
        ],
      },
      {
        id: 'mid-hold',
        weight: 20,
        moves: [
          ['LONG', 'SHORT', 'MID', 'MID', 'MID'],
          ['LONG', 'SHORT', 'MID', 'MID', 'MID'],
          ['LONG', 'SHORT', 'MID', 'MID', 'MID'],
          ['LONG', 'SHORT', 'MID', 'MID', 'MID'],
        ],
      },
      {
        id: 'b-cover',
        weight: 14,
        moves: [
          ['LONG', 'SHORT', 'LOWTUNNEL', 'LOWTUNNEL', 'MID'],
          ['LONG', 'SHORT', 'LOWTUNNEL', 'LOWTUNNEL', 'MID'],
          ['LONG', 'SHORT', 'LOWTUNNEL', 'LOWTUNNEL', 'MID'],
          ['LONG', 'SHORT', 'LOWTUNNEL', 'LOWTUNNEL', 'MID'],
        ],
      },
      {
        id: 'long-heavy',
        weight: 10,
        moves: [
          ['LONG', 'LONG', 'LONG', 'SHORT', 'MID'],
          ['LONG', 'LONG', 'LONG', 'SHORT', 'MID'],
          ['LONG', 'LONG', 'LONG', 'SHORT', 'MID'],
          ['LONG', 'LONG', 'LONG', 'SHORT', 'MID'],
        ],
      },
      {
        id: 'short-heavy',
        weight: 10,
        moves: [
          ['SHORT', 'SHORT', 'SHORT', 'LONG', 'MID'],
          ['SHORT', 'SHORT', 'SHORT', 'LONG', 'MID'],
          ['SHORT', 'SHORT', 'SHORT', 'LONG', 'MID'],
          ['SHORT', 'SHORT', 'SHORT', 'LONG', 'MID'],
        ],
      },
      {
        id: 'tunnel-heavy',
        weight: 10,
        moves: [
          ['LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LONG', 'SHORT'],
          ['LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LONG', 'SHORT'],
          ['LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LONG', 'SHORT'],
          ['LOWTUNNEL', 'LOWTUNNEL', 'LOWTUNNEL', 'LONG', 'SHORT'],
        ],
      },
    ],
  },
};
