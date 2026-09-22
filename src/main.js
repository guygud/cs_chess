import { CONFIG } from './config.js';
import { applyRoundEconomy, matchStatus, resolveRound } from './engine.js';
import { planDefense } from './bot.js';
import { clearTimers, render } from './ui.js';

function assertConfig() {
  if (CONFIG.ui.defaultAttackPoints.length !== CONFIG.rules.attackFighters) {
    throw new Error('defaultAttackPoints должен совпадать с числом бойцов атаки');
  }
  if (CONFIG.rosters.attack.length !== CONFIG.rules.attackFighters) {
    throw new Error('Ростер атаки не совпадает с числом бойцов');
  }
  const defense = CONFIG.rules.defensePlaced + CONFIG.rules.defenseRotators;
  if (CONFIG.rosters.defense.length !== defense) {
    throw new Error('Ростер защиты не совпадает с числом бойцов');
  }
}

function freshState() {
  return {
    round: 1,
    score: { attack: 0, defense: 0 },
    wallets: {
      attack: CONFIG.economy.startMoney,
      defense: CONFIG.economy.startMoney,
    },
    lossStreak: { attack: 0, defense: 0 },
    history: [],
    phase: 'buy',
    botPlan: null,
    playerPlan: null,
    result: null,
    economy: null,
    matchWinner: null,
    error: null,
  };
}

let state;

function beginRound() {
  clearTimers();
  state.botPlan = planDefense(state.wallets.defense, CONFIG);
  state.playerPlan = null;
  state.result = null;
  state.economy = null;
  state.error = null;
  state.phase = 'buy';
  render(state, actions);
}

function onBuy(plan) {
  if (plan.cost > state.wallets.attack) {
    state.error = 'Не хватает денег на этот набор';
    render(state, actions);
    return;
  }
  state.error = null;
  state.playerPlan = plan;
  state.phase = 'deploy';
  render(state, actions);
}

function onBack() {
  state.phase = 'buy';
  state.error = null;
  render(state, actions);
}

function onDeploy(placement) {
  const attack = {
    fighters: placement.fighters,
    utility: placement.utility,
    midTransfer: placement.midTransfer,
    cost: placement.cost,
  };
  try {
    const result = resolveRound({ attack, defense: state.botPlan }, CONFIG);
    const applied = applyRoundEconomy(
      {
        wallets: state.wallets,
        lossStreak: state.lossStreak,
        score: state.score,
      },
      result,
      { attack: attack.cost, defense: state.botPlan.cost },
      CONFIG,
    );
    state.playerPlan = attack;
    state.wallets = applied.wallets;
    state.lossStreak = applied.lossStreak;
    state.score = applied.score;
    state.economy = applied.economy;
    state.result = result;
    state.history.push(result.winner);
    state.matchWinner = matchStatus(state.score, state.round, CONFIG);
    state.error = null;
    state.phase = 'reveal';
    render(state, actions);
  } catch (error) {
    state.error = error.message;
    state.phase = 'deploy';
    render(state, actions);
  }
}

function onNext() {
  if (state.matchWinner) {
    onRestart();
    return;
  }
  state.round += 1;
  beginRound();
}

function onRestart() {
  clearTimers();
  state = freshState();
  beginRound();
}

const actions = { onBuy, onBack, onDeploy, onNext };

window.addEventListener('error', (event) => {
  const app = document.querySelector('#app');
  if (!app) return;
  const note = document.createElement('pre');
  note.className = 'crash';
  note.textContent = event.message || 'Ошибка скрипта';
  app.prepend(note);
});

assertConfig();
state = freshState();
beginRound();
