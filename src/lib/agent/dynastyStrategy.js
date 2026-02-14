/**
 * Dynasty Strategy Assessment
 *
 * Analyzes your roster's championship window, recommends overall strategy
 * (Win Now, Retool, or Rebuild), and provides actionable steps.
 */

import { rankRosterPlayers, getPositionBreakdown } from './playerAnalysis.js';
import { analyzeNeeds } from './tradeEngine.js';

/**
 * Perform a full dynasty strategy assessment.
 */
export function assessStrategy(roster, playerData, rosterPositions, leagueContext = {}) {
    const rankedPlayers = rankRosterPlayers(roster, playerData);
    const breakdown = getPositionBreakdown(rankedPlayers);
    const needs = analyzeNeeds(rosterPositions, rankedPlayers);

    const ageProfile = analyzeAgeProfile(rankedPlayers);
    const windowAnalysis = assessChampionshipWindow(rankedPlayers, breakdown);
    const strategy = determineStrategy(ageProfile, windowAnalysis, breakdown, needs);
    const actionPlan = buildActionPlan(strategy, needs, breakdown, rankedPlayers, ageProfile);
    const draftStrategy = buildDraftStrategy(strategy, needs, ageProfile);

    return {
        strategy,
        ageProfile,
        windowAnalysis,
        actionPlan,
        draftStrategy,
        rosterSummary: {
            totalPlayers: rankedPlayers.length,
            elitePlayers: rankedPlayers.filter(p => p.tier === 'elite').length,
            starterPlayers: rankedPlayers.filter(p => p.tier === 'starter').length,
            totalDynastyValue: rankedPlayers.reduce((s, p) => s + p.dynastyValue, 0),
        },
    };
}

/**
 * Analyze the age profile of the roster.
 */
function analyzeAgeProfile(players) {
    if (players.length === 0) return { avgAge: 0, youngCount: 0, primeCount: 0, veteranCount: 0, distribution: {} };

    const ages = players.map(p => p.age);
    const avgAge = ages.reduce((a, b) => a + b, 0) / ages.length;

    const young = players.filter(p => p.age <= 24);
    const prime = players.filter(p => p.age >= 25 && p.age <= 29);
    const veteran = players.filter(p => p.age >= 30);

    // Value-weighted age
    const totalValue = players.reduce((s, p) => s + p.dynastyValue, 0);
    const weightedAge = totalValue > 0
        ? players.reduce((s, p) => s + p.age * p.dynastyValue, 0) / totalValue
        : avgAge;

    return {
        avgAge: Math.round(avgAge * 10) / 10,
        weightedAge: Math.round(weightedAge * 10) / 10,
        youngCount: young.length,
        primeCount: prime.length,
        veteranCount: veteran.length,
        youngPercent: Math.round((young.length / players.length) * 100),
        primePercent: Math.round((prime.length / players.length) * 100),
        veteranPercent: Math.round((veteran.length / players.length) * 100),
        youngValue: young.reduce((s, p) => s + p.dynastyValue, 0),
        primeValue: prime.reduce((s, p) => s + p.dynastyValue, 0),
        veteranValue: veteran.reduce((s, p) => s + p.dynastyValue, 0),
        keyYoungPlayers: young.sort((a, b) => b.dynastyValue - a.dynastyValue).slice(0, 3),
        keyVeteranPlayers: veteran.sort((a, b) => b.dynastyValue - a.dynastyValue).slice(0, 3),
    };
}

/**
 * Assess championship window based on player prime years.
 */
function assessChampionshipWindow(players, breakdown) {
    const corePlayers = players.filter(p =>
        p.tier === 'elite' || p.tier === 'starter'
    );

    if (corePlayers.length === 0) {
        return {
            windowYears: 0,
            windowStatus: 'No Window',
            corePlayerCount: 0,
            closingPlayers: [],
        };
    }

    // Window is determined by how long your core stays in prime
    const primeEndYears = corePlayers.map(p => p.yearsInPrime);
    const minPrimeYears = Math.min(...primeEndYears);
    const avgPrimeYears = primeEndYears.reduce((a, b) => a + b, 0) / primeEndYears.length;

    const closingPlayers = corePlayers
        .filter(p => p.windowStatus === 'Closing Window' || p.windowStatus === 'Past Prime')
        .sort((a, b) => b.dynastyValue - a.dynastyValue);

    let windowStatus;
    if (avgPrimeYears >= 5) windowStatus = 'Wide Open';
    else if (avgPrimeYears >= 3) windowStatus = 'Prime Window';
    else if (avgPrimeYears >= 1) windowStatus = 'Closing';
    else windowStatus = 'Closed';

    // Assess competitive strength
    const posGrades = {};
    for (const pos in breakdown) {
        posGrades[pos] = breakdown[pos].grade;
    }

    const hasEliteQB = breakdown.QB?.players.some(p => p.tier === 'elite');
    const hasEliteRBs = (breakdown.RB?.players.filter(p => p.tier === 'elite' || p.tier === 'starter') || []).length >= 2;
    const hasEliteWRs = (breakdown.WR?.players.filter(p => p.tier === 'elite' || p.tier === 'starter') || []).length >= 2;

    const competitiveScore = (hasEliteQB ? 30 : 0) + (hasEliteRBs ? 30 : 0) + (hasEliteWRs ? 30 : 0) +
        (closingPlayers.length === 0 ? 10 : 0);

    return {
        windowYears: Math.round(avgPrimeYears * 10) / 10,
        windowStatus,
        corePlayerCount: corePlayers.length,
        closingPlayers,
        competitiveScore,
        hasEliteQB,
        hasEliteRBs,
        hasEliteWRs,
    };
}

/**
 * Determine the recommended dynasty strategy.
 */
function determineStrategy(ageProfile, windowAnalysis, breakdown, needs) {
    const { competitiveScore, windowStatus, windowYears } = windowAnalysis;
    const { weightedAge, youngPercent } = ageProfile;

    // Strategy scoring
    let winNowScore = 0;
    let retoolScore = 0;
    let rebuildScore = 0;

    // Competitive strength
    if (competitiveScore >= 70) winNowScore += 40;
    else if (competitiveScore >= 40) retoolScore += 30;
    else rebuildScore += 30;

    // Window
    if (windowStatus === 'Wide Open') winNowScore += 20;
    else if (windowStatus === 'Prime Window') winNowScore += 30;
    else if (windowStatus === 'Closing') retoolScore += 25;
    else rebuildScore += 35;

    // Age
    if (weightedAge <= 25) { winNowScore += 10; rebuildScore -= 10; }
    else if (weightedAge <= 27) { winNowScore += 5; }
    else if (weightedAge >= 29) { rebuildScore += 20; }

    // Youth percentage
    if (youngPercent >= 50) rebuildScore += 10;
    else if (youngPercent <= 20) { winNowScore += 5; retoolScore += 5; }

    // Needs
    const criticalNeeds = needs.filter(n => n.needScore > 25).length;
    if (criticalNeeds >= 3) rebuildScore += 20;
    else if (criticalNeeds >= 2) retoolScore += 15;

    const scores = { 'Win Now': winNowScore, 'Retool': retoolScore, 'Rebuild': rebuildScore };
    const recommended = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

    return {
        recommendation: recommended[0],
        confidence: Math.round((recommended[1] / (winNowScore + retoolScore + rebuildScore)) * 100),
        scores,
        summary: generateStrategySummary(recommended[0], windowAnalysis, ageProfile),
    };
}

/**
 * Generate a strategy summary.
 */
function generateStrategySummary(strategy, windowAnalysis, ageProfile) {
    if (strategy === 'Win Now') {
        return `Your roster is built to compete. With ${windowAnalysis.corePlayerCount} core players and a ${windowAnalysis.windowStatus.toLowerCase()} championship window (~${windowAnalysis.windowYears} years), focus on maximizing this window. Target proven producers, trade future picks for impact players, and prioritize weekly upside.`;
    }
    if (strategy === 'Retool') {
        return `Your roster has pieces but needs strategic upgrades. With a roster averaging ${ageProfile.avgAge} years old, you should sell aging assets at peak value while acquiring younger players with upside. Target 1-2 impact trades to reshape your core without tearing everything down.`;
    }
    return `Time to build for the future. Your championship window is ${windowAnalysis.windowStatus.toLowerCase()} and the roster lacks the elite talent to compete. Accumulate draft picks, trade veterans for young players and picks, and be patient. The goal is to build a championship core for 2-3 years from now.`;
}

/**
 * Build a concrete action plan for the strategy.
 */
function buildActionPlan(strategy, needs, breakdown, players, ageProfile) {
    const actions = [];

    if (strategy.recommendation === 'Win Now') {
        // Find positions to upgrade
        const upgradeNeeds = needs.filter(n => n.needScore > 15 && n.position !== 'K' && n.position !== 'DEF');
        for (const need of upgradeNeeds.slice(0, 2)) {
            actions.push({
                priority: 'High',
                action: `Upgrade ${need.position}`,
                detail: `Current grade: ${need.grade}. Target a starter-caliber ${need.position} via trade. Consider packaging bench pieces + future picks.`,
            });
        }

        // Sell aging bench depth
        const sellCandidates = players.filter(p =>
            p.age >= 29 && (p.tier === 'bench' || p.tier === 'flex') && p.dynastyValue > 1000
        );
        if (sellCandidates.length > 0) {
            actions.push({
                priority: 'Medium',
                action: 'Sell aging depth',
                detail: `${sellCandidates.map(p => p.name).join(', ')} - trade for younger upside or upgrade picks.`,
            });
        }

        actions.push({
            priority: 'Medium',
            action: 'Trade future picks for win-now players',
            detail: 'Your window is open. Future 1st/2nd round picks can be used to acquire impact starters from rebuilding teams.',
        });

    } else if (strategy.recommendation === 'Retool') {
        // Sell veterans past prime
        const sellVets = ageProfile.keyVeteranPlayers.filter(p => p.dynastyValue > 2000);
        if (sellVets.length > 0) {
            actions.push({
                priority: 'High',
                action: 'Sell peak-value veterans',
                detail: `Trade ${sellVets.map(p => `${p.name} (${p.age}, value: ${p.dynastyValue})`).join(', ')} for younger assets + picks before their value drops.`,
            });
        }

        actions.push({
            priority: 'High',
            action: 'Target young breakout candidates',
            detail: 'Acquire 23-25 year old players at positions of need who are entering their prime production years.',
        });

        // Accumulate mid-round picks
        actions.push({
            priority: 'Medium',
            action: 'Stockpile 2nd round picks',
            detail: 'While not tearing down, accumulate 2nd round picks which offer strong value for emerging talent.',
        });

    } else {
        // Rebuild mode
        const sellHighPlayers = players
            .filter(p => p.age >= 27 && p.dynastyValue > 3000)
            .sort((a, b) => b.dynastyValue - a.dynastyValue);

        if (sellHighPlayers.length > 0) {
            actions.push({
                priority: 'High',
                action: 'Trade your top veterans',
                detail: `Sell ${sellHighPlayers.slice(0, 3).map(p => `${p.name} (value: ${p.dynastyValue})`).join(', ')} for 1st round picks and young players.`,
            });
        }

        actions.push({
            priority: 'High',
            action: 'Accumulate 1st round draft picks',
            detail: 'Target 2-3 first round picks per draft. These are the building blocks of your future dynasty.',
        });

        // Identify keepers
        const keepers = players
            .filter(p => p.age <= 24 && (p.tier === 'elite' || p.tier === 'starter' || p.tier === 'flex'))
            .sort((a, b) => b.dynastyValue - a.dynastyValue);

        if (keepers.length > 0) {
            actions.push({
                priority: 'Medium',
                action: 'Build around your young core',
                detail: `${keepers.slice(0, 4).map(p => `${p.name} (${p.age}, ${p.position})`).join(', ')} - these are your foundation pieces. Do not trade them.`,
            });
        }

        actions.push({
            priority: 'Low',
            action: 'Target upside stashes on waivers',
            detail: 'Claim young handcuffs and practice squad callups. In a rebuild, lottery tickets are valuable.',
        });
    }

    return actions;
}

/**
 * Build draft strategy recommendations.
 */
function buildDraftStrategy(strategy, needs, ageProfile) {
    const positionPriority = needs
        .filter(n => n.position !== 'K' && n.position !== 'DEF')
        .slice(0, 4)
        .map(n => n.position);

    let approach;
    let pickStrategy;
    let targets;

    if (strategy.recommendation === 'Win Now') {
        approach = 'Best Player Available with positional need tiebreaker';
        pickStrategy = 'Trade down from early picks if possible to acquire extra mid-round capital. Draft the most NFL-ready rookies.';
        targets = 'Day 1 NFL starters, high-draft-capital rookies at positions of need, immediate impact players';
    } else if (strategy.recommendation === 'Retool') {
        approach = 'Balance BPA and positional need';
        pickStrategy = 'Hold your picks. Target upside players who can contribute within 1-2 years.';
        targets = 'High-upside rookies, 2nd-year breakout candidates, players in good NFL situations';
    } else {
        approach = 'Accumulate and draft Best Player Available';
        pickStrategy = 'Trade back to accumulate more picks. Quantity leads to quality in rebuilds. Focus purely on talent.';
        targets = 'Top talent regardless of position, high draft capital players, developmental prospects at premium positions';
    }

    return {
        approach,
        pickStrategy,
        positionPriority,
        targets,
        keyPositions: positionPriority.slice(0, 2),
    };
}
