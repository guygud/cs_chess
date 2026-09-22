import { CONFIG } from './config.js';
import { canStep, loadoutCost } from './engine.js';

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
