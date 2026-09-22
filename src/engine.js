import { CONFIG } from './config.js';

// Чистые функции. Не обращаются к DOM и к Math.random.
// Ход: переход, размен, смерти, хозяин клетки, установка и обезвреживание.

function fail(message) {
  throw new Error(message);
}

export function compare(left, right, config = CONFIG) {
  const delta = left - right;
  if (Math.abs(delta) <= config.rules.compareEpsilon) return 0;
  return delta > 0 ? 1 : -1;
}

export function weaponStrength(weaponId, config = CONFIG) {
  const weapon = config.weapons[weaponId];
  if (!weapon) fail(`Неизвестное оружие: ${weaponId}`);
  return weapon.strength;
}

export function loadoutCost(fighters, utility, config = CONFIG) {
  let cost = 0;
  for (const fighter of fighters) {
    cost += config.weapons[fighter.weapon].cost;
    if (fighter.armor) cost += config.armor.cost;
  }
  for (const item of utility || []) {
    cost += config.utility[item.type || item].cost;
  }
  return cost;
}

export function roundReward(won, lossStreak, config = CONFIG) {
  if (won) return { reward: config.economy.winReward, lossStreak: 0 };
  const steps = Math.min(lossStreak, config.economy.maxLossStreakSteps);
  return {
    reward: config.economy.lossBase + config.economy.lossStreakStep * steps,
    lossStreak: lossStreak + 1,
  };
}

export function matchStatus(score, round, config = CONFIG) {
  if (score.attack >= config.rules.winsNeeded) return 'attack';
  if (score.defense >= config.rules.winsNeeded) return 'defense';
  if (round >= config.rules.maxRounds) return 'draw';
  return null;
}

export function applyRoundEconomy(snapshot, result, spent, config = CONFIG) {
  const attackWon = result.winner === 'attack';
  const attackPay = roundReward(attackWon, snapshot.lossStreak.attack, config);
  const defensePay = roundReward(!attackWon, snapshot.lossStreak.defense, config);
  const wallets = {
    attack: snapshot.wallets.attack - spent.attack + attackPay.reward,
    defense: snapshot.wallets.defense - spent.defense + defensePay.reward,
  };
  return {
    wallets,
    lossStreak: {
      attack: attackPay.lossStreak,
      defense: defensePay.lossStreak,
    },
    score: {
      attack: snapshot.score.attack + (attackWon ? 1 : 0),
      defense: snapshot.score.defense + (attackWon ? 0 : 1),
    },
    economy: {
      attack: {
        before: snapshot.wallets.attack,
        spent: spent.attack,
        reward: attackPay.reward,
        after: wallets.attack,
      },
      defense: {
        before: snapshot.wallets.defense,
        spent: spent.defense,
        reward: defensePay.reward,
        after: wallets.defense,
      },
    },
  };
}

export function neighbors(cellId, config = CONFIG) {
  const list = [];
  for (const [left, right] of config.edges) {
    if (left === cellId) list.push(right);
    if (right === cellId) list.push(left);
  }
  return list;
}

export function canStep(from, to, config = CONFIG) {
  if (!config.map.cells[from] || !config.map.cells[to]) return false;
  return from === to || neighbors(from, config).includes(to);
}

function cloneState(state) {
  return {
    move: state.move,
    fighters: state.fighters.map((fighter) => ({ ...fighter })),
    owned: { ...state.owned },
    bomb: state.bomb ? { ...state.bomb } : null,
    defused: state.defused,
    winner: state.winner,
    endReason: state.endReason,
    stock: {
      attack: [...state.stock.attack],
      defense: [...state.stock.defense],
    },
  };
}

function living(fighters, cellId, side) {
  return fighters.filter((fighter) => (
    fighter.alive && fighter.point === cellId && (!side || fighter.side === side)
  ));
}

function personStrength(fighter, cellId, side, owned, stayed, config) {
  const base = weaponStrength(fighter.weapon, config);
  const stood = (typeof stayed === 'function'
    ? stayed(fighter)
    : stayed.has(fighter.name)) && owned[cellId] === side;
  return stood ? base * config.rules.holdMultiplier : base;
}

// Дымовая бьёт по каждому в клетке. Стреляют только первые stackShooters: угол узкий.
export function sidePower(group, cellId, side, owned, smokePerPerson, stayed, config = CONFIG) {
  const parts = group.map((fighter) => Math.max(0, personStrength(fighter, cellId, side, owned, stayed, config) - smokePerPerson));
  parts.sort((left, right) => right - left);
  const full = config.rules.stackFull;
  const extra = config.rules.stackExtra;
  const shooters = config.rules.stackShooters ?? parts.length;
  return parts
    .slice(0, shooters)
    .reduce((sum, value, index) => sum + (index < full ? value : value * extra), 0);
}

function weakest(group) {
  return [...group].sort((left, right) => {
    const byGun = weaponStrength(left.weapon) - weaponStrength(right.weapon);
    if (byGun !== 0) return byGun;
    return left.name.localeCompare(right.name, 'ru');
  })[0];
}

function strike(fighter) {
  if (fighter.armor && !fighter.armorUsed) {
    fighter.armorUsed = true;
    return 'saved';
  }
  fighter.alive = false;
  return 'dead';
}

function resolveContact(attackGroup, defenseGroup, {
  cellId = null,
  owned = null,
  stayed = new Set(),
  smokes = { attack: 0, defense: 0 },
  flashes = { attack: false, defense: false },
  config = CONFIG,
  clash = false,
  endpoints = null,
} = {}) {
  const attackFinal = sidePower(attackGroup, cellId || endpoints?.[0] || config.cellOrder[0], 'attack', owned || {}, smokes.attack, stayed, config);
  const defenseFinal = sidePower(defenseGroup, cellId || endpoints?.[0] || config.cellOrder[0], 'defense', owned || {}, smokes.defense, stayed, config);
  const present = [...attackGroup, ...defenseGroup].map((fighter) => ({
    name: fighter.name,
    side: fighter.side,
    weapon: fighter.weapon,
    died: false,
    saved: false,
    stood: stayed.has(fighter.name),
  }));
  const contact = attackGroup.length > 0 && defenseGroup.length > 0;
  let outcome = null;
  if (contact) {
    const diff = compare(attackFinal, defenseFinal, config);
    const mark = (group, mode) => {
      for (const fighter of mode === 'all' ? group : [weakest(group)]) {
        const card = present.find((person) => person.name === fighter.name);
        const result = strike(fighter);
        if (result === 'saved') card.saved = true;
        else card.died = true;
      }
    };
    const killOne = (group) => {
      const alive = group.filter((fighter) => fighter.alive);
      if (alive.length) mark(alive, 'one');
    };
    // Кто не поместился в угол, стоит в проходе и гибнет первым.
    const killCrowd = (group, enemyPower) => {
      if (enemyPower <= 0) return;
      const shooters = config.rules.stackShooters ?? group.length;
      const queue = [...group].sort((left, right) => (
        weaponStrength(right.weapon, config) - weaponStrength(left.weapon, config)
        || left.name.localeCompare(right.name, 'ru')
      ));
      for (const fighter of queue.slice(shooters)) {
        if (!fighter.alive) continue;
        mark([fighter], 'all');
      }
    };
    if (diff === 0 && flashes.attack !== flashes.defense) {
      const winner = flashes.attack ? 'attack' : 'defense';
      mark(winner === 'attack' ? defenseGroup : attackGroup, 'all');
      outcome = winner;
    } else if (diff === 0) {
      killCrowd(attackGroup, defenseFinal);
      killCrowd(defenseGroup, attackFinal);
      killOne(attackGroup);
      killOne(defenseGroup);
      outcome = clash ? null : (owned?.[cellId] || 'defense');
    } else {
      const winner = diff > 0 ? 'attack' : 'defense';
      const losers = winner === 'attack' ? defenseGroup : attackGroup;
      const winners = winner === 'attack' ? attackGroup : defenseGroup;
      const loserPower = winner === 'attack' ? defenseFinal : attackFinal;
      mark(losers, 'all');
      const flash = winner === 'attack' ? flashes.attack : flashes.defense;
      if (!flash) {
        killCrowd(winners, loserPower);
        if (winners.filter((fighter) => fighter.alive).length > 1) killOne(winners);
      }
      outcome = winner;
    }
  }
  return {
    point: cellId,
    endpoints,
    clash,
    contact,
    attackFinal,
    defenseFinal,
    attackCount: attackGroup.length,
    defenseCount: defenseGroup.length,
    outcome,
    present,
    smoke: smokes,
    flash: flashes,
    owned: cellId ? (owned?.[cellId] || null) : null,
  };
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function takeStock(stock, type) {
  const index = stock.indexOf(type);
  if (index < 0) fail(`Нет гранаты: ${type}`);
  stock.splice(index, 1);
}

function throwAllowed(point, ownCells, config) {
  if (ownCells.includes(point)) return true;
  return ownCells.some((cell) => neighbors(cell, config).includes(point));
}

export function createRound(attack, defense, config = CONFIG) {
  const packs = [
    ['attack', attack, config.rules.attackFighters, config.spawns.attack],
    ['defense', defense, config.rules.defenseFighters, config.spawns.defense],
  ];
  const fighters = [];
  const stock = { attack: [], defense: [] };
  const seen = new Set();
  for (const [side, pack, expected, spawn] of packs) {
    if (!pack || pack.fighters.length !== expected) {
      fail(`${side}: ожидалось ${expected} бойцов`);
    }
    for (const fighter of pack.fighters) {
      if (seen.has(fighter.name)) fail(`Имя повторяется: ${fighter.name}`);
      seen.add(fighter.name);
      if (!config.weapons[fighter.weapon]) fail(`Неизвестное оружие: ${fighter.weapon}`);
      fighters.push({
        name: fighter.name,
        side,
        weapon: fighter.weapon,
        armor: Boolean(fighter.armor),
        armorUsed: false,
        point: spawn,
        alive: true,
      });
    }
    for (const item of pack.stock || []) {
      if (!config.utility[item]) fail(`Неизвестная граната: ${item}`);
      stock[side].push(item);
    }
    if (stock[side].length > config.rules.maxUtility) fail('Слишком много гранат');
  }
  return {
    move: 0,
    fighters,
    owned: Object.fromEntries(
      config.cellOrder.map((cellId) => [cellId, config.map.cells[cellId].owner]),
    ),
    bomb: null,
    defused: false,
    winner: null,
    endReason: null,
    stock,
  };
}

function finishRound(state, config) {
  const attackAlive = state.fighters.filter((fighter) => fighter.side === 'attack' && fighter.alive).length;
  const defenseAlive = state.fighters.filter((fighter) => fighter.side === 'defense' && fighter.alive).length;
  if (attackAlive === 0 || defenseAlive === 0) {
    state.winner = attackAlive > defenseAlive ? 'attack' : 'defense';
    state.endReason = 'wipe';
    return;
  }
  if (state.defused) {
    state.winner = 'defense';
    state.endReason = 'defuse';
    return;
  }
  if (state.move < config.rules.movesPerRound) return;
  if (state.bomb) {
    state.winner = 'attack';
    state.endReason = 'bomb';
    return;
  }
  state.winner = attackAlive > defenseAlive ? 'attack' : 'defense';
  state.endReason = 'alive';
}

export function resolveMove(round, orders, config = CONFIG) {
  if (round.winner) fail('Раунд уже закончен');
  const state = cloneState(round);
  state.move += 1;
  const stayed = new Set();
  const plans = [];

  for (const fighter of state.fighters) {
    if (!fighter.alive) continue;
    const order = (orders[fighter.side]?.moves || []).find((item) => item.name === fighter.name);
    const to = order?.to || fighter.point;
    if (!canStep(fighter.point, to, config)) {
      fail(`${fighter.name} не может шагнуть из ${fighter.point} в ${to}`);
    }
    plans.push({ fighter, from: fighter.point, to });
    if (to === fighter.point) stayed.add(fighter.name);
  }

  const fights = {};
  const byEdge = new Map();
  for (const plan of plans) {
    if (plan.from === plan.to) continue;
    const key = edgeKey(plan.from, plan.to);
    if (!byEdge.has(key)) byEdge.set(key, []);
    byEdge.get(key).push(plan);
  }

  // Встречные шаги по одной связи — стычка на дороге, без стойки.
  for (const [key, group] of byEdge) {
    const [left, right] = key.split('|');
    const towardRight = (side) => group.filter((plan) => (
      plan.fighter.side === side && plan.from === left && plan.to === right
    ));
    const towardLeft = (side) => group.filter((plan) => (
      plan.fighter.side === side && plan.from === right && plan.to === left
    ));
    const pairs = [
      [towardRight('attack'), towardLeft('defense')],
      [towardLeft('attack'), towardRight('defense')],
    ];
    for (const [attackPlans, defensePlans] of pairs) {
      if (!attackPlans.length || !defensePlans.length) continue;
      const attackGroup = attackPlans.map((plan) => plan.fighter);
      const defenseGroup = defensePlans.map((plan) => plan.fighter);
      const fight = resolveContact(attackGroup, defenseGroup, {
        stayed: new Set(),
        owned: {},
        config,
        clash: true,
        endpoints: [left, right],
      });
      fights[`clash:${key}:${attackPlans[0].from}>${attackPlans[0].to}`] = fight;
    }
  }

  for (const plan of plans) {
    if (plan.fighter.alive) plan.fighter.point = plan.to;
  }

  const thrown = { attack: [], defense: [] };
  const cellsOf = (side) => [...new Set(
    state.fighters.filter((fighter) => fighter.alive && fighter.side === side).map((fighter) => fighter.point),
  )];

  for (const side of ['attack', 'defense']) {
    for (const item of orders[side]?.throws || []) {
      if (!config.map.cells[item.point]) fail(`Нет клетки ${item.point}`);
      if (!throwAllowed(item.point, cellsOf(side), config)) {
        fail(`${side} не докидывает до ${item.point}`);
      }
      takeStock(state.stock[side], item.type);
      thrown[side].push({ type: item.type, point: item.point });
    }
  }

  for (const cellId of config.cellOrder) {
    const attackGroup = living(state.fighters, cellId, 'attack');
    const defenseGroup = living(state.fighters, cellId, 'defense');
    const smokes = { attack: 0, defense: 0 };
    const flashes = { attack: false, defense: false };
    for (const side of ['attack', 'defense']) {
      for (const item of thrown[side]) {
        if (item.point !== cellId) continue;
        if (item.type === 'smoke') smokes[side === 'attack' ? 'defense' : 'attack'] += config.utility.smoke.penalty;
        if (item.type === 'flash') flashes[side] = true;
      }
    }
    fights[cellId] = resolveContact(attackGroup, defenseGroup, {
      cellId,
      owned: state.owned,
      stayed,
      smokes,
      flashes,
      config,
    });
  }

  const nextOwned = { ...state.owned };
  for (const cellId of config.cellOrder) {
    const here = state.fighters.filter((fighter) => fighter.alive && fighter.point === cellId);
    const sides = new Set(here.map((fighter) => fighter.side));
    const holder = here.find((fighter) => stayed.has(fighter.name));
    if (sides.size === 1 && holder) nextOwned[cellId] = holder.side;
  }
  state.owned = nextOwned;

  let planted = null;
  if (!state.bomb) {
    const open = config.cellOrder.filter((cellId) => (
      config.map.cells[cellId].plant
      && living(state.fighters, cellId, 'attack').length > 0
      && living(state.fighters, cellId, 'defense').length === 0
    ));
    open.sort((left, right) => {
      const byStrength = living(state.fighters, right, 'attack').reduce(
        (sum, fighter) => sum + weaponStrength(fighter.weapon, config),
        0,
      ) - living(state.fighters, left, 'attack').reduce(
        (sum, fighter) => sum + weaponStrength(fighter.weapon, config),
        0,
      );
      if (byStrength !== 0) return byStrength;
      if (left === config.plantTie) return -1;
      if (right === config.plantTie) return 1;
      return 0;
    });
    if (open.length) {
      planted = open[0];
      state.bomb = { point: planted, move: state.move };
    }
  }

  let defused = false;
  if (state.bomb && !state.defused) {
    const site = state.bomb.point;
    if (living(state.fighters, site, 'defense').length > 0 && living(state.fighters, site, 'attack').length === 0) {
      state.defused = true;
      defused = true;
    }
  }

  finishRound(state, config);
  return { state, fights, thrown, planted, defused, move: state.move };
}

export function playRound(attack, defense, scripts, config = CONFIG) {
  let state = createRound(attack, defense, config);
  const log = [];
  for (let index = 0; index < config.rules.movesPerRound; index += 1) {
    if (state.winner) break;
    const step = resolveMove(state, {
      attack: scripts.attack[index] || { moves: [], throws: [] },
      defense: scripts.defense[index] || { moves: [], throws: [] },
    }, config);
    log.push(step);
    state = step.state;
  }
  if (!state.winner) fail('Раунд не определил победителя');
  return { state, log };
}

export function visibleCells(fighters, side, config = CONFIG) {
  const cells = new Set();
  for (const fighter of fighters) {
    if (!fighter.alive || fighter.side !== side) continue;
    cells.add(fighter.point);
    for (const next of neighbors(fighter.point, config)) cells.add(next);
  }
  return cells;
}

export function remember(memory, step, side, config = CONFIG) {
  const next = {};
  for (const [name, info] of Object.entries(memory || {})) next[name] = { ...info };
  for (const fight of Object.values(step.fights)) {
    if (!fight.contact) continue;
    for (const person of fight.present) {
      if (person.side === side) continue;
      let seenAt = fight.point;
      if (fight.clash) {
        const self = step.state.fighters.find((fighter) => fighter.name === person.name);
        seenAt = self?.point || fight.endpoints?.[0];
      }
      if (!seenAt) continue;
      next[person.name] = { point: seenAt, move: step.move, dead: person.died };
    }
  }
  const vision = visibleCells(step.state.fighters, side, config);
  for (const fighter of step.state.fighters) {
    if (fighter.side === side) continue;
    if (!vision.has(fighter.point)) continue;
    next[fighter.name] = {
      point: fighter.point,
      move: step.move,
      dead: !fighter.alive,
    };
  }
  return next;
}

export function unfoundCount(state, memory, side, move, config = CONFIG) {
  const vision = visibleCells(state.fighters, side, config);
  return state.fighters.filter((fighter) => {
    if (fighter.side === side || !fighter.alive) return false;
    if (vision.has(fighter.point)) return false;
    if (memory[fighter.name]?.move === move) return false;
    return true;
  }).length;
}

export function shadowMarks(fighters, memory, side, move, config = CONFIG) {
  const vision = visibleCells(fighters, side, config);
  return fighters.filter((fighter) => (
    fighter.side !== side
    && fighter.alive
    && memory[fighter.name]
    && !memory[fighter.name].dead
    && memory[fighter.name].move !== move
    && !vision.has(fighter.point)
  )).map((fighter) => ({
    name: fighter.name,
    point: memory[fighter.name].point,
    move: memory[fighter.name].move,
  }));
}
