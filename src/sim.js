import { CONFIG } from './config.js';
import { applyRoundEconomy, canStep, loadoutCost, matchStatus, playRound, resolveMove, createRound, weaponStrength } from './engine.js';
import { assertRoutes, planRound, scriptFromRoute } from './bot.js';

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function orders(names, targets, throws = []) {
  return {
    moves: names.map((name, index) => ({ name, to: targets[index] })),
    throws,
  };
}

function stay(names, cell) {
  return orders(names, names.map(() => cell));
}

function pack(side, weapon = 'pistol', armor = false, stock = []) {
  return {
    fighters: CONFIG.rosters[side].map((name) => ({ name, weapon, armor })),
    stock,
  };
}

function selfCheck() {
  assertRoutes(CONFIG);
  expect(weaponStrength('rifle') === 3, 'Автомат даёт 3');
  expect(weaponStrength('pistol') === 1, 'Пистолет даёт 1');
  expect(!canStep('TSPAWN', 'PLANTA'), 'С Т-спавна нельзя шагнуть сразу на плент');
  expect(canStep('TSPAWN', 'LONG'), 'С Т-спавна есть шаг на лонг');
  expect(canStep('LONG', 'LONG'), 'Стоять на месте можно');

  let failed = false;
  try {
    const bad = createRound(pack('attack'), pack('defense'));
    resolveMove(bad, {
      attack: orders(CONFIG.rosters.attack, CONFIG.rosters.attack.map(() => 'PLANTA')),
      defense: stay(CONFIG.rosters.defense, 'CTSPAWN'),
    });
  } catch (error) {
    failed = /не может шагнуть/.test(error.message);
  }
  expect(failed, 'Нелегальный шаг отклоняется');

  const owned = playRound(
    pack('attack'),
    pack('defense'),
    {
      attack: [
        stay(CONFIG.rosters.attack, 'TSPAWN'),
        stay(CONFIG.rosters.attack, 'TSPAWN'),
        stay(CONFIG.rosters.attack, 'TSPAWN'),
      ],
      defense: [
        stay(CONFIG.rosters.defense, 'CTSPAWN'),
        stay(CONFIG.rosters.defense, 'CTSPAWN'),
        stay(CONFIG.rosters.defense, 'CTSPAWN'),
      ],
    },
  );
  expect(owned.log[0].fights.TSPAWN.owned === 'attack', 'Т-спавн ваш с самого начала');
  expect(Object.values(owned.log[0].state.owned).every(Boolean), 'Пустых клеток нет');
  expect(owned.state.winner === 'defense' && owned.state.endReason === 'alive', 'Без бомбы и при равенстве живых раунд у защиты');

  const names = CONFIG.rosters.attack;
  const defenseNames = CONFIG.rosters.defense;
  const rifleVsTwo = createRound(pack('attack', 'pistol'), pack('defense'));
  rifleVsTwo.fighters.forEach((fighter) => {
    if (fighter.name === names[0]) {
      fighter.weapon = 'rifle';
      fighter.point = 'MID';
    } else if (fighter.name === defenseNames[0] || fighter.name === defenseNames[1]) {
      fighter.point = 'MID';
    }
  });
  const traded = resolveMove(rifleVsTwo, { attack: { moves: [], throws: [] }, defense: { moves: [], throws: [] } });
  const mid = traded.fights.MID;
  expect(mid.outcome === 'attack', 'Автомат сильнее двух пистолетов');
  expect(mid.present.filter((person) => person.side === 'defense').every((person) => person.died), 'Оба пистолета гибнут');
  expect(mid.present.find((person) => person.side === 'attack').died, 'Сильные теряют одного, даже если перевес большой');

  const threeHome = createRound(pack('attack'), pack('defense'));
  threeHome.fighters.forEach((fighter) => {
    if (fighter.name === names[0] || fighter.name === names[1]) fighter.point = 'PLANTA';
    if (fighter.name === defenseNames[0] || fighter.name === defenseNames[1] || fighter.name === defenseNames[2]) {
      fighter.point = 'PLANTA';
    }
  });
  const dry = resolveMove(threeHome, { attack: { moves: [], throws: [] }, defense: { moves: [], throws: [] } });
  const plantFight = dry.fights.PLANTA;
  expect(plantFight.outcome === 'defense', 'Трое на своей клетке сильнее двоих');
  expect(plantFight.present.filter((person) => person.side === 'attack').every((person) => person.died), 'Двое гибнут целиком');
  expect(plantFight.present.filter((person) => person.side === 'defense' && person.died).length === 1, 'Трое всё равно теряют одного');

  const even = createRound(pack('attack'), pack('defense'));
  even.fighters.forEach((fighter) => {
    if ([names[0], names[1], names[2]].includes(fighter.name)) fighter.point = 'PLANTA';
    if (fighter.name === defenseNames[0] || fighter.name === defenseNames[1]) fighter.point = 'PLANTA';
  });
  const tied = resolveMove(even, { attack: { moves: [], throws: [] }, defense: { moves: [], throws: [] } });
  const evenFight = tied.fights.PLANTA;
  expect(evenFight.attackFinal === evenFight.defenseFinal, 'Трое гостей равны двоим хозяевам');
  expect(evenFight.outcome === 'defense', 'При равенстве клетка остаётся у хозяина');
  expect(evenFight.present.filter((person) => person.died).length === 2, 'При равенстве каждая сторона теряет одного');

  const armored = createRound(pack('attack'), pack('defense'));
  armored.fighters.forEach((fighter) => {
    if (fighter.name === names[0]) {
      fighter.weapon = 'rifle';
      fighter.armor = true;
      fighter.point = 'MID';
    } else if (fighter.name === defenseNames[0] || fighter.name === defenseNames[1]) {
      fighter.point = 'MID';
    }
  });
  const saved = resolveMove(armored, { attack: { moves: [], throws: [] }, defense: { moves: [], throws: [] } });
  const rifle = saved.fights.MID.present.find((person) => person.name === names[0]);
  expect(rifle.saved && !rifle.died, 'Броник съедает смерть победителя');
  expect(saved.state.fighters.find((fighter) => fighter.name === names[0]).armorUsed, 'Броник снимается один раз');

  const smoked = createRound(pack('attack', 'pistol', false, ['smoke']), pack('defense'));
  smoked.fighters.forEach((fighter) => {
    if (fighter.side === 'attack' && (fighter.name === names[0] || fighter.name === names[1])) fighter.point = 'MID';
    if (fighter.name === defenseNames[0] || fighter.name === defenseNames[1]) fighter.point = 'MID';
  });
  const smokeStep = resolveMove(smoked, {
    attack: { moves: [], throws: [{ type: 'smoke', point: 'MID' }] },
    defense: { moves: [], throws: [] },
  });
  expect(smokeStep.fights.MID.defenseFinal === 0, 'Дымовая снимает 2 у противника');
  expect(smokeStep.fights.MID.outcome === 'attack', 'Дымовая решает равный пистолетный размен');
  expect(smokeStep.state.stock.attack.length === 0, 'Брошенная граната уходит из запаса');

  const burned = loadoutCost(
    names.map((name) => ({ name, weapon: 'pistol', armor: false })),
    ['smoke'],
    CONFIG,
  );
  expect(burned === CONFIG.utility.smoke.cost, 'Неброшенная граната всё равно в цене раунда');

  const planted = playRound(pack('attack'), pack('defense'), {
    attack: [
      orders(names, names.map(() => 'TUNNEL')),
      orders(names, names.map(() => 'PLANTB')),
      orders(names, names.map(() => 'PLANTB')),
    ],
    defense: [
      stay(defenseNames, 'CTSPAWN'),
      stay(defenseNames, 'CTSPAWN'),
      stay(defenseNames, 'CTSPAWN'),
    ],
  });
  expect(planted.log[1].planted === 'PLANTB', 'Пустой плент ставит бомбу на втором ходу');
  expect(planted.state.winner === 'attack' && planted.state.endReason === 'bomb', 'Неснятая бомба после третьего хода отдаёт раунд атаке');

  const defused = playRound(pack('attack'), pack('defense'), {
    attack: [
      orders(names, names.map(() => 'TUNNEL')),
      orders(names, names.map(() => 'PLANTB')),
      orders(names, names.map(() => 'TUNNEL')),
    ],
    defense: [
      stay(defenseNames, 'CTSPAWN'),
      stay(defenseNames, 'CTSPAWN'),
      orders(defenseNames, defenseNames.map(() => 'PLANTB')),
    ],
  });
  expect(defused.log[2].defused, 'Защита обезвреживает, если занимает плент одна');
  expect(defused.state.winner === 'defense' && defused.state.endReason === 'defuse', 'Дефьюз отдаёт раунд защите');

  const bodies = playRound(pack('attack'), pack('defense'), {
    attack: [
      orders(names, names.map(() => 'MID')),
      stay(names, 'MID'),
      stay(names, 'MID'),
    ],
    defense: [
      orders(defenseNames, ['MID', 'MID', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN']),
      orders(defenseNames, ['CTSPAWN', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN']),
      stay(defenseNames, 'CTSPAWN'),
    ],
  });
  expect(bodies.state.endReason === 'alive' && bodies.state.winner === 'attack', 'Без бомбы побеждает сторона, у которой больше живых');
  expect(bodies.state.fighters.filter((fighter) => fighter.side === 'defense' && fighter.alive).length === 3, 'Проигравшие в клетке гибнут');
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return function rng() {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function playMatch(config, rng) {
  let wallets = {
    attack: config.economy.startMoney,
    defense: config.economy.startMoney,
  };
  let lossStreak = { attack: 0, defense: 0 };
  let score = { attack: 0, defense: 0 };
  let rounds = 0;
  let attackRounds = 0;

  for (let round = 1; round <= config.rules.maxRounds; round += 1) {
    rounds = round;
    const attack = planRound('attack', wallets.attack, config, rng);
    const defense = planRound('defense', wallets.defense, config, rng);
    const played = playRound(
      { fighters: attack.fighters, stock: attack.stock },
      { fighters: defense.fighters, stock: defense.stock },
      {
        attack: scriptFromRoute(attack.route, config.rosters.attack),
        defense: scriptFromRoute(defense.route, config.rosters.defense),
      },
      config,
    );
    const applied = applyRoundEconomy(
      { wallets, lossStreak, score },
      played.state,
      { attack: attack.cost, defense: defense.cost },
      config,
    );
    wallets = applied.wallets;
    lossStreak = applied.lossStreak;
    score = applied.score;
    if (played.state.winner === 'attack') attackRounds += 1;
    if (matchStatus(score, round, config)) break;
  }

  return { score, rounds, attackRounds, wallets };
}

function percent(part, total) {
  return `${((part / total) * 100).toFixed(1).replace('.', ',')}%`;
}

const matches = Number(process.argv[2] ?? CONFIG.sim?.matches ?? 2000);
const seed = Number(process.argv[3] ?? 1);

selfCheck();
console.log('Проверки правил: ок');

if (matches > 0) {
  const rng = mulberry32(seed);
  let attackWins = 0;
  let defenseWins = 0;
  let draws = 0;
  let attackRounds = 0;
  let rounds = 0;
  for (let index = 0; index < matches; index += 1) {
    const match = playMatch(CONFIG, rng);
    rounds += match.rounds;
    attackRounds += match.attackRounds;
    if (match.score.attack > match.score.defense) attackWins += 1;
    else if (match.score.defense > match.score.attack) defenseWins += 1;
    else draws += 1;
  }
  console.log(`Партий: ${matches}, зерно ${seed}`);
  console.log(`Победы атаки: ${attackWins} (${percent(attackWins, matches)})`);
  console.log(`Победы защиты: ${defenseWins} (${percent(defenseWins, matches)})`);
  console.log(`Ничьи: ${draws} (${percent(draws, matches)})`);
  console.log(`Раунды атаки: ${attackRounds} из ${rounds} (${percent(attackRounds, rounds)})`);
}
