import { CONFIG } from './config.js';
import { applyRoundEconomy, bestBuy, buyCost, canStep, matchStatus, movesLimit, playRound, resolveMove, createRound, neighbors, weaponStrength, visibleCells, remember } from './engine.js';
import { defenseOrders, planRound } from './bot.js';
import { assertPlays, commitOrders, contextPlays, ordersFromPlay } from './plays.js';
import { nextTip } from './tips.js';

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
  assertPlays(CONFIG);
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

  expect(buyCost('eco') === 0 && buyCost('force') === 2000 && buyCost('full') === 4000, 'Закуп стоит 0, 2\u00A0000 и\u00A04\u00A0000');
  expect(bestBuy(800).id === 'eco', 'Со стартовыми деньгами берётся только эко');
  expect(bestBuy(2600).id === 'force', 'После поражения хватает на форс');
  expect(bestBuy(4200).id === 'full' && bestBuy(4200).stock[0] === 'smoke', 'После победы хватает на фулл с дымовой');
  const rich = planRound('defense', 4200, CONFIG, () => 0);
  expect(
    rich.weapon === 'rifle' && rich.armor && rich.cost === 4000
    && rich.stock.includes('smoke') && rich.stock.includes('flash'),
    'Фулл даёт автомат, броник, дымовую и световую',
  );

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
  expect(planted.state.winner === 'attack' && planted.state.endReason === 'bomb', 'Неснятая бомба отдаёт раунд атаке');
  expect(planted.log.length === CONFIG.rules.movesPerRound, 'Ранняя бомба раунд не удлиняет: такты на ретейк уже были');

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

  const fresh = createRound(pack('attack'), pack('defense'));
  const rushTo = ordersFromPlay('rush-a', 'attack', fresh).moves.map((move) => move.to);
  expect(rushTo.every((cell) => cell === 'OUTLONG'), 'Раш ведёт всех одной внешней дорогой');
  const splitTo = ordersFromPlay('split-a', 'attack', fresh).moves.map((move) => move.to);
  expect(splitTo.filter((cell) => cell === 'OUTLONG').length === 3 && splitTo.filter((cell) => cell === 'MID').length === 2, 'Сплит делит пятёрку 3 и 2');
  const fakeTo = ordersFromPlay('rush-a', 'attack', fresh, CONFIG, { fake: true }).moves.map((move) => move.to);
  expect(fakeTo.filter((cell) => cell === 'OUTLONG').length === 3, 'Фейк оставляет троих на муве');
  expect(fakeTo.filter((cell) => cell === 'UPTUNNEL').length === 2, 'Фейк уводит двоих на другую дорогу');
  const stackTo = ordersFromPlay('stack-a', 'defense', fresh).moves.map((move) => move.to);
  expect(
    stackTo.filter((cell) => cell === 'LONG').length === 2
    && stackTo.filter((cell) => cell === 'SHORT').length === 2
    && stackTo.filter((cell) => cell === 'MID').length === 1,
    'Стак садится на дороги',
  );
  const doors = createRound(pack('attack'), pack('defense'));
  place(doors, { [defenseNames[0]]: 'SHORT', [defenseNames[1]]: 'LONG' });
  const retakeTo = Object.fromEntries(ordersFromPlay('retake-a', 'defense', doors).moves.map((move) => [move.name, move.to]));
  expect(retakeTo[defenseNames[0]] === 'PLANTA' && retakeTo[defenseNames[1]] === 'PLANTA', 'Ретейк с дверей идёт на плент');
  let walked = fresh;
  for (let index = 0; index < 3; index += 1) {
    walked = resolveMove(walked, {
      attack: ordersFromPlay('rush-a', 'attack', walked),
      defense: stay(defenseNames, 'CTSPAWN'),
    }, CONFIG).state;
  }
  expect(walked.fighters.filter((fighter) => fighter.side === 'attack').every((fighter) => fighter.point === 'PLANTA'), 'Раш собирает всех на пленте');
  const smokedHold = createRound(pack('attack', 'rifle', true, ['smoke']), pack('defense'));
  place(smokedHold, {
    [names[0]]: 'OUTLONG',
    [names[1]]: 'OUTLONG',
    [names[2]]: 'OUTLONG',
    [names[3]]: 'OUTLONG',
    [names[4]]: 'OUTLONG',
    [defenseNames[0]]: 'LONG',
    [defenseNames[1]]: 'LONG',
  });
  const picked = commitOrders('rush-a', 'attack', smokedHold, CONFIG, { grenade: 'smoke' });
  expect(
    picked.throws.some((item) => item.type === 'smoke' && item.point === 'LONG'),
    'Выбранная дымовая летит в клетку, куда идёт основная группа',
  );
  expect(
    commitOrders('rush-a', 'attack', smokedHold, CONFIG).throws.length === 0,
    'Без выбора игрока граната не тратится',
  );
  expect(
    commitOrders('rush-a', 'attack', smokedHold, CONFIG, { grenade: 'flash' }).throws.length === 0,
    'Гранаты, которой нет в закупе, не бросить',
  );
  const botThrow = commitOrders('retake-a', 'defense', smokedHold, CONFIG, { grenade: 'auto' });
  expect(botThrow.throws.length === 0, 'Бот не кидает гранату из пустого закупа');

  const lateBomb = createRound(pack('attack'), pack('defense'));
  place(lateBomb, Object.fromEntries([
    ...names.map((name) => [name, 'PLANTA']),
    ...defenseNames.map((name) => [name, 'LONG']),
  ]));
  lateBomb.move = CONFIG.rules.movesPerRound - 1;
  const lastTick = resolveMove(lateBomb, {
    attack: stay(names, 'PLANTA'),
    defense: stay(defenseNames, 'LONG'),
  }, CONFIG);
  expect(lastTick.planted === 'PLANTA', 'Бомба встаёт и на последнем такте');
  expect(!lastTick.state.winner, 'После постановки раунд не кончается: есть такт на разминирование');
  expect(movesLimit(lastTick.state, CONFIG) === CONFIG.rules.movesPerRound + 1, 'Бомба продлевает раунд на один такт');
  const defuseTick = resolveMove(lastTick.state, {
    attack: stay(names, 'SHORT'),
    defense: ordersFromPlay('retake-a', 'defense', lastTick.state),
  }, CONFIG);
  expect(defuseTick.state.winner === 'defense' && defuseTick.state.endReason === 'defuse', 'Защита успевает снять бомбу на добавочном такте');
  const heldTick = resolveMove(lastTick.state, {
    attack: stay(names, 'PLANTA'),
    defense: stay(defenseNames, 'LONG'),
  }, CONFIG);
  expect(heldTick.state.winner === 'attack' && heldTick.state.endReason === 'bomb', 'Не дошли до плента — бомба решает раунд');
  expect(
    !resolveMove(lastTick.state, {
      attack: stay(names, 'PLANTA'),
      defense: stay(defenseNames, 'LONG'),
    }, CONFIG).planted,
    'На добавочном такте вторую бомбу не поставить',
  );

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
  const react = defenseOrders(approach, CONFIG);
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
  const save = defenseOrders(retake, CONFIG);
  const saveTo = Object.fromEntries(save.moves.map((item) => [item.name, item.to]));
  expect(saveTo[defenseNames[3]] === 'PLANTA', 'Кто на шорте, идёт обезвреживать');
  expect(saveTo[defenseNames[4]] === 'PLANTA', 'Кто на лонге, идёт обезвреживать');
  expect(
    saveTo[defenseNames[0]] !== 'PLANTB' && saveTo[defenseNames[1]] !== 'PLANTB',
    'С плента B не держат пустой сайт при бомбе на A',
  );

  checkTips();

  const opening = contextPlays(createRound(pack('attack'), pack('defense')));
  expect(opening.fake, 'На старте фейк доступен');
  expect(!opening.plays.some((play) => play.label.includes('Отойти')), 'На старте нет отхода');
  expect(opening.plays.length <= 6, 'Мувов не больше шести');
  const openingKeys = opening.plays.map((play) => play.orders.moves.map((move) => `${move.name}:${move.to}`).sort().join('|'));
  expect(new Set(openingKeys).size === openingKeys.length, 'Одинаковых приказов нет');

  const shifted = createRound(pack('attack'), pack('defense'));
  place(shifted, Object.fromEntries(names.map((name) => [name, 'OUTLONG'])));
  shifted.move = 1;
  const fromLong = contextPlays(shifted);
  expect(!fromLong.fake, 'После первого хода фейк недоступен');
  expect(fromLong.plays.some((play) => play.label.startsWith('Зайти') && play.label.includes('лонг')), 'С выхода есть зайти на лонг');
  expect(fromLong.plays.some((play) => play.label.startsWith('Держать')), 'С выхода есть держать');
  expect(fromLong.plays.some((play) => play.label.includes('Отойти')), 'С выхода есть отойти на спавн');
  const longKeys = fromLong.plays.map((play) => play.orders.moves.map((move) => `${move.name}:${move.to}`).sort().join('|'));
  expect(new Set(longKeys).size === longKeys.length && fromLong.plays.length <= 6, 'С выхода список без повторов и не длиннее шести');

  const slotsRound = createRound(pack('attack', 'smg'), pack('defense', 'rifle'));
  place(slotsRound, {
    [defenseNames[0]]: 'OUTLONG',
    [defenseNames[1]]: 'OUTLONG',
  });
  const slotsPlay = contextPlays(slotsRound).plays.find((play) => play.id === 'rush:PLANTA');
  expect(slotsPlay?.forecast.tone === 'loss', 'Прогноз толпы против двоих — проигрыш');
  expect(slotsPlay?.forecast.attack === 5 && slotsPlay?.forecast.defense === 6, 'Прогноз 5 против 6');
}

function stand(round, spots) {
  round.fighters.forEach((fighter) => {
    if (spots[fighter.name]) fighter.point = spots[fighter.name];
  });
}

function checkTips() {
  const buy = { phase: 'buy', round: 1, roundState: null, draft: { play: null }, menu: null, wallet: 800 };
  const buyTip = nextTip(buy, []);
  expect(buyTip?.id === 'buy', 'На закупе первого раунда подсказка про закуп');
  expect(nextTip({ ...buy, round: 2 }, [])?.id !== 'buy', 'Во втором раунде закуп не подсказывается');
  expectBuyTarget(buyTip, buy);

  const opening = createRound(pack('attack', 'smg'), pack('defense', 'rifle'));
  const openingMenu = contextPlays(opening);
  const bare = { phase: 'move', round: 1, roundState: opening, draft: { play: null, grenade: null }, menu: openingMenu, wallet: 800 };
  expect(nextTip(bare, [])?.id === 'move', 'Первый ход без мува — подсказка про мув');
  expectTarget(nextTip(bare, []), bare);

  const watched = createRound(pack('attack', 'smg'), pack('defense', 'rifle'));
  stand(watched, { [CONFIG.rosters.defense[0]]: 'OUTLONG' });
  const watchedMenu = contextPlays(watched);
  const watchedView = { phase: 'move', round: 1, roundState: watched, draft: { play: 'split:PLANTA', grenade: null }, menu: watchedMenu, wallet: 800 };
  expect(nextTip(watchedView, [])?.id === 'forecast', 'Выбранный мув при видимом враге — подсказка про счёт');

  const crowded = (stock) => {
    const round = createRound(pack('attack', 'smg', false, stock), pack('defense', 'rifle'));
    stand(round, {
      [CONFIG.rosters.defense[0]]: 'OUTLONG',
      [CONFIG.rosters.defense[1]]: 'OUTLONG',
    });
    return {
      phase: 'move',
      round: 1,
      roundState: round,
      draft: { play: 'rush:PLANTA', grenade: null },
      menu: contextPlays(round),
      wallet: 4000,
    };
  };
  const withFlash = crowded(['flash']);
  expect(nextTip(withFlash, [])?.id === 'grenade', 'Проигрыш и граната в закупе — подсказка про гранату');
  expect(nextTip(withFlash, [])?.target === 'grenade:flash', 'Подсказка про гранату указывает на световую');
  const without = crowded([]);
  expect(nextTip(without, [])?.id === 'slots', 'Проигрыш толпой без гранаты — подсказка про места');
  expect(nextTip(withFlash, ['grenade'])?.id === 'slots', 'После гранаты та же толпа говорит про места');
  expect(nextTip(withFlash, ['grenade', 'slots'])?.id !== 'grenade', 'Подсказка про гранату не повторяется');

  const holdView = { ...bare, draft: { play: 'split:PLANTA', grenade: null } };
  expect(nextTip(holdView, ['move', 'forecast', 'grenade', 'slots'])?.id === 'hold', 'Своя клетка — подсказка про стойку');
  expect(nextTip(holdView, ['move', 'forecast', 'grenade', 'slots'])?.target === 'play:hold', 'Стойка указывает на мув «Держать»');
  expect(nextTip({ ...bare, menu: { plays: bare.menu.plays.filter((play) => play.id !== 'hold'), fake: false } }, ['move'])?.target !== 'play:hold', 'Стойка не указывает на отсутствующий мув');

  expect(nextTip(bare, ['buy', 'move', 'forecast', 'grenade', 'slots', 'hold'])?.id === 'fake', 'На спавне после остальных подсказок — фейк');
  expect(nextTip(bare, ['buy', 'move', 'forecast', 'grenade', 'slots', 'hold'])?.target === 'fake', 'Фейк указывает на чип');
  expect(nextTip({ ...bare, menu: { ...openingMenu, fake: false } }, ['buy', 'move', 'forecast', 'grenade', 'slots', 'hold']) === null, 'Без фейка подсказка не появляется');

  for (const view of [buy, bare, watchedView, withFlash, without, holdView]) {
    expectTarget(nextTip(view, []), view);
  }
}

function expectBuyTarget(tip, view) {
  if (!tip?.target?.startsWith('buy:')) return;
  const id = tip.target.slice(4);
  const item = CONFIG.buys.find((buy) => buy.id === id);
  expect(item && item.cost <= view.wallet, `Закуп ${id} есть и по карману`);
}

function expectTarget(tip, view) {
  if (!tip?.target) return;
  if (tip.target === 'fake') {
    expect(view.menu?.fake, 'Фейк доступен, раз на него указывает подсказка');
    return;
  }
  const sep = tip.target.indexOf(':');
  const kind = tip.target.slice(0, sep);
  const id = tip.target.slice(sep + 1);
  if (kind === 'buy') expectBuyTarget(tip, view);
  if (kind === 'play') {
    expect(view.menu?.plays?.some((play) => play.id === id), `Мув ${id} есть в списке`);
  }
  if (kind === 'grenade') {
    expect(view.roundState?.stock?.attack?.includes(id), `Граната ${id} есть в закупе`);
  }
}

function playAgainstDefense(attack, defense, attackPlays, config = CONFIG) {
  let state = createRound(attack, defense, config);
  const log = [];
  const hardStop = config.rules.movesPerRound + (config.rules.defuseMoves || 0);
  for (let index = 0; index < hardStop; index += 1) {
    if (state.winner) break;
    // На добавочном такте атака держит то же, что и на последнем основном.
    const entry = attackPlays[index] || attackPlays[attackPlays.length - 1];
    const attackOrders = commitOrders(entry, 'attack', state, config, { grenade: 'auto' });
    const defensePlan = defenseOrders(state, config);
    const step = resolveMove(state, { attack: attackOrders, defense: defensePlan }, config);
    step.plays = { attack: attackOrders.label, defense: defensePlan.label };
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
      attack.probe.plays,
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
  const probe = (probeId) => {
    const script = CONFIG.probes.find((item) => item.id === probeId);
    let wins = 0;
    for (let index = 0; index < probeRounds; index += 1) {
      const defense = planRound('defense', CONFIG.economy.startMoney, CONFIG, splitRng);
      const played = playAgainstDefense(
        pack('attack'),
        { fighters: defense.fighters, stock: defense.stock },
        script.plays,
      );
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
  console.log(`Плент А ${siteA} из ${probeRounds * 2}, плент Б ${siteB} из ${probeRounds * 2}`);
}
