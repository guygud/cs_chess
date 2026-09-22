import { CONFIG } from './config.js';
import { applyRoundEconomy, canStep, loadoutCost, matchStatus, playRound, resolveMove, createRound, neighbors, weaponStrength } from './engine.js';
import { assertRoutes, defenseOrders, planRound, scriptFromRoute } from './bot.js';

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

function distance(from, to, config = CONFIG) {
  const queue = [[from, 0]];
  const seen = new Set([from]);
  while (queue.length) {
    const [cell, steps] = queue.shift();
    if (cell === to) return steps;
    for (const next of neighbors(cell, config)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push([next, steps + 1]);
    }
  }
  return Infinity;
}

function roads(spawn, plant, config = CONFIG) {
  return neighbors(spawn, config).filter((cell) => 1 + distance(cell, plant, config) === distance(spawn, plant, config));
}

function selfCheck() {
  assertRoutes(CONFIG);
  expect(weaponStrength('rifle') === 3, 'Автомат даёт 3');
  expect(weaponStrength('pistol') === 1, 'Пистолет даёт 1');
  expect(CONFIG.edges.length === 15, 'На карте пятнадцать связей');
  for (const cellId of CONFIG.cellOrder) {
    expect(CONFIG.map.cells[cellId].owner, `У клетки ${cellId} есть хозяин`);
    expect(distance(CONFIG.spawns.attack, cellId) < Infinity, `${cellId} достижима с Т-спавна`);
  }
  expect(distance('TSPAWN', 'PLANTA') === 3 && distance('CTSPAWN', 'PLANTA') === 2, 'До плента A вам три шага, защите два');
  expect(distance('TSPAWN', 'PLANTB') === 3 && distance('CTSPAWN', 'PLANTB') === 2, 'До плента B вам три шага, защите два');
  expect(roads('TSPAWN', 'PLANTA').length >= 2 && roads('TSPAWN', 'PLANTB').length >= 2, 'К каждому пленту две дороги');
  expect(distance('TSPAWN', 'LONG') === distance('CTSPAWN', 'LONG') + 1, 'В лонге защита успевает встать');
  expect(distance('TSPAWN', 'SHORT') === distance('CTSPAWN', 'SHORT') + 1, 'В шорте защита успевает встать');
  expect(distance('TSPAWN', 'MID') === distance('CTSPAWN', 'MID'), 'В центре никто не успевает встать');
  expect(distance('TSPAWN', 'LOWTUNNEL') === distance('CTSPAWN', 'LOWTUNNEL'), 'В нижних туннелях никто не успевает встать');
  expect(!canStep('TSPAWN', 'PLANTA'), 'С Т-спавна нельзя шагнуть сразу на плент');
  expect(!canStep('CTSPAWN', 'PLANTA') && !canStep('CTSPAWN', 'PLANTB'), 'С КТ-спавна нельзя шагнуть сразу на плент');
  expect(canStep('TSPAWN', 'OUTLONG'), 'С Т-спавна есть шаг на выход лонга');
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
  const place = (round, spots) => {
    round.fighters.forEach((fighter) => {
      if (spots[fighter.name]) fighter.point = spots[fighter.name];
    });
  };
  const stepTo = (round, attackTo, defenseTo, throws = []) => resolveMove(round, {
    attack: orders(names, names.map((name) => attackTo[name] || round.fighters.find((fighter) => fighter.name === name).point), throws),
    defense: orders(defenseNames, defenseNames.map((name) => defenseTo[name] || round.fighters.find((fighter) => fighter.name === name).point)),
  });

  const rifleVsTwo = createRound(pack('attack'), pack('defense'));
  rifleVsTwo.fighters.find((fighter) => fighter.name === names[0]).weapon = 'rifle';
  const traded = stepTo(rifleVsTwo, { [names[0]]: 'MID' }, { [defenseNames[0]]: 'MID', [defenseNames[1]]: 'MID' });
  const mid = traded.fights.MID;
  expect(mid.outcome === 'attack', 'Автомат сильнее двух пистолетов, если никто не стоял');
  expect(mid.present.filter((person) => person.side === 'defense').every((person) => person.died), 'Оба пистолета гибнут');
  expect(!mid.present.find((person) => person.side === 'attack').died, 'Один победитель остаётся жив');

  const held = createRound(pack('attack'), pack('defense'));
  place(held, { [defenseNames[0]]: 'LONG', [defenseNames[1]]: 'LONG', [names[0]]: 'OUTLONG', [names[1]]: 'OUTLONG', [names[2]]: 'OUTLONG' });
  const hold = stepTo(held, { [names[0]]: 'LONG', [names[1]]: 'LONG', [names[2]]: 'LONG' }, {});
  expect(hold.fights.LONG.defenseFinal === 3 && hold.fights.LONG.attackFinal === 3, 'Двое стоящих в лонге равны троим пришедшим');
  expect(hold.fights.LONG.outcome === 'defense', 'При равенстве лонг остаётся у защиты');
  expect(hold.fights.LONG.present.filter((person) => person.died).length === 2, 'При равенстве каждая сторона теряет одного');

  const rushed = createRound(pack('attack'), pack('defense'));
  place(rushed, { [names[0]]: 'OUTLONG', [names[1]]: 'OUTLONG', [names[2]]: 'OUTLONG' });
  const rush = stepTo(rushed, { [names[0]]: 'LONG', [names[1]]: 'LONG', [names[2]]: 'LONG' }, { [defenseNames[0]]: 'LONG', [defenseNames[1]]: 'LONG' });
  expect(rush.fights.LONG.outcome === 'attack', 'Двое пришедших в лонг проигрывают троим');
  expect(rush.fights.LONG.present.filter((person) => person.side === 'defense').every((person) => person.died), 'Пришедшая защита гибнет');

  const tunnel = createRound(pack('attack'), pack('defense'));
  place(tunnel, {
    [names[0]]: 'UPTUNNEL',
    [names[1]]: 'UPTUNNEL',
    [names[2]]: 'UPTUNNEL',
    [defenseNames[0]]: 'MID',
    [defenseNames[1]]: 'MID',
  });
  const race = stepTo(tunnel, { [names[0]]: 'LOWTUNNEL', [names[1]]: 'LOWTUNNEL', [names[2]]: 'LOWTUNNEL' }, { [defenseNames[0]]: 'LOWTUNNEL', [defenseNames[1]]: 'LOWTUNNEL' });
  expect(race.fights.LOWTUNNEL.defenseFinal === 2 && race.fights.LOWTUNNEL.outcome === 'attack', 'В нижних туннелях стойки нет, решает число');

  const smoked = createRound(pack('attack', 'pistol', false, ['smoke']), pack('defense'));
  place(smoked, { [defenseNames[0]]: 'LONG', [defenseNames[1]]: 'LONG', [names[0]]: 'OUTLONG', [names[1]]: 'OUTLONG' });
  const smokeStep = stepTo(
    smoked,
    { [names[0]]: 'LONG', [names[1]]: 'LONG' },
    {},
    [{ type: 'smoke', point: 'LONG' }],
  );
  expect(smokeStep.fights.LONG.defenseFinal === 1, 'Дымовая ломает стойку двоих');
  expect(smokeStep.fights.LONG.outcome === 'attack', 'После дымовой проход забирает атака');
  expect(smokeStep.state.stock.attack.length === 0, 'Брошенная граната уходит из запаса');

  const armored = createRound(pack('attack'), pack('defense'));
  const pistolFighter = armored.fighters.find((fighter) => fighter.name === names[0]);
  pistolFighter.armor = true;
  armored.fighters.find((fighter) => fighter.name === names[1]).weapon = 'rifle';
  const saved = stepTo(armored, { [names[0]]: 'MID', [names[1]]: 'MID' }, { [defenseNames[0]]: 'MID' });
  const pistol = saved.fights.MID.present.find((person) => person.name === names[0]);
  expect(pistol.saved && !pistol.died, 'Броник съедает смерть победителя');
  expect(!saved.fights.MID.present.find((person) => person.name === names[1]).died, 'Сильный напарник не платит за размен');
  expect(saved.state.fighters.find((fighter) => fighter.name === names[0]).armorUsed, 'Броник снимается один раз');

  const duel = createRound(pack('attack'), pack('defense'));
  place(duel, { [names[0]]: 'MID', [defenseNames[0]]: 'SHORT' });
  const short = stepTo(duel, { [names[0]]: 'SHORT' }, {});
  expect(short.fights.SHORT.attackFinal === 1 && short.fights.SHORT.defenseFinal === 1.5, 'Стоящий в шорте сильнее одного пришедшего');
  expect(short.fights.SHORT.outcome === 'defense', 'Стойка решает дуэль');
  expect(short.fights.SHORT.present.find((person) => person.side === 'attack').died, 'Пришедший в дуэли гибнет');
  expect(!short.fights.SHORT.present.find((person) => person.side === 'defense').died, 'Один стоящий в дуэли остаётся жив');

  const site = createRound(pack('attack'), pack('defense'));
  place(site, {
    [names[0]]: 'LONG',
    [names[1]]: 'LONG',
    [names[2]]: 'LONG',
    [defenseNames[0]]: 'SHORT',
    [defenseNames[1]]: 'SHORT',
  });
  const taken = stepTo(site, { [names[0]]: 'PLANTA', [names[1]]: 'PLANTA', [names[2]]: 'PLANTA' }, { [defenseNames[0]]: 'PLANTA', [defenseNames[1]]: 'PLANTA' });
  expect(taken.fights.PLANTA.outcome === 'attack', 'Трое против двоих проходят на плент');
  expect(taken.planted === 'PLANTA', 'Плент без живой защиты ставит бомбу');

  const crush = createRound(pack('attack'), pack('defense'));
  place(crush, {
    [names[0]]: 'LONG', [names[1]]: 'LONG', [names[2]]: 'LONG', [names[3]]: 'LONG', [names[4]]: 'LONG',
    [defenseNames[0]]: 'SHORT', [defenseNames[1]]: 'SHORT', [defenseNames[2]]: 'SHORT',
  });
  const crushed = stepTo(
    crush,
    Object.fromEntries(names.map((name) => [name, 'PLANTA'])),
    { [defenseNames[0]]: 'PLANTA', [defenseNames[1]]: 'PLANTA', [defenseNames[2]]: 'PLANTA' },
  );
  expect(crushed.fights.PLANTA.present.filter((person) => person.side === 'defense').every((person) => person.died), 'Пятёрка выносит троих на пленте');
  expect(crushed.fights.PLANTA.present.filter((person) => person.side === 'attack' && person.died).length === 1, 'Пятёрка теряет одного');

  const burned = loadoutCost(
    names.map((name) => ({ name, weapon: 'pistol', armor: false })),
    ['smoke'],
    CONFIG,
  );
  expect(burned === CONFIG.utility.smoke.cost, 'Неброшенная граната всё равно в цене раунда');

  const planted = playRound(pack('attack'), pack('defense'), {
    attack: [
      orders(names, names.map(() => 'UPTUNNEL')),
      orders(names, names.map(() => 'LOWTUNNEL')),
      orders(names, names.map(() => 'PLANTB')),
      orders(names, names.map(() => 'PLANTB')),
    ],
    defense: [
      stay(defenseNames, 'CTSPAWN'),
      stay(defenseNames, 'CTSPAWN'),
      stay(defenseNames, 'CTSPAWN'),
      stay(defenseNames, 'CTSPAWN'),
    ],
  });
  expect(planted.log[2].planted === 'PLANTB', 'Пустой плент ставит бомбу на третьем ходу');
  expect(planted.state.winner === 'attack' && planted.state.endReason === 'bomb', 'Неснятая бомба после четвёртого хода отдаёт раунд атаке');

  const defused = playRound(pack('attack'), pack('defense'), {
    attack: [
      orders(names, names.map(() => 'UPTUNNEL')),
      orders(names, names.map(() => 'LOWTUNNEL')),
      orders(names, names.map(() => 'PLANTB')),
      orders(names, names.map(() => 'LOWTUNNEL')),
    ],
    defense: [
      orders(defenseNames, defenseNames.map(() => 'BDOORS')),
      stay(defenseNames, 'BDOORS'),
      stay(defenseNames, 'BDOORS'),
      orders(defenseNames, defenseNames.map(() => 'PLANTB')),
    ],
  });
  expect(defused.log[3].defused, 'Защита обезвреживает на четвёртом ходу, если занимает плент одна');
  expect(defused.state.winner === 'defense' && defused.state.endReason === 'defuse', 'Дефьюз отдаёт раунд защите');

  const bodies = playRound(pack('attack'), pack('defense'), {
    attack: [
      orders(names, names.map(() => 'MID')),
      stay(names, 'MID'),
      stay(names, 'MID'),
      stay(names, 'MID'),
    ],
    defense: [
      orders(defenseNames, ['MID', 'MID', 'CTSPAWN', 'CTSPAWN', 'CTSPAWN']),
      stay(defenseNames, 'CTSPAWN'),
      stay(defenseNames, 'CTSPAWN'),
      stay(defenseNames, 'CTSPAWN'),
    ],
  });
  expect(bodies.state.endReason === 'alive' && bodies.state.winner === 'attack', 'Без бомбы побеждает сторона, у которой больше живых');
  expect(bodies.state.fighters.filter((fighter) => fighter.side === 'defense' && fighter.alive).length === 3, 'Проигравшие в клетке гибнут');
}

function playAgainstDefense(attack, defense, attackScript, route, config = CONFIG) {
  let state = createRound(attack, defense, config);
  const log = [];
  for (let index = 0; index < config.rules.movesPerRound; index += 1) {
    if (state.winner) break;
    const step = resolveMove(state, {
      attack: attackScript[index] || { moves: [], throws: [] },
      defense: defenseOrders(route, config.rosters.defense, index, state, config),
    }, config);
    log.push(step);
    state = step.state;
  }
  if (!state.winner) throw new Error('Раунд не определил победителя');
  return { state, log };
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
    const played = playAgainstDefense(
      { fighters: attack.fighters, stock: attack.stock },
      { fighters: defense.fighters, stock: defense.stock },
      scriptFromRoute(attack.route, config.rosters.attack),
      defense.route,
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

  const splitRng = mulberry32(seed + 1);
  const probeRounds = 200;
  const probe = (routeId) => {
    const route = CONFIG.routes.attack.find((item) => item.id === routeId);
    const script = scriptFromRoute(route, CONFIG.rosters.attack);
    let wins = 0;
    for (let index = 0; index < probeRounds; index += 1) {
      const defense = planRound('defense', CONFIG.economy.startMoney, CONFIG, splitRng);
      const played = playAgainstDefense(pack('attack'), pack('defense'), script, defense.route);
      if (played.state.winner === 'attack') wins += 1;
    }
    return wins;
  };
  const probes = ['fast-a-long', 'fast-b-tunnel', 'split-a', 'flex'];
  for (const id of probes) {
    const wins = probe(id);
    console.log(`Проба ${id}, ${probeRounds} раундов: атака ${wins} (${percent(wins, probeRounds)})`);
  }
  const siteA = probe('fast-a-long') + probe('fast-a-short');
  const siteB = probe('fast-b-tunnel') + probe('fast-b-mid');
  console.log(`Плент A ${siteA} из ${probeRounds * 2}, плент B ${siteB} из ${probeRounds * 2}`);
}
