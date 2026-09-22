import { CONFIG } from './config.js';
import { loadoutCost } from './engine.js';

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

function assertTemplate(template, expected, config) {
  const sum = config.pointOrder.reduce((total, id) => total + template.points[id], 0);
  if (sum !== expected) {
    fail(`Шаблон ${template.id} ставит ${sum} бойцов, нужно ${expected}`);
  }
  for (const id of config.pointOrder) {
    const count = template.points[id];
    if (!Number.isInteger(count) || count < 0) {
      fail(`Шаблон ${template.id}: точка ${id} задана неверно`);
    }
  }
}

export function planDefense(wallet, config = CONFIG, rng = Math.random) {
  const roster = config.rosters.defense;
  const headcount = config.rules.defensePlaced + config.rules.defenseRotators;
  if (roster.length !== headcount) {
    fail(`Ростер защиты: ожидалось ${headcount} имён, есть ${roster.length}`);
  }

  const rifleCost = config.weapons.rifle.cost;
  const fullBuy = rifleCost * headcount;
  const weapon = wallet >= fullBuy ? 'rifle' : 'pistol';
  const template = pickWeighted(config.defenseTemplates, rng);
  assertTemplate(template, config.rules.defensePlaced, config);

  const fighters = [];
  let index = 0;
  for (const pointId of config.pointOrder) {
    for (let count = 0; count < template.points[pointId]; count += 1) {
      fighters.push({
        name: roster[index],
        weapon,
        point: pointId,
        rotator: false,
      });
      index += 1;
    }
  }
  fighters.push({
    name: roster[index],
    weapon,
    point: null,
    rotator: true,
  });

  const utility = [];
  const cost = loadoutCost(fighters, utility, config);
  if (cost > wallet) fail(`Закупка бота ${cost} дороже кошелька ${wallet}`);

  return {
    fighters,
    utility,
    cost,
    weapon,
    templateId: template.id,
  };
}
