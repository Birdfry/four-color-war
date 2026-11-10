/*
 * BlueTide strategy adapted from the supplied DeepSeek script to the public
 * FourColorWarAI v1.0.0 plugin API. It only installs on faction 1 (Blue).
 * The game engine remains responsible for combat, reward learning, routing,
 * alliances, cooldowns, and betrayal penalties.
 */
(function installBlueAIStrategy(window) {
  'use strict';

  const API_VERSION = '1.0.0';
  const PLUGIN_ID = 'blue-tide-strategic';
  const BLUE = 1;
  const TEAM_IDS = [0, 1, 2, 3];
  const STORAGE_PREFIX = 'bluetide_v1_';
  const HOME = [[78, 78], [742, 78], [78, 742], [742, 742]];
  const CENTER = Object.freeze({ x: 410, y: 410 });
  const PLAZA_RADIUS = 96;
  const POWER_PRIORITY = Object.freeze([1, 1.15, 1.3, 1.7]);
  const GENOME_SCHEMA = Object.freeze({
    aggression:        { min: 0.3, max: 1.8, init: 0.90 },
    kitePriority:      { min: 1.0, max: 2.2, init: 1.60 },
    defendSensitivity: { min: 0.6, max: 1.8, init: 1.00 },
    skillMultiplier:   { min: 0.8, max: 1.6, init: 1.20 },
    caution:           { min: 0.4, max: 1.6, init: 1.00 },
    betrayThreshold:   { min: 1.2, max: 2.2, init: 1.50 },
    allyPrefMelee:     { min: 0.5, max: 1.5, init: 1.10 },
    ringRadius:        { min: 120, max: 200, init: 165 },
    defenseRadius:     { min: 120, max: 200, init: 175 }
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const homeOf = (f) => ({ x: HOME[f][0], y: HOME[f][1] });

  const Store = {
    memory: Object.create(null),
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (_) {
        return this.memory[key] === undefined ? fallback : this.memory[key];
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
      } catch (_) {
        this.memory[key] = value;
      }
    },
    remove(key) {
      try {
        window.localStorage.removeItem(STORAGE_PREFIX + key);
      } catch (_) {
        delete this.memory[key];
      }
    }
  };

  function gaussian() {
    const u = Math.max(Number.EPSILON, Math.random());
    const v = Math.max(Number.EPSILON, Math.random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  class Genome {
    constructor(values = null) {
      this.values = {};
      for (const [key, schema] of Object.entries(GENOME_SCHEMA)) {
        const candidate = Number(values?.[key]);
        this.values[key] = clamp(Number.isFinite(candidate) ? candidate : schema.init, schema.min, schema.max);
      }
    }
    get(key) { return this.values[key]; }
    mutate(rate, scale) {
      for (const [key, schema] of Object.entries(GENOME_SCHEMA)) {
        if (Math.random() < rate) this.values[key] += gaussian() * (schema.max - schema.min) * scale;
      }
      this.clip();
    }
    clip() {
      for (const [key, schema] of Object.entries(GENOME_SCHEMA)) {
        this.values[key] = clamp(this.values[key], schema.min, schema.max);
      }
    }
    cross(other) {
      const child = new Genome(this.values);
      for (const key of Object.keys(GENOME_SCHEMA)) {
        if (Math.random() < 0.5) child.values[key] = this.values[key];
        else if (Math.random() < 0.5) child.values[key] = other.values[key];
        else {
          const blend = Math.random();
          child.values[key] = blend * this.values[key] + (1 - blend) * other.values[key];
        }
      }
      child.clip();
      return child;
    }
    toJSON() { return { ...this.values }; }
  }

  class Evolution {
    constructor(populationSize = 20, eliteCount = 5, mutationRate = 0.28, mutationScale = 0.15) {
      this.populationSize = populationSize;
      this.eliteCount = eliteCount;
      this.mutationRate = mutationRate;
      this.mutationScale = mutationScale;
      this.nextId = 1;
      this.evaluations = 0;
      this.generation = 0;
      this.history = [];
      const saved = Store.get('evolution', null);
      const validPopulation = Array.isArray(saved?.population)
        && saved.population.length === populationSize
        && saved.population.every((entry) => entry && Number.isInteger(entry.id) && entry.genome);
      if (validPopulation) {
        this.nextId = Math.max(1, Number(saved.nextId) || 1);
        this.evaluations = clamp(Number(saved.evaluations) || 0, 0, populationSize - 1);
        this.generation = Math.max(0, Number(saved.generation) || 0);
        this.history = Array.isArray(saved.history) ? saved.history.slice(-80) : [];
        this.population = saved.population.map((entry) => ({
          id: entry.id,
          genome: new Genome(entry.genome),
          plays: Math.max(0, Number(entry.plays) || 0),
          fitness: Array.isArray(entry.fitness) ? entry.fitness.slice(-10).map((v) => Number(v) || 0) : [],
          average: Number(entry.average) || 0
        }));
      } else {
        this.population = [];
        this.initialize();
      }
    }
    initialize() {
      this.nextId = 1;
      this.evaluations = 0;
      this.generation = 0;
      this.history = [];
      this.population = [];
      for (let i = 0; i < this.populationSize; i++) {
        const genome = new Genome();
        if (i > 0) genome.mutate(0.4, 0.25);
        this.population.push({ id: this.nextId++, genome, plays: 0, fitness: [], average: 0 });
      }
      this.save();
    }
    save() {
      Store.set('evolution', {
        nextId: this.nextId,
        evaluations: this.evaluations,
        generation: this.generation,
        history: this.history,
        population: this.population.map((entry) => ({
          id: entry.id,
          genome: entry.genome.toJSON(),
          plays: entry.plays,
          fitness: entry.fitness,
          average: entry.average
        }))
      });
    }
    select() {
      const untried = this.population.filter((entry) => entry.plays === 0);
      if (untried.length) return untried[Math.floor(Math.random() * untried.length)];
      const total = this.population.reduce((sum, entry) => sum + entry.plays, 0) + 1;
      return this.population.reduce((best, entry) => {
        const score = entry.average + 0.5 * Math.sqrt(Math.log(total) / Math.max(1, entry.plays));
        return !best || score > best.score ? { entry, score } : best;
      }, null).entry;
    }
    record(id, fitness) {
      const entry = this.population.find((item) => item.id === id);
      if (!entry) return;
      entry.plays++;
      entry.fitness.push(fitness);
      if (entry.fitness.length > 10) entry.fitness.shift();
      entry.average = entry.fitness.reduce((sum, value) => sum + value, 0) / entry.fitness.length;
      this.evaluations++;
      if (this.evaluations >= this.populationSize) this.evolve();
      this.save();
    }
    tournament(pool, size = 3) {
      let best = null;
      for (let i = 0; i < size; i++) {
        const entry = pool[Math.floor(Math.random() * pool.length)];
        if (!best || entry.average > best.average) best = entry;
      }
      return best;
    }
    evolve() {
      const sorted = [...this.population].sort((a, b) => b.average - a.average);
      const elites = sorted.slice(0, this.eliteCount);
      this.generation++;
      this.history.push({
        generation: this.generation,
        best: elites[0]?.average || 0,
        average: sorted.reduce((sum, entry) => sum + entry.average, 0) / Math.max(1, sorted.length)
      });
      if (this.history.length > 80) this.history.shift();
      const next = elites.map((entry) => ({
        id: this.nextId++, genome: new Genome(entry.genome.toJSON()), plays: 0, fitness: [], average: 0
      }));
      while (next.length < this.populationSize) {
        const first = this.tournament(elites);
        const second = this.tournament(elites);
        const genome = first.genome.cross(second.genome);
        genome.mutate(this.mutationRate, this.mutationScale);
        next.push({ id: this.nextId++, genome, plays: 0, fitness: [], average: 0 });
      }
      this.population = next;
      this.evaluations = 0;
    }
  }

  const evolution = new Evolution();
  const state = {
    focus: -1,
    nextReplanAt: 0,
    lastTime: -1,
    plazaClaimed: false,
    powerClaims: new Map(),
    genomeEntry: null,
    episode: null
  };

  function resetMatchState() {
    state.focus = -1;
    state.nextReplanAt = 0;
    state.lastTime = -1;
    state.plazaClaimed = false;
    state.powerClaims.clear();
    state.genomeEntry = null;
    state.episode = null;
  }

  function beginMatch(ctx) {
    state.focus = -1;
    state.nextReplanAt = 0;
    state.plazaClaimed = false;
    state.powerClaims.clear();
    state.genomeEntry = evolution.select();
    state.episode = {
      maxPlaza: 0,
      maxTerritory: 0,
      maxKills: 0,
      lastRank: 4,
      lastHp: 0,
      castleAlive: true,
      lastTime: Number(ctx.time) || 0
    };
    observeMatch(ctx);
  }

  function observeMatch(ctx) {
    if (!state.episode || !ctx?.faction) return;
    const faction = ctx.faction;
    const plazaShare = clamp(Number(ctx.signals?.plazaShare ?? faction.plazaShare) || 0, 0, 1);
    const landShare = clamp(Number(faction.landShare) || 0, 0, 1);
    state.episode.maxPlaza = Math.max(state.episode.maxPlaza, plazaShare);
    state.episode.maxTerritory = Math.max(state.episode.maxTerritory, landShare);
    state.episode.maxKills = Math.max(state.episode.maxKills, Number(faction.kills) || 0);
    state.episode.lastHp = Number(faction.hp) || 0;
    state.episode.castleAlive = !!faction.alive && state.episode.lastHp > 0;
    state.episode.lastTime = Number(ctx.time) || state.episode.lastTime;
    if (Number.isInteger(faction.rank) && faction.rank >= 1 && faction.rank <= 4) {
      state.episode.lastRank = faction.rank;
    } else {
      const standings = [faction, ...(ctx.enemies || []), ...(ctx.allies || [])]
        .filter((team) => team?.alive)
        .sort((a, b) => (Number(b.landShare) || 0) - (Number(a.landShare) || 0));
      state.episode.lastRank = standings.findIndex((team) => team.f === BLUE) + 1 || 4;
    }
    if (plazaShare > 0.30) state.plazaClaimed = true;
  }

  function diplomacyStrength(team) {
    return (Number(team?.land) || 0) + (Number(team?.hp) || 0) * 0.22 + (Number(team?.count) || 0) * 5;
  }

  function learnedWeight(ctx, mode) {
    const rawPolicy = Number(ctx.learning?.policy?.[mode]);
    const policy = Number.isFinite(rawPolicy) ? clamp(rawPolicy, 0.45, 2.2) : 1;
    const situation = ctx.signals?.situation;
    const contextQ = Number(ctx.learning?.ctxQ?.[situation]?.[mode]) || 0;
    return clamp(policy * Math.exp(clamp(contextQ, -2, 2) * 0.16), 0.45, 2.3);
  }

  function learnedRouteWeight(ctx, route) {
    const value = Number(ctx.learning?.routePolicy?.[route]);
    return Number.isFinite(value) ? clamp(value, 0.55, 1.8) : 1;
  }

  function currentGenome() {
    return state.genomeEntry?.genome || new Genome();
  }

  function currentStance(ctx) {
    const faction = ctx.faction;
    const hpRatio = clamp((Number(faction.hp) || 0) / Math.max(1, Number(faction.maxHp) || 2000), 0, 1);
    const homePressure = clamp(Number(ctx.signals?.homePressure) || 0, 0, 1);
    const localPressure = clamp(Number(ctx.signals?.localPressure) || 0, 0, 1);
    const castleLoss = clamp(Number(ctx.signals?.castleLoss) || 0, 0, 1);
    const threat = clamp(homePressure * 0.65 + localPressure * 0.25 + castleLoss * 0.5, 0, 1);
    if (threat > 0.6 && hpRatio < 0.75) return 'survival';
    if (hpRatio < 0.55 || castleLoss > 0.55) return 'defensive';
    if (threat > 0.4 || hpRatio < 0.75) return 'cautious';
    return 'balanced';
  }

  function currentPolicy(ctx, stance, genome) {
    const policy = {
      attack: clamp(1.2 * genome.get('aggression') * learnedWeight(ctx, 'attack'), 0.35, 2.4),
      kite: clamp(genome.get('kitePriority') * learnedWeight(ctx, 'kite'), 0.7, 2.5),
      defend: clamp(genome.get('defendSensitivity') * learnedWeight(ctx, 'defend'), 0.4, 2.4),
      retreat: clamp(genome.get('caution') * learnedWeight(ctx, 'retreat'), 0.4, 2.4),
      skill: clamp(genome.get('skillMultiplier') * learnedWeight(ctx, 'skill'), 0.4, 2.2)
    };
    if (stance === 'survival') {
      policy.attack *= 0.55;
      policy.kite = Math.max(policy.kite, 1.8);
      policy.defend *= 1.5;
      policy.retreat *= 1.35;
      policy.skill *= 1.1;
    } else if (stance === 'defensive') {
      policy.attack *= 0.72;
      policy.kite = Math.max(policy.kite, 1.65);
      policy.defend *= 1.35;
      policy.retreat *= 1.2;
    } else if (stance === 'cautious') {
      policy.attack *= 0.86;
      policy.kite = Math.max(policy.kite, 1.6);
      policy.defend *= 1.1;
    }
    return policy;
  }

  function activeEnemies(ctx) {
    return (ctx.enemies || []).filter((enemy) => enemy?.alive && enemy.f !== BLUE);
  }

  function chooseFocus(ctx, enemies, stance) {
    const stillAlive = enemies.some((enemy) => enemy.f === state.focus);
    if (ctx.time < state.nextReplanAt && stillAlive) return enemies.find((enemy) => enemy.f === state.focus);
    let best = null;
    let bestScore = Infinity;
    const ownHome = homeOf(BLUE);
    for (const enemy of enemies) {
      const enemyHome = homeOf(enemy.f);
      const homeDistance = distance(ownHome, enemyHome);
      let score = stance === 'survival'
        ? (Number(enemy.hp) || 0) + homeDistance * 1.2
        : (Number(enemy.hp) || 0) * 0.8 + (Number(enemy.count) || 0) * 18 + homeDistance;
      if (enemy.f === state.focus) score -= 100;
      if (score < bestScore) {
        best = enemy;
        bestScore = score;
      }
    }
    state.focus = best?.f ?? -1;
    state.nextReplanAt = (Number(ctx.time) || 0) + 0.75;
    return best;
  }

  function targetForFaction(ctx, faction) {
    const candidates = (ctx.nearbyEnemies || []).filter((enemy) => enemy.f === faction);
    if (!candidates.length) return null;
    return candidates.reduce((best, enemy) => {
      const enemyHealth = (Number(enemy.hp) || 0) / Math.max(1, Number(enemy.maxHp) || 1);
      const bestHealth = (Number(best.hp) || 0) / Math.max(1, Number(best.maxHp) || 1);
      const enemyScore = distance(ctx.unit, enemy) - (1 - enemyHealth) * 12;
      const bestScore = distance(ctx.unit, best) - (1 - bestHealth) * 12;
      return enemyScore < bestScore ? enemy : best;
    });
  }

  function targetIdFor(ctx, faction) {
    return targetForFaction(ctx, faction)?.id ?? null;
  }

  function finish(ctx, intent, targetFaction = null, targetId = null) {
    const routeStyle = learnedRouteWeight(ctx, 'flank') > learnedRouteWeight(ctx, 'direct') * 1.03
      ? 'flank'
      : 'direct';
    return {
      ...intent,
      targetFaction,
      targetId,
      routeStyle,
      refreshAfter: 0.75
    };
  }

  function clampGoal(point, ctx) {
    const width = Number(ctx.world?.width) || 820;
    const height = Number(ctx.world?.height) || 820;
    return {
      x: clamp(Number(point.x) || 0, 14, width - 14),
      y: clamp(Number(point.y) || 0, 14, height - 14)
    };
  }

  function retreatGoal(ctx, target) {
    const unit = ctx.unit;
    const home = homeOf(BLUE);
    const homeX = home.x - unit.x;
    const homeY = home.y - unit.y;
    const homeLength = Math.hypot(homeX, homeY) || 1;
    const awayX = target ? unit.x - target.x : homeX;
    const awayY = target ? unit.y - target.y : homeY;
    const awayLength = Math.hypot(awayX, awayY) || 1;
    let dx = homeX / homeLength * 0.72 + awayX / awayLength * 0.28;
    let dy = homeY / homeLength * 0.72 + awayY / awayLength * 0.28;
    const length = Math.hypot(dx, dy) || 1;
    const side = ((unit.id % 5) - 2) * 14;
    const missingHp = 1 - clamp(unit.hp / Math.max(1, unit.maxHp), 0, 1);
    const step = 80 + missingHp * 55;
    return clampGoal({
      x: unit.x + dx / length * step - dy / length * side,
      y: unit.y + dy / length * step + dx / length * side
    }, ctx);
  }

  function defenseGoal(ctx, genome, intruder = null) {
    if (intruder) return clampGoal({ x: intruder.x, y: intruder.y }, ctx);
    const home = homeOf(BLUE);
    const angle = (ctx.unit.id * 1.7) % (Math.PI * 2);
    const radius = genome.get('defenseRadius');
    return clampGoal({ x: home.x + Math.cos(angle) * radius, y: home.y + Math.sin(angle) * radius }, ctx);
  }

  function prunePowerClaims(now) {
    for (const [unitId, claim] of state.powerClaims) {
      if (now - claim.lastSeen > 2.25) state.powerClaims.delete(unitId);
    }
  }

  function selectPower(ctx, policy) {
    const unitId = ctx.unit.id;
    const ownClaim = state.powerClaims.get(unitId);
    let best = null;
    let bestScore = Infinity;
    const skillWeight = policy.skill * learnedRouteWeight(ctx, 'skill');
    for (const power of ctx.powers || []) {
      if (!Number.isFinite(power.x) || !Number.isFinite(power.y) || Number(power.life) <= 0) continue;
      const d = distance(ctx.unit, power);
      if (d > 320) continue;
      const key = `${power.type}:${power.x.toFixed(1)}:${power.y.toFixed(1)}`;
      const claimedByOthers = [...state.powerClaims.entries()]
        .filter(([id, claim]) => id !== unitId && claim.key === key).length;
      if (claimedByOthers >= 2) continue;
      const priority = POWER_PRIORITY[power.type] || 1;
      const remainingLife = clamp((Number(power.life) || 0) / 17, 0, 1);
      const expiryFactor = 0.82 + 0.18 * remainingLife;
      const score = d * expiryFactor / (priority * Math.max(0.35, skillWeight));
      if (score < bestScore) {
        best = { power, key };
        bestScore = score;
      }
    }
    if (!best) {
      state.powerClaims.delete(unitId);
      return null;
    }
    state.powerClaims.set(unitId, { key: best.key, lastSeen: Number(ctx.time) || 0 });
    return best.power;
  }

  function decide(ctx) {
    if (!ctx || ctx.apiVersion !== API_VERSION || ctx.faction?.f !== BLUE || !ctx.unit) return null;
    if (state.lastTime >= 0 && ctx.time < state.lastTime - 1) resetMatchState();
    state.lastTime = Number(ctx.time) || 0;
    if (!state.episode) beginMatch(ctx);
    observeMatch(ctx);
    prunePowerClaims(state.lastTime);

    const genome = currentGenome();
    const stance = currentStance(ctx);
    const policy = currentPolicy(ctx, stance, genome);
    const enemies = activeEnemies(ctx);
    const focus = chooseFocus(ctx, enemies, stance);
    const focusedTarget = focus ? targetForFaction(ctx, focus.f) : null;
    const target = focusedTarget || ctx.target || (ctx.nearbyEnemies || [])[0] || null;
    const targetFaction = focus?.f ?? null;
    const homePressure = clamp(Number(ctx.signals?.homePressure) || 0, 0, 1);
    const localPressure = clamp(Number(ctx.signals?.localPressure) || 0, 0, 1);
    const castleLoss = clamp(Number(ctx.signals?.castleLoss) || 0, 0, 1);
    const hpRatio = clamp(ctx.unit.hp / Math.max(1, ctx.unit.maxHp), 0, 1);
    const missingHp = 1 - hpRatio;
    const plazaShare = clamp(Number(ctx.signals?.plazaShare ?? ctx.faction.plazaShare) || 0, 0, 1);
    const routeStyle = learnedRouteWeight(ctx, 'flank') > learnedRouteWeight(ctx, 'direct') * 1.03
      ? 'flank'
      : 'direct';

    const retreatThreshold = clamp(0.5 + (genome.get('caution') - 1) * 0.10, 0.4, 0.6);
    const retreatScore = (missingHp * 0.72 + localPressure * 0.2 + homePressure * 0.12)
      * Math.sqrt(Math.max(0.35, policy.retreat * learnedRouteWeight(ctx, 'retreat')));
    if (hpRatio < retreatThreshold && retreatScore > 0.46 && (target || homePressure > 0.25)) {
      return finish(ctx, {
        mode: 'retreat',
        goal: retreatGoal(ctx, target),
        goalKind: 'retreat'
      }, target?.f ?? targetFaction, target?.id ?? null);
    }

    const needDefense = clamp(castleLoss * 0.8 + homePressure * 0.62, 0, 1);
    const dynamicDefense = 1 + homePressure * 1.2 + castleLoss * 0.8;
    const defenderShare = clamp(
      needDefense * policy.defend * learnedRouteWeight(ctx, 'defend') * dynamicDefense * 0.48,
      0,
      0.68
    );
    const assignedDefender = ((ctx.unit.id * 37 + BLUE * 17) % 100) / 100 < defenderShare;
    if (stance === 'survival' || stance === 'defensive' || assignedDefender) {
      const intruder = (ctx.nearbyEnemies || []).reduce((best, enemy) => {
        if (!best) return enemy;
        return distance(enemy, homeOf(BLUE)) < distance(best, homeOf(BLUE)) ? enemy : best;
      }, ctx.target || null);
      return finish(ctx, {
        mode: 'defend',
        goal: defenseGoal(ctx, genome, intruder),
        goalKind: 'defend'
      }, intruder?.f ?? null, intruder?.id ?? null);
    }

    if (!state.plazaClaimed && state.lastTime < 90 && plazaShare <= 0.35) {
      const angle = (ctx.unit.id * 2.399963229728653) % (Math.PI * 2);
      const radius = PLAZA_RADIUS * 1.05;
      return finish(ctx, {
        mode: 'attack',
        goal: clampGoal({ x: CENTER.x + Math.cos(angle) * radius, y: CENTER.y + Math.sin(angle) * radius }, ctx),
        goalKind: 'plaza'
      });
    }

    const power = selectPower(ctx, policy);
    if (power) {
      return finish(ctx, {
        mode: 'skill',
        goal: clampGoal({ x: power.x, y: power.y }, ctx),
        goalKind: 'power'
      });
    }

    const isRanged = ctx.unit.type === 1 || ctx.unit.type === 4;
    const kiteBias = policy.kite * learnedRouteWeight(ctx, 'kite');
    if (target && kiteBias > 0.72) {
      const d = distance(ctx.unit, target);
      if ((isRanged && d < 120) || (!isRanged && missingHp > 0.68 && d < 78)) {
        const dx = ctx.unit.x - target.x;
        const dy = ctx.unit.y - target.y;
        const length = Math.hypot(dx, dy) || 1;
        const step = isRanged ? 62 : 90 + missingHp * 35;
        return finish(ctx, {
          mode: 'kite',
          goal: clampGoal({ x: ctx.unit.x + dx / length * step, y: ctx.unit.y + dy / length * step }, ctx),
          goalKind: 'kite'
        }, target.f, target.id);
      }
    }

    if (focus) {
      const enemyHome = homeOf(focus.f);
      const angle = (ctx.unit.id * 1.9) % (Math.PI * 2);
      const radius = genome.get('ringRadius');
      return finish(ctx, {
        mode: 'attack',
        goal: clampGoal({ x: enemyHome.x + Math.cos(angle) * radius, y: enemyHome.y + Math.sin(angle) * radius }, ctx),
        goalKind: 'tower'
      }, focus.f, targetIdFor(ctx, focus.f));
    }

    const home = homeOf(BLUE);
    const angle = (ctx.unit.id * 1.3) % (Math.PI * 2);
    return finish(ctx, {
      mode: 'attack',
      goal: clampGoal({ x: home.x + Math.cos(angle) * 130, y: home.y + Math.sin(angle) * 130 }, ctx),
      goalKind: 'patrol'
    });
  }

  function decideDiplomacy(ctx) {
    if (!ctx || ctx.apiVersion !== API_VERSION || ctx.faction?.f !== BLUE || !ctx.faction.alive
      || ctx.phase !== 'battle' || ctx.time >= ctx.stormAt) return null;

    const pacts = (ctx.alliances || []).filter((pact) => pact.a === BLUE || pact.b === BLUE);
    const genome = currentGenome();
    if (pacts.length) {
      for (const ally of ctx.allies || []) {
        const pact = pacts.find((item) => (item.a === BLUE ? item.b : item.a) === ally);
        const partner = (ctx.factions || []).find((team) => team.f === ally && team.alive);
        if (pact && partner && ctx.time - pact.formedAt >= 18
          && diplomacyStrength(partner) >= diplomacyStrength(ctx.faction) * genome.get('betrayThreshold')
          && ctx.faction.hp < 1400) {
          return { type: 'betrayAlliance', targetFaction: ally };
        }
      }
      return null;
    }

    if (ctx.time <= 24 || ctx.aliveCount < 3 || ctx.cooldownRemaining > 0
      || typeof ctx.canFormAlliance !== 'function') return null;
    const candidates = (ctx.factions || []).filter((team) => team.f !== BLUE && team.alive
      && ctx.canFormAlliance(team.f));
    if (!candidates.length) return null;

    const ordered = candidates.map((team) => ({ team, strength: diplomacyStrength(team) }))
      .sort((a, b) => a.strength - b.strength);
    const weakest = ordered[0].team.f;
    const ownStrength = diplomacyStrength(ctx.faction);
    const amWeakest = ownStrength <= ordered[0].strength;
    let pool = candidates;
    if (!amWeakest && ordered.length > 1) pool = candidates.filter((team) => team.f !== weakest);
    if (!pool.length) pool = candidates;

    let best = null;
    let bestStrength = -Infinity;
    for (const team of pool) {
      let strength = diplomacyStrength(team);
      if (team.f === 0 || team.f === 3) strength *= genome.get('allyPrefMelee');
      if (amWeakest) strength *= 1.3;
      if (strength > bestStrength) {
        best = team;
        bestStrength = strength;
      }
    }
    return best && Math.random() < 0.6
      ? { type: 'formAlliance', targetFaction: best.f }
      : null;
  }

  function matchFitness(episode, result) {
    const rankScore = result.isWinner
      ? 1
      : ({ 1: 1, 2: 0.7, 3: 0.4, 4: 0.1 }[episode.lastRank] || 0.1);
    const territory = clamp(episode.maxTerritory, 0, 1);
    const castle = result.isWinner || episode.castleAlive ? 1 : 0;
    const kills = clamp(episode.maxKills / 5, 0, 1);
    const plaza = clamp(episode.maxPlaza / 0.3, 0, 1);
    return 0.5 * rankScore + 0.2 * territory + 0.1 * castle + 0.1 * kills + 0.1 * plaza;
  }

  function makeStrategy() {
    return {
      name: 'BlueTide strategic AI',
      version: '1.0.0',
      apiVersion: API_VERSION,
      decide,
      decideDiplomacy,
      onMatchEnd(result) {
        if (!result || result.apiVersion !== API_VERSION || result.faction !== BLUE || !state.episode) return;
        const fitness = matchFitness(state.episode, result);
        const saved = Store.get('episodes', []);
        const history = Array.isArray(saved) ? saved : [];
        history.push({
          generation: evolution.generation,
          genomeId: state.genomeEntry?.id ?? null,
          winner: result.winner,
          time: result.time,
          fitness,
          maxPlaza: state.episode.maxPlaza,
          maxTerritory: state.episode.maxTerritory,
          maxKills: state.episode.maxKills
        });
        Store.set('episodes', history.slice(-300));
        if (state.genomeEntry) evolution.record(state.genomeEntry.id, fitness);
        resetMatchState();
      }
    };
  }

  window.__installFourColorWarBlueAI = function install(api) {
    if (!api || api.apiVersion !== API_VERSION || typeof api.register !== 'function'
      || typeof api.setFactionStrategy !== 'function') {
      console.error('[BlueTide AI] FourColorWarAI v1.0.0 is required; Blue will keep its built-in AI.');
      return false;
    }
    const registered = api.register(PLUGIN_ID, makeStrategy());
    if (!registered || !api.setFactionStrategy(BLUE, PLUGIN_ID)) {
      console.error('[BlueTide AI] Could not register/assign the strategy; Blue will keep its built-in AI.');
      return false;
    }
    return true;
  };
})(window);
