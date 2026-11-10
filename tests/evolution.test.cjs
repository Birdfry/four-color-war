'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { assignEvolutionCodes } = require('../ai-evolution.js');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const factionNames = ['Red', 'Blue', 'Green', 'Yellow'];
const codebookMatch = html.match(/const AI_CODEBOOK=(\{[^\n]+\});/);
assert.ok(codebookMatch, 'the live game should expose its AICode book in index.html');
const codebook = vm.runInNewContext(`(${codebookMatch[1]})`);
const codeArchetype = (code) => typeof code === 'string' ? code.split(':').pop() : 'balanced';
const deepCopy = (value) => JSON.parse(JSON.stringify(value));

function brain(code, marker) {
  return {
    code,
    codeName: codebook[codeArchetype(code)]?.name || '旧名称',
    q: { attack: marker + 0.1, defend: marker + 0.2 },
    routeQ: { tower: marker + 0.3, flank: marker + 0.4 },
    ctxQ: { lowHealth: { retreat: marker + 0.5 } },
    xp: 100 + marker,
    games: 20 + marker,
    wins: marker,
    customPluginState: { active: true, token: `team-${marker}` }
  };
}

function changedAssignments() {
  return [
    brain('guardian', 0),
    brain('evo-3:siege', 1),
    brain('balanced', 2),
    brain('evo-4:raider', 3)
  ];
}

function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `expected ${name} in the live game source`);
  const open = html.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = open; index < html.length; index++) {
    const char = html[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return html.slice(start, index + 1);
  }
  throw new Error(`Could not find the end of ${name}`);
}

test('ten completed matches still trigger one evolution cycle', () => {
  const recordMatchResult = functionSource('recordMatchResult');
  assert.match(recordMatchResult, /evolution\.progress\+\+;if\(evolution\.progress>=10\)evolveBrains\(\);/);
});

test('each evolution changes only Red and Green AICodes and preserves all learning', () => {
  const teams = changedAssignments().map((ai, f) => ({ f, ai }));
  const before = deepCopy(teams);
  const randomValues = [0, 0.999];
  const assignment = assignEvolutionCodes({
    teams,
    champion: 3,
    cycle: 5,
    random: () => randomValues.shift() ?? 0,
    codebook,
    codeArchetype
  });

  assert.equal(assignment.experimenter, 0);
  assert.equal(assignment.codeRecipient, 2);
  assert.equal(teams[2].ai.code, before[3].ai.code, 'Green copies the champion Yellow code exactly');
  assert.equal(teams[0].ai.code, 'evo-5:siege', 'Red receives a fresh exploratory AICode');
  assert.equal(teams[0].ai.codeName, codebook.siege.name);
  assert.equal(teams[2].ai.codeName, codebook.raider.name);
  assert.deepEqual(teams[1].ai, before[1].ai, 'Blue code and learning remain untouched');
  assert.deepEqual(teams[3].ai, before[3].ai, 'Yellow code and learning remain untouched');

  for (const faction of [0, 2]) {
    const { code, codeName, ...afterLearning } = teams[faction].ai;
    const { code: oldCode, codeName: oldCodeName, ...beforeLearning } = before[faction].ai;
    assert.deepEqual(afterLearning, beforeLearning, `${factionNames[faction]} learning state is preserved`);
    assert.equal(typeof code, 'string');
    assert.ok(codeName);
  }
});

test('the integrated game evolution uses the cycle leader and picks only Red or Green to explore', () => {
  const teams = changedAssignments().map((ai, f) => ({ f, ai }));
  const evolution = {
    completed: 4,
    progress: 10,
    scores: [300, 200, 450, 100],
    games: [10, 10, 10, 10],
    wins: [2, 6, 1, 1],
    last: null
  };
  const randomValues = [0.99, 0];
  const sandbox = {
    teams,
    evolution,
    rng: () => randomValues.shift() ?? 0,
    AI_CODEBOOK: codebook,
    codeArchetype,
    window: { FourColorWarEvolution: { assignEvolutionCodes } },
    NAME: ['红', '蓝', '绿', '黄'],
    saveLearningArchive() {},
    saveEvolutionState() {},
    announce() {}
  };
  vm.runInNewContext(functionSource('evolveBrains'), sandbox);
  vm.runInNewContext('evolveBrains()', sandbox);

  assert.equal(evolution.completed, 5);
  assert.equal(evolution.progress, 0);
  assert.equal(evolution.last.champion, 2, 'the highest cycle-performance score supplies the copied code');
  assert.equal(evolution.last.tieBreak, 'score-desc,wins-desc,faction-id-asc');
  assert.equal(evolution.last.experimenter, 2, 'the exploratory role is assigned only to Green here');
  assert.equal(evolution.last.codeRecipient, 0, 'the copy role goes to the other Red/Green faction');
  assert.equal(teams[0].ai.code, 'balanced', 'Red receives Green’s code from the end of the cycle');
  assert.match(teams[2].ai.code, /^evo-5:/);
  assert.equal(teams[1].ai.code, 'evo-3:siege');
  assert.equal(teams[3].ai.code, 'evo-4:raider');
  assert.deepEqual(Array.from(evolution.wins), [0, 0, 0, 0]);
});

test('a new exploratory AICode changes the live built-in objective strategy', () => {
  const sandbox = {
    HOME: [[78, 78], [742, 78], [78, 742], [742, 742]],
    T: 25.625,
    N: 32,
    SKILL_SEEK_WEIGHT: 1.35,
    PLAZA_NEED: 0.3,
    PLAZA_R: 96,
    PLAZA: [{}],
    teams: [{ plaza: 0 }, { plaza: 0 }, { plaza: 0 }, { plaza: 0 }],
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    preferredEnemy: () => null,
    coalitionAttackTarget: () => null,
    targetScore: () => 100
  };
  const codeStyle = functionSource('codeStyle');
  const codeArchetypeSource = functionSource('codeArchetype');
  const chooseObjective = functionSource('chooseStrategicObjective');
  vm.runInNewContext(`${codebookMatch[0]}\n${codeArchetypeSource}\n${codeStyle}\n${chooseObjective}`, sandbox);

  const args = {
    u: { f: 0, id: 0, x: 410, y: 250 },
    enemies: [{ f: 1 }],
    availablePowers: [],
    policy: { attack: 1, defend: 1, skill: 1 },
    routePolicy: { tower: 1, center: 1, skill: 1 },
    enemyPressure: new Float32Array(32 * 32)
  };
  sandbox.args = args;
  const balanced = vm.runInNewContext('chooseStrategicObjective(args.u,args.enemies,args.availablePowers,args.policy,args.routePolicy,"balanced",args.enemyPressure)', sandbox);
  const exploratory = vm.runInNewContext('chooseStrategicObjective(args.u,args.enemies,args.availablePowers,args.policy,args.routePolicy,"evo-5:siege",args.enemyPressure)', sandbox);

  assert.equal(balanced.kind, 'tower');
  assert.equal(exploratory.kind, 'plaza');
  assert.notDeepEqual(exploratory.goal, balanced.goal, 'AICode multipliers affect the actual built-in strategy choice');
});
