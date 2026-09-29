import { CONFIG } from './config.js';
import {
  canStep,
  compare,
  createRound,
  neighbors,
  resolveMove,
  shadowMarks,
  sidePower,
  visibleCells,
  weaponStrength,
} from './engine.js';

function fail(message) {
  throw new Error(message);
}

export function normalizeCall(playRef, options = {}) {
  if (playRef && typeof playRef === 'object') {
    return { id: playRef.play || playRef.id, fake: Boolean(playRef.fake || options.fake) };
  }
  return { id: playRef, fake: Boolean(options.fake) };
}

export function playById(side, playId, config = CONFIG) {
  const play = config.plays[side]?.find((item) => item.id === playId);
  if (!play) fail(`Неизвестный мув: ${playId}`);
  return play;
}

export function playLabel(play, fake) {
  return fake ? `${play.label} +\u00A0фейк` : play.label;
}

export function cellDistance(from, to, config = CONFIG) {
  if (from === to) return 0;
  const queue = [[from, 0]];
  const seen = new Set([from]);
  while (queue.length) {
    const [cell, steps] = queue.shift();
    for (const next of neighbors(cell, config)) {
      if (seen.has(next)) continue;
      if (next === to) return steps + 1;
      seen.add(next);
      queue.push([next, steps + 1]);
    }
  }
  return Infinity;
}

function rankStep(next, goal, config) {
  const lane = config.preferredLane?.[goal];
  const gate = config.preferredGate?.[goal];
  const dist = cellDistance(next, goal, config);
  const throughLane = Boolean(lane) && (
    next === lane
    || cellDistance(next, lane, config) + cellDistance(lane, goal, config) === dist
  );
  return [dist, throughLane ? 0 : 1, next === gate ? 0 : 1, next];
}

function betterRank(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    if (typeof left[index] === 'string') return left[index].localeCompare(right[index], 'en');
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

// Один шаг по кратчайшему пути. При равной длине — внешняя дорога.
export function stepToward(from, goal, config = CONFIG) {
  if (!goal || from === goal) return from;
  if (canStep(from, goal, config)) return goal;
  let best = null;
  let bestRank = null;
  for (const next of neighbors(from, config)) {
    const rank = rankStep(next, goal, config);
    if (!bestRank || betterRank(rank, bestRank) < 0) {
      bestRank = rank;
      best = next;
    }
  }
  return best || from;
}

function onWay(from, via, goal, config) {
  if (!via || from === via) return false;
  return cellDistance(from, via, config) + cellDistance(via, goal, config) === cellDistance(from, goal, config);
}

function stepVia(from, via, goal, config) {
  if (from === goal) return from;
  if (onWay(from, via, goal, config)) return stepToward(from, via, config);
  return stepToward(from, goal, config);
}

function living(state, side) {
  return state.fighters.filter((fighter) => fighter.alive && fighter.side === side);
}

export function otherPlant(zone, config = CONFIG) {
  const plants = config.cellOrder.filter((cellId) => config.map.cells[cellId].plant);
  if (plants.includes(zone)) return plants.find((cellId) => cellId !== zone);
  return plants[0];
}

function corridors(plant, config) {
  const spawn = config.spawns.attack;
  const dist = cellDistance(spawn, plant, config);
  const gates = neighbors(spawn, config).filter((cell) => (
    1 + cellDistance(cell, plant, config) === dist
  ));
  const preferred = config.preferredGate?.[plant];
  gates.sort((left, right) => {
    if (left === preferred) return -1;
    if (right === preferred) return 1;
    return left.localeCompare(right, 'en');
  });
  return gates;
}

function rushDest(fighters, zone, config) {
  return Object.fromEntries(fighters.map((fighter) => [fighter.name, stepToward(fighter.point, zone, config)]));
}

function splitDest(fighters, plant, config) {
  const gates = corridors(plant, config);
  const main = gates[0] || plant;
  const off = gates[1] || main;
  const offCount = fighters.length <= 1 ? 0 : Math.max(1, Math.floor((fighters.length * 2) / 5));
  const mainCount = fighters.length - offCount;
  return Object.fromEntries(fighters.map((fighter, index) => {
    const gate = index < mainCount ? main : off;
    return [fighter.name, stepVia(fighter.point, gate, plant, config)];
  }));
}

function regroupDest(fighters, zone, side, config) {
  const goal = zone === 'spawn' ? config.spawns[side] : zone;
  return Object.fromEntries(fighters.map((fighter) => [fighter.name, stepToward(fighter.point, goal, config)]));
}

function applyFake(dest, fighters, play, config) {
  const count = Math.min(config.rules.fakeFighters, Math.max(0, fighters.length - 1));
  if (!count) return [];
  const plant = otherPlant(play.zone, config);
  const gate = config.preferredGate?.[plant] || corridors(plant, config)[0];
  const names = [];
  for (const fighter of fighters.slice(-count)) {
    dest[fighter.name] = stepVia(fighter.point, gate, plant, config);
    names.push(fighter.name);
  }
  return names;
}

function slotsFor(play, count) {
  const table = {
    'stack-a': ['LONG', 'LONG', 'SHORT', 'SHORT', 'MID'],
    'stack-b': ['LOWTUNNEL', 'LOWTUNNEL', 'BDOORS', 'BDOORS', 'MID'],
    split: ['LONG', 'LONG', 'SHORT', 'LOWTUNNEL', 'MID'],
    'retake-a': ['PLANTA', 'PLANTA', 'PLANTA', 'PLANTA', 'PLANTA'],
    'retake-b': ['PLANTB', 'PLANTB', 'PLANTB', 'PLANTB', 'PLANTB'],
  };
  const slots = table[play.id] || [];
  const open = slots.slice(0, count);
  while (open.length < count) open.push(slots[slots.length - 1] || 'MID');
  return open;
}

function assignSlots(slots, fighters, config) {
  const open = [...slots];
  const planned = {};
  const left = [...fighters];
  for (const fighter of [...left]) {
    const index = open.indexOf(fighter.point);
    if (index < 0) continue;
    planned[fighter.name] = open.splice(index, 1)[0];
    left.splice(left.indexOf(fighter), 1);
  }
  for (const fighter of left) {
    let best = 0;
    let bestDist = Infinity;
    open.forEach((cell, index) => {
      const dist = cellDistance(fighter.point, cell, config);
      if (dist < bestDist) {
        bestDist = dist;
        best = index;
      }
    });
    planned[fighter.name] = open.splice(best, 1)[0];
  }
  const dest = {};
  for (const fighter of fighters) {
    const wish = planned[fighter.name];
    dest[fighter.name] = canStep(fighter.point, wish, config)
      ? wish
      : stepToward(fighter.point, wish, config);
  }
  return { planned, dest };
}

function goingTo(defense, dest, cellId) {
  return defense.filter((fighter) => dest[fighter.name] === cellId);
}

function laneCells(plant, attackers, config) {
  const lanes = new Map();
  for (const cellId of neighbors(plant, config)) {
    if (config.map.cells[cellId].plant) continue;
    const coming = attackers.filter((fighter) => (
      cellDistance(fighter.point, cellId, config) + 1 === cellDistance(fighter.point, plant, config)
      || fighter.point === cellId
    ));
    if (coming.length) lanes.set(cellId, coming);
  }
  return lanes;
}

function holdsCell(defenders, attackers, cellId, state, config) {
  const diff = compare(
    sidePower(defenders, cellId, 'defense', state.owned, 0, (fighter) => fighter.point === cellId, config),
    sidePower(attackers, cellId, 'attack', state.owned, 0, (fighter) => fighter.point === cellId, config),
    config,
  );
  return state.owned[cellId] === 'defense' ? diff >= 0 : diff > 0;
}

// Шаблон задаёт места, пока контакта нет. Дальше защита держит свою полосу,
// а на плент выходит только когда атака уже у двери. Текущий ход атаки не виден.
function react(dest, defense, state, config) {
  const attack = living(state, 'attack');
  const threatRange = config.rules.threatRange ?? 2;
  const plants = config.cellOrder.filter((cellId) => config.map.cells[cellId].plant);
  const bombPoint = state.bomb && !state.defused ? state.bomb.point : null;
  const goals = [];
  for (const plant of plants) {
    const onSite = attack.filter((fighter) => fighter.point === plant);
    if (onSite.length) {
      goals.push({ cell: plant, attackers: onSite });
      continue;
    }
    const atDoor = attack.filter((fighter) => cellDistance(fighter.point, plant, config) === 1);
    if (atDoor.length) goals.push({ cell: plant, attackers: atDoor });
    const far = attack.filter((fighter) => {
      const steps = cellDistance(fighter.point, plant, config);
      return steps > 1 && steps <= threatRange;
    });
    if (!far.length) continue;
    for (const [lane, coming] of laneCells(plant, far, config)) {
      goals.push({ cell: lane, attackers: coming });
    }
  }
  if (bombPoint) {
    const already = goals.find((goal) => goal.cell === bombPoint);
    if (already) already.save = true;
    else goals.push({ cell: bombPoint, attackers: attack.filter((fighter) => fighter.point === bombPoint), save: true });
  }
  goals.sort((left, right) => {
    if (left.save && !right.save) return -1;
    if (right.save && !left.save) return 1;
    return right.attackers.length - left.attackers.length;
  });

  const used = new Set();
  for (const goal of goals) {
    for (const fighter of defense) {
      if (used.has(fighter.name) || fighter.point !== goal.cell) continue;
      used.add(fighter.name);
      dest[fighter.name] = goal.cell;
    }
  }
  for (const goal of goals) {
    const { cell, attackers } = goal;
    const enough = () => Boolean(attackers.length) && !goal.save
      && holdsCell(goingTo(defense, dest, cell), attackers, cell, state, config);
    if (enough()) continue;
    const free = defense.filter((fighter) => !used.has(fighter.name));
    const reach = free
      .filter((fighter) => canStep(fighter.point, cell, config))
      .sort((left, right) => weaponStrength(right.weapon, config) - weaponStrength(left.weapon, config));
    for (const fighter of reach) {
      used.add(fighter.name);
      dest[fighter.name] = cell;
      if (enough()) break;
    }
    if (enough()) continue;
    const distant = defense
      .filter((fighter) => !used.has(fighter.name))
      .sort((left, right) => (
        cellDistance(left.point, cell, config) - cellDistance(right.point, cell, config)
        || weaponStrength(right.weapon, config) - weaponStrength(left.weapon, config)
      ));
    for (const fighter of distant) {
      const next = stepToward(fighter.point, cell, config);
      if (next === fighter.point) continue;
      used.add(fighter.name);
      dest[fighter.name] = next;
      if (!goal.save && goingTo(defense, dest, cell).length > attackers.length) break;
    }
  }
}

function saveDest(fighters, state, config) {
  const goal = config.spawns.defense;
  const enemies = new Set(
    state.fighters.filter((fighter) => fighter.alive && fighter.side === 'attack').map((fighter) => fighter.point),
  );
  return Object.fromEntries(fighters.map((fighter) => {
    if (fighter.point === goal) return [fighter.name, goal];
    const options = [fighter.point, ...neighbors(fighter.point, config)];
    const safe = options.filter((cell) => cell === fighter.point || !enemies.has(cell));
    let best = fighter.point;
    let bestDist = cellDistance(fighter.point, goal, config);
    for (const cell of safe) {
      const dist = cellDistance(cell, goal, config);
      if (dist < bestDist) {
        bestDist = dist;
        best = cell;
      }
    }
    return [fighter.name, best];
  }));
}

function defend(play, fighters, state, config) {
  const { dest } = assignSlots(slotsFor(play, fighters.length), fighters, config);
  if (play.action === 'stack' || play.action === 'split' || play.action === 'retake') {
    react(dest, fighters, state, config);
  }
  return dest;
}

export function ordersFromPlay(playRef, side, state, config = CONFIG, options = {}) {
  const { id, fake } = normalizeCall(playRef, options);
  const play = playById(side, id, config);
  const fighters = living(state, side);
  let dest;
  if (side === 'defense' && (play.action === 'stack' || play.action === 'split' || play.action === 'retake')) {
    dest = defend(play, fighters, state, config);
  } else if (play.action === 'save') {
    dest = saveDest(fighters, state, config);
  } else if (play.action === 'regroup') {
    dest = regroupDest(fighters, play.zone, side, config);
  } else if (play.action === 'rush') {
    dest = rushDest(fighters, play.zone, config);
  } else if (play.action === 'split') {
    dest = splitDest(fighters, play.zone, config);
  } else {
    fail(`Мув ${play.id} не разбирается`);
  }
  const fakeNames = fake && side === 'attack' ? applyFake(dest, fighters, play, config) : [];
  for (const fighter of fighters) {
    if (!canStep(fighter.point, dest[fighter.name], config)) {
      fail(`${fighter.name} не может шагнуть из ${fighter.point} в ${dest[fighter.name]}`);
    }
  }
  return {
    moves: fighters.map((fighter) => ({ name: fighter.name, to: dest[fighter.name] })),
    throws: [],
    play,
    fake: fakeNames,
    label: playLabel(play, fakeNames.length > 0),
  };
}

// Граната летит туда, куда идёт основная группа: игрок видит клетку заранее.
export function grenadeTarget(orders, config = CONFIG) {
  const fake = new Set(orders.fake || []);
  const counts = new Map();
  for (const move of orders.moves) {
    if (fake.has(move.name)) continue;
    counts.set(move.to, (counts.get(move.to) || 0) + 1);
  }
  if (!counts.size) return null;
  const goal = config.map.cells[orders.play?.zone] ? orders.play.zone : null;
  const toGoal = (cell) => (goal ? cellDistance(cell, goal, config) : 0);
  const ranked = [...counts.entries()].sort((left, right) => (
    right[1] - left[1]
    || toGoal(left[0]) - toGoal(right[0])
    || left[0].localeCompare(right[0], 'en')
  ));
  return ranked[0][0];
}

export function withGrenade(orders, side, state, config = CONFIG, type = null) {
  if (!type || !state.stock?.[side]?.includes(type)) return orders;
  const point = grenadeTarget(orders, config);
  if (!point) return orders;
  return {
    ...orders,
    throws: orders.throws.concat({ type, point }),
    grenade: { type, point },
  };
}

// Бот кидает сам: на ретейке важнее флешка, на входе — дым.
export function autoGrenade(orders, side, state, config = CONFIG) {
  const stock = state.stock?.[side] || [];
  if (!stock.length) return orders;
  const ours = new Set(orders.moves.map((move) => move.to));
  const hits = new Map();
  for (const enemy of state.fighters) {
    if (!enemy.alive || enemy.side === side) continue;
    const reachable = [...ours].some((cell) => cell === enemy.point || neighbors(cell, config).includes(enemy.point));
    if (!reachable) continue;
    hits.set(enemy.point, (hits.get(enemy.point) || 0) + 1);
  }
  if (!hits.size) return orders;
  const [point] = [...hits.entries()].sort((left, right) => {
    const enter = (ours.has(right[0]) ? 1 : 0) - (ours.has(left[0]) ? 1 : 0);
    if (enter) return enter;
    return right[1] - left[1] || left[0].localeCompare(right[0], 'en');
  })[0];
  const bomb = state.bomb && !state.defused ? state.bomb.point : null;
  const wish = point === bomb ? ['flash', 'smoke'] : ['smoke', 'flash'];
  const type = wish.find((item) => stock.includes(item));
  if (!type) return orders;
  return {
    ...orders,
    throws: orders.throws.concat({ type, point }),
    grenade: { type, point },
  };
}

export function commitOrders(playRef, side, state, config = CONFIG, options = {}) {
  const orders = ordersFromPlay(playRef, side, state, config, options);
  if (options.grenade === 'auto') return autoGrenade(orders, side, state, config);
  return withGrenade(orders, side, state, config, options.grenade || null);
}

function threatened(attack, plant, config) {
  const onSite = attack.filter((fighter) => fighter.point === plant);
  const atDoor = attack.filter((fighter) => cellDistance(fighter.point, plant, config) === 1);
  const far = attack.filter((fighter) => {
    const steps = cellDistance(fighter.point, plant, config);
    return steps > 1 && steps <= (config.rules.threatRange ?? 2);
  });
  return { onSite, atDoor, far };
}

export function chooseDefensePlay(state, config = CONFIG) {
  const attack = living(state, 'attack');
  const defense = living(state, 'defense');
  const bomb = state.bomb && !state.defused ? state.bomb.point : null;
  if (bomb) return playById('defense', bomb === 'PLANTB' ? 'retake-b' : 'retake-a', config);

  const plants = config.cellOrder.filter((cellId) => config.map.cells[cellId].plant);
  const threat = Object.fromEntries(plants.map((plant) => [plant, threatened(attack, plant, config)]));
  const hot = plants.filter((plant) => threat[plant].onSite.length || threat[plant].atDoor.length);
  if (hot.length) {
    hot.sort((left, right) => (
      (threat[right].onSite.length + threat[right].atDoor.length)
      - (threat[left].onSite.length + threat[left].atDoor.length)
    ));
    return playById('defense', hot[0] === 'PLANTB' ? 'retake-b' : 'retake-a', config);
  }
  const lanes = plants.filter((plant) => threat[plant].far.length);
  if (lanes.length >= 2) return playById('defense', 'split', config);
  if (lanes.length === 1) return playById('defense', lanes[0] === 'PLANTB' ? 'stack-b' : 'stack-a', config);

  const lastMove = state.move >= config.rules.movesPerRound - 1;
  if (lastMove && defense.length > attack.length && attack.length) return playById('defense', 'save', config);
  return playById('defense', 'split', config);
}

const PREP = {
  UPTUNNEL: 'в',
  TSPAWN: 'на',
  OUTLONG: 'на',
  PLANTB: 'на',
  LOWTUNNEL: 'в',
  MID: 'в',
  LONG: 'на',
  BDOORS: 'в',
  SHORT: 'на',
  PLANTA: 'на',
  CTSPAWN: 'на',
};

function lowerLabel(cellId, config) {
  const label = config.map.cells[cellId]?.label || cellId;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

function into(cellId, config) {
  return `${PREP[cellId] || 'в'}\u00A0${lowerLabel(cellId, config)}`;
}

function plantsOf(config) {
  return config.cellOrder.filter((cellId) => config.map.cells[cellId].plant);
}

function roadsFrom(cell, plant, config) {
  const dist = cellDistance(cell, plant, config);
  const roads = neighbors(cell, config).filter((next) => cellDistance(next, plant, config) + 1 === dist);
  const preferred = config.preferredGate?.[plant];
  const lane = config.preferredLane?.[plant];
  roads.sort((left, right) => {
    const rank = (cellId) => (cellId === preferred || cellId === lane ? 0 : 1);
    return rank(left) - rank(right) || left.localeCompare(right, 'en');
  });
  return roads;
}

function orderKey(moves) {
  return moves.map((move) => `${move.name}>${move.to}`).sort().join('|');
}

function movesFromDest(fighters, dest) {
  return fighters.map((fighter) => ({ name: fighter.name, to: dest[fighter.name] }));
}

function contextSplitDest(fighters, plant, config) {
  const groups = new Map();
  for (const fighter of fighters) {
    if (!groups.has(fighter.point)) groups.set(fighter.point, []);
    groups.get(fighter.point).push(fighter);
  }
  let bestCell = null;
  let bestSize = 0;
  for (const [cell, group] of groups) {
    if (group.length >= 2 && roadsFrom(cell, plant, config).length >= 2 && group.length > bestSize) {
      bestCell = cell;
      bestSize = group.length;
    }
  }
  if (!bestCell) return null;
  const roadsHere = roadsFrom(bestCell, plant, config);
  const group = groups.get(bestCell);
  const offCount = Math.max(1, Math.floor((group.length * 2) / 5));
  const mainCount = group.length - offCount;
  const dest = {};
  group.forEach((fighter, index) => {
    dest[fighter.name] = index < mainCount ? roadsHere[0] : roadsHere[1];
  });
  for (const fighter of fighters) {
    if (dest[fighter.name]) continue;
    dest[fighter.name] = stepToward(fighter.point, plant, config);
  }
  return dest;
}

function peopleWord(count) {
  if (count === 1) return 'один';
  if (count === 2) return 'двое';
  if (count === 3) return 'трое';
  if (count === 4) return 'четверо';
  if (count === 5) return 'пятеро';
  return String(count);
}

function powerNum(value) {
  const rounded = Math.round(value * 10) / 10;
  return String(rounded).replace('.', ',');
}

function powerParts(group, cellId, side, owned, smoke, stayed, config) {
  const parts = group.map((fighter) => Math.max(0, (
    weaponStrength(fighter.weapon, config)
    * ((stayed(fighter) && owned[cellId] === side) ? config.rules.holdMultiplier : 1)
    - smoke
  )));
  parts.sort((left, right) => right - left);
  const full = config.rules.stackFull;
  const extra = config.rules.stackExtra;
  const shooters = config.rules.stackShooters ?? parts.length;
  return parts.slice(0, shooters).map((value, index) => (index < full ? value : value * extra));
}

function describeMove(id, action, zone, moves, fighters, config) {
  const spawn = config.spawns.attack;
  const at = Object.fromEntries(fighters.map((fighter) => [fighter.name, fighter.point]));
  const allOnSpawn = fighters.every((fighter) => fighter.point === spawn);
  const destinations = new Map();
  for (const move of moves) destinations.set(move.to, (destinations.get(move.to) || 0) + 1);
  const groups = [...destinations.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'));
  const stayed = moves.every((move) => move.to === at[move.name]);
  if (action === 'hold' || stayed) {
    if (groups.length === 1) return `Держать ${lowerLabel(groups[0][0], config)}`;
    return 'Держать';
  }
  if (action === 'fallback') return 'Отойти на\u00A0спавн';
  if (action === 'split' && zone) {
    const letter = zone === 'PLANTB' ? 'Б' : 'А';
    const bits = groups.map(([cellId, count]) => `${count}\u00A0${into(cellId, config)}`);
    return `Сплит на\u00A0${letter}: ${bits.join(', ')}`;
  }
  if (groups.length === 1) {
    const cellId = groups[0][0];
    if (allOnSpawn) return `Все ${into(cellId, config)}`;
    if (action === 'regroup') return `Собраться ${into(cellId, config)}`;
    return `Зайти ${into(cellId, config)}`;
  }
  if (action === 'regroup') {
    const goal = zone === 'spawn' ? spawn : zone;
    return `Собраться ${into(goal, config)}`;
  }
  return groups.map(([cellId, count]) => `${count}\u00A0${into(cellId, config)}`).join(', ');
}

export function contextPlays(state, config = CONFIG, options = {}) {
  const fighters = living(state, 'attack');
  const spawn = config.spawns.attack;
  const plants = plantsOf(config).sort((left, right) => {
    if (left === config.plantTie) return -1;
    if (right === config.plantTie) return 1;
    return 0;
  });
  const fakeAllowed = state.move === 0 && fighters.length > 0 && fighters.every((fighter) => fighter.point === spawn);
  const points = new Set(fighters.map((fighter) => fighter.point));
  const candidates = [];

  const push = (id, action, zone, dest) => {
    if (!dest) return;
    for (const fighter of fighters) {
      if (!canStep(fighter.point, dest[fighter.name], config)) return;
    }
    const moves = movesFromDest(fighters, dest);
    candidates.push({ id, action, zone, moves, dest });
  };

  for (const plant of plants) {
    push(`rush:${plant}`, 'rush', plant, rushDest(fighters, plant, config));
    push(`split:${plant}`, 'split', plant, contextSplitDest(fighters, plant, config));
  }
  if (points.size > 1) {
    const tally = new Map();
    for (const fighter of fighters) tally.set(fighter.point, (tally.get(fighter.point) || 0) + 1);
    const [gather] = [...tally.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'en'))[0];
    push(`regroup:${gather}`, 'regroup', gather, regroupDest(fighters, gather, 'attack', config));
    if (gather !== spawn) {
      push('regroup:spawn', 'regroup', 'spawn', regroupDest(fighters, 'spawn', 'attack', config));
    }
  } else if (!points.has(config.map.cells.MID ? 'MID' : spawn)) {
    push('regroup:MID', 'regroup', 'MID', regroupDest(fighters, 'MID', 'attack', config));
  }
  push('hold', 'hold', null, Object.fromEntries(fighters.map((fighter) => [fighter.name, fighter.point])));
  push('fallback', 'fallback', 'spawn', regroupDest(fighters, 'spawn', 'attack', config));

  const at = Object.fromEntries(fighters.map((fighter) => [fighter.name, fighter.point]));
  const seen = new Map();
  const unique = [];
  for (const candidate of candidates) {
    const stayed = candidate.moves.every((move) => move.to === at[move.name]);
    if (stayed && candidate.action !== 'hold') continue;
    const key = orderKey(candidate.moves);
    const preferred = candidate.action === 'hold' || candidate.action === 'fallback';
    if (seen.has(key) && !preferred) continue;
    const label = describeMove(candidate.id, candidate.action, candidate.zone, candidate.moves, fighters, config);
    const play = { id: candidate.id, action: candidate.action, zone: candidate.zone, label };
    const dest = { ...candidate.dest };
    const fakeNames = options.fake && fakeAllowed && candidate.action === 'rush'
      ? applyFake(dest, fighters, play, config)
      : [];
    const moves = fakeNames.length ? movesFromDest(fighters, dest) : candidate.moves;
    const orders = {
      moves,
      throws: [],
      play,
      fake: fakeNames,
      label: fakeNames.length ? `${label} +\u00A0фейк` : label,
    };
    const closer = candidate.action === 'hold'
      ? 0
      : fighters.filter((fighter) => {
        const next = orders.moves.find((move) => move.name === fighter.name)?.to;
        const before = Math.min(...plants.map((plant) => cellDistance(fighter.point, plant, config)));
        const after = Math.min(...plants.map((plant) => cellDistance(next, plant, config)));
        return after < before;
      }).length;
    const rank = candidate.action === 'hold' ? 1 : candidate.action === 'fallback' ? 2 : (closer > 0 ? 0 : 2);
    const item = {
      id: candidate.id,
      label: orders.label,
      orders,
      forecast: forecastFor(orders, state, config, options),
      rank,
    };
    if (seen.has(key)) unique[seen.get(key)] = item;
    else {
      seen.set(key, unique.length);
      unique.push(item);
    }
  }
  const forward = unique.filter((item) => item.rank === 0);
  const tail = unique.filter((item) => item.rank !== 0);
  const plays = [...forward.slice(0, Math.max(0, 6 - tail.length)), ...tail].slice(0, 6);
  return { plays, fake: fakeAllowed };
}

export function forecastFor(orders, state, config = CONFIG, options = {}) {
  const unknown = {
    tone: 'unknown',
    attack: null,
    defense: null,
    score: null,
    sentence: 'Врагов не\u00A0видно',
    cell: null,
  };
  if (!orders?.moves?.length || !state) return unknown;
  const withThrow = options.grenade ? withGrenade(orders, 'attack', state, config, options.grenade) : orders;
  const thrown = withThrow.throws?.find((item) => item.type === 'smoke' || item.type === 'flash') || null;
  const vision = visibleCells(state.fighters, 'attack', config);
  const at = Object.fromEntries(state.fighters.map((fighter) => [fighter.name, fighter]));
  const fake = new Set(withThrow.fake || []);
  const byCell = new Map();
  for (const move of withThrow.moves) {
    if (fake.has(move.name)) continue;
    if (!byCell.has(move.to)) byCell.set(move.to, []);
    byCell.get(move.to).push(at[move.name]);
  }
  const marks = shadowMarks(state.fighters, options.memory || {}, 'attack', state.move, config);
  let best = null;
  let unseen = false;
  let remembered = null;
  for (const [cellId, group] of byCell) {
    const enemies = state.fighters.filter((fighter) => (
      fighter.alive && fighter.side === 'defense' && fighter.point === cellId && vision.has(cellId)
    ));
    if (!vision.has(cellId)) {
      unseen = true;
      const here = marks.filter((mark) => mark.point === cellId);
      if (here.length && (!remembered || here.length > remembered.count)) {
        remembered = { cellId, count: here.length };
      }
      continue;
    }
    if (!enemies.length) continue;
    const smoke = thrown?.type === 'smoke' && thrown.point === cellId ? config.utility.smoke.penalty : 0;
    const oursStay = (fighter) => withThrow.moves.find((move) => move.name === fighter.name)?.to === at[fighter.name]?.point;
    const attackParts = powerParts(group.filter(Boolean), cellId, 'attack', state.owned, 0, oursStay, config);
    const defenseParts = powerParts(enemies, cellId, 'defense', state.owned, smoke, () => true, config);
    const attack = sidePower(group.filter(Boolean), cellId, 'attack', state.owned, 0, oursStay, config);
    const defense = sidePower(enemies, cellId, 'defense', state.owned, smoke, () => true, config);
    const flash = thrown?.type === 'flash' && thrown.point === cellId;
    let diff = compare(attack, defense, config);
    if (diff === 0 && flash) diff = 1;
    const item = {
      cellId,
      group: group.length,
      enemies: enemies.length,
      attack,
      defense,
      attackParts,
      defenseParts,
      diff,
      flash,
      smoke,
    };
    if (!best || item.group > best.group) best = item;
  }
  const mainCell = [...byCell.entries()].sort((left, right) => right[1].length - left[1].length)[0]?.[0] || null;
  if (!best) {
    if (remembered) {
      const verb = remembered.count === 1 ? 'был' : 'были';
      return {
        tone: 'unknown',
        attack: null,
        defense: null,
        score: null,
        sentence: `${config.map.cells[remembered.cellId].label}: там ${verb} ${peopleWord(remembered.count)} ходом раньше`,
        cell: remembered.cellId,
      };
    }
    if (!unseen) {
      return { tone: 'clear', attack: null, defense: null, score: null, sentence: 'Там пусто', cell: mainCell };
    }
    return { ...unknown, cell: mainCell };
  }
  const tone = best.diff > 0 ? 'win' : best.diff < 0 ? 'loss' : 'tie';
  const verdict = tone === 'win' ? 'победа' : tone === 'loss' ? 'проигрыш' : 'ничья';
  const extra = [];
  if (best.smoke) extra.push('дымовая снимает\u00A02');
  if (best.flash && best.diff > 0 && compare(best.attack, best.defense, config) === 0) extra.push('световая решает равный бой');
  const stand = best.enemies === 1 ? 'стоит' : 'стоят';
  const sentence = [
    `${config.map.cells[best.cellId].label}: там ${peopleWord(best.enemies)} ${stand}`,
    `${best.attackParts.map(powerNum).join(' + ')} против ${best.defenseParts.map(powerNum).join(' + ')}\u00A0\u2014 ${verdict}`,
    ...extra,
  ].join(', ');
  return {
    tone,
    attack: best.attack,
    defense: best.defense,
    score: `${powerNum(best.attack)}\u00A0:\u00A0${powerNum(best.defense)}`,
    sentence,
    cell: best.cellId,
  };
}

export function assertPlays(config = CONFIG) {
  for (const side of ['attack', 'defense']) {
    for (const play of config.plays[side]) {
      if (!play.id || !play.action || !play.label) fail(`Мув ${play.id || side} без полей`);
    }
  }
  const attack = {
    fighters: config.rosters.attack.map((name) => ({ name, weapon: 'pistol', armor: false })),
    stock: ['smoke'],
  };
  const defense = {
    fighters: config.rosters.defense.map((name) => ({ name, weapon: 'pistol', armor: false })),
    stock: [],
  };
  const start = createRound(attack, defense, config);
  for (const play of config.plays.attack) ordersFromPlay(play.id, 'attack', start, config, { fake: true });
  for (const play of config.plays.defense) ordersFromPlay(play.id, 'defense', start, config);
  for (const probe of config.probes) {
    if (probe.plays.length !== config.rules.movesPerRound) fail(`Проба ${probe.id}: не ${config.rules.movesPerRound} мува`);
    let round = createRound(attack, defense, config);
    for (let index = 0; index < probe.plays.length && !round.winner; index += 1) {
      const entry = probe.plays[index];
      const id = typeof entry === 'string' ? entry : entry.play;
      if (!config.plays.attack.some((play) => play.id === id)) fail(`Проба ${probe.id}: нет мува ${id}`);
      const step = resolveMove(round, {
        attack: ordersFromPlay(entry, 'attack', round, config),
        defense: ordersFromPlay('split', 'defense', round, config),
      }, config);
      round = step.state;
    }
  }
}
