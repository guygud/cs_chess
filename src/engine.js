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

function sidePower(group, cellId, side, owned, penalty, config) {
  const raw = group.reduce((sum, fighter) => sum + weaponStrength(fighter.weapon, config), 0);
  const multiplied = owned[cellId] === side ? raw * config.rules.holdMultiplier : raw;
  return Math.max(0, multiplied - penalty);
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

  for (const fighter of state.fighters) {
    if (!fighter.alive) continue;
    const order = (orders[fighter.side]?.moves || []).find((item) => item.name === fighter.name);
    const to = order?.to || fighter.point;
    if (!canStep(fighter.point, to, config)) {
      fail(`${fighter.name} не может шагнуть из ${fighter.point} в ${to}`);
    }
    if (to === fighter.point) stayed.add(fighter.name);
    fighter.point = to;
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

  const fights = {};
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
    const attackFinal = sidePower(attackGroup, cellId, 'attack', state.owned, smokes.attack, config);
    const defenseFinal = sidePower(defenseGroup, cellId, 'defense', state.owned, smokes.defense, config);
    const present = [...attackGroup, ...defenseGroup].map((fighter) => ({
      name: fighter.name,
      side: fighter.side,
      weapon: fighter.weapon,
      died: false,
      saved: false,
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
      if (diff === 0 && flashes.attack !== flashes.defense) {
        const winner = flashes.attack ? 'attack' : 'defense';
        mark(winner === 'attack' ? defenseGroup : attackGroup, 'all');
        outcome = winner;
      } else if (diff === 0) {
        killOne(attackGroup);
        killOne(defenseGroup);
        outcome = state.owned[cellId] || 'defense';
      } else {
        const winner = diff > 0 ? 'attack' : 'defense';
        const losers = winner === 'attack' ? defenseGroup : attackGroup;
        const winners = winner === 'attack' ? attackGroup : defenseGroup;
        mark(losers, 'all');
        const flash = winner === 'attack' ? flashes.attack : flashes.defense;
        if (!flash) killOne(winners);
        outcome = winner;
      }
    }
    fights[cellId] = {
      point: cellId,
      contact,
      attackFinal,
      defenseFinal,
      attackCount: attackGroup.length,
      defenseCount: defenseGroup.length,
      outcome,
      present,
      smoke: smokes,
      flash: flashes,
      owned: state.owned[cellId] || null,
    };
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

export function remember(memory, step, side) {
  const next = {};
  for (const [name, info] of Object.entries(memory || {})) next[name] = { ...info };
  for (const fight of Object.values(step.fights)) {
    if (!fight.contact) continue;
    for (const person of fight.present) {
      if (person.side === side) continue;
      next[person.name] = { point: fight.point, move: step.move, dead: person.died };
    }
  }
  return next;
}

export function unfoundCount(state, memory, side, move) {
  return state.fighters.filter((fighter) => (
    fighter.side !== side && fighter.alive && memory[fighter.name]?.move !== move
  )).length;
}

export function shadowMarks(fighters, memory, side, move) {
  return fighters.filter((fighter) => (
    fighter.side !== side
    && fighter.alive
    && memory[fighter.name]
    && !memory[fighter.name].dead
    && memory[fighter.name].move !== move
  )).map((fighter) => ({
    name: fighter.name,
    point: memory[fighter.name].point,
    move: memory[fighter.name].move,
  }));
}
