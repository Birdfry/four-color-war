'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'blue-ai.js'), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function createHarness(initialAssignments = [null, null, null, 'yellow-strategic']) {
  const registrations = new Map();
  const assignments = [...initialAssignments];
  const storage = new Map();
  const window = {
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); }
    }
  };
  const math = Object.create(Math);
  math.random = () => 0.1;
  vm.runInNewContext(source, { window, console, Math: math });
  const api = {
    apiVersion: '1.0.0',
    register(id, strategy) {
      registrations.set(id, strategy);
      return true;
    },
    setFactionStrategy(faction, id) {
      assignments[faction] = id;
      return true;
    }
  };
  assert.equal(window.__installFourColorWarBlueAI(api), true);
  const strategy = registrations.get('blue-tide-strategic');
  assert.ok(strategy);
  return { strategy, assignments, registrations, window, storage, api };
}

function context(overrides = {}) {
  const base = {
    apiVersion: '1.0.0',
    time: 20,
    phase: 'battle',
    world: { width: 820, height: 820, tileSize: 25.625, stormAt: 480, verdictAt: 600 },
    map: {
      width: 820, height: 820, gridSize: 32, tileSize: 25.625,
      isObstacleTile: () => false,
      ownerAtTile: () => -1,
      isProtectedFor: () => false
    },
    faction: {
      f: 1, alive: true, hp: 2000, maxHp: 2000, land: 160, landShare: 0.16,
      rank: 2, count: 12, kills: 0, plazaShare: 0.1
    },
    unit: { id: 1, f: 1, type: 0, x: 700, y: 180, hp: 100, maxHp: 100, mode: null, goalKind: null },
    enemies: [
      { f: 0, alive: true, hp: 1200, maxHp: 2000, land: 100, landShare: 0.10, count: 20, kills: 2, rank: 3 },
      { f: 2, alive: true, hp: 1500, maxHp: 2000, land: 150, landShare: 0.15, count: 18, kills: 4, rank: 1 },
      { f: 3, alive: true, hp: 1800, maxHp: 2000, land: 120, landShare: 0.12, count: 16, kills: 3, rank: 2 }
    ],
    allies: [],
    target: null,
    nearbyEnemies: [],
    targetFaction: null,
    powers: [],
    learning: {
      code: 'balanced',
      policy: { attack: 1, kite: 1, defend: 1, retreat: 1, skill: 1 },
      routePolicy: { tower: 1, center: 1, skill: 1, defend: 1, retreat: 1, kite: 1, direct: 1, flank: 1 },
      ctxQ: {}
    },
    signals: { situation: 'c0', homePressure: 0, localPressure: 0, castleLoss: 0, plazaShare: 0.1 }
  };
  const result = { ...base, ...overrides };
  result.faction = { ...base.faction, ...(overrides.faction || {}) };
  result.unit = { ...base.unit, ...(overrides.unit || {}) };
  result.learning = { ...base.learning, ...(overrides.learning || {}) };
  result.signals = { ...base.signals, ...(overrides.signals || {}) };
  result.world = { ...base.world, ...(overrides.world || {}) };
  result.map = { ...base.map, ...(overrides.map || {}) };
  return result;
}

function diplomacyContext(overrides = {}) {
  const factions = [
    { f: 0, alive: true, hp: 500, land: 10, count: 5 },
    { f: 1, alive: true, hp: 1000, land: 30, count: 12 },
    { f: 2, alive: true, hp: 1500, land: 80, count: 20 },
    { f: 3, alive: true, hp: 2000, land: 100, count: 25 }
  ];
  return {
    apiVersion: '1.0.0',
    time: 30,
    phase: 'battle',
    stormAt: 480,
    faction: factions[1],
    factions,
    allies: [],
    alliances: [],
    aliveCount: 4,
    cooldownRemaining: 0,
    canFormAlliance: () => true,
    ...overrides
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

test('registers BlueTide v3 through the public API and assigns only Blue by default', () => {
  const { strategy, assignments, window } = createHarness();
  assert.deepEqual(assignments, [null, 'blue-tide-strategic', null, 'yellow-strategic']);
  assert.equal(strategy.name, 'BlueTide AI v3 strategic policy');
  assert.equal(strategy.version, '3.0.0');
  assert.equal(typeof strategy.decide, 'function');
  assert.equal(typeof strategy.decideDiplomacy, 'function');
  assert.equal(window.update, undefined);
  assert.equal(window.reset, undefined);
  assert.equal(window.selectTargetFaction, undefined);
  assert.equal(window.canFormAlliance, undefined);
  assert.equal(window.BlueTide, undefined);
});

test('overwrites only the Blue binding while preserving pre-existing Red, Green, and Yellow plugins', () => {
  const { assignments } = createHarness(['red-custom', 'blue-legacy', 'green-custom', 'yellow-strategic']);
  assert.deepEqual(assignments, ['red-custom', 'blue-tide-strategic', 'green-custom', 'yellow-strategic']);
});

test('rejects incompatible API versions and never decides for another faction', () => {
  const registrations = new Map();
  const window = {};
  vm.runInNewContext(source, { window, console, Math });
  assert.equal(window.__installFourColorWarBlueAI({ apiVersion: '2.0.0', register: () => true, setFactionStrategy: () => true }), false);
  const { strategy } = createHarness();
  assert.equal(strategy.decide(context({ faction: { f: 3 }, unit: { f: 3 } })), null);
  assert.equal(strategy.decide({ ...context(), apiVersion: '2.0.0' }), null);
});

test('forces a real move into the plaza until Blue reaches the one-time reward threshold', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(context());
  assert.equal(result.mode, 'attack');
  assert.equal(result.goalKind, 'plaza');
  assert.ok(Math.hypot(result.goal.x - 410, result.goal.y - 410) < 96, 'the destination lies inside the plaza');
  assert.notDeepEqual(plain(result.goal), { x: 410, y: 410 });
});

test('prioritizes a nearby high-value shield after the plaza reward is secured', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(context({
    faction: { plazaShare: 0.4 },
    signals: { plazaShare: 0.4 },
    unit: { x: 675, y: 155 },
    powers: [
      { x: 690, y: 160, type: 0, life: 15 },
      { x: 675, y: 155, type: 1, life: 15 }
    ]
  }));
  assert.equal(result.mode, 'skill');
  assert.equal(result.goalKind, 'power');
  assert.deepEqual(plain(result.goal), { x: 675, y: 155 });
});

test('switches from expansion to a defensive position as Blue faces castle pressure', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(context({
    time: 80,
    faction: { hp: 1000, plazaShare: 0.4 },
    signals: { plazaShare: 0.4, homePressure: 1, castleLoss: 0.5 }
  }));
  assert.equal(result.mode, 'defend');
  assert.equal(result.goalKind, 'defend');
});

test('retreats a damaged Blue unit under sufficient nearby pressure', () => {
  const { strategy } = createHarness();
  const enemy = { id: 88, f: 0, type: 0, x: 680, y: 170, hp: 80, maxHp: 100 };
  const result = strategy.decide(context({
    faction: { plazaShare: 0.4 },
    unit: { hp: 35, maxHp: 100 },
    target: enemy,
    nearbyEnemies: [enemy],
    signals: { plazaShare: 0.4, localPressure: 0.5, homePressure: 0.3 }
  }));
  assert.equal(result.mode, 'retreat');
  assert.equal(result.goalKind, 'retreat');
  assert.ok(result.goal.x > 680 || result.goal.y < 170, 'the retreat vector leads away from the attacker and toward Blue home');
});

test('uses learned flank preferences and bounded public decision fields', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(context({
    faction: { plazaShare: 0.4 },
    signals: { plazaShare: 0.4 },
    learning: { routePolicy: { flank: 1.5, direct: 1 } }
  }));
  assert.equal(result.routeStyle, 'flank');
  assert.ok(result.refreshAfter >= 0.25 && result.refreshAfter <= 5);
  assert.ok(['tower', 'plaza', 'power', 'defend', 'retreat', 'kite', 'patrol'].includes(result.goalKind));
});

test('requests alliances only through the API eligibility check and game-owned action hook', () => {
  const { strategy } = createHarness();
  let checks = 0;
  const action = strategy.decideDiplomacy(diplomacyContext({
    canFormAlliance: (faction) => { checks++; return faction === 3; }
  }));
  assert.deepEqual(plain(action), { type: 'formAlliance', targetFaction: 3 });
  assert.ok(checks >= 3);
});

test('requests betrayal only for a mature pact when a much stronger ally threatens vulnerable Blue', () => {
  const { strategy } = createHarness();
  const factions = [
    { f: 0, alive: true, hp: 2000, land: 100, count: 100 },
    { f: 1, alive: true, hp: 700, land: 20, count: 2 },
    { f: 2, alive: true, hp: 1000, land: 50, count: 8 },
    { f: 3, alive: false, hp: 0, land: 0, count: 0 }
  ];
  const action = strategy.decideDiplomacy(diplomacyContext({
    time: 35,
    faction: factions[1],
    factions,
    allies: [0],
    alliances: [{ a: 0, b: 1, formedAt: 10, remaining: 30 }]
  }));
  assert.deepEqual(plain(action), { type: 'betrayAlliance', targetFaction: 0 });
});

test('leaves diplomacy to the game during cooldown, outside battle, or after the storm starts', () => {
  const { strategy } = createHarness();
  assert.equal(strategy.decideDiplomacy(diplomacyContext({ cooldownRemaining: 3 })), null);
  assert.equal(strategy.decideDiplomacy(diplomacyContext({ phase: 'end' })), null);
  assert.equal(strategy.decideDiplomacy(diplomacyContext({ time: 480 })), null);
});

test('does not mutate the read-only game context or native reward-learning snapshot', () => {
  const { strategy } = createHarness();
  const ctx = deepFreeze(context({
    learning: {
      policy: { attack: 1.2, kite: 1.1, defend: 1, retreat: 1, skill: 1.3 },
      routePolicy: { tower: 1, center: 1, skill: 1, defend: 1, retreat: 1, kite: 1, direct: 1, flank: 1 },
      ctxQ: { c0: { attack: 0.2 } }
    }
  }));
  const before = plain(ctx.learning);
  assert.ok(strategy.decide(ctx));
  assert.deepEqual(plain(ctx.learning), before);
});

test('learns its own strategy parameters across completed matches without changing Blue/Yellow assignments', () => {
  const { strategy, assignments, storage } = createHarness();
  const initial = JSON.parse(storage.get('bluetide_v3_evolution'));
  const originalGenomes = new Set(initial.population.map((entry) => JSON.stringify(entry.genome)));

  for (let match = 0; match < 20; match++) {
    strategy.decide(context({ time: 0 }));
    strategy.onMatchEnd({
      apiVersion: '1.0.0',
      faction: 1,
      winner: match % 2,
      isWinner: match % 2 === 1,
      time: 90,
      learning: { policy: {}, routePolicy: {}, ctxQ: {} }
    });
  }

  const learned = JSON.parse(storage.get('bluetide_v3_evolution'));
  const episodes = JSON.parse(storage.get('bluetide_v3_episodes'));
  assert.deepEqual(assignments, [null, 'blue-tide-strategic', null, 'yellow-strategic']);
  assert.equal(learned.generation, initial.generation + 1);
  assert.equal(learned.evaluations, 0);
  assert.ok(learned.population.some((entry) => !originalGenomes.has(JSON.stringify(entry.genome))));
  assert.equal(episodes.length, 20);
});

test('resets per-match objectives after completion while keeping evolution history', () => {
  const { strategy, storage } = createHarness();
  strategy.decide(context({ time: 20, faction: { plazaShare: 0.4 }, signals: { plazaShare: 0.4 } }));
  strategy.onMatchEnd({ apiVersion: '1.0.0', faction: 1, winner: 1, isWinner: true, time: 90 });
  const next = strategy.decide(context({ time: 0, faction: { plazaShare: 0.1 }, signals: { plazaShare: 0.1 } }));
  assert.equal(next.goalKind, 'plaza');
  assert.ok(storage.has('bluetide_v3_evolution'));
});


test('rushes the weakest castle at the source strategy radius when Blue has a decisive strength advantage', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(context({
    time: 20,
    faction: { hp: 6000, maxHp: 6000, count: 90, plazaShare: 0.4 },
    enemies: [
      { f: 0, alive: true, hp: 500, maxHp: 2000, landShare: 0.05, count: 3, rank: 4 },
      { f: 2, alive: true, hp: 1500, maxHp: 2000, landShare: 0.15, count: 18, rank: 2 },
      { f: 3, alive: true, hp: 1800, maxHp: 2000, landShare: 0.18, count: 16, rank: 1 }
    ],
    unit: { x: 500, y: 500 },
    signals: { plazaShare: 0.4 }
  }));
  assert.equal(result.goalKind, 'tower');
  assert.equal(result.targetFaction, 0);
  assert.ok(Math.abs(Math.hypot(result.goal.x - 78, result.goal.y - 78) - 80) < 0.01);
});
