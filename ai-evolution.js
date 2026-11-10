'use strict';

(function installFourColorWarEvolution(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    Object.defineProperty(root, 'FourColorWarEvolution', {
      value: api,
      enumerable: true,
      configurable: false,
      writable: false
    });
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createEvolutionAPI() {
  const CODE_EVOLUTION_FACTIONS = Object.freeze([0, 2]); // Red and Green.

  function randomIndex(random, length) {
    const value = Math.max(0, Math.min(0.999999999999, Number(random()) || 0));
    return Math.floor(value * length);
  }

  function assignEvolutionCodes({ teams, champion, cycle, random, codebook, codeArchetype }) {
    if (!Array.isArray(teams) || teams.length !== 4) throw new TypeError('Expected four faction teams');
    if (!Number.isInteger(champion) || !teams[champion]?.ai) throw new TypeError('Expected a valid champion faction');
    if (typeof random !== 'function' || !codebook || typeof codeArchetype !== 'function') {
      throw new TypeError('Expected random, codebook, and codeArchetype inputs');
    }

    const experimenter = CODE_EVOLUTION_FACTIONS[randomIndex(random, CODE_EVOLUTION_FACTIONS.length)];
    const codeRecipient = CODE_EVOLUTION_FACTIONS.find((faction) => faction !== experimenter);
    const championCode = teams[champion].ai.code || 'balanced';
    const championStyle = codeArchetype(championCode);
    const currentExperimentStyle = codeArchetype(teams[experimenter].ai.code);
    const styles = Object.keys(codebook);
    let exploratoryStyles = styles.filter((style) => style !== championStyle && style !== currentExperimentStyle);
    if (exploratoryStyles.length === 0) exploratoryStyles = styles.filter((style) => style !== championStyle);
    if (exploratoryStyles.length === 0) exploratoryStyles = styles;
    if (exploratoryStyles.length === 0) throw new TypeError('The AICode book must contain at least one style');

    const archetype = exploratoryStyles[randomIndex(random, exploratoryStyles.length)];
    const code = `evo-${cycle}:${archetype}`;
    const copiedAI = teams[codeRecipient].ai;
    const exploratoryAI = teams[experimenter].ai;
    copiedAI.code = championCode;
    copiedAI.codeName = codebook[championStyle]?.name || codebook.balanced?.name || '均衡';
    exploratoryAI.code = code;
    exploratoryAI.codeName = codebook[archetype]?.name || archetype;

    return { experimenter, codeRecipient, championCode, code, archetype };
  }

  return Object.freeze({ assignEvolutionCodes });
});
