'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'yellow-ai.js'), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));

function createHarness() {
  const registrations = new Map();
  const assignments = [null, null, null, null];
  const window = {};
  const math = Object.create(Math);
  math.random = () => 0.1;
  vm.runInNewContext(source, { window, console, Math: math, Number, String, Map, Object });
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
  assert.equal(window.__installFourColorWarYellowAI(api), true);
  const strategy = registrations.get('yellow-strategic');
  assert.ok(strategy);
  return { strategy, assignments };
}

function context(overrides = {}) {
  const share = overrides.plazaShare ?? 0.4;
  const base = {
    apiVersion: '1.0.0',
    time: 20,
    phase: 'battle',
    faction: { f: 3, alive: true, hp: 2000, maxHp: 2000, plazaShare: share },
    unit: { id: 1, f: 3, type: 0, x: 600, y: 700, hp: 100, maxHp: 100, mode: null, goalKind: null },
    enemies: [{ f: 0, alive: true, hp: 1200, maxHp: 2000, count: 12 }],
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
    signals: { situation: 'c0', homePressure: 0, localPressure: 0, castleLoss: 0, plazaShare: share }
  };
  const result = { ...base, ...overrides };
  result.faction = { ...base.faction, ...(overrides.faction || {}) };
  result.unit = { ...base.unit, ...(overrides.unit || {}) };
  result.learning = { ...base.learning, ...(overrides.learning || {}) };
  result.signals = { ...base.signals, ...(overrides.signals || {}) };
  return result;
}

function diplomacyContext(overrides = {}) {
  const factions = [
    { f: 0, alive: true, hp: 500, land: 10, count: 5 },
    { f: 1, alive: true, hp: 1000, land: 30, count: 12 },
    { f: 2, alive: true, hp: 1500, land: 80, count: 20 },
    { f: 3, alive: true, hp: 2000, land: 100, count: 20 }
  ];
  return {
    apiVersion: '1.0.0',
    time: 30,
    phase: 'battle',
    stormAt: 480,
    faction: factions[3],
    factions,
    allies: [],
    alliances: [],
    aliveCount: 4,
    cooldownRemaining: 0,
    canFormAlliance: () => true,
    ...overrides
  };
}

test('registers only the Yellow faction through the public plugin API', () => {
  const { assignments } = createHarness();
  assert.deepEqual(assignments, [null, null, null, 'yellow-strategic']);
});

test('prioritizes the plaza before the one-time share threshold', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(context({ plazaShare: 0.2, signals: { plazaShare: 0.2 } }));
  assert.equal(result.goalKind, 'plaza');
  assert.equal(result.mode, 'attack');
  assert.ok(Math.abs(Math.hypot(result.goal.x - 410, result.goal.y - 410) - 57.6) < 1e-8);
});

test('selects the weak, nearby enemy faction for tower focus after plaza priority', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(context({
    plazaShare: 0.4,
    signals: { plazaShare: 0.4 },
    enemies: [
      { f: 0, alive: true, hp: 1200, maxHp: 2000, count: 12 },
      { f: 2, alive: true, hp: 300, maxHp: 2000, count: 3 }
    ]
  }));
  assert.equal(result.goalKind, 'tower');
  assert.equal(result.targetFaction, 2);
  assert.deepEqual(plain(result.goal), { x: 78, y: 742 });
});

test('uses the attached priority ordering and limits active reservations to two units per power', () => {
  const { strategy } = createHarness();
  const powers = [
    { x: 620, y: 700, type: 3, life: 15 },
    { x: 600, y: 720, type: 0, life: 15 }
  ];
  const first = strategy.decide(context({ powers }));
  assert.equal(first.goalKind, 'power');
  assert.deepEqual(plain(first.goal), { x: 620, y: 700 });

  const onlyPower = [{ x: 620, y: 700, type: 3, life: 15 }];
  const second = strategy.decide(context({ time: 20.5, unit: { id: 2, x: 600, y: 700 }, powers: onlyPower }));
  const third = strategy.decide(context({ time: 21, unit: { id: 3, x: 600, y: 700 }, powers: onlyPower }));
  assert.equal(second.goalKind, 'power');
  assert.equal(third.goalKind, 'tower');
});

test('raises defender share when home pressure or castle loss grows', () => {
  const { strategy } = createHarness();
  const result = strategy.decide(context({
    unit: { id: 2, hp: 100, maxHp: 100 },
    signals: { homePressure: 1, castleLoss: 1 }
  }));
  assert.equal(result.mode, 'defend');
  assert.equal(result.goalKind, 'defend');
});

test('retreats below the supported 50% Yellow threshold under sufficient pressure', () => {
  const { strategy } = createHarness();
  const nearEnemy = { id: 88, f: 0, type: 0, x: 580, y: 700, hp: 80, maxHp: 100 };
  const result = strategy.decide(context({
    unit: { hp: 49, maxHp: 100 },
    target: nearEnemy,
    nearbyEnemies: [nearEnemy],
    signals: { localPressure: 0.5, homePressure: 0.3 }
  }));
  assert.equal(result.mode, 'retreat');
  assert.equal(result.goalKind, 'retreat');
});

test('clears per-match strategy memory at match end', () => {
  const { strategy } = createHarness();
  strategy.decide(context({ plazaShare: 0.4, signals: { plazaShare: 0.4 } }));
  strategy.onMatchEnd({ faction: 3, winner: 3 });
  const result = strategy.decide(context({ time: 0, plazaShare: 0.1, signals: { plazaShare: 0.1 } }));
  assert.equal(result.goalKind, 'plaza');
});

test('requests an alliance with the strongest eligible rival while sparing the weakest', () => {
  const { strategy } = createHarness();
  const action = strategy.decideDiplomacy(diplomacyContext());
  assert.deepEqual(plain(action), { type: 'formAlliance', targetFaction: 2 });
});

test('uses the API eligibility check before requesting an alliance', () => {
  const { strategy } = createHarness();
  const action = strategy.decideDiplomacy(diplomacyContext({ canFormAlliance: (faction) => faction === 1 }));
  assert.deepEqual(plain(action), { type: 'formAlliance', targetFaction: 1 });
});

test('does not request an alliance with fewer than two living rival factions', () => {
  const { strategy } = createHarness();
  assert.equal(strategy.decideDiplomacy(diplomacyContext({
    aliveCount: 2,
    factions: [
      { f: 0, alive: false, hp: 0, land: 0, count: 0 },
      { f: 1, alive: false, hp: 0, land: 0, count: 0 },
      { f: 2, alive: true, hp: 1000, land: 30, count: 12 },
      { f: 3, alive: true, hp: 2000, land: 100, count: 20 }
    ]
  })), null);
});

test('requests betrayal only for a mature alliance when Yellow overwhelmingly leads over a weak ally', () => {
  const { strategy } = createHarness();
  const factions = diplomacyContext().factions.map((team) => team.f === 1
    ? { ...team, hp: 900, land: 5, count: 2 }
    : team);
  const action = strategy.decideDiplomacy(diplomacyContext({
    time: 20,
    allies: [1],
    factions,
    alliances: [{ a: 1, b: 3, formedAt: 1, remaining: 40 }]
  }));
  assert.deepEqual(plain(action), { type: 'betrayAlliance', targetFaction: 1 });
});

test('does not betray before 18 seconds or after the storm begins', () => {
  const { strategy } = createHarness();
  const alliance = { a: 1, b: 3, formedAt: 5, remaining: 40 };
  const base = {
    allies: [1],
    alliances: [alliance],
    factions: diplomacyContext().factions.map((team) => team.f === 1
      ? { ...team, hp: 900, land: 5, count: 2 }
      : team)
  };
  assert.equal(strategy.decideDiplomacy(diplomacyContext({ ...base, time: 22 })), null);
  assert.equal(strategy.decideDiplomacy(diplomacyContext({ ...base, time: 480 })), null);
});
