import { CONFIG } from './config.js';
import { canStep, compare, loadoutCost, neighbors, sidePower, weaponStrength } from './engine.js';

function fail(message) {
  throw new Error(message);
}

export function pickWeighted(items, rng) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) fail('Сумма весов шаблонов должна быть больше нуля');
  let roll = rng() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return items[items.length - 1];
}

export function assertRoute(route, side, config = CONFIG) {
  const names = config.rosters[side];
  const count = side === 'attack' ? config.rules.attackFighters : config.rules.defenseFighters;
  if (names.length !== count) fail(`Ростер ${side}: ожидалось ${count}, есть ${names.length}`);
  if (route.moves.length !== config.rules.movesPerRound) {
    fail(`Маршрут ${route.id}: ходов ${route.moves.length}`);
  }
  let points = names.map(() => config.spawns[side]);
  route.moves.forEach((step, move) => {
    if (step.length !== count) fail(`Маршрут ${route.id}, ход ${move + 1}: не ${count} клеток`);
    step.forEach((to, index) => {
      if (!canStep(points[index], to, config)) {
        fail(`Маршрут ${route.id}: ${names[index]} не шагает из ${points[index]} в ${to}`);
      }
      points[index] = to;
    });
  });
}

export function assertRoutes(config = CONFIG) {
  for (const side of ['attack', 'defense']) {
    for (const route of config.routes[side]) assertRoute(route, side, config);
  }
}

function gear(wallet, count, config) {
  const rifle = config.weapons.rifle.cost * count;
  const smg = config.weapons.smg.cost * count;
  let weapon = 'pistol';
  if (wallet >= rifle) weapon = 'rifle';
  else if (wallet >= smg) weapon = 'smg';
  const spent = config.weapons[weapon].cost * count;
  const armor = spent + config.armor.cost * count <= wallet;
  return { weapon, armor };
}

export function planRound(side, wallet, config = CONFIG, rng = Math.random) {
  const names = config.rosters[side];
  const count = names.length;
  const route = pickWeighted(config.routes[side], rng);
  assertRoute(route, side, config);
  const picked = gear(wallet, count, config);
  const fighters = names.map((name) => ({
    name,
    weapon: picked.weapon,
    armor: picked.armor,
  }));
  const stock = [];
  const cost = loadoutCost(fighters, stock, config);
  if (cost > wallet) fail(`Закупка ${side} ${cost} дороже кошелька ${wallet}`);
  return {
    side,
    fighters,
    stock,
    cost,
    weapon: picked.weapon,
    armor: picked.armor,
    route,
    templateId: route.id,
  };
}

export function scriptFromRoute(route, names) {
  return route.moves.map((step) => ({
    moves: names.map((name, index) => ({ name, to: step[index] })),
    throws: [],
  }));
}

// В своей клетке ничья остаётся за защитой, поэтому её достаточно.
function holdsCell(defenders, attackers, cellId, state, config) {
  const diff = compare(
    sidePower(defenders, cellId, 'defense', state.owned, 0, (fighter) => fighter.point === cellId, config),
    sidePower(attackers, cellId, 'attack', state.owned, 0, (fighter) => fighter.point === cellId, config),
    config,
  );
  return state.owned[cellId] === 'defense' ? diff >= 0 : diff > 0;
}

function cellDistance(from, to, config) {
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

// Один шаг по кратчайшему пути к цели. Бот не видит текущий ход игрока — только уже случившееся.
function stepToward(from, goal, config) {
  if (from === goal) return from;
  if (canStep(from, goal, config)) return goal;
  let best = null;
  let bestDist = Infinity;
  for (const next of neighbors(from, config)) {
    const dist = cellDistance(next, goal, config);
    if (dist < bestDist || (dist === bestDist && (!best || next.localeCompare(best, 'ru') < 0))) {
      bestDist = dist;
      best = next;
    }
  }
  return best || from;
}

function goingTo(defense, dest, cellId) {
  return defense.filter((fighter) => dest[fighter.name] === cellId);
}

// Клетки, через которые атака войдёт на плент: соседи плента на её кратчайшем пути.
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

// Шаблон задаёт, куда идти, пока контакта нет. Дальше бот видит уже случившееся
// и держит свою полосу перед плентом, а не бежит на сам плент: множитель только у себя.
// Текущий ход игрока ему не виден.
export function defenseOrders(route, names, moveIndex, state, config = CONFIG) {
  const script = scriptFromRoute(route, names)[moveIndex];
  const planned = new Map(script.moves.map((order) => [order.name, order.to]));
  const defense = state.fighters.filter((fighter) => fighter.alive && fighter.side === 'defense');
  const attack = state.fighters.filter((fighter) => fighter.alive && fighter.side === 'attack');
  const dest = {};
  for (const fighter of defense) {
    const wish = planned.get(fighter.name);
    dest[fighter.name] = wish && canStep(fighter.point, wish, config) ? wish : fighter.point;
  }

  const threatRange = config.rules.threatRange ?? 2;
  const plants = config.cellOrder.filter((cellId) => config.map.cells[cellId].plant);
  const bombPoint = state.bomb && !state.defused ? state.bomb.point : null;

  // Цель: клетка, которую надо занять, и кем её грозят взять.
  const goals = [];
  for (const plant of plants) {
    const onSite = attack.filter((fighter) => fighter.point === plant);
    if (onSite.length) {
      goals.push({ cell: plant, attackers: onSite });
      continue;
    }
    // Атака у двери — закрываем сам плент. Дальше — держим полосу, там работает множитель.
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
    else goals.push({ cell: bombPoint, attackers: attack.filter((f) => f.point === bombPoint), hold: false, save: true });
  }
  goals.sort((left, right) => {
    if (left.save && !right.save) return -1;
    if (right.save && !left.save) return 1;
    return right.attackers.length - left.attackers.length;
  });

  const used = new Set();

  // Кто уже стоит на нужной клетке, там и остаётся: только так работает множитель.
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
      // На чужой клетке ничья не спасает, поэтому тянем на одного больше, чем у них.
      if (!goal.save && goingTo(defense, dest, cell).length > attackers.length) break;
    }
  }

  return {
    moves: defense.map((fighter) => ({ name: fighter.name, to: dest[fighter.name] })),
    throws: [],
  };
}
