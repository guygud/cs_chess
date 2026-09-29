import { CONFIG } from './config.js';
import { bestBuy, loadoutFromBuy } from './engine.js';
import { chooseDefensePlay, commitOrders } from './plays.js';

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

export function planRound(side, wallet, config = CONFIG, rng = Math.random) {
  const buy = bestBuy(wallet, config);
  const loadout = loadoutFromBuy(side, buy.id, config);
  if (loadout.cost > wallet) fail(`Закупка ${side} ${loadout.cost} дороже кошелька ${wallet}`);
  const probe = side === 'attack' ? pickWeighted(config.probes, rng) : null;
  return {
    side,
    ...loadout,
    probe,
    templateId: probe?.id || buy.id,
  };
}

// Обёртка: мув выбирается по уже случившемуся, приказы собирает словарь.
export function defenseOrders(state, config = CONFIG) {
  const play = chooseDefensePlay(state, config);
  return commitOrders(play.id, 'defense', state, config, { grenade: 'auto' });
}
