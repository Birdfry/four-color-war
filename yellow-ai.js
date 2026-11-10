/*
 * Yellow faction strategy adapted to FourColorWarAI v1.0.0.
 * This file is loaded before the game script and installed at the end of app boot.
 * It deliberately uses only the public plugin context and registration API.
 */
(function installYellowAIStrategy(window) {
  'use strict';

  const API_VERSION = '1.0.0';
  const PLUGIN_ID = 'yellow-strategic';
  const YELLOW = 3;
  const HOME = [[78, 78], [742, 78], [78, 742], [742, 742]];
  const CENTER = { x: 410, y: 410 };
  const PLAZA_RADIUS = 96;
  const BASE_POLICY = Object.freeze({ attack: 1.45, kite: 0.45, defend: 1, retreat: 0.9, skill: 1.1 });
  const POWER_PRIORITY = Object.freeze([1, 1.15, 1.3, 1.7]);
  const CODE_POLICY = Object.freeze({
    balanced: { attack: 1, defend: 1, retreat: 1, kite: 1, tower: 1, center: 1, skill: 1 },
    siege: { attack: 1.2, defend: 0.9, retreat: 0.78, kite: 0.92, tower: 0.78, center: 1.18, skill: 1 },
    guardian: { attack: 0.93, defend: 1.32, retreat: 1.28, kite: 1.06, tower: 1.08, center: 1.04, skill: 1.08 },
    raider: { attack: 1.04, defend: 0.86, retreat: 0.9, kite: 1.18, tower: 0.95, center: 0.84, skill: 0.78 }
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const homeOf = (f) => ({ x: HOME[f][0], y: HOME[f][1] });

  function makeStrategy() {
    const state = {
      focus: -1,
      nextReplanAt: 0,
      lastTime: -1,
      plazaClaimed: false,
      powerClaims: new Map()
    };

    function resetState() {
      state.focus = -1;
      state.nextReplanAt = 0;
      state.lastTime = -1;
      state.plazaClaimed = false;
      state.powerClaims.clear();
    }

    function currentCode(ctx) {
      const codeName = String(ctx.learning?.code || 'balanced').split(':').pop();
      return CODE_POLICY[codeName] || CODE_POLICY.balanced;
    }

    function modeWeight(ctx, mode) {
      const policy = Number(ctx.learning?.policy?.[mode]);
      const situation = ctx.signals?.situation;
      const contextQ = Number(ctx.learning?.ctxQ?.[situation]?.[mode]) || 0;
      const learned = Number.isFinite(policy) ? policy : 1;
      const contextual = clamp(Math.exp(contextQ * 0.16), 0.78, 1.28);
      return clamp((BASE_POLICY[mode] || 1) * learned * contextual, 0.35, 2.1);
    }

    function routeWeight(ctx, route) {
      const weight = Number(ctx.learning?.routePolicy?.[route]);
      return Number.isFinite(weight) ? clamp(weight, 0.55, 1.8) : 1;
    }

    function routeStyle(ctx) {
      return routeWeight(ctx, 'flank') > routeWeight(ctx, 'direct') * 1.03 ? 'flank' : 'direct';
    }

    function activeEnemies(ctx) {
      return (ctx.enemies || []).filter((enemy) => enemy?.alive && enemy.f !== YELLOW);
    }

    function chooseFocus(ctx, enemies) {
      if (!enemies.length) {
        state.focus = -1;
        return null;
      }
      const focusStillAlive = enemies.some((enemy) => enemy.f === state.focus);
      if (ctx.time >= state.nextReplanAt || !focusStillAlive) {
        const ownHome = homeOf(YELLOW);
        const focusPersistence = 120 * modeWeight(ctx, 'attack');
        let best = null;
        let bestScore = Infinity;
        for (const enemy of enemies) {
          const score = enemy.hp * 0.9 + enemy.count * 22 + distance(ownHome, homeOf(enemy.f)) * 0.9
            - (enemy.f === state.focus ? focusPersistence : 0);
          if (score < bestScore) {
            best = enemy;
            bestScore = score;
          }
        }
        state.focus = best?.f ?? -1;
        state.nextReplanAt = ctx.time + 0.5;
      }
      return enemies.find((enemy) => enemy.f === state.focus) || enemies[0];
    }

    function targetForFaction(ctx, faction) {
      const candidates = (ctx.nearbyEnemies || []).filter((enemy) => enemy.f === faction);
      if (!candidates.length) return null;
      return candidates.reduce((best, enemy) => {
        const enemyHpRatio = enemy.hp / Math.max(1, enemy.maxHp);
        const bestHpRatio = best.hp / Math.max(1, best.maxHp);
        const score = distance(ctx.unit, enemy) - (1 - enemyHpRatio) * 12;
        const bestScore = distance(ctx.unit, best) - (1 - bestHpRatio) * 12;
        return score < bestScore ? enemy : best;
      });
    }

    function targetIdFor(ctx, faction) {
      return targetForFaction(ctx, faction)?.id ?? null;
    }

    function releasePowerClaim(unitId) {
      state.powerClaims.delete(unitId);
    }

    function prunePowerClaims(now) {
      for (const [unitId, claim] of state.powerClaims) {
        if (now - claim.lastSeen > 2.25) state.powerClaims.delete(unitId);
      }
    }

    function selectPower(ctx, code) {
      const unit = ctx.unit;
      const unitId = unit.id;
      const ownClaim = state.powerClaims.get(unitId);
      let best = null;
      let bestScore = Infinity;
      const skillWeight = modeWeight(ctx, 'skill') * routeWeight(ctx, 'skill') * code.skill;
      const skillScale = Math.sqrt(Math.max(0.35, skillWeight));
      for (const power of ctx.powers || []) {
        const d = distance(unit, power);
        if (d > 300 || !Number.isFinite(power.x) || !Number.isFinite(power.y)) continue;
        const key = `${power.type}:${power.x.toFixed(1)}:${power.y.toFixed(1)}`;
        const reservedByOthers = [...state.powerClaims.entries()].filter(([id, claim]) => id !== unitId && claim.key === key).length;
        if (reservedByOthers >= 2) continue;
        const priority = POWER_PRIORITY[power.type] || 1;
        const remainingLife = clamp((Number(power.life) || 0) / 17, 0, 1);
        const expiryFactor = 0.82 + 0.18 * remainingLife;
        const score = d * expiryFactor / (priority * skillScale);
        if (score < bestScore) {
          best = { power, key };
          bestScore = score;
        }
      }
      if (!best) {
        releasePowerClaim(unitId);
        return null;
      }
      state.powerClaims.set(unitId, { key: best.key, lastSeen: ctx.time });
      return best.power;
    }

    function retreatGoal(ctx, target) {
      const unit = ctx.unit;
      const home = homeOf(YELLOW);
      const homeX = home.x - unit.x;
      const homeY = home.y - unit.y;
      const homeD = Math.hypot(homeX, homeY) || 1;
      const awayX = target ? unit.x - target.x : homeX;
      const awayY = target ? unit.y - target.y : homeY;
      const awayD = Math.hypot(awayX, awayY) || 1;
      let dx = homeX / homeD * 0.72 + awayX / awayD * 0.28;
      let dy = homeY / homeD * 0.72 + awayY / awayD * 0.28;
      const d = Math.hypot(dx, dy) || 1;
      const side = ((unit.id % 5) - 2) * 14;
      const missingHp = 1 - clamp(unit.hp / Math.max(1, unit.maxHp), 0, 1);
      const step = 80 + missingHp * 55;
      return {
        x: clamp(unit.x + dx / d * step - dy / d * side, 14, 806),
        y: clamp(unit.y + dy / d * step + dx / d * side, 14, 806)
      };
    }

    function decide(ctx) {
      if (!ctx || ctx.apiVersion !== API_VERSION || ctx.faction?.f !== YELLOW || !ctx.unit) return null;
      if (state.lastTime >= 0 && ctx.time < state.lastTime - 1) resetState();
      state.lastTime = ctx.time;
      prunePowerClaims(ctx.time);

      const enemies = activeEnemies(ctx);
      const focus = chooseFocus(ctx, enemies);
      const focusFaction = focus?.f ?? null;
      const focusedTarget = focusFaction === null ? null : targetForFaction(ctx, focusFaction);
      const target = focusedTarget || ctx.target || (ctx.nearbyEnemies || [])[0] || null;
      const targetId = focusedTarget?.id ?? null;
      const code = currentCode(ctx);
      const style = routeStyle(ctx);
      const finish = (intent, usesPower = false) => {
        if (!usesPower) releasePowerClaim(ctx.unit.id);
        return {
          ...intent,
          targetFaction: focusFaction,
          targetId: Number.isInteger(intent.targetId) ? intent.targetId : targetId,
          routeStyle: style,
          refreshAfter: 0.75
        };
      };

      const hpRatio = clamp(ctx.unit.hp / Math.max(1, ctx.unit.maxHp), 0, 1);
      const missingHp = 1 - hpRatio;
      const homePressure = clamp(Number(ctx.signals?.homePressure) || 0, 0, 1);
      const localPressure = clamp(Number(ctx.signals?.localPressure) || 0, 0, 1);
      const retreatBias = Math.sqrt(Math.max(0.35,
        modeWeight(ctx, 'retreat') * routeWeight(ctx, 'retreat') * code.retreat));
      const retreatScore = (missingHp * 0.72 + localPressure * 0.2 + homePressure * 0.12) * retreatBias;
      if (hpRatio < 0.50 && retreatScore > 0.46 && (!!ctx.target || homePressure > 0.25)) {
        return finish({ mode: 'retreat', goal: retreatGoal(ctx, target), goalKind: 'retreat', targetId: target?.id });
      }

      const castleLoss = clamp(Number(ctx.signals?.castleLoss) || 0, 0, 1);
      const needDefense = clamp(castleLoss * 0.8 + homePressure * 0.62, 0, 1);
      const dynamicDefenseWeight = 1 + homePressure * 1.2 + castleLoss * 0.8;
      const defendShare = clamp(needDefense * modeWeight(ctx, 'defend') * dynamicDefenseWeight * routeWeight(ctx, 'defend') * code.defend * 0.48, 0, 0.68);
      const assignedDefender = ((ctx.unit.id * 37 + YELLOW * 17) % 100) / 100 < defendShare;
      if (assignedDefender) {
        const intruder = (ctx.nearbyEnemies || []).reduce((best, enemy) => {
          if (!best) return enemy;
          return distance(enemy, homeOf(YELLOW)) < distance(best, homeOf(YELLOW)) ? enemy : best;
        }, ctx.target || null);
        const home = homeOf(YELLOW);
        return finish({
          mode: 'defend',
          goal: intruder ? { x: intruder.x, y: intruder.y } : {
            x: home.x + (CENTER.x - home.x) * 0.16,
            y: home.y + (CENTER.y - home.y) * 0.16
          },
          goalKind: 'defend',
          targetId: intruder?.id
        });
      }

      const kiteBias = modeWeight(ctx, 'kite') * routeWeight(ctx, 'kite') * code.kite;
      const nearestTarget = focusedTarget || ctx.target || (ctx.nearbyEnemies || [])[0] || null;
      if (nearestTarget && kiteBias > 0.72) {
        const d = distance(ctx.unit, nearestTarget);
        const ranged = ctx.unit.type === 1;
        if ((ranged && d < 120) || (!ranged && missingHp > 0.68 && d < 78)) {
          const dx = ctx.unit.x - nearestTarget.x;
          const dy = ctx.unit.y - nearestTarget.y;
          const length = Math.hypot(dx, dy) || 1;
          const step = ranged ? 62 : 90 + missingHp * 35;
          return finish({
            mode: 'kite',
            goal: { x: clamp(ctx.unit.x + dx / length * step, 14, 806), y: clamp(ctx.unit.y + dy / length * step, 14, 806) },
            goalKind: 'kite',
            targetId: nearestTarget.id
          });
        }
      }

      const plazaShare = clamp(Number(ctx.signals?.plazaShare ?? ctx.faction.plazaShare) || 0, 0, 1);
      // The game awards the one-time bonus just above 30%; remember it without reaching into private game globals.
      if (plazaShare > 0.30) state.plazaClaimed = true;
      if (!state.plazaClaimed && plazaShare <= 0.35) {
        const angle = (ctx.unit.id * 2.399963229728653) % (Math.PI * 2);
        const radius = PLAZA_RADIUS * 0.6;
        return finish({
          mode: 'attack',
          goal: { x: CENTER.x + Math.cos(angle) * radius, y: CENTER.y + Math.sin(angle) * radius },
          goalKind: 'plaza'
        });
      }

      const power = selectPower(ctx, code);
      if (power) return finish({ mode: 'skill', goal: { x: power.x, y: power.y }, goalKind: 'power' }, true);

      if (focus) {
        const targetHome = homeOf(focus.f);
        return finish({ mode: 'attack', goal: targetHome, goalKind: 'tower' });
      }

      return finish({
        mode: 'attack',
        goal: { x: CENTER.x, y: CENTER.y },
        goalKind: 'patrol',
        targetId: null
      });
    }

    return {
      name: 'Yellow strategic AI',
      version: '1.0.0',
      apiVersion: API_VERSION,
      decide,
      onMatchEnd() { resetState(); }
    };
  }

  window.__installFourColorWarYellowAI = function install(api) {
    if (!api || api.apiVersion !== API_VERSION || typeof api.register !== 'function' || typeof api.setFactionStrategy !== 'function') {
      console.error('[Yellow AI] FourColorWarAI v1.0.0 is required; Yellow will keep its built-in AI.');
      return false;
    }
    const registered = api.register(PLUGIN_ID, makeStrategy());
    if (!registered || !api.setFactionStrategy(YELLOW, PLUGIN_ID)) {
      console.error('[Yellow AI] Could not register/assign the strategy; Yellow will keep its built-in AI.');
      return false;
    }
    return true;
  };
})(window);
