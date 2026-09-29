import { CONFIG } from './config.js';
import { bestBuy } from './engine.js';

// Одна подсказка за ситуацию. nextTip ничего не запоминает: память живёт у вызывающего.

function selectedPlay(view) {
  if (!view?.draft?.play || !view.menu?.plays) return null;
  return view.menu.plays.find((play) => play.id === view.draft.play) || null;
}

function hasScore(view) {
  return Boolean(view.menu?.plays?.some((play) => play.forecast?.score));
}

function grenadeType(view) {
  const stock = view.roundState?.stock?.attack || [];
  if (stock.includes('flash')) return 'flash';
  if (stock.includes('smoke')) return 'smoke';
  return stock[0] || null;
}

function losingPlay(view) {
  const play = selectedPlay(view);
  const tone = play?.forecast?.tone;
  return tone === 'loss' || tone === 'tie' ? play : null;
}

function crowd(play, config) {
  if (!play?.orders?.moves) return false;
  const fake = new Set(play.orders.fake || []);
  const counts = new Map();
  for (const move of play.orders.moves) {
    if (fake.has(move.name)) continue;
    counts.set(move.to, (counts.get(move.to) || 0) + 1);
  }
  const limit = config.rules.stackShooters ?? 3;
  return [...counts.values()].some((count) => count > limit);
}

function ownsCell(view) {
  const round = view.roundState;
  if (!round) return false;
  return round.fighters.some((fighter) => (
    fighter.alive && fighter.side === 'attack' && round.owned[fighter.point] === 'attack'
  ));
}

function grenadeTip(view, config) {
  if (view.phase !== 'move' || !grenadeType(view) || !losingPlay(view)) return null;
  const type = grenadeType(view);
  const name = (config.utility[type]?.name || type).toLowerCase();
  return {
    id: 'grenade',
    text: `Тут есть ${name}\u00A0— бросьте её, равный бой станет вашим.`,
    target: `grenade:${type}`,
  };
}

function slotsTip(view, config) {
  const play = selectedPlay(view);
  if (view.phase !== 'move' || !play || !crowd(play, config)) return null;
  return {
    id: 'slots',
    text: 'В\u00A0клетке стреляют трое. Кто не\u00A0поместился, гибнет первым.',
    target: `play:${play.id}`,
  };
}

const TIPS = [
  {
    id: 'buy',
    make(view, config) {
      if (view.phase !== 'buy' || view.round !== 1) return null;
      const buy = bestBuy(view.wallet ?? 0, config);
      return {
        text: 'Закуп один на\u00A0всю команду. Оружие сгорит в\u00A0конце раунда.',
        target: buy ? `buy:${buy.id}` : null,
      };
    },
  },
  {
    id: 'move',
    make(view) {
      if (view.phase !== 'move' || view.roundState?.move !== 0 || view.draft?.play) return null;
      const first = view.menu?.plays?.[0];
      return {
        text: 'Выберите мув. Стрелки на\u00A0карте покажут, кто куда пойдёт.',
        target: first ? `play:${first.id}` : null,
      };
    },
  },
  {
    id: 'forecast',
    make(view, config) {
      if (view.phase !== 'move' || !hasScore(view)) return null;
      if (grenadeTip(view, config) || slotsTip(view, config)) return null;
      const scored = view.menu.plays.find((play) => play.forecast?.score);
      return {
        text: 'На\u00A0плитке счёт боя: зелёный\u00A0— выиграете, красный\u00A0— проиграете.',
        target: scored ? `play:${scored.id}` : null,
      };
    },
  },
  {
    id: 'grenade',
    make: grenadeTip,
  },
  {
    id: 'slots',
    make: slotsTip,
  },
  {
    id: 'hold',
    make(view) {
      if (view.phase !== 'move' || !ownsCell(view)) return null;
      const hold = view.menu?.plays?.find((play) => play.id === 'hold');
      if (!hold) return null;
      return {
        text: 'Кто стоит в\u00A0своей клетке, сильнее в\u00A0полтора раза.',
        target: 'play:hold',
      };
    },
  },
  {
    id: 'fake',
    make(view) {
      if (view.phase !== 'move' || !view.menu?.fake) return null;
      return {
        text: 'Фейк уводит двоих на\u00A0другой плент, защита тянется за\u00A0ними.',
        target: 'fake',
      };
    },
  },
];

export function nextTip(view, seen = [], config = CONFIG) {
  const known = new Set(seen || []);
  for (const tip of TIPS) {
    if (known.has(tip.id)) continue;
    const made = tip.make(view, config);
    if (!made) continue;
    return { id: tip.id, text: made.text, target: made.target ?? null };
  }
  return null;
}
