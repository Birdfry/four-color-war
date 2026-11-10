'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'blue-ai.js'), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function createHarness() {
  const registrations = new Map();
  const assignments = [null, null, null, null];
  const window = {};
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
  return { strategy, assignments, window };
}

function strategyContext(overrides = {}) {
  const faction = {
    f: 1, alive: true, hp: 2000, maxHp: 2000, land: 120, landShare: 0.1,
    rank: 2, count: 12, kills: 0, plazaShare: 0.1
  };
  const unit = { id: 1, f: 1, type: 0, x: 742, y: 200, hp: 100, maxHp: 100, mode: null, goalKind: null };
  const base = {
    apiVersion: '1.0.0',
    time: 20,
    phase: 'battle',
    world: { width: 820, height: 820, tileSize: 25.625, stormAt: 480, verdictAt: 600 },
    map: { width: 820, height: 820, gridSize: 32, tileSize: 25.625, isObstacleTile: () => false, ownerAtTile: () => -1, isProtectedFor: () => false },
    faction,
    unit,
    enemies: [
      { f: 0, alive: true, hp: 800, maxHp: 2000, land: 60, landShare: 0.08, count: 8, kills: 1, rank: 3, plazaShare: 0.1 },
      { f: 2, alive: true, hp: 1600, maxHp: 2000, land: 150, landShare: 0.14, count: 15, kills: 4, rank: 1, plazaShare: 0.2 },
      { f: 3, alive: true, hp: 1800, maxHp: 2000, land: 80, landShare: 0.09, count: 10, kills: 2, rank: 2, plazaShare: 0.1 }
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
  return result;
}

function diplomacyContext(overrides = {}) {
  const factions = [
    { f: 0, alive: true, hp: 1700, land: 900, count: 28, landShare: 0.2, rank: 2 },
    { f: 1, alive: true, hp: 1900, land: 500, count: 20, landShare: 0.15, rank: 2 },
    { f: 2, alive: true, hp: 1200, land: 80, count: 10, landShare: 0.04, rank: 4 },
    { f: 3, alive: true, hp: 1500, land: 300, count: 16, landShare: 0.1, rank: 3 }
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

test('registers BlueTide only for Blue and does not patch game globals', () => {
  const { strategy, assignments, window } = createHarness();
  assert.deepEqual(assignments, [null, 'blue-tide-strategic', null, null]);
  assert.deepEqual(plain(strategy.name), 'BlueTide strategic AI');
  assert.equal(typeof strategy.decideDiplomacy, 'function');
  assert.equal(window.update, undefined);
  assert.equal(window.reset, undefined);
  assert.equal(window.canFormAlliance, undefined);
});

test('prioritizes the plaza early and places Blue units on its outer ring', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(strategyContext());
  assert.equal(result.mode, 'attack');
  assert.equal(result.goalKind, 'plaza');
  assert.ok(Math.abs(Math.hypot(result.goal.x - 410, result.goal.y - 410) - 100.8) < 1e-8);
});

test('seeks the best nearby power using value and the learned skill weight', () => {
  const { strategy } = createHarness();
  const powers = [
    { x: 762, y: 200, type: 0, life: 15 },
    { x: 762, y: 200, type: 3, life: 15 }
  ];
  const result = strategy.decide(strategyContext({ time: 100, faction: { plazaShare: 0.4 }, signals: { plazaShare: 0.4 }, powers }));
  assert.equal(result.mode, 'skill');
  assert.equal(result.goalKind, 'power');
  assert.deepEqual(plain(result.goal), { x: 762, y: 200 });
});

test('uses the current learning snapshot and target focus when attacking a tower', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(strategyContext({
    time: 100,
    faction: { plazaShare: 0.4 },
    signals: { plazaShare: 0.4 },
    learning: { routePolicy: { flank: 1.5, direct: 1 } }
  }));
  assert.equal(result.goalKind, 'tower');
  assert.equal(result.mode, 'attack');
  assert.equal(result.targetFaction, 0);
  assert.equal(result.routeStyle, 'flank');
  assert.ok(result.goal.x >= 14 && result.goal.x <= 806);
});

test('retreats a low-health Blue unit under nearby pressure', () => {
  const { strategy } = createHarness();
  const target = { id: 88, f: 0, type: 0, x: 700, y: 100, hp: 80, maxHp: 100 };
  const result = strategy.decide(strategyContext({
    time: 100,
    faction: { plazaShare: 0.4 },
    unit: { hp: 35, maxHp: 100 },
    target,
    nearbyEnemies: [target],
    signals: { plazaShare: 0.4, localPressure: 0.5, homePressure: 0.2 }
  }));
  assert.equal(result.mode, 'retreat');
  assert.equal(result.goalKind, 'retreat');
});

test('uses ranged kiting for the Blue special mage while an enemy is close', () => {
  const { strategy } = createHarness();
  const target = { id: 42, f: 0, type: 0, x: 742, y: 260, hp: 90, maxHp: 100 };
  const result = strategy.decide(strategyContext({
    time: 100,
    faction: { plazaShare: 0.4 },
    unit: { type: 4, hp: 100, maxHp: 100 },
    target,
    nearbyEnemies: [target],
    signals: { plazaShare: 0.4 }
  }));
  assert.equal(result.mode, 'kite');
  assert.equal(result.goalKind, 'kite');
  assert.ok(result.goal.y < target.y);
});

test('proposes only an eligible alliance through the diplomacy hook', () => {
  const { strategy } = createHarness();
  let eligibilityChecks = 0;
  const action = strategy.decideDiplomacy(diplomacyContext({
    canFormAlliance: (faction) => { eligibilityChecks++; return faction !== 2; }
  }));
  assert.deepEqual(plain(action), { type: 'formAlliance', targetFaction: 0 });
  assert.ok(eligibilityChecks >= 2);
});

test('requests betrayal only for a mature pact when Blue is vulnerable to a stronger ally', () => {
  const { strategy } = createHarness();
  const factions = [
    { f: 0, alive: true, hp: 2000, land: 0, count: 100 },
    { f: 1, alive: true, hp: 700, land: 20, count: 5 },
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

test('leaves diplomacy untouched when the game disallows alliances or the storm has started', () => {
  const { strategy } = createHarness();
  assert.equal(strategy.decideDiplomacy(diplomacyContext({ canFormAlliance: () => false })), null);
  assert.equal(strategy.decideDiplomacy(diplomacyContext({ time: 480 })), null);
});

test('records a completed episode via onMatchEnd and safely starts a new one', () => {
  const { strategy } = createHarness();
  strategy.decide(strategyContext({ time: 20 }));
  assert.doesNotThrow(() => strategy.onMatchEnd({ apiVersion: '1.0.0', faction: 1, winner: 1, isWinner: true, time: 90 }));
  assert.ok(strategy.decide(strategyContext({ time: 0 })));
});
