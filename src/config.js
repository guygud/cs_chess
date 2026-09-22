// Все числа баланса живут здесь. Движок, бот и интерфейс читают только этот объект.

export const CONFIG = {
  map: {
    id: 'dust2',
    name: 'Dust2',
    viewBox: { x: 0, y: 0, width: 640, height: 400 },
    tokenColumns: 2,
    tokenStep: 72,
    spawnAnchor: { x: 130, y: 372 },
    ground: 'M 12 12 H 628 V 388 H 12 Z',
    decor: [
      'M 80 340 H 12',
      'M 300 300 H 400 V 360 H 300 Z',
      'M 520 360 H 470 V 388',
    ],
    zones: {
      A: {
        label: 'A · long',
        path: 'M 12 12 H 220 V 340 H 80 V 388 H 12 Z',
        anchor: { x: 28, y: 56 },
        labelAt: { x: 150, y: 36 },
      },
      MID: {
        label: 'Мид',
        path: 'M 232 12 H 424 V 200 H 390 V 388 H 266 V 200 H 232 Z',
        anchor: { x: 248, y: 48 },
        labelAt: { x: 360, y: 36 },
      },
      B: {
        label: 'B · tunnels',
        path: 'M 436 12 H 628 V 360 H 520 V 388 H 470 V 360 H 436 Z',
        anchor: { x: 452, y: 56 },
        labelAt: { x: 560, y: 36 },
      },
    },
  },

  points: {
    A: { id: 'A', name: 'A', isSite: true, long: true },
    MID: { id: 'MID', name: 'Мид', isSite: false, long: true },
    B: { id: 'B', name: 'B', isSite: true, long: false },
  },
  pointOrder: ['A', 'MID', 'B'],

  weapons: {
    pistol: { id: 'pistol', name: 'Пистолет', cost: 0, strength: 1 },
    rifle: { id: 'rifle', name: 'Винтовка', cost: 2700, strength: 2 },
    awp: {
      id: 'awp',
      name: 'AWP',
      cost: 4750,
      longStrength: 3,
      shortStrength: 1,
    },
  },
  weaponOrder: ['pistol', 'rifle', 'awp'],

  utility: {
    smoke: { id: 'smoke', name: 'Смоук', cost: 300, defensePenalty: 2 },
    flash: { id: 'flash', name: 'Флеш', cost: 200 },
  },
  utilityOrder: ['smoke', 'flash'],

  economy: {
    startMoney: 800,
    winReward: 3000,
    lossBase: 1400,
    lossStreakStep: 500,
    // Шаги считаются по поражениям ДО текущего раунда.
    // 0 → 1400, 1 → 1900, 2 → 2400, 3 и дальше → 2900.
    maxLossStreakSteps: 3,
  },

  rules: {
    attackFighters: 5,
    defensePlaced: 4,
    defenseRotators: 1,
    defenderSiteMultiplier: 1.5,
    rotatorMultiplier: 0.5,
    midTransferFighters: 1,
    tieWinner: 'defense',
    maxUtility: 2,
    winsNeeded: 3,
    maxRounds: 5,
    rotatorTieSite: 'A',
    killfeedDivisor: 2,
    compareEpsilon: 1e-9,
  },

  ui: {
    revealStepMs: 500,
    playbackStepMs: 1100,
    dragThreshold: 8,
    defaultAttackPoints: ['A', 'A', 'MID', 'B', 'B'],
    defaultUtilityPoint: 'A',
    defaultMidTransfer: 'A',
  },

  rosters: {
    attack: ['viper', 'entry', 'spark', 'lurk', 'star'],
    defense: ['brick', 'swing', 'hold', 'watch', 'rotate'],
  },

  defenseTemplates: [
    { id: '2-1-1', points: { A: 2, MID: 1, B: 1 }, weight: 3 },
    { id: '1-2-1', points: { A: 1, MID: 2, B: 1 }, weight: 3 },
    { id: '1-1-2', points: { A: 1, MID: 1, B: 2 }, weight: 3 },
    { id: '2-2-0', points: { A: 2, MID: 2, B: 0 }, weight: 2 },
    { id: '0-2-2', points: { A: 0, MID: 2, B: 2 }, weight: 2 },
    { id: '2-0-2', points: { A: 2, MID: 0, B: 2 }, weight: 2 },
    { id: '3-1-0', points: { A: 3, MID: 1, B: 0 }, weight: 1 },
    { id: '0-1-3', points: { A: 0, MID: 1, B: 3 }, weight: 1 },
  ],

  sim: {
    matches: 2000,
    seed: 1,
    midTransferToB: 0.5,
    attackTemplates: [
      { id: '5-0-0', points: { A: 5, MID: 0, B: 0 }, weight: 1 },
      { id: '0-0-5', points: { A: 0, MID: 0, B: 5 }, weight: 1 },
      { id: '0-5-0', points: { A: 0, MID: 5, B: 0 }, weight: 1 },
      { id: '3-1-1', points: { A: 3, MID: 1, B: 1 }, weight: 2 },
      { id: '1-1-3', points: { A: 1, MID: 1, B: 3 }, weight: 2 },
      { id: '2-1-2', points: { A: 2, MID: 1, B: 2 }, weight: 3 },
      { id: '4-1-0', points: { A: 4, MID: 1, B: 0 }, weight: 1 },
      { id: '0-1-4', points: { A: 0, MID: 1, B: 4 }, weight: 1 },
      { id: '2-2-1', points: { A: 2, MID: 2, B: 1 }, weight: 2 },
      { id: '1-2-2', points: { A: 1, MID: 2, B: 2 }, weight: 2 },
    ],
  },
};
