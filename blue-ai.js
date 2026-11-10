/*
 * BlueTide AI v3, adapted to the public FourColorWarAI v1.0.0 plugin API.
 * This strategy only controls Blue (faction 1). It reads immutable game and
 * learning snapshots, returns decisions/diplomacy requests, and evolves its own
 * namespaced genome. It never patches game globals or writes native AI state.
 */
(function installBlueAIStrategy(window) {
  'use strict';

  const API_VERSION = '1.0.0';
  const PLUGIN_ID = 'blue-tide-strategic';
  const BLUE = 1;
  const HOME = [[78, 78], [742, 78], [78, 742], [742, 742]];
  const CENTER = Object.freeze({ x: 410, y: 410 });
  const PLAZA_RADIUS = 96;
  const PLAZA_NEED = 0.30;
  const STORAGE_PREFIX = 'bluetide_v3_';
  const POPULATION_SIZE = 20;
  const ELITE_COUNT = 5;

  const SCHEMA = Object.freeze({
    plazaWeight:        { min: 0.3, max: 3.0, init: 2.0 },
    skillWeight:        { min: 0.5, max: 3.0, init: 2.2 },
    defendWeight:       { min: 0.5, max: 3.0, init: 1.8 },
    expandWeight:       { min: 0.2, max: 2.0, init: 1.0 },
    splashWeight:       { min: 0.2, max: 2.0, init: 1.2 },
    towerRushWeight:    { min: 0.5, max: 3.0, init: 2.0 },
    towerRushThreshold: { min: 1.2, max: 2.5, init: 1.6 },
    territoryCap:       { min: 0.25, max: 0.45, init: 0.33 },
    safeDistance:       { min: 100, max: 220, init: 155 },
    pathDangerWeight:   { min: 10, max: 40, init: 22 },
    valueWeight:        { min: 5, max: 25, init: 12 },
    kitePriority:       { min: 1.0, max: 2.5, init: 1.55 },
    aggression:         { min: 0.5, max: 2.0, init: 1.20 },
    skillShield:        { min: 1.0, max: 2.0, init: 1.6 },
    skillHaste:         { min: 0.8, max: 2.0, init: 1.3 },
    skillCrown:         { min: 0.5, max: 1.5, init: 1.0 },
    betrayThreshold:    { min: 1.2, max: 2.2, init: 1.55 },
    allyMeleeBias:      { min: 0.6, max: 1.5, init: 1.1 }
  });

  const clamp = (value, min, max) => {
    const number = Number(value);
    return Math.max(min, Math.min(max, Number.isFinite(number) ? number : min));
  };
  const distance = (a, b) => Math.hypot((Number(a?.x) || 0) - (Number(b?.x) || 0), (Number(a?.y) || 0) - (Number(b?.y) || 0));
  const homeOf = (f) => ({ x: HOME[f][0], y: HOME[f][1] });
  const random = () => Math.random();

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
    }
  };

  function gaussian() {
    const u = Math.max(Number.EPSILON, random());
    const v = Math.max(Number.EPSILON, random());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  class Genome {
    constructor(values = null) {
      this.values = {};
      for (const [key, schema] of Object.entries(SCHEMA)) {
        const candidate = Number(values?.[key]);
        this.values[key] = clamp(Number.isFinite(candidate) ? candidate : schema.init, schema.min, schema.max);
      }
    }
    get(key) { return this.values[key]; }
    mutate(rate, scale) {
      for (const [key, schema] of Object.entries(SCHEMA)) {
        if (random() < rate) this.values[key] += gaussian() * (schema.max - schema.min) * scale;
      }
      this.clip();
    }
    clip() {
      for (const [key, schema] of Object.entries(SCHEMA)) {
        this.values[key] = clamp(this.values[key], schema.min, schema.max);
      }
    }
    cross(other) {
      const child = new Genome(this.values);
      for (const key of Object.keys(SCHEMA)) {
        if (random() < 0.5) child.values[key] = this.values[key];
        else if (random() < 0.5) child.values[key] = other.values[key];
        else {
          const mix = random();
          child.values[key] = mix * this.values[key] + (1 - mix) * other.values[key];
        }
      }
      child.clip();
      return child;
    }
    toJSON() { return { ...this.values }; }
  }

  class Evolution {
    constructor(populationSize = POPULATION_SIZE, eliteCount = ELITE_COUNT, mutationRate = 0.30, mutationScale = 0.16) {
      this.populationSize = populationSize;
      this.eliteCount = eliteCount;
      this.mutationRate = mutationRate;
      this.mutationScale = mutationScale;
      this.nextId = 1;
      this.evaluations = 0;
      this.generation = 0;
      this.history = [];
      const saved = Store.get('evolution', null);
      const valid = Array.isArray(saved?.population)
        && saved.population.length === populationSize
        && saved.population.every((entry) => entry && Number.isInteger(entry.id) && entry.genome);
      if (valid) {
        this.nextId = Math.max(1, Number(saved.nextId) || 1);
        this.generation = Math.max(0, Number(saved.generation) || 0);
        this.evaluations = clamp(saved.evaluations, 0, populationSize - 1);
        this.history = Array.isArray(saved.history) ? saved.history.slice(-80) : [];
        this.population = saved.population.map((entry) => ({
          id: entry.id,
          genome: new Genome(entry.genome),
          plays: Math.max(0, Number(entry.plays) || 0),
          fitness: Array.isArray(entry.fitness) ? entry.fitness.slice(-10).map((value) => Number(value) || 0) : [],
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
      for (let index = 0; index < this.populationSize; index++) {
        const genome = new Genome();
        if (index > 0) genome.mutate(0.45, 0.25);
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
      if (untried.length) return untried[Math.floor(random() * untried.length)];
      const total = this.population.reduce((sum, entry) => sum + entry.plays, 0) + 1;
      return this.population.reduce((best, entry) => {
        const score = entry.average + 0.5 * Math.sqrt(Math.log(total) / Math.max(1, entry.plays));
        return !best || score > best.score ? { entry, score } : best;
      }, null).entry;
    }
    record(id, fitness) {
      const entry = this.population.find((candidate) => candidate.id === id);
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
      for (let index = 0; index < size; index++) {
        const candidate = pool[Math.floor(random() * pool.length)];
        if (!best || candidate.average > best.average) best = candidate;
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
        const child = first.genome.cross(second.genome);
        child.mutate(this.mutationRate, this.mutationScale);
        next.push({ id: this.nextId++, genome: child, plays: 0, fitness: [], average: 0 });
      }
      this.population = next;
      this.evaluations = 0;
    }
  }

  function makeStrategy() {
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

    function visibleTeams(ctx) {
      const byFaction = new Map();
      for (const team of [ctx.faction, ...(ctx.enemies || []), ...(ctx.allies || [])]) {
        if (team && Number.isInteger(team.f)) byFaction.set(team.f, team);
      }
      return [...byFaction.values()];
    }

    function beginMatch(ctx) {
      state.focus = -1;
      state.nextReplanAt = 0;
      state.plazaClaimed = false;
      state.powerClaims.clear();
      state.genomeEntry = evolution.select();
      state.episode = {
        maxPlaza: 0,
        maxTerritoryRatio: 0,
        territoryRatio: 0,
        maxKills: 0,
        lastRank: 4,
        castleAlive: true,
        lastTime: Number(ctx.time) || 0,
        knownFactions: new Set(),
        eliminatedFactions: new Set(),
        betrayalTime: 0
      };
      observeMatch(ctx);
    }

    function observeMatch(ctx) {
      const episode = state.episode;
      const faction = ctx?.faction;
      if (!episode || !faction) return;
      const plazaShare = clamp(ctx.signals?.plazaShare ?? faction.plazaShare, 0, 1);
      episode.maxPlaza = Math.max(episode.maxPlaza, plazaShare);
      const teams = visibleTeams(ctx).filter((team) => team.alive);
      const totalLand = teams.reduce((sum, team) => sum + Math.max(0, Number(team.landShare) || 0), 0);
      const ownLand = Math.max(0, Number(faction.landShare) || 0);
      const territoryRatio = totalLand > 0 ? ownLand / totalLand : ownLand;
      episode.territoryRatio = territoryRatio;
      episode.maxTerritoryRatio = Math.max(episode.maxTerritoryRatio, territoryRatio);
      episode.maxKills = Math.max(episode.maxKills, Number(faction.kills) || 0);
      episode.castleAlive = !!faction.alive && (Number(faction.hp) || 0) > 0;
      episode.lastTime = Number(ctx.time) || episode.lastTime;
      if (Number.isInteger(faction.rank) && faction.rank >= 1 && faction.rank <= 4) {
        episode.lastRank = faction.rank;
      } else {
        const standings = teams.sort((a, b) => (Number(b.landShare) || 0) - (Number(a.landShare) || 0));
        episode.lastRank = standings.findIndex((team) => team.f === BLUE) + 1 || 4;
      }
      const aliveFactions = new Set(teams.map((team) => team.f));
      for (const factionId of episode.knownFactions) {
        if (factionId !== BLUE && !aliveFactions.has(factionId)) episode.eliminatedFactions.add(factionId);
      }
      for (const team of teams) if (team.f !== BLUE) episode.knownFactions.add(team.f);
      if (plazaShare > PLAZA_NEED) state.plazaClaimed = true;
    }

    function diplomacyStrength(team) {
      return (Number(team?.hp) || 0) + (Number(team?.count) || 0) * 60;
    }

    function learnedWeight(ctx, mode) {
      const raw = Number(ctx.learning?.policy?.[mode]);
      const policy = Number.isFinite(raw) ? clamp(raw, 0.45, 2.2) : 1;
      const situation = ctx.signals?.situation;
      const contextQ = Number(ctx.learning?.ctxQ?.[situation]?.[mode]) || 0;
      return clamp(policy * Math.exp(clamp(contextQ, -2, 2) * 0.16), 0.45, 2.3);
    }

    function learnedRouteWeight(ctx, route) {
      const raw = Number(ctx.learning?.routePolicy?.[route]);
      return Number.isFinite(raw) ? clamp(raw, 0.55, 1.8) : 1;
    }

    function currentGenome() {
      return state.genomeEntry?.genome || new Genome();
    }

    function activeEnemies(ctx) {
      return (ctx.enemies || []).filter((team) => team?.alive && team.f !== BLUE);
    }

    function calculateAdvantage(ctx, enemies) {
      const own = diplomacyStrength(ctx.faction);
      const strongestEnemy = enemies.reduce((maximum, team) => Math.max(maximum, diplomacyStrength(team)), 0);
      return strongestEnemy > 0 ? own / strongestEnemy : 2;
    }

    function weakestEnemy(enemies) {
      return enemies.reduce((best, team) => !best || (Number(team.hp) || 0) < (Number(best.hp) || 0) ? team : best, null);
    }

    function chooseFocus(ctx, enemies, genome, advantage) {
      if (!enemies.length) {
        state.focus = -1;
        return null;
      }
      const weakest = weakestEnemy(enemies);
      if (advantage >= genome.get('towerRushThreshold') * 0.85 && weakest) {
        state.focus = weakest.f;
        state.nextReplanAt = Number(ctx.time) + 0.75;
        return weakest;
      }
      const stillAlive = enemies.some((team) => team.f === state.focus);
      if (Number(ctx.time) < state.nextReplanAt && stillAlive) return enemies.find((team) => team.f === state.focus);
      const ownHome = homeOf(BLUE);
      let best = null;
      let bestScore = Infinity;
      for (const team of enemies) {
        const enemyHome = homeOf(team.f);
        const homeDistance = distance(ownHome, enemyHome);
        const visibleThreat = (ctx.nearbyEnemies || []).some((unit) => unit.f === team.f
          && distance(unit, ownHome) < 400) ? 220 : 0;
        const score = (Number(team.hp) || 0) * 0.45 + (Number(team.count) || 0) * 12
          + homeDistance * 0.62 - visibleThreat - (team.f === state.focus ? 110 : 0);
        if (score < bestScore) {
          best = team;
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
        const score = distance(ctx.unit, enemy) - (1 - enemyHealth) * 12;
        const bestScore = distance(ctx.unit, best) - (1 - bestHealth) * 12;
        return score < bestScore ? enemy : best;
      });
    }

    function clampGoal(point, ctx) {
      const width = Number(ctx.world?.width) || 820;
      const height = Number(ctx.world?.height) || 820;
      return { x: clamp(point.x, 14, width - 14), y: clamp(point.y, 14, height - 14) };
    }

    function routeStyle(ctx) {
      return learnedRouteWeight(ctx, 'flank') > learnedRouteWeight(ctx, 'direct') * 1.03 ? 'flank' : 'direct';
    }

    function typeWeight(type, genome) {
      if (type === 0) return genome.get('skillHaste');
      if (type === 1) return genome.get('skillShield');
      if (type === 3) return genome.get('skillCrown');
      return 0.9; // Bombs retain the game's native boundary-only placement and collection rules.
    }

    function nearbyDanger(point, enemies) {
      let risk = 0;
      for (const enemy of enemies) {
        const d = distance(point, enemy);
        if (d < 160) risk += (1 - d / 160);
      }
      return risk;
    }

    function pathCost(ctx, from, to, genome, enemies) {
      let cost = distance(from, to) / 25;
      const steps = 10;
      for (let index = 1; index < steps; index++) {
        const t = index / steps;
        const point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
        cost += nearbyDanger(point, enemies) * genome.get('pathDangerWeight') * 0.04;
        for (const enemy of activeEnemies(ctx)) {
          const d = distance(point, homeOf(enemy.f));
          if (d > 100 && d < 400) cost -= (1 - d / 400) * genome.get('valueWeight') * 0.025;
        }
        const tileSize = Number(ctx.map?.tileSize) || Number(ctx.world?.tileSize) || 25.625;
        const owner = ctx.map?.ownerAtTile?.(Math.floor(point.x / tileSize), Math.floor(point.y / tileSize));
        if (Number.isInteger(owner) && owner >= 0 && owner !== BLUE && !isAlly(ctx, owner)) cost -= genome.get('valueWeight') * 0.012;
      }
      return cost;
    }

    function isAlly(ctx, faction) {
      return (ctx.allies || []).some((team) => team.f === faction);
    }

    function safetyPenalty(ctx, point, genome, nearby) {
      let minimum = Infinity;
      for (const enemy of nearby) {
        if (enemy.type === 1 || enemy.type === 4) continue;
        minimum = Math.min(minimum, distance(point, enemy));
      }
      return minimum < genome.get('safeDistance') ? (genome.get('safeDistance') - minimum) * 0.4 : 0;
    }

    function jitter(goal, unit, radius = 30) {
      const angle = ((Number(unit.id) || 0) * 2.399963229728653) % (Math.PI * 2);
      return { x: goal.x + Math.cos(angle) * radius, y: goal.y + Math.sin(angle) * radius };
    }

    function plazaGoal(ctx) {
      const center = CENTER;
      const radius = PLAZA_RADIUS * 0.55;
      const relevantEnemy = (ctx.nearbyEnemies || []).find((enemy) => distance(enemy, center) < PLAZA_RADIUS);
      const angle = relevantEnemy
        ? Math.atan2(relevantEnemy.y - center.y, relevantEnemy.x - center.x)
        : ((Number(ctx.unit.id) || 0) * 2.399963229728653) % (Math.PI * 2);
      return clampGoal(jitter({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius }, ctx.unit), ctx);
    }

    function expansionGoal(ctx, enemy) {
      const enemyHome = homeOf(enemy.f);
      const tileSize = Number(ctx.map?.tileSize) || Number(ctx.world?.tileSize) || 25.625;
      const width = Number(ctx.world?.width) || 820;
      const height = Number(ctx.world?.height) || 820;
      const candidates = [];
      for (let index = 0; index < 16; index++) {
        const angle = ((Number(ctx.unit.id) || 0) * 2.7 + enemy.f + index * Math.PI / 8) % (Math.PI * 2);
        for (const radius of [190, 230, 270]) {
          const point = clampGoal({ x: enemyHome.x + Math.cos(angle) * radius, y: enemyHome.y + Math.sin(angle) * radius }, ctx);
          const tx = Math.floor(point.x / tileSize);
          const ty = Math.floor(point.y / tileSize);
          const owner = ctx.map?.ownerAtTile?.(tx, ty);
          const obstacle = ctx.map?.isObstacleTile?.(tx, ty) === true;
          const protectedForRival = ctx.map?.isProtectedFor?.(enemy.f, tx, ty) === true;
          const score = (owner === enemy.f ? 100 : 0) - (obstacle ? 1000 : 0) - (protectedForRival ? 200 : 0)
            - Math.abs(radius - 230) * 0.02 - distance(ctx.unit, point) * 0.001;
          candidates.push({ point, score });
        }
      }
      candidates.sort((a, b) => b.score - a.score);
      const valid = candidates.find((candidate) => candidate.score > -500);
      if (valid) return valid.point;
      return clampGoal({ x: enemyHome.x + (ctx.unit.id % 2 ? 1 : -1) * 230, y: enemyHome.y + ((ctx.unit.id % 3) - 1) * 90 }, ctx);
    }

    function localCluster(nearby) {
      if (nearby.length < 4) return null;
      let best = null;
      let bestCount = 0;
      for (const unit of nearby) {
        const count = nearby.reduce((sum, other) => sum + (distance(unit, other) < 120 ? 1 : 0), 0);
        if (count > bestCount) {
          best = { x: unit.x, y: unit.y, count };
          bestCount = count;
        }
      }
      return bestCount >= 4 ? best : null;
    }

    function findPower(ctx, genome, policy, nearby) {
      let best = null;
      let bestScore = -Infinity;
      const unitId = ctx.unit.id;
      const skillFactor = Math.sqrt(Math.max(0.35, policy.skill * learnedRouteWeight(ctx, 'skill')));
      for (const power of ctx.powers || []) {
        if (!Number.isFinite(power.x) || !Number.isFinite(power.y) || Number(power.life) <= 0) continue;
        const d = distance(ctx.unit, power);
        if (d > 500) continue;
        const key = `${power.type}:${power.x.toFixed(1)}:${power.y.toFixed(1)}`;
        const claims = [...state.powerClaims.entries()].filter(([id, claim]) => id !== unitId && claim.key === key).length;
        if (claims >= 2) continue;
        const expiry = 0.82 + 0.18 * clamp(Number(power.life) / 17, 0, 1);
        const typePriority = typeWeight(power.type, genome);
        const shieldHomeBonus = power.type === 1 && distance(power, homeOf(BLUE)) < 220 ? 1.4 : 1;
        const value = 9 * genome.get('skillWeight') * learnedWeight(ctx, 'skill') * typePriority * shieldHomeBonus;
        const score = value - d / 25 * expiry - nearbyDanger(power, nearby) * genome.get('pathDangerWeight') * 0.04;
        if (score < bestScore) continue;
        best = { power, key, score };
        bestScore = score;
      }
      return best;
    }

    function selectObjective(ctx, genome, enemies, focus, advantage, policy) {
      const candidates = [];
      const unit = ctx.unit;
      const nearby = ctx.nearbyEnemies || [];
      const ownHome = homeOf(BLUE);
      const plazaShare = clamp(ctx.signals?.plazaShare ?? ctx.faction.plazaShare, 0, 1);
      const rows = visibleTeams(ctx).filter((team) => team.alive);
      const landTotal = rows.reduce((sum, team) => sum + Math.max(0, Number(team.landShare) || 0), 0);
      const territoryRatio = landTotal > 0 ? (Number(ctx.faction.landShare) || 0) / landTotal : Number(ctx.faction.landShare) || 0;
      const rank = Number(ctx.faction.rank) || 4;
      const homePressure = clamp(ctx.signals?.homePressure, 0, 1);
      const castleLoss = clamp(ctx.signals?.castleLoss, 0, 1);
      const threat = clamp(homePressure + castleLoss * 0.25, 0, 1);
      const routeAttack = learnedRouteWeight(ctx, 'tower');
      const add = (goal, kind, priority, targetFaction = null, route = 'direct') => {
        const point = clampGoal(goal, ctx);
        const score = priority - pathCost(ctx, unit, point, genome, nearby)
          - safetyPenalty(ctx, point, genome, nearby)
          - (point.x < 40 || point.y < 40 || point.x > (Number(ctx.world?.width) || 820) - 40
            || point.y > (Number(ctx.world?.height) || 820) - 40 ? 30 : 0);
        candidates.push({ goal: point, kind, priority, targetFaction, route, score });
      };

      if (!state.plazaClaimed && plazaShare < PLAZA_NEED && Number(ctx.time) < (Number(ctx.world?.stormAt) || 480)) {
        add(plazaGoal(ctx), 'plaza', 10 * genome.get('plazaWeight')
          * Math.sqrt(learnedWeight(ctx, 'attack') * learnedRouteWeight(ctx, 'center')));
      }

      const power = findPower(ctx, genome, policy, nearby);
      if (power) add(power.power, 'power', power.score);

      if (threat > 0.1) {
        const intruder = nearby.reduce((best, enemy) => !best || distance(enemy, ownHome) < distance(best, ownHome) ? enemy : best, null);
        const angle = intruder
          ? Math.atan2(intruder.y - ownHome.y, intruder.x - ownHome.x)
          : Math.atan2(CENTER.y - ownHome.y, CENTER.x - ownHome.x);
        const goal = intruder ? { x: intruder.x, y: intruder.y }
          : { x: ownHome.x + Math.cos(angle) * 130, y: ownHome.y + Math.sin(angle) * 130 };
        const defendWeight = learnedWeight(ctx, 'defend') * learnedRouteWeight(ctx, 'defend') * policy.defend;
        add(jitter(goal, unit, 22), 'defend', (6 + threat * 4) * genome.get('defendWeight') * defendWeight,
          intruder?.f ?? null, 'flank');
      }

      const weak = weakestEnemy(enemies);
      if (advantage >= genome.get('towerRushThreshold') && weak) {
        const enemyHome = homeOf(weak.f);
        const angle = ((Number(unit.id) || 0) * 1.7) % (Math.PI * 2);
        const radius = 80;
        add({ x: enemyHome.x + Math.cos(angle) * radius, y: enemyHome.y + Math.sin(angle) * radius },
          'tower', 12 * genome.get('towerRushWeight') * (advantage / 2)
            * learnedWeight(ctx, 'attack') * routeAttack, weak.f, 'flank');
      }

      const stopExpansion = rank === 1 && territoryRatio > genome.get('territoryCap');
      if (!stopExpansion && Number(ctx.time) > 45) {
        for (const enemy of enemies) {
          add(expansionGoal(ctx, enemy), 'patrol', 5 * genome.get('expandWeight') * learnedWeight(ctx, 'attack'), enemy.f, 'flank');
        }
      }

      const cluster = localCluster(nearby);
      if (cluster) {
        const angle = Math.atan2(unit.y - cluster.y, unit.x - cluster.x);
        add({ x: cluster.x + Math.cos(angle) * 150, y: cluster.y + Math.sin(angle) * 150 },
          'patrol', 6 * genome.get('splashWeight') * learnedWeight(ctx, 'attack'), focus?.f ?? null, 'flank');
      }

      if (focus) {
        const enemyHome = homeOf(focus.f);
        const angle = ((Number(unit.id) || 0) * 1.7) % (Math.PI * 2);
        const radius = 80;
        const towerPriority = 7 * policy.attack * routeAttack + (Number(ctx.time) > 85 ? 8 : 0);
        add({ x: enemyHome.x + Math.cos(angle) * radius, y: enemyHome.y + Math.sin(angle) * radius },
          'tower', towerPriority, focus.f, 'flank');
      }

      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];
      if (!best) {
        const angle = ((Number(unit.id) || 0) * 1.3) % (Math.PI * 2);
        return { goal: clampGoal({ x: ownHome.x + Math.cos(angle) * 130, y: ownHome.y + Math.sin(angle) * 130 }, ctx), kind: 'patrol', targetFaction: null, route: routeStyle(ctx) };
      }
      if (best.kind === 'power') {
        const powerRow = power.power;
        state.powerClaims.set(unit.id, { key: power.key, lastSeen: Number(ctx.time) || 0 });
        return { goal: best.goal, kind: best.kind, targetFaction: focus?.f ?? null, route: best.route, power: powerRow };
      }
      state.powerClaims.delete(unit.id);
      return { goal: best.goal, kind: best.kind, targetFaction: best.targetFaction ?? focus?.f ?? null, route: best.route };
    }

    function retreatGoal(ctx, target) {
      const unit = ctx.unit;
      const home = homeOf(BLUE);
      const toHome = { x: home.x - unit.x, y: home.y - unit.y };
      const homeLength = Math.hypot(toHome.x, toHome.y) || 1;
      const away = target ? { x: unit.x - target.x, y: unit.y - target.y } : toHome;
      const awayLength = Math.hypot(away.x, away.y) || 1;
      let dx = toHome.x / homeLength * 0.72 + away.x / awayLength * 0.28;
      let dy = toHome.y / homeLength * 0.72 + away.y / awayLength * 0.28;
      const length = Math.hypot(dx, dy) || 1;
      const side = ((unit.id % 5) - 2) * 14;
      const missingHp = 1 - clamp(unit.hp / Math.max(1, unit.maxHp), 0, 1);
      const step = 80 + missingHp * 55;
      return clampGoal({
        x: unit.x + dx / length * step - dy / length * side,
        y: unit.y + dy / length * step + dx / length * side
      }, ctx);
    }

    function currentPolicy(ctx, genome, advantage, hpRatio, threat) {
      const policy = {
        attack: genome.get('aggression') * learnedWeight(ctx, 'attack'),
        kite: genome.get('kitePriority') * learnedWeight(ctx, 'kite') * learnedRouteWeight(ctx, 'kite'),
        defend: genome.get('defendWeight') * learnedWeight(ctx, 'defend'),
        retreat: (1 + (1 - hpRatio) * 0.7) * learnedWeight(ctx, 'retreat') * learnedRouteWeight(ctx, 'retreat'),
        skill: genome.get('skillWeight') * learnedWeight(ctx, 'skill')
      };
      if (advantage > 1.5) {
        policy.attack *= 1.3;
        policy.defend *= 0.7;
        policy.kite *= 0.9;
      } else if (advantage < 0.7) {
        policy.attack *= 0.7;
        policy.kite *= 1.2;
        policy.defend *= 1.4;
      }
      if (threat > 0.5) {
        policy.attack *= 0.6;
        policy.defend *= 1.8;
      }
      return policy;
    }

    function decide(ctx) {
      if (!ctx || ctx.apiVersion !== API_VERSION || ctx.faction?.f !== BLUE || !ctx.unit || ctx.unit.f !== BLUE) return null;
      const currentTime = Number(ctx.time) || 0;
      if (state.lastTime >= 0 && currentTime < state.lastTime - 1) resetMatchState();
      state.lastTime = currentTime;
      if (!state.episode) beginMatch(ctx);
      observeMatch(ctx);
      for (const [unitId, claim] of state.powerClaims) {
        if (currentTime - claim.lastSeen > 2.25) state.powerClaims.delete(unitId);
      }

      const genome = currentGenome();
      const enemies = activeEnemies(ctx);
      const advantage = calculateAdvantage(ctx, enemies);
      const focus = chooseFocus(ctx, enemies, genome, advantage);
      const target = targetForFaction(ctx, focus?.f) || ctx.target || (ctx.nearbyEnemies || [])[0] || null;
      const homePressure = clamp(ctx.signals?.homePressure, 0, 1);
      const localPressure = clamp(ctx.signals?.localPressure, 0, 1);
      const castleLoss = clamp(ctx.signals?.castleLoss, 0, 1);
      const hpRatio = clamp((Number(ctx.unit.hp) || 0) / Math.max(1, Number(ctx.unit.maxHp) || 1), 0, 1);
      const missingHp = 1 - hpRatio;
      const threat = clamp(homePressure * 0.65 + localPressure * 0.25 + castleLoss * 0.5, 0, 1);
      const policy = currentPolicy(ctx, genome, advantage, hpRatio, threat);
      const route = routeStyle(ctx);

      const retreatScore = (missingHp * 0.72 + localPressure * 0.2 + homePressure * 0.12)
        * Math.sqrt(Math.max(0.35, policy.retreat));
      if (hpRatio < 0.50 && retreatScore > 0.46 && (target || homePressure > 0.25)) {
        state.powerClaims.delete(ctx.unit.id);
        return {
          mode: 'retreat', goal: retreatGoal(ctx, target), goalKind: 'retreat',
          targetFaction: target?.f ?? focus?.f ?? null, targetId: target?.id ?? null,
          routeStyle: route, refreshAfter: 0.5
        };
      }

      const ranged = ctx.unit.type === 1 || ctx.unit.type === 4;
      const kiteBias = policy.kite;
      if (target && kiteBias > 0.72) {
        const d = distance(ctx.unit, target);
        if ((ranged && d < 120) || (!ranged && missingHp > 0.68 && d < 78)) {
          const dx = ctx.unit.x - target.x;
          const dy = ctx.unit.y - target.y;
          const length = Math.hypot(dx, dy) || 1;
          const step = ranged ? 62 : 90 + missingHp * 35;
          state.powerClaims.delete(ctx.unit.id);
          return {
            mode: 'kite',
            goal: clampGoal({ x: ctx.unit.x + dx / length * step, y: ctx.unit.y + dy / length * step }, ctx),
            goalKind: 'kite', targetFaction: target.f, targetId: target.id,
            routeStyle: route, refreshAfter: 0.5
          };
        }
      }

      const objective = selectObjective(ctx, genome, enemies, focus, advantage, policy);
      const mode = objective.kind === 'power' ? 'skill'
        : objective.kind === 'defend' ? 'defend'
          : objective.kind === 'retreat' ? 'retreat'
            : objective.kind === 'kite' ? 'kite' : 'attack';
      const targetId = objective.targetFaction === focus?.f ? targetForFaction(ctx, focus.f)?.id ?? null : null;
      return {
        mode,
        goal: objective.goal,
        goalKind: objective.kind,
        targetFaction: objective.targetFaction,
        targetId,
        routeStyle: objective.route === 'flank' || route === 'flank' ? 'flank' : 'direct',
        refreshAfter: 0.75
      };
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
            if (state.episode) state.episode.betrayalTime = Math.min(15, state.episode.betrayalTime + 15);
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
        if (team.f === 0 || team.f === 3) strength *= genome.get('allyMeleeBias');
        if (amWeakest) strength *= 1.25;
        if (strength > bestStrength) {
          best = team;
          bestStrength = strength;
        }
      }
      return best && random() < 0.6 ? { type: 'formAlliance', targetFaction: best.f } : null;
    }

    function matchFitness(episode, result) {
      const won = result.isWinner ? 1 : 0;
      const towers = clamp(episode.eliminatedFactions.size / 3, 0, 1);
      const rankScore = result.isWinner ? 1 : ({ 1: 1, 2: 0.6, 3: 0.3, 4: 0.1 }[episode.lastRank] || 0.1);
      const survived = result.isWinner || episode.castleAlive ? 1 : 0;
      let territoryScore = clamp(episode.territoryRatio / 0.30, 0, 1);
      if (episode.lastRank === 1 && episode.territoryRatio > 0.35) {
        territoryScore -= (episode.territoryRatio - 0.35) * 2;
      }
      const betrayalPenalty = clamp(episode.betrayalTime / 15, 0, 1) * 0.05;
      return 0.40 * won + 0.22 * towers + 0.15 * rankScore + 0.13 * survived
        + 0.10 * territoryScore - betrayalPenalty;
    }

    return {
      name: 'BlueTide AI v3 strategic policy',
      version: '3.0.0',
      apiVersion: API_VERSION,
      decide,
      decideDiplomacy,
      onMatchEnd(result) {
        if (!result || result.apiVersion !== API_VERSION || result.faction !== BLUE || !state.episode) return;
        const episode = state.episode;
        const fitness = matchFitness(episode, result);
        const saved = Store.get('episodes', []);
        const history = Array.isArray(saved) ? saved : [];
        history.push({
          generation: evolution.generation,
          genomeId: state.genomeEntry?.id ?? null,
          winner: result.winner,
          time: result.time,
          fitness,
          maxPlaza: episode.maxPlaza,
          maxTerritoryRatio: episode.maxTerritoryRatio,
          maxKills: episode.maxKills,
          eliminatedFactions: episode.eliminatedFactions.size,
          rank: episode.lastRank
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
