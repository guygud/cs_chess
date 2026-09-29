import { CONFIG } from './config.js';
import { createRound } from './engine.js';
import { contextPlays, withGrenade } from './plays.js';

const ATTACK = CONFIG.rosters.attack;
const DEFENSE = CONFIG.rosters.defense;

function spots(side, cells) {
  return Object.fromEntries(CONFIG.rosters[side].map((name, index) => [name, cells[index]]));
}

export const LESSONS = [
  {
    id: 'buy',
    title: 'Закуп',
    task: 'Купите форс.',
    outcome: 'Закуп один на\u00A0всю команду, оружие сгорит в\u00A0конце раунда.',
    wallet: 2000,
    allow: { buys: ['force'], plays: [], grenades: [], stay: false },
  },
  {
    id: 'move',
    title: 'Мув',
    task: 'Выберите «{play}» и\u00A0сделайте ход.',
    taskPlay: 'rush:PLANTA',
    outcome: 'Все пятеро дошли до\u00A0выхода на\u00A0лонг. Стрелки на\u00A0карте показывали это заранее.',
    weapon: 'smg',
    defenseWeapon: 'pistol',
    spots: {
      attack: spots('attack', ['TSPAWN', 'TSPAWN', 'TSPAWN', 'TSPAWN', 'TSPAWN']),
      defense: spots('defense', ['CTSPAWN', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN']),
    },
    play: 'rush:PLANTA',
    allow: { buys: [], plays: ['rush:PLANTA'], grenades: [], stay: false },
    expect: { cell: 'OUTLONG', attackThere: 5, contact: false },
  },
  {
    id: 'hold',
    title: 'Стойка',
    task: 'Нажмите «Стоять».',
    outcome: 'Кто стоял в\u00A0своей клетке, сильнее в\u00A0полтора раза. Кто пришёл\u00A0— нет.',
    weapon: 'smg',
    defenseWeapon: 'smg',
    spots: {
      attack: spots('attack', ['TSPAWN', 'UPTUNNEL', 'UPTUNNEL', 'UPTUNNEL', 'UPTUNNEL']),
      defense: spots('defense', ['MID', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN']),
    },
    defenseMoves: { [DEFENSE[0]]: 'TSPAWN' },
    defenseLabel: 'Шаг на\u00A0Т-спавн',
    allow: { buys: [], plays: [], grenades: [], stay: true },
    expect: { cell: 'TSPAWN', outcome: 'attack', attackFinal: 3, defenseFinal: 2 },
  },
  {
    id: 'slots',
    title: 'Места',
    task: 'Выберите «{play}» и\u00A0зайдите всей толпой.',
    taskPlay: 'rush:PLANTA',
    outcome: 'Пятеро дали столько\u00A0же, сколько трое.',
    weapon: 'smg',
    defenseWeapon: 'rifle',
    spots: {
      attack: spots('attack', ['TSPAWN', 'TSPAWN', 'TSPAWN', 'TSPAWN', 'TSPAWN']),
      defense: spots('defense', ['OUTLONG', 'OUTLONG', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN']),
    },
    play: 'rush:PLANTA',
    allow: { buys: [], plays: ['rush:PLANTA'], grenades: [], stay: false },
    expect: {
      cell: 'OUTLONG',
      outcome: 'defense',
      attackCount: 5,
      attackFinal: 5,
      defenseFinal: 6,
    },
  },
  {
    id: 'grenade',
    title: 'Граната',
    task: 'Включите дымовую и\u00A0сделайте ход.',
    outcome: 'Та\u00A0же толпа выигрывает, если сначала закрыть угол дымом.',
    weapon: 'smg',
    defenseWeapon: 'rifle',
    stock: ['smoke'],
    presetPlay: 'rush:PLANTA',
    spots: {
      attack: spots('attack', ['TSPAWN', 'TSPAWN', 'TSPAWN', 'TSPAWN', 'TSPAWN']),
      defense: spots('defense', ['OUTLONG', 'OUTLONG', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN']),
    },
    play: 'rush:PLANTA',
    grenade: 'smoke',
    allow: { buys: [], plays: ['rush:PLANTA'], grenades: ['smoke'], stay: false },
    expect: { cell: 'OUTLONG', outcome: 'attack', smoke: 'OUTLONG' },
  },
];

export const TUTORIAL_KEY = 'dust2.tutorialDone';

export function lessonAt(state) {
  if (!state?.tutorial) return null;
  return LESSONS[state.tutorial.index] || null;
}

export function lessonRound(lesson, config = CONFIG) {
  const round = createRound(
    {
      fighters: ATTACK.map((name) => ({ name, weapon: lesson.weapon || 'pistol', armor: false })),
      stock: lesson.stock || [],
    },
    {
      fighters: DEFENSE.map((name) => ({ name, weapon: lesson.defenseWeapon || 'pistol', armor: false })),
      stock: [],
    },
    config,
  );
  for (const fighter of round.fighters) {
    const spot = lesson.spots?.[fighter.side]?.[fighter.name];
    if (spot) fighter.point = spot;
  }
  return round;
}

export function lessonAttackOrders(lesson, round, config = CONFIG) {
  if (!lesson.play) return { moves: [], throws: [], label: 'Стоят', fake: [] };
  const play = contextPlays(round, config).plays.find((item) => item.id === lesson.play);
  if (!play) throw new Error(`Урок не нашёл мув ${lesson.play}`);
  return withGrenade(play.orders, 'attack', round, config, lesson.grenade || null);
}

export function lessonDefenseOrders(lesson, round) {
  return {
    moves: round.fighters
      .filter((fighter) => fighter.side === 'defense' && fighter.alive)
      .map((fighter) => ({
        name: fighter.name,
        to: lesson.defenseMoves?.[fighter.name] || fighter.point,
      })),
    throws: [],
    label: lesson.defenseLabel || 'Стоят',
  };
}

export function commitReady(lesson, draft) {
  if (!lesson || lesson.allow?.buys?.length) return false;
  if (lesson.grenade && draft.grenade !== lesson.grenade) return false;
  if (lesson.allow?.plays?.length) return lesson.allow.plays.includes(draft.play);
  return Boolean(lesson.allow?.stay) && !draft.play;
}

export function coachTarget(lesson, draft) {
  if (!lesson) return null;
  if (lesson.allow?.buys?.length) return `buy:${lesson.allow.buys[0]}`;
  if (lesson.allow?.plays?.length && !lesson.allow.plays.includes(draft.play)) {
    return `play:${lesson.allow.plays[0]}`;
  }
  if (lesson.grenade && draft.grenade !== lesson.grenade) return `grenade:${lesson.grenade}`;
  return 'commit';
}
