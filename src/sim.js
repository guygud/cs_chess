import { CONFIG } from './config.js';
import { applyRoundEconomy, canStep, loadoutCost, matchStatus, playRound, resolveMove, createRound, neighbors, weaponStrength, visibleCells, remember } from './engine.js';
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
  expect(CONFIG.edges.length === 16, 'На карте шестнадцать связей');
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
  expect(distance('TSPAWN', 'LOWTUNNEL') === distance('CTSPAWN', 'LOWTUNNEL') + 1, 'В нижних туннелях защита успевает встать');
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
  const stepTo = (round, attackTo, defenseTo, throws = [], defenseThrows = []) => resolveMove(round, {
    attack: orders(names, names.map((name) => attackTo[name] || round.fighters.find((fighter) => fighter.name === name).point), throws),
    defense: orders(defenseNames, defenseNames.map((name) => defenseTo[name] || round.fighters.find((fighter) => fighter.name === name).point), defenseThrows),
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
  expect(hold.fights.LONG.defenseFinal === 3 && hold.fights.LONG.attackFinal === 2.5, 'Двое стоящих сильнее троих: у третьего только половина');
  expect(hold.fights.LONG.outcome === 'defense', 'Стойка в лонге держит троих');
  expect(hold.fights.LONG.present.filter((person) => person.side === 'attack').every((person) => person.died), 'Пришедшие гибнут');
  expect(hold.fights.LONG.present.filter((person) => person.side === 'defense' && person.died).length === 1, 'Двое стоящих теряют одного');

  const headOn = createRound(pack('attack'), pack('defense'));
  place(headOn, {
    [names[0]]: 'OUTLONG',
    [names[1]]: 'OUTLONG',
    [defenseNames[0]]: 'LONG',
  });
  const clash = stepTo(headOn, { [names[0]]: 'LONG', [names[1]]: 'LONG' }, { [defenseNames[0]]: 'OUTLONG' });
  const road = Object.values(clash.fights).find((fight) => fight.clash);
  expect(road?.contact, 'Встречные шаги дают стычку на дороге');
  expect(road.attackFinal === 2 && road.defenseFinal === 1, 'На дороге стойки нет, двое против одного');
  expect(road.present.find((person) => person.side === 'defense').died, 'Один навстречу двоим гибнет');
  expect(clash.state.fighters.find((fighter) => fighter.name === names[0]).point === 'LONG'
    || clash.state.fighters.find((fighter) => fighter.name === names[1]).point === 'LONG', 'Выжившие доходят до клетки');
  expect(clash.state.fighters.find((fighter) => fighter.name === defenseNames[0]).point === 'LONG', 'Убитый на дороге остаётся где вышел');
  expect(!clash.fights.LONG.contact && !clash.fights.OUTLONG.contact, 'После встречки в клетках второго боя нет');

  const swap = createRound(pack('attack'), pack('defense'));
  place(swap, { [names[0]]: 'MID', [defenseNames[0]]: 'SHORT' });
  const swapped = stepTo(swap, { [names[0]]: 'SHORT' }, { [defenseNames[0]]: 'MID' });
  const midRoad = Object.values(swapped.fights).find((fight) => fight.clash);
  expect(midRoad?.attackFinal === 1 && midRoad?.defenseFinal === 1, 'Встречка один на один без стойки');
  expect(midRoad.present.filter((person) => person.died).length === 2, 'При равенстве на дороге оба теряют по одному');
  expect(!swapped.state.fighters.find((fighter) => fighter.name === names[0]).alive, 'Атака гибнет на встречке');
  expect(!swapped.state.fighters.find((fighter) => fighter.name === defenseNames[0]).alive, 'Защита гибнет на встречке');

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
  expect(smokeStep.fights.LONG.defenseFinal === 0, 'Дымовая бьёт по каждому из двоих на стойке');
  expect(smokeStep.fights.LONG.outcome === 'attack', 'После дымовой проход забирает атака');
  expect(smokeStep.state.stock.attack.length === 0, 'Брошенная граната уходит из запаса');

  const stacked = createRound(pack('attack'), pack('defense'));
  place(stacked, {
    [names[0]]: 'OUTLONG',
    [names[1]]: 'OUTLONG',
    [names[2]]: 'OUTLONG',
    [names[3]]: 'OUTLONG',
    [names[4]]: 'OUTLONG',
    [defenseNames[0]]: 'LONG',
    [defenseNames[1]]: 'LONG',
  });
  const stack = stepTo(
    stacked,
    Object.fromEntries(names.map((name) => [name, 'LONG'])),
    {},
  );
  expect(stack.fights.LONG.attackFinal === 2.5, 'В клетке стреляют трое: двое полных и один вполсилы');
  expect(stack.fights.LONG.defenseFinal === 3, 'Двое стоящих дают 3');
  expect(stack.fights.LONG.outcome === 'defense', 'Пятёрка пистолетов не ломит стойку двоих');
  expect(stack.fights.LONG.present.filter((person) => person.side === 'attack').every((person) => person.died), 'Толпа гибнет вся, даже те, кто не стрелял');

  const smokedStack = createRound(pack('attack'), pack('defense', 'pistol', false, ['smoke']));
  place(smokedStack, {
    [names[0]]: 'OUTLONG',
    [names[1]]: 'OUTLONG',
    [names[2]]: 'OUTLONG',
    [names[3]]: 'OUTLONG',
    [names[4]]: 'OUTLONG',
    [defenseNames[0]]: 'LONG',
    [defenseNames[1]]: 'LONG',
  });
  const smokeFive = stepTo(
    smokedStack,
    Object.fromEntries(names.map((name) => [name, 'LONG'])),
    {},
    [],
    [{ type: 'smoke', point: 'LONG' }],
  );
  expect(smokeFive.fights.LONG.attackFinal === 0, 'Дымовая обнуляет каждого из пятёрки');
  expect(smokeFive.fights.LONG.outcome === 'defense', 'После дыма пятёрка не проходит');

  const seen = createRound(pack('attack'), pack('defense'));
  place(seen, {
    [names[0]]: 'MID',
    [defenseNames[0]]: 'SHORT',
    [defenseNames[1]]: 'LONG',
  });
  const look = stepTo(seen, {}, {});
  const vision = visibleCells(look.state.fighters, 'attack');
  expect(vision.has('SHORT') && vision.has('TSPAWN'), 'С центра видны соседние клетки');
  expect(!vision.has('LONG') && !vision.has('PLANTA'), 'Лонг и плент A с центра не видны');
  const memory = remember({}, look, 'attack');
  expect(memory[defenseNames[0]]?.point === 'SHORT', 'Сосед в памяти после хода');
  expect(!memory[defenseNames[1]], 'Кто дальше соседней клетки, не виден');

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
  expect(crushed.fights.PLANTA.attackFinal === 2.5 && crushed.fights.PLANTA.defenseFinal === 2.5, 'После третьего стрелка числа не растут');
  expect(crushed.fights.PLANTA.outcome === 'attack', 'Ничья на пленте остаётся хозяину — атаке');
  expect(crushed.fights.PLANTA.present.filter((person) => person.side === 'defense' && person.died).length === 1, 'При ничьей троим защиты стоит одного');
  expect(crushed.fights.PLANTA.present.filter((person) => person.side === 'attack' && person.died).length === 3, 'Пятёрке ничья стоит троих: двое в проходе и один в бою');

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
  expect(bodies.log[0].fights.MID.outcome === 'attack', 'Пятёрка в центре бьёт двоих');
  expect(bodies.state.fighters.filter((fighter) => fighter.side === 'attack' && fighter.alive).length === 2, 'Толпе бой стоит троих: двое в проходе и один в размене');
  expect(bodies.state.fighters.filter((fighter) => fighter.side === 'defense' && fighter.alive).length === 3, 'Проигравшие в клетке гибнут, остальные целы');
  expect(bodies.state.endReason === 'alive' && bodies.state.winner === 'defense', 'Без бомбы побеждает сторона, у которой больше живых');

  const approach = createRound(pack('attack'), pack('defense'));
  place(approach, {
    [names[0]]: 'OUTLONG',
    [names[1]]: 'OUTLONG',
    [names[2]]: 'OUTLONG',
    [names[3]]: 'OUTLONG',
    [names[4]]: 'OUTLONG',
    [defenseNames[0]]: 'LONG',
    [defenseNames[1]]: 'SHORT',
    [defenseNames[2]]: 'BDOORS',
    [defenseNames[3]]: 'BDOORS',
    [defenseNames[4]]: 'MID',
  });
  const react = defenseOrders(
    CONFIG.routes.defense.find((route) => route.id === 'both'),
    defenseNames,
    1,
    approach,
    CONFIG,
  );
  const reactTo = Object.fromEntries(react.moves.map((item) => [item.name, item.to]));
  expect(
    reactTo[defenseNames[2]] !== 'BDOORS' || reactTo[defenseNames[3]] !== 'BDOORS',
    'Угроза с выхода на лонг тянет защиту с дверей B к пленту A',
  );
  expect(
    [reactTo[defenseNames[2]], reactTo[defenseNames[3]]].some((to) => (
      to === 'CTSPAWN' || to === 'SHORT' || to === 'PLANTA' || to === 'LONG'
    )),
    'С дверей B идут в сторону A, а не стоят',
  );

  const retake = createRound(pack('attack'), pack('defense'));
  place(retake, {
    [names[0]]: 'PLANTA',
    [names[1]]: 'PLANTA',
    [names[2]]: 'PLANTA',
    [defenseNames[0]]: 'PLANTB',
    [defenseNames[1]]: 'PLANTB',
    [defenseNames[2]]: 'LOWTUNNEL',
    [defenseNames[3]]: 'SHORT',
    [defenseNames[4]]: 'LONG',
  });
  retake.bomb = { point: 'PLANTA' };
  const save = defenseOrders(
    CONFIG.routes.defense.find((route) => route.id === 'both'),
    defenseNames,
    3,
    retake,
    CONFIG,
  );
  const saveTo = Object.fromEntries(save.moves.map((item) => [item.name, item.to]));
  expect(saveTo[defenseNames[3]] === 'PLANTA', 'Кто на шорте, идёт обезвреживать');
  expect(saveTo[defenseNames[4]] === 'PLANTA', 'Кто на лонге, идёт обезвреживать');
  expect(
    saveTo[defenseNames[0]] !== 'PLANTB' && saveTo[defenseNames[1]] !== 'PLANTB',
    'С плента B не держат пустой сайт при бомбе на A',
  );
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
