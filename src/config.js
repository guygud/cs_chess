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
      PLANTB: { label: 'Плент Б', x: 12, y: 224, w: 196, h: 200, plant: true, owner: 'attack' },
      LOWTUNNEL: { label: 'Нижние туннели', x: 222, y: 224, w: 196, h: 200, owner: 'defense' },
      MID: { label: 'Центр', x: 432, y: 224, w: 196, h: 200, owner: 'defense' },
      LONG: { label: 'Лонг', x: 642, y: 224, w: 196, h: 200, owner: 'defense' },
      BDOORS: { label: 'Двери Б', x: 12, y: 438, w: 196, h: 200, owner: 'defense' },
      SHORT: { label: 'Шорт', x: 432, y: 438, w: 196, h: 200, owner: 'defense' },
      PLANTA: { label: 'Плент А', x: 642, y: 438, w: 196, h: 200, plant: true, owner: 'attack' },
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
    pistol: { id: 'pistol', name: 'Пистолет', strength: 1 },
    smg: { id: 'smg', name: 'ПП', strength: 2 },
    rifle: { id: 'rifle', name: 'Автомат', strength: 3 },
  },
  weaponOrder: ['pistol', 'smg', 'rifle'],
  armor: { id: 'armor', name: 'Броник' },

  utility: {
    smoke: { id: 'smoke', name: 'Дымовая', penalty: 2 },
    flash: { id: 'flash', name: 'Световая' },
  },
  utilityOrder: ['smoke', 'flash'],

  // Цена на всю команду. Оружие сгорает в конце раунда.
  buys: [
    { id: 'eco', label: 'Фул эко', cost: 0, weapon: 'pistol', armor: false, stock: [] },
    { id: 'force', label: 'Форс', cost: 2000, weapon: 'smg', armor: true, stock: ['flash'] },
    { id: 'full', label: 'Фулл', cost: 4000, weapon: 'rifle', armor: true, stock: ['smoke', 'flash'] },
  ],

  economy: {
    startMoney: 800,
    winReward: 3400,
    lossBase: 1800,
    lossStreakStep: 600,
    maxLossStreakSteps: 3,
  },

  rules: {
    attackFighters: 5,
    defenseFighters: 5,
    movesPerRound: 4,
    // Бомба встала — раунду добавляется такт: защита успевает прийти и снять.
    defuseMoves: 1,
    holdMultiplier: 1.5,
    // В узкой клетке нормально стреляют двое, третий достаёт углом вполсилы,
    // остальные стоят за спинами и в бою не считаются — но гибнут и ловят гранаты.
    stackFull: 2,
    stackExtra: 0.5,
    stackShooters: 3,
    // Защита считает угрозой атаку на пленте и на пути к нему (в шагах).
    threatRange: 2,
    fakeFighters: 2,
    maxUtility: 2,
    winsNeeded: 3,
    maxRounds: 5,
    compareEpsilon: 1e-9,
  },

  // При равной длине раш идёт внешней дорогой: лонг на A, туннели на B.
  preferredLane: { PLANTA: 'LONG', PLANTB: 'LOWTUNNEL' },
  preferredGate: { PLANTA: 'OUTLONG', PLANTB: 'UPTUNNEL' },

  ui: {
    playbackStepMs: 1100,
    buySeconds: 20,
    moveSeconds: 20,
    moveAnimMs: 700,
    fightRevealMs: 900,
  },

  rosters: {
    attack: ['Змей', 'Таран', 'Искра', 'Тень', 'Звезда'],
    defense: ['Якорь', 'Сдвиг', 'Пост', 'Дозор', 'Бегун'],
  },

  plays: {
    attack: [
      { id: 'rush-a', action: 'rush', zone: 'PLANTA', label: 'Раш +\u00A0А', short: 'А' },
      { id: 'rush-b', action: 'rush', zone: 'PLANTB', label: 'Раш +\u00A0Б', short: 'Б' },
      { id: 'rush-mid', action: 'rush', zone: 'MID', label: 'Раш +\u00A0Мид', short: 'Мид' },
      { id: 'split-a', action: 'split', zone: 'PLANTA', label: 'Сплит +\u00A0А', short: 'А' },
      { id: 'split-b', action: 'split', zone: 'PLANTB', label: 'Сплит +\u00A0Б', short: 'Б' },
      { id: 'regroup-spawn', action: 'regroup', zone: 'spawn', label: 'Регруп +\u00A0Спавн', short: 'Спавн' },
      { id: 'regroup-mid', action: 'regroup', zone: 'MID', label: 'Регруп +\u00A0Мид', short: 'Мид' },
    ],
    defense: [
      { id: 'stack-a', action: 'stack', zone: 'PLANTA', label: 'Стак +\u00A0А', short: 'А' },
      { id: 'stack-b', action: 'stack', zone: 'PLANTB', label: 'Стак +\u00A0Б', short: 'Б' },
      { id: 'split', action: 'split', zone: null, label: 'Сплит', short: 'Сплит' },
      { id: 'retake-a', action: 'retake', zone: 'PLANTA', label: 'Ретейк +\u00A0А', short: 'А' },
      { id: 'retake-b', action: 'retake', zone: 'PLANTB', label: 'Ретейк +\u00A0Б', short: 'Б' },
      { id: 'regroup-spawn', action: 'regroup', zone: 'spawn', label: 'Регруп +\u00A0Спавн', short: 'Спавн' },
      { id: 'regroup-mid', action: 'regroup', zone: 'MID', label: 'Регруп +\u00A0Мид', short: 'Мид' },
      { id: 'save', action: 'save', zone: 'spawn', label: 'Сейв', short: 'Сейв' },
    ],
  },

  // Зеркало бот-против-бота: четыре мува вместо таблицы клеток.
  probes: [
    { id: 'split-a', weight: 16, plays: ['split-a', 'split-a', 'split-a', 'split-a'] },
    { id: 'split-b', weight: 16, plays: ['split-b', 'split-b', 'split-b', 'split-b'] },
    { id: 'flex', weight: 8, plays: ['rush-mid', 'split-a', 'rush-a', 'rush-a'] },
    {
      id: 'fake-a',
      weight: 6,
      plays: [
        { play: 'rush-a', fake: true },
        { play: 'rush-a', fake: true },
        { play: 'rush-a', fake: true },
        { play: 'rush-a', fake: true },
      ],
    },
    {
      id: 'fake-b',
      weight: 6,
      plays: [
        { play: 'rush-b', fake: true },
        { play: 'rush-b', fake: true },
        { play: 'rush-b', fake: true },
        { play: 'rush-b', fake: true },
      ],
    },
    { id: 'fast-a-long', weight: 4, plays: ['rush-a', 'rush-a', 'rush-a', 'rush-a'] },
    { id: 'fast-a-short', weight: 4, plays: ['rush-mid', 'rush-a', 'rush-a', 'rush-a'] },
    { id: 'fast-b-tunnel', weight: 4, plays: ['rush-b', 'rush-b', 'rush-b', 'rush-b'] },
    { id: 'fast-b-mid', weight: 4, plays: ['rush-mid', 'rush-b', 'rush-b', 'rush-b'] },
  ],
};
