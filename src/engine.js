import { CONFIG } from './config.js';

// Чистые функции. Не обращаются к DOM и к Math.random.
// Порядок раунда: мид → переброс → ротатор → смоук → сравнение сайтов.

function fail(message) {
  throw new Error(message);
}

export function compare(left, right, config = CONFIG) {
  const delta = left - right;
  if (Math.abs(delta) <= config.rules.compareEpsilon) return 0;
  return delta > 0 ? 1 : -1;
}

export function weaponStrength(weaponId, pointId, config = CONFIG) {
  const weapon = config.weapons[weaponId];
  const point = config.points[pointId];
  if (!weapon) fail(`Неизвестное оружие: ${weaponId}`);
  if (!point) fail(`Неизвестная точка: ${pointId}`);
  if (weapon.longStrength != null) {
    return point.long ? weapon.longStrength : weapon.shortStrength;
  }
  return weapon.strength;
}

export function loadoutCost(fighters, utility, config = CONFIG) {
  let cost = 0;
  for (const fighter of fighters) {
    cost += config.weapons[fighter.weapon].cost;
  }
  for (const item of utility || []) {
    cost += config.utility[item.type].cost;
  }
  return cost;
}

export function roundReward(won, lossStreak, config = CONFIG) {
  if (won) {
    return { reward: config.economy.winReward, lossStreak: 0 };
  }
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
        lossStreak: attackPay.lossStreak,
      },
      defense: {
        before: snapshot.wallets.defense,
        spent: spent.defense,
        reward: defensePay.reward,
        after: wallets.defense,
        lossStreak: defensePay.lossStreak,
      },
    },
  };
}

function siteIds(config) {
  return config.pointOrder.filter((id) => config.points[id].isSite);
}

function midId(config) {
  const id = config.pointOrder.find((pointId) => !config.points[pointId].isSite);
  if (!id) fail('В pointOrder нет точки мида');
  return id;
}

function cloneFighters(list) {
  return list.map((fighter) => ({
    name: fighter.name,
    weapon: fighter.weapon,
    point: fighter.point,
    rotator: Boolean(fighter.rotator),
  }));
}

function validateFighters(fighters, expected, side, config) {
  if (!Array.isArray(fighters) || fighters.length !== expected) {
    fail(`${side}: ожидалось ${expected} бойцов, пришло ${fighters ? fighters.length : 0}`);
  }
  const rotators = fighters.filter((fighter) => fighter.rotator);
  const expectedRotators = side === 'defense' ? config.rules.defenseRotators : 0;
  if (rotators.length !== expectedRotators) {
    fail(`${side}: ротаторов ${rotators.length}, нужно ${expectedRotators}`);
  }
  for (const fighter of fighters) {
    if (!fighter.name) fail(`${side}: боец без имени`);
    if (!config.weapons[fighter.weapon]) fail(`${side}: неизвестное оружие ${fighter.weapon}`);
    if (fighter.rotator) continue;
    if (!config.points[fighter.point]) fail(`${side}: ${fighter.name} стоит не на точке`);
  }
}

function validateUtility(utility, config) {
  const items = utility || [];
  if (items.length > config.rules.maxUtility) {
    fail(`Утилиты: ${items.length}, максимум ${config.rules.maxUtility}`);
  }
  for (const item of items) {
    if (!config.utility[item.type]) fail(`Неизвестная утилита: ${item.type}`);
    if (!config.points[item.point]) fail(`Утилита на неизвестной точке: ${item.point}`);
  }
}

function validateAttackTransfer(pointId, config) {
  const point = config.points[pointId];
  if (!point || !point.isSite) fail('Переброс атаки должен вести на сайт');
}

function smokeCount(utility, pointId) {
  return (utility || []).filter((item) => item.type === 'smoke' && item.point === pointId).length;
}

function hasFlash(utility, pointId) {
  return (utility || []).some((item) => item.type === 'flash' && item.point === pointId);
}

function describe(fighters, pointId, config, wantRotator) {
  return fighters
    .filter((fighter) => fighter.point === pointId && Boolean(fighter.rotator) === wantRotator)
    .map((fighter) => ({
      name: fighter.name,
      weapon: fighter.weapon,
      rotator: Boolean(fighter.rotator),
      strength: weaponStrength(fighter.weapon, pointId, config),
    }));
}

function evaluatePoint(pointId, attack, defense, utility, config) {
  const point = config.points[pointId];
  const attackers = describe(attack, pointId, config, false);
  const placed = describe(defense, pointId, config, false);
  const rotators = describe(defense, pointId, config, true);
  const attackStrength = attackers.reduce((sum, fighter) => sum + fighter.strength, 0);
  const defenseRaw = placed.reduce((sum, fighter) => sum + fighter.strength, 0);
  const multiplier = point.isSite ? config.rules.defenderSiteMultiplier : 1;
  const defenseMultiplied = defenseRaw * multiplier;
  const rotatorStrength = rotators.reduce(
    (sum, fighter) => sum + fighter.strength * config.rules.rotatorMultiplier * multiplier,
    0,
  );
  const defenseBeforeUtility = defenseMultiplied + rotatorStrength;
  const smokes = smokeCount(utility, pointId);
  const smokePenalty = smokes * config.utility.smoke.defensePenalty;
  const defenseFinal = Math.max(0, defenseBeforeUtility - smokePenalty);
  return {
    point: pointId,
    attackStrength,
    attackCount: attackers.length,
    attackers,
    defenseCount: placed.length + rotators.length,
    defenders: placed.concat(rotators),
    defenseRaw,
    defenseMultiplied,
    rotatorStrength,
    defenseBeforeUtility,
    smokePenalty,
    defenseFinal,
    flash: hasFlash(utility, pointId),
  };
}

function controlOfMid(snapshot, config) {
  if (snapshot.attackCount <= 0 && snapshot.defenseCount <= 0) return 'none';
  if (snapshot.attackCount <= 0) return 'defense';
  if (snapshot.defenseCount <= 0) return 'attack';
  const diff = compare(snapshot.attackStrength, snapshot.defenseFinal, config);
  if (diff > 0) return 'attack';
  if (diff < 0) return 'defense';
  if (snapshot.flash) return 'attack';
  return config.rules.tieWinner;
}

function siteTaken(snapshot, config) {
  if (snapshot.attackCount <= 0) return false;
  const diff = compare(snapshot.attackStrength, snapshot.defenseFinal, config);
  if (diff > 0) return true;
  if (diff < 0) return false;
  return snapshot.flash;
}

function siteStats(fighters, pointId, config) {
  const group = fighters.filter((fighter) => !fighter.rotator && fighter.point === pointId);
  const strength = group.reduce(
    (sum, fighter) => sum + weaponStrength(fighter.weapon, pointId, config),
    0,
  );
  return { strength, count: group.length };
}

function heavierAttackSite(fighters, config) {
  const stats = siteIds(config).map((id) => ({ id, ...siteStats(fighters, id, config) }));
  if (stats.every((site) => site.count === 0)) return null;
  const ranked = [...stats].sort((left, right) => {
    const byStrength = compare(right.strength, left.strength, config);
    if (byStrength !== 0) return byStrength;
    return compare(right.count, left.count, config);
  });
  const top = ranked[0];
  const tied = ranked.filter(
    (site) => compare(site.strength, top.strength, config) === 0 && site.count === top.count,
  );
  if (tied.length > 1) return config.rules.rotatorTieSite;
  return top.id;
}

function moveOne(fighters, from, to, config, side) {
  let bestIndex = -1;
  let bestStrength = null;
  fighters.forEach((fighter, index) => {
    if (fighter.rotator || fighter.point !== from) return;
    const strength = weaponStrength(fighter.weapon, from, config);
    if (bestIndex < 0 || compare(strength, bestStrength, config) > 0) {
      bestIndex = index;
      bestStrength = strength;
    }
  });
  if (bestIndex < 0) return null;
  const fighter = fighters[bestIndex];
  const strengthBefore = weaponStrength(fighter.weapon, from, config);
  fighter.point = to;
  return {
    side,
    name: fighter.name,
    weapon: fighter.weapon,
    from,
    to,
    strengthBefore,
    strengthAfter: weaponStrength(fighter.weapon, to, config),
  };
}

function moveFighters(fighters, from, to, count, config, side) {
  const moved = [];
  for (let index = 0; index < count; index += 1) {
    const one = moveOne(fighters, from, to, config, side);
    if (!one) break;
    moved.push(one);
  }
  return moved;
}

function fragCount(diff, enemyCount, config) {
  if (enemyCount <= 0 || diff <= 0) return 0;
  const raw = Math.ceil(diff / config.rules.killfeedDivisor);
  return Math.min(enemyCount, raw);
}

function withFrags(snapshot, control, config) {
  const frags = [];
  if (control === 'attack' || control === 'defense') {
    const attackWon = control === 'attack';
    const diff = attackWon
      ? snapshot.attackStrength - snapshot.defenseFinal
      : snapshot.defenseFinal - snapshot.attackStrength;
    const friends = attackWon ? snapshot.attackers : snapshot.defenders;
    const enemies = attackWon ? snapshot.defenders : snapshot.attackers;
    const count = fragCount(diff, enemies.length, config);
    for (let index = 0; index < count && friends.length > 0; index += 1) {
      const killer = friends[index % friends.length];
      const victim = enemies[index % enemies.length];
      frags.push({
        point: snapshot.point,
        killer: killer.name,
        killerSide: control,
        victim: victim.name,
        victimSide: attackWon ? 'defense' : 'attack',
        weapon: killer.weapon,
      });
    }
  }
  return { ...snapshot, control, frags };
}

function rotatorInfo(defense, pointId, config) {
  const rotator = defense.find((fighter) => fighter.rotator);
  if (!rotator) return null;
  if (!pointId) {
    return { name: rotator.name, weapon: rotator.weapon, point: null, strength: 0 };
  }
  const point = config.points[pointId];
  const multiplier = point.isSite ? config.rules.defenderSiteMultiplier : 1;
  const strength = weaponStrength(rotator.weapon, pointId, config)
    * config.rules.rotatorMultiplier
    * multiplier;
  return { name: rotator.name, weapon: rotator.weapon, point: pointId, strength };
}

function withoutSmoke(utility) {
  return utility.filter((item) => item.type !== 'smoke');
}

function packPoint(snapshot, control) {
  return {
    attackStrength: snapshot.attackStrength,
    defenseBeforeUtility: snapshot.defenseBeforeUtility,
    defenseFinal: snapshot.defenseFinal,
    smokePenalty: snapshot.smokePenalty,
    flash: snapshot.flash,
    control: control ?? null,
  };
}

function packBoard(attack, defense, utility, config, controls) {
  const points = {};
  for (const id of config.pointOrder) {
    points[id] = packPoint(evaluatePoint(id, attack, defense, utility, config), controls[id]);
  }
  return points;
}

function packFighters(attack, defense, deadNames) {
  const rows = [];
  for (const fighter of attack) {
    rows.push({
      name: fighter.name,
      side: 'attack',
      weapon: fighter.weapon,
      point: fighter.point,
      rotator: false,
      alive: !deadNames.has(fighter.name),
    });
  }
  for (const fighter of defense) {
    rows.push({
      name: fighter.name,
      side: 'defense',
      weapon: fighter.weapon,
      point: fighter.point,
      rotator: Boolean(fighter.rotator),
      alive: !deadNames.has(fighter.name),
    });
  }
  return rows;
}

function grenadeMarks(utility) {
  return {
    smokes: utility.filter((item) => item.type === 'smoke').map((item) => item.point),
    flashes: utility.filter((item) => item.type === 'flash').map((item) => item.point),
  };
}

function buildStages({
  atStart,
  atTransfer,
  atEnd,
  mid,
  midPoint,
  points,
  transfers,
  utility,
  rotator,
  config,
}) {
  const marks = grenadeMarks(utility);
  const bare = withoutSmoke(utility);
  const noControl = {};
  const revealPoints = packBoard(atStart.attack, atStart.defense, bare, config, noControl);
  const midControls = { ...noControl, [mid]: midPoint.control };
  const midPoints = packBoard(atStart.attack, atStart.defense, bare, config, midControls);
  midPoints[mid] = packPoint(midPoint, midPoint.control);

  const transferPoints = packBoard(atTransfer.attack, atTransfer.defense, bare, config, midControls);
  const rotatorControls = { ...midControls };
  const rotatorPoints = packBoard(atEnd.attack, atEnd.defense, bare, config, rotatorControls);

  const finalControls = { ...midControls };
  for (const id of siteIds(config)) {
    finalControls[id] = points[id].control;
  }
  const smoked = packBoard(atEnd.attack, atEnd.defense, utility, config, {});
  function withControls(controls) {
    const next = {};
    for (const id of config.pointOrder) {
      next[id] = { ...smoked[id], control: controls[id] ?? null };
    }
    return next;
  }

  const midDead = new Set(midPoint.frags.map((frag) => frag.victim));
  const dead = new Set(midDead);

  const stages = [
    {
      id: 'reveal',
      focus: null,
      fighters: packFighters(atStart.attack, atStart.defense, new Set()),
      points: revealPoints,
      frags: [],
      transfer: null,
      rotator,
      ...marks,
    },
    {
      id: 'mid',
      focus: mid,
      fighters: packFighters(atStart.attack, atStart.defense, midDead),
      points: midPoints,
      frags: midPoint.frags,
      transfer: null,
      rotator,
      ...marks,
    },
    {
      id: 'transfer',
      focus: transfers[0] ? transfers[0].to : mid,
      fighters: packFighters(atTransfer.attack, atTransfer.defense, midDead),
      points: transferPoints,
      frags: [],
      transfer: transfers[0] || null,
      rotator,
      ...marks,
    },
    {
      id: 'rotator',
      focus: rotator.point,
      fighters: packFighters(atEnd.attack, atEnd.defense, midDead),
      points: rotatorPoints,
      frags: [],
      transfer: transfers[0] || null,
      rotator,
      ...marks,
    },
    {
      id: 'utility',
      focus: marks.smokes[0] || marks.flashes[0] || null,
      fighters: packFighters(atEnd.attack, atEnd.defense, midDead),
      points: withControls(midControls),
      frags: [],
      transfer: transfers[0] || null,
      rotator,
      ...marks,
    },
  ];

  const revealedSites = [];
  for (const id of siteIds(config)) {
    for (const frag of points[id].frags) dead.add(frag.victim);
    revealedSites.push(id);
    const controls = { ...midControls };
    for (const pointId of revealedSites) controls[pointId] = points[pointId].control;
    const stagePoints = withControls(controls);
    stages.push({
      id: `site${id}`,
      focus: id,
      fighters: packFighters(atEnd.attack, atEnd.defense, dead),
      points: stagePoints,
      frags: points[id].frags,
      transfer: transfers[0] || null,
      rotator,
      ...marks,
    });
  }

  stages.push({
    id: 'result',
    focus: null,
    fighters: packFighters(atEnd.attack, atEnd.defense, dead),
    points: withControls(finalControls),
    frags: [],
    transfer: transfers[0] || null,
    rotator,
    ...marks,
  });

  return stages;
}

export function resolveRound(input, config = CONFIG) {
  const attack = cloneFighters(input.attack.fighters);
  const defense = cloneFighters(input.defense.fighters);
  const utility = (input.attack.utility || []).map((item) => ({ ...item }));
  const headcount = config.rules.defensePlaced + config.rules.defenseRotators;

  validateFighters(attack, config.rules.attackFighters, 'attack', config);
  validateFighters(defense, headcount, 'defense', config);
  validateUtility(utility, config);
  validateAttackTransfer(input.attack.midTransfer, config);
  if (input.defense.utility && input.defense.utility.length) {
    fail('Бот тестовой сборки не покупает утилиту');
  }

  const mid = midId(config);
  const atStart = {
    attack: cloneFighters(attack),
    defense: cloneFighters(defense),
  };
  const midRaw = evaluatePoint(mid, attack, defense, utility, config);
  const midControl = controlOfMid(midRaw, config);
  const midPoint = withFrags(midRaw, midControl, config);

  let transfers = [];
  if (midControl === 'attack') {
    transfers = moveFighters(
      attack,
      mid,
      input.attack.midTransfer,
      config.rules.midTransferFighters,
      config,
      'attack',
    );
  } else if (midControl === 'defense') {
    const destination = heavierAttackSite(attack, config) || config.rules.rotatorTieSite;
    transfers = moveFighters(
      defense,
      mid,
      destination,
      config.rules.midTransferFighters,
      config,
      'defense',
    );
  }
  const atTransfer = {
    attack: cloneFighters(attack),
    defense: cloneFighters(defense),
  };

  const rotatorPoint = heavierAttackSite(attack, config);
  const rotator = defense.find((fighter) => fighter.rotator);
  if (rotator && rotatorPoint) rotator.point = rotatorPoint;
  const atEnd = {
    attack: cloneFighters(attack),
    defense: cloneFighters(defense),
  };

  const points = { [mid]: midPoint };
  const takenSites = [];
  for (const id of siteIds(config)) {
    const snapshot = evaluatePoint(id, attack, defense, utility, config);
    const taken = siteTaken(snapshot, config);
    points[id] = withFrags(snapshot, taken ? 'attack' : 'defense', config);
    if (taken) takenSites.push(id);
  }

  const killfeed = config.pointOrder.flatMap((id) => points[id].frags);
  const rotatorState = rotatorInfo(defense, rotatorPoint, config);
  return {
    winner: takenSites.length ? 'attack' : 'defense',
    takenSites,
    midPoint: mid,
    points,
    transfers,
    rotator: rotatorState,
    killfeed,
    stages: buildStages({
      atStart,
      atTransfer,
      atEnd,
      mid,
      midPoint,
      points,
      transfers,
      utility,
      rotator: rotatorState,
      config,
    }),
  };
}
