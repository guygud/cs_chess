import { CONFIG } from './config.js';
import { canStep, compare, loadoutCost, neighbors, weaponStrength } from './engine.js';

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

function cellPower(group, cellId, side, owned, config, standing) {
  return group.reduce((sum, fighter) => {
    const raw = weaponStrength(fighter.weapon, config);
    const bonus = standing(fighter) && owned[cellId] === side;
    return sum + (bonus ? raw * config.rules.holdMultiplier : raw);
  }, 0);
}

function ahead(defenders, attackers, cellId, state, config) {
  return compare(
    cellPower(defenders, cellId, 'defense', state.owned, config, (fighter) => fighter.point === cellId),
    cellPower(attackers, cellId, 'attack', state.owned, config, (fighter) => fighter.point === cellId),
    config,
  ) > 0;
}

// Шаблон задаёт, куда идти, пока контакта нет. После хода бот видит уже случившееся
// и добирает людей на плент, где своих не хватает. Текущий ход игрока ему не виден.
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

  const plants = config.cellOrder.filter((cellId) => config.map.cells[cellId].plant);
  const attackOn = Object.fromEntries(plants.map((cellId) => [
    cellId,
    attack.filter((fighter) => fighter.point === cellId),
  ]));
  const hot = plants.filter((cellId) => attackOn[cellId].length > 0);
  for (const cellId of plants) {
    if (attackOn[cellId].length) continue;
    const incoming = attack.filter((fighter) => neighbors(cellId, config).includes(fighter.point));
    if (!incoming.length) continue;
    attackOn[cellId] = incoming;
    hot.push(cellId);
  }
  if (state.bomb && !state.defused && !hot.includes(state.bomb.point)) hot.push(state.bomb.point);

  const used = new Set();
  hot.sort((left, right) => (attackOn[right]?.length || 0) - (attackOn[left]?.length || 0));
  for (const cellId of hot) {
    const attackers = attackOn[cellId] || [];
    const chosen = [];
    const pool = defense.filter((fighter) => canStep(fighter.point, cellId, config));
    pool.sort((left, right) => {
      const rank = (fighter) => {
        if (fighter.point === cellId) return 0;
        return hot.includes(fighter.point) ? 2 : 1;
      };
      return rank(left) - rank(right)
        || weaponStrength(right.weapon, config) - weaponStrength(left.weapon, config);
    });
    for (const fighter of pool) {
      if (used.has(fighter.name)) continue;
      if (hot.includes(fighter.point) && fighter.point !== cellId) {
        const stay = defense.filter((other) => (
          other.point === fighter.point && other.name !== fighter.name && !used.has(other.name)
        ));
        if (!ahead(stay, attackOn[fighter.point] || [], fighter.point, state, config)) continue;
      }
      chosen.push(fighter);
      used.add(fighter.name);
      if (ahead(chosen, attackers, cellId, state, config)) break;
    }
    for (const fighter of chosen) dest[fighter.name] = cellId;
  }

  return {
    moves: defense.map((fighter) => ({ name: fighter.name, to: dest[fighter.name] })),
    throws: [],
  };
}
