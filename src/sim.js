import { CONFIG } from './config.js';
import {
  applyRoundEconomy,
  loadoutCost,
  matchStatus,
  resolveRound,
  roundReward,
  weaponStrength,
} from './engine.js';
import { pickWeighted, planDefense } from './bot.js';

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, message) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  expect(threw, message);
}

function fighter(name, point, weapon = 'pistol', rotator = false) {
  return { name, weapon, point, rotator };
}

function named(prefix, count, point, weapon = 'pistol') {
  return Array.from({ length: count }, (_, index) => fighter(`${prefix}${index + 1}`, point, weapon));
}

function defenseGroup({ a = 0, mid = 0, b = 0, weapon = 'pistol', rotatorWeapon = weapon }) {
  return named('a', a, 'A', weapon)
    .concat(named('m', mid, 'MID', weapon))
    .concat(named('b', b, 'B', weapon))
    .concat([fighter('rotate', null, rotatorWeapon, true)]);
}

function attackGroup(spec) {
  return spec.flatMap((entry) => named(entry.point.toLowerCase(), entry.count, entry.point, entry.weapon || 'pistol'));
}

function play(attack, defense, utility = [], midTransfer = 'A') {
  return resolveRound({
    attack: {
      fighters: attack,
      utility,
      midTransfer,
    },
    defense: {
      fighters: defense,
      utility: [],
    },
  });
}

function formulaDefense(placedStrengths, rotatorStrength, isSite, smokes) {
  const multiplier = isSite ? CONFIG.rules.defenderSiteMultiplier : 1;
  const raw = placedStrengths.reduce((sum, value) => sum + value, 0) * multiplier;
  const rotator = rotatorStrength * CONFIG.rules.rotatorMultiplier * multiplier;
  const penalty = smokes * CONFIG.utility.smoke.defensePenalty;
  return Math.max(0, raw + rotator - penalty);
}

function selfCheck() {
  const pistol = CONFIG.weapons.pistol.strength;
  const rifle = CONFIG.weapons.rifle.strength;

  expect(weaponStrength('awp', 'A') === CONFIG.weapons.awp.longStrength, 'AWP на A длинный');
  expect(weaponStrength('awp', 'MID') === CONFIG.weapons.awp.longStrength, 'AWP на миде длинный');
  expect(weaponStrength('awp', 'B') === CONFIG.weapons.awp.shortStrength, 'AWP на B короткий');
  expect(weaponStrength('rifle', 'B') === rifle, 'Винтовка не зависит от линии');
  expect(weaponStrength('pistol', 'A') === pistol, 'Пистолет не зависит от линии');

  const ignored = play(
    named('t', CONFIG.rules.attackFighters, 'A'),
    defenseGroup({ a: 2, mid: 1, b: 1 }),
  );
  expect(ignored.points.MID.control === 'defense', 'Пустой мид достаётся защите, если у неё там есть бойцы');
  expect(ignored.points.MID.defenseMultiplied === pistol, 'На миде нет множителя сайта');
  expect(ignored.transfers.length === 1 && ignored.transfers[0].side === 'defense', 'Защита забирает переброс с мида');
  expect(ignored.transfers[0].to === 'A', 'Защита переносит туда, где атаки больше');
  expect(ignored.winner === 'defense', 'Игнор мида отдаёт раунд защите на пистолетах');
  expect(
    ignored.points.A.defenseFinal === formulaDefense([pistol, pistol, pistol], pistol, true, 0),
    'Сила сайта после переброса и ротатора совпадает с формулой',
  );

  const contested = play(
    named('a', 3, 'A').concat(named('m', 2, 'MID')),
    defenseGroup({ a: 2, mid: 1, b: 1 }),
    [],
    'A',
  );
  expect(contested.points.MID.control === 'attack', 'Двое на миде забирают мид у одного');
  expect(contested.transfers[0].side === 'attack' && contested.transfers[0].to === 'A', 'Атака переносит на заранее выбранный сайт');
  expect(contested.points.A.attackCount === 4, 'Перенос добавляет бойца на сайт');
  expect(contested.takenSites.includes('A'), 'Контроль мида помогает взять A');
  expect(contested.winner === 'attack', 'Спорный мид выигрывает пистолетный раунд');

  const emptyMid = play(
    named('t', CONFIG.rules.attackFighters, 'A'),
    defenseGroup({ a: 4, mid: 0, b: 0 }),
  );
  expect(emptyMid.points.MID.control === 'none', 'Пустой мид никому не достаётся');
  expect(emptyMid.transfers.length === 0, 'Без победителя мида переброса нет');

  const awpMove = play(
    [fighter('awper', 'MID', 'awp')].concat(named('t', 4, 'A')),
    defenseGroup({ a: 0, mid: 0, b: 4 }),
    [],
    'B',
  );
  expect(awpMove.transfers[0].strengthBefore === CONFIG.weapons.awp.longStrength, 'AWP на миде считается длинным');
  expect(awpMove.transfers[0].strengthAfter === CONFIG.weapons.awp.shortStrength, 'AWP после переноса на B слабеет');
  expect(awpMove.points.B.attackStrength === CONFIG.weapons.awp.shortStrength, 'На B остаётся короткая сила AWP');

  const smoked = play(
    named('a', 2, 'A').concat(named('b', 3, 'B', 'rifle')),
    defenseGroup({ a: 2, mid: 0, b: 2 }),
    [{ type: 'smoke', point: 'A' }],
  );
  expect(smoked.rotator.point === 'B', 'Ротатор идёт на сайт, где атака сильнее');
  expect(
    smoked.points.A.defenseFinal === formulaDefense([pistol, pistol], 0, true, 1),
    'Смоук снимает силу защиты по формуле',
  );
  expect(smoked.points.A.control === 'attack', 'Смоук открывает сайт');

  const clamped = play(
    [fighter('lone', 'A')].concat(named('b', 4, 'B', 'rifle')),
    defenseGroup({ a: 1, mid: 0, b: 3 }),
    [{ type: 'smoke', point: 'A' }, { type: 'smoke', point: 'A' }],
  );
  expect(clamped.points.A.defenseFinal === 0, 'Смоук не уводит защиту ниже нуля');
  expect(clamped.points.A.control === 'attack', 'Нулевая защита отдаёт сайт');

  const flashedEmpty = play(
    named('t', CONFIG.rules.attackFighters, 'A', 'rifle'),
    defenseGroup({ a: 4 }),
    [{ type: 'flash', point: 'B' }],
  );
  expect(flashedEmpty.points.B.control === 'defense', 'Флеш на пустой точке сайт не берёт');
  expect(flashedEmpty.points.B.attackCount === 0, 'На пустой точке нет атакующих');

  const original = named('t', CONFIG.rules.attackFighters, 'A');
  const originalPoint = original[0].point;
  play(original, defenseGroup({ a: 2, mid: 1, b: 1 }));
  expect(original[0].point === originalPoint, 'Резолв не меняет исходную расстановку');

  const heavy = play(
    named('t', CONFIG.rules.attackFighters, 'B', 'rifle'),
    defenseGroup({ a: 3, mid: 0, b: 1 }),
  );
  const enemyOnB = heavy.points.B.defenseCount;
  expect(heavy.points.B.frags.length <= enemyOnB, 'Фрагов не больше, чем бойцов противника');
  expect(heavy.points.B.frags.length === enemyOnB, 'Большой разрыв упирается в число защитников');

  const pistolTarget = 2 * pistol * CONFIG.rules.defenderSiteMultiplier;
  const attackPieces = pistolTarget / pistol;
  const leftover = CONFIG.rules.attackFighters - attackPieces;
  const leftoverStrength = leftover * rifle;
  if (Number.isInteger(attackPieces) && leftover > 0 && leftoverStrength > pistolTarget) {
    const tieAttack = named('b', attackPieces, 'B').concat(named('a', leftover, 'A', 'rifle'));
    const tieDefense = defenseGroup({ a: 2, mid: 0, b: 2 });
    const held = play(tieAttack, tieDefense);
    const taken = play(tieAttack, tieDefense, [{ type: 'flash', point: 'B' }]);
    expect(compareTie(held.points.B), 'Без флеша ничья на сайте остаётся у защиты');
    expect(held.points.B.control === 'defense', 'Ничья без флеша не берёт сайт');
    expect(taken.points.B.control === 'attack', 'Флеш отдаёт ничью атаке');
    expect(held.points.B.attackStrength === held.points.B.defenseFinal, 'Сценарий ничьи действительно равный');
  }

  expect(roundReward(false, 0).reward === CONFIG.economy.lossBase, 'Первое поражение платит базу');
  expect(roundReward(false, 0).lossStreak === 1, 'Поражение увеличивает серию');
  expect(
    roundReward(false, 1).reward === CONFIG.economy.lossBase + CONFIG.economy.lossStreakStep,
    'Второе поражение добавляет один шаг',
  );
  const capped = CONFIG.economy.lossBase
    + CONFIG.economy.lossStreakStep * CONFIG.economy.maxLossStreakSteps;
  expect(roundReward(false, CONFIG.economy.maxLossStreakSteps).reward === capped, 'Серия упирается в потолок');
  expect(roundReward(false, CONFIG.economy.maxLossStreakSteps + 1).reward === capped, 'Дальше потолок не растёт');
  expect(roundReward(true, 4).reward === CONFIG.economy.winReward, 'Победа платит фикс');
  expect(roundReward(true, 4).lossStreak === 0, 'Победа обнуляет серию');

  const snapshot = {
    wallets: { attack: CONFIG.economy.startMoney, defense: CONFIG.economy.startMoney },
    lossStreak: { attack: 0, defense: 0 },
    score: { attack: 0, defense: 0 },
  };
  const applied = applyRoundEconomy(
    snapshot,
    { winner: 'defense' },
    { attack: 0, defense: 0 },
  );
  expect(snapshot.wallets.attack === CONFIG.economy.startMoney, 'Экономика не мутирует снимок');
  expect(applied.wallets.attack === CONFIG.economy.startMoney + CONFIG.economy.lossBase, 'Проигравший получает лузбонус');
  expect(applied.wallets.defense === CONFIG.economy.startMoney + CONFIG.economy.winReward, 'Победитель получает награду');
  expect(applied.score.defense === 1 && applied.score.attack === 0, 'Очко уходит победителю раунда');

  expect(matchStatus({ attack: CONFIG.rules.winsNeeded, defense: 1 }, 4) === 'attack', 'Матч кончается на лимите побед');
  expect(matchStatus({ attack: 2, defense: CONFIG.rules.winsNeeded }, CONFIG.rules.maxRounds) === 'defense', 'Защита закрывает матч по победам');
  expect(matchStatus({ attack: 2, defense: 2 }, CONFIG.rules.maxRounds) === 'draw', 'Без лимита побед после последнего раунда ничья');
  expect(matchStatus({ attack: 2, defense: 1 }, CONFIG.rules.maxRounds - 1) === null, 'До лимитов матч продолжается');

  const poor = planDefense(CONFIG.economy.startMoney, CONFIG, () => 0);
  expect(poor.weapon === 'pistol' && poor.cost === 0, 'На стартовых деньгах бот на пистолетах');
  expect(poor.templateId === CONFIG.defenseTemplates[0].id, 'Нулевой бросок берёт первый шаблон');
  expect(poor.fighters.filter((item) => item.rotator).length === 1, 'У бота один ротатор');
  expect(poor.fighters.filter((item) => !item.rotator).length === CONFIG.rules.defensePlaced, 'Остальные стоят на точках');
  expect(poor.fighters.at(-1).rotator, 'Ротатор последний в списке');

  const headcount = CONFIG.rules.defensePlaced + CONFIG.rules.defenseRotators;
  const full = CONFIG.weapons.rifle.cost * headcount;
  expect(planDefense(full, CONFIG, () => 0).weapon === 'rifle', 'Полной суммы хватает на винтовки');
  expect(planDefense(full - 1, CONFIG, () => 0).weapon === 'pistol', 'Почти полной суммы на винтовки не хватает');
  expect(planDefense(full, CONFIG, () => 0).fighters.every((item) => item.weapon !== 'awp'), 'Бот не покупает AWP');

  const staged = play(
    named('t', CONFIG.rules.attackFighters, 'A'),
    defenseGroup({ a: 2, mid: 1, b: 1 }),
    [{ type: 'smoke', point: 'A' }],
  );
  const stageIds = staged.stages.map((stage) => stage.id);
  expect(
    stageIds.join(',') === 'reveal,mid,transfer,rotator,utility,siteA,siteB,result',
    `Порядок стадий: ${stageIds.join(',')}`,
  );
  const last = staged.stages.at(-1);
  const midStage = staged.stages.find((stage) => stage.id === 'mid');
  const midNames = midStage.fighters
    .filter((fighter) => fighter.point === 'MID')
    .map((fighter) => fighter.name)
    .sort()
    .join('|');
  const midResultNames = staged.points.MID.attackers
    .concat(staged.points.MID.defenders)
    .map((fighter) => fighter.name)
    .sort()
    .join('|');
  expect(midNames === midResultNames, 'Состав мида на стадии боя совпадает');
  expect(
    midStage.points.MID.attackStrength === staged.points.MID.attackStrength
      && midStage.points.MID.defenseFinal === staged.points.MID.defenseFinal,
    'Числа мида на стадии боя совпадают',
  );
  for (const id of ['A', 'B']) {
    expect(
      last.points[id].attackStrength === staged.points[id].attackStrength
        && last.points[id].defenseFinal === staged.points[id].defenseFinal,
      `Финал стадии совпадает с точкой ${id}`,
    );
    const stageNames = last.fighters
      .filter((fighter) => fighter.point === id)
      .map((fighter) => fighter.name)
      .sort()
      .join('|');
    const resultNames = staged.points[id].attackers
      .concat(staged.points[id].defenders)
      .map((fighter) => fighter.name)
      .sort()
      .join('|');
    expect(stageNames === resultNames, `Состав на ${id} совпадает`);
  }
  const stageFragKey = staged.stages
    .flatMap((stage) => stage.frags)
    .map((frag) => `${frag.point}:${frag.killer}:${frag.victim}`)
    .sort()
    .join(',');
  const killfeedKey = staged.killfeed
    .map((frag) => `${frag.point}:${frag.killer}:${frag.victim}`)
    .sort()
    .join(',');
  expect(stageFragKey === killfeedKey, 'Фраги стадий совпадают с килл-фидом');
  const beforeSmoke = staged.stages.find((stage) => stage.id === 'rotator').points.A.defenseFinal;
  const afterSmoke = staged.stages.find((stage) => stage.id === 'utility').points.A.defenseFinal;
  expect(
    afterSmoke === Math.max(0, beforeSmoke - CONFIG.utility.smoke.defensePenalty),
    'Смоук на стадии утилиты снижает защиту сайта',
  );

  expectThrow(
    () => play(
      named('t', CONFIG.rules.attackFighters, 'A'),
      defenseGroup({ a: 4 }),
      [
        { type: 'smoke', point: 'A' },
        { type: 'smoke', point: 'A' },
        { type: 'flash', point: 'B' },
      ],
    ),
    'Лишняя утилита отклоняется',
  );
}

function compareTie(point) {
  return point.attackStrength === point.defenseFinal;
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

function planSimAttack(wallet, config, rng) {
  const roster = config.rosters.attack;
  const count = config.rules.attackFighters;
  if (roster.length !== count) {
    throw new Error(`Ростер атаки: ожидалось ${count} имён, есть ${roster.length}`);
  }
  const weapon = wallet >= config.weapons.rifle.cost * count ? 'rifle' : 'pistol';
  const template = pickWeighted(config.sim.attackTemplates, rng);
  const sum = config.pointOrder.reduce((total, id) => total + template.points[id], 0);
  if (sum !== count) throw new Error(`Шаблон атаки ${template.id} ставит ${sum}, нужно ${count}`);

  const fighters = [];
  let index = 0;
  for (const pointId of config.pointOrder) {
    for (let placed = 0; placed < template.points[pointId]; placed += 1) {
      fighters.push({
        name: roster[index],
        weapon,
        point: pointId,
        rotator: false,
      });
      index += 1;
    }
  }
  const midTransfer = rng() < config.sim.midTransferToB ? 'B' : 'A';
  const utility = [];
  return {
    fighters,
    utility,
    midTransfer,
    cost: loadoutCost(fighters, utility, config),
    templateId: template.id,
    weapon,
  };
}

function playMatch(config, rng, log) {
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
    const defense = planDefense(wallets.defense, config, rng);
    const attack = planSimAttack(wallets.attack, config, rng);
    const result = resolveRound({ attack, defense }, config);
    const applied = applyRoundEconomy(
      { wallets, lossStreak, score },
      result,
      { attack: attack.cost, defense: defense.cost },
      config,
    );
    wallets = applied.wallets;
    lossStreak = applied.lossStreak;
    score = applied.score;
    if (result.winner === 'attack') attackRounds += 1;
    if (log) {
      log.push(`р${round} ${attack.templateId} vs ${defense.templateId} → ${result.winner} [${result.takenSites.join(',') || '—'}]`);
    }
    if (matchStatus(score, round, config)) break;
  }

  return {
    winner: matchStatus(score, rounds, config),
    rounds,
    attackRounds,
    score,
  };
}

function percent(part, total) {
  if (!total) return '0%';
  const value = (part / total) * 100;
  return `${value.toFixed(1).replace('.', ',')}%`;
}

function main() {
  selfCheck();
  console.log('Проверки правил: ок');

  const matches = Number(process.argv[2] ?? CONFIG.sim.matches);
  const seed = Number(process.argv[3] ?? CONFIG.sim.seed);
  if (!Number.isInteger(matches) || matches < 0) {
    throw new Error('Число партий должно быть целым и неотрицательным');
  }
  if (matches === 0) return;

  const rng = mulberry32(seed);
  const totals = { attack: 0, defense: 0, draw: 0, rounds: 0, attackRounds: 0 };
  const lengths = {};
  const sample = [];

  for (let index = 0; index < matches; index += 1) {
    const log = matches <= 3 ? [] : null;
    const match = playMatch(CONFIG, rng, log);
    totals[match.winner] += 1;
    totals.rounds += match.rounds;
    totals.attackRounds += match.attackRounds;
    lengths[match.rounds] = (lengths[match.rounds] || 0) + 1;
    if (log) sample.push(log);
  }

  console.log(`Партий: ${matches}, зерно ${seed}`);
  console.log(`Победы атаки: ${totals.attack} (${percent(totals.attack, matches)})`);
  console.log(`Победы защиты: ${totals.defense} (${percent(totals.defense, matches)})`);
  console.log(`Ничьи: ${totals.draw} (${percent(totals.draw, matches)})`);
  console.log(`Раунды атаки: ${totals.attackRounds} из ${totals.rounds} (${percent(totals.attackRounds, totals.rounds)})`);
  const lengthLine = Object.keys(lengths)
    .map(Number)
    .sort((left, right) => left - right)
    .map((length) => `${length} — ${lengths[length]}`)
    .join(', ');
  console.log(`Длина: ${lengthLine}`);
  for (const log of sample) console.log(log.join('\n'), '\n');
}

main();
