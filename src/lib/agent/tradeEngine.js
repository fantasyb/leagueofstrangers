/**
 * Trade Recommendation Engine
 *
 * Identifies trade targets, evaluates trade fairness, and generates
 * trade packages that improve your dynasty roster.
 */

import { calculateDynastyValue, buildPlayerProfile, getPositionBreakdown, rankRosterPlayers } from './playerAnalysis.js';

/**
 * Analyze positional needs based on roster composition.
 * Returns positions ranked by need (most needed first).
 */
export function analyzeNeeds(rosterPositions, rankedPlayers) {
    const breakdown = getPositionBreakdown(rankedPlayers);

    // Count required starters by position
    const starterSlots = {};
    const flexPositions = {
        FLEX: ['RB', 'WR', 'TE'],
        SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
        REC_FLEX: ['WR', 'TE'],
        WRRB_FLEX: ['WR', 'RB'],
    };

    for (const slot of rosterPositions) {
        if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].includes(slot)) {
            starterSlots[slot] = (starterSlots[slot] || 0) + 1;
        } else if (flexPositions[slot]) {
            // Distribute flex need proportionally
            for (const pos of flexPositions[slot]) {
                starterSlots[pos] = (starterSlots[pos] || 0) + 0.5;
            }
        }
    }

    const needs = [];
    for (const pos in starterSlots) {
        const group = breakdown[pos] || { players: [], totalValue: 0, grade: 'F', avgAge: 0 };
        const requiredStarters = Math.ceil(starterSlots[pos] || 0);
        const qualityStarters = group.players.filter(p =>
            p.tier === 'elite' || p.tier === 'starter' || p.tier === 'flex'
        ).length;

        const starterGap = Math.max(0, requiredStarters - qualityStarters);
        const depthScore = group.players.length - requiredStarters;

        // Need score: higher = more need
        let needScore = 0;
        needScore += starterGap * 30;      // big penalty for missing starters
        needScore += (5 - gradeToNum(group.grade)) * 15;  // grade penalty
        needScore -= Math.min(depthScore, 3) * 5;         // depth bonus

        needs.push({
            position: pos,
            needScore,
            starterGap,
            grade: group.grade,
            qualityStarters,
            requiredStarters,
            depth: group.players.length,
            avgAge: group.avgAge,
        });
    }

    return needs.sort((a, b) => b.needScore - a.needScore);
}

function gradeToNum(grade) {
    const map = { 'A+': 6, 'A': 5, 'B': 4, 'C': 3, 'D': 2, 'F': 1 };
    return map[grade] || 1;
}

/**
 * Find trade targets across the league.
 * Identifies players on other rosters that would fill your needs.
 */
export function findTradeTargets(myRosterId, rosters, playerData, rosterPositions) {
    const myRoster = rosters[myRosterId];
    if (!myRoster) return [];

    const myPlayers = rankRosterPlayers(myRoster, playerData);
    const myNeeds = analyzeNeeds(rosterPositions, myPlayers);
    const topNeeds = myNeeds.filter(n => n.needScore > 10).slice(0, 3);

    if (topNeeds.length === 0) return [];

    const targetPositions = topNeeds.map(n => n.position);
    const targets = [];

    for (const rosterId in rosters) {
        if (parseInt(rosterId) === parseInt(myRosterId)) continue;

        const roster = rosters[rosterId];
        const theirPlayers = rankRosterPlayers(roster, playerData);
        const theirNeeds = analyzeNeeds(rosterPositions, theirPlayers);

        // Find players on their team that match our needs
        for (const player of theirPlayers) {
            if (!targetPositions.includes(player.position)) continue;
            if (player.tier === 'roster') continue; // Skip deep bench

            // Check if they have surplus at this position (more likely to trade)
            const theirBreakdown = getPositionBreakdown(theirPlayers);
            const posGroup = theirBreakdown[player.position];
            const isSurplus = posGroup && posGroup.players.filter(p =>
                p.tier === 'elite' || p.tier === 'starter'
            ).length > 2;

            targets.push({
                player,
                fromRosterId: parseInt(rosterId),
                fromTeamName: roster.ownerName || `Team ${rosterId}`,
                isSurplus,
                theirNeeds: theirNeeds.slice(0, 3),
                tradeability: isSurplus ? 'High' : player.tier === 'flex' ? 'Medium' : 'Low',
            });
        }
    }

    // Sort by dynasty value (prefer higher value targets) and tradeability
    return targets.sort((a, b) => {
        const tradeOrder = { High: 3, Medium: 2, Low: 1 };
        const tradeScore = (tradeOrder[b.tradeability] || 0) - (tradeOrder[a.tradeability] || 0);
        if (tradeScore !== 0) return tradeScore;
        return b.player.dynastyValue - a.player.dynastyValue;
    });
}

/**
 * Generate trade package suggestions.
 * Creates balanced trade proposals that benefit both sides.
 */
export function generateTradePackages(myRosterId, rosters, playerData, rosterPositions) {
    const myRoster = rosters[myRosterId];
    if (!myRoster) return [];

    const myPlayers = rankRosterPlayers(myRoster, playerData);
    const myNeeds = analyzeNeeds(rosterPositions, myPlayers);
    const targets = findTradeTargets(myRosterId, rosters, playerData, rosterPositions);

    if (targets.length === 0) return [];

    const packages = [];

    // Try to build packages for top targets
    for (const target of targets.slice(0, 15)) {
        const targetValue = target.player.dynastyValue;
        const theirNeedPositions = target.theirNeeds
            .filter(n => n.needScore > 10)
            .map(n => n.position);

        // Find players on my team that could interest them
        const myTradeable = myPlayers.filter(p => {
            // Don't trade away elite players at positions of need
            const myNeed = myNeeds.find(n => n.position === p.position);
            if (myNeed && myNeed.needScore > 20 && p.tier === 'elite') return false;
            // Don't trade players that are at positions they don't need
            if (theirNeedPositions.length > 0 && !theirNeedPositions.includes(p.position)) {
                // Allow trading non-need position players if they're valuable enough
                if (p.dynastyValue < targetValue * 0.5) return false;
            }
            return p.tier !== 'roster' && p.dynastyValue > 500;
        });

        // Try 1-for-1 trades
        for (const myPlayer of myTradeable) {
            const valueDiff = Math.abs(myPlayer.dynastyValue - targetValue);
            const valueRatio = Math.min(myPlayer.dynastyValue, targetValue) /
                             Math.max(myPlayer.dynastyValue, targetValue);

            if (valueRatio >= 0.75 && valueRatio <= 1.25) {
                const fairness = evaluateTradeFairness(
                    [myPlayer], [target.player]
                );
                packages.push({
                    send: [myPlayer],
                    receive: [target.player],
                    partnerRosterId: target.fromRosterId,
                    partnerTeamName: target.fromTeamName,
                    fairness,
                    rationale: buildTradeRationale(myPlayer, target.player, myNeeds, target.theirNeeds),
                });
            }
        }

        // Try 2-for-1 trades (consolidation)
        if (myTradeable.length >= 2) {
            for (let i = 0; i < Math.min(myTradeable.length, 6); i++) {
                for (let j = i + 1; j < Math.min(myTradeable.length, 6); j++) {
                    const combinedValue = myTradeable[i].dynastyValue + myTradeable[j].dynastyValue;
                    const valueRatio = combinedValue / targetValue;

                    if (valueRatio >= 0.85 && valueRatio <= 1.35) {
                        const fairness = evaluateTradeFairness(
                            [myTradeable[i], myTradeable[j]], [target.player]
                        );
                        if (fairness.score >= 60) {
                            packages.push({
                                send: [myTradeable[i], myTradeable[j]],
                                receive: [target.player],
                                partnerRosterId: target.fromRosterId,
                                partnerTeamName: target.fromTeamName,
                                fairness,
                                rationale: `Package deal: Send ${myTradeable[i].name} + ${myTradeable[j].name} for ${target.player.name}. Consolidates talent at a position of need.`,
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort by fairness score (most balanced first) and deduplicate
    const seen = new Set();
    return packages
        .sort((a, b) => b.fairness.score - a.fairness.score)
        .filter(pkg => {
            const key = [...pkg.send.map(p => p.id), '|', ...pkg.receive.map(p => p.id)].join(',');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 20);
}

/**
 * Evaluate the fairness of a trade.
 * Returns a score from 0-100 where 50 is perfectly fair.
 */
export function evaluateTradeFairness(sendPlayers, receivePlayers) {
    const sendValue = sendPlayers.reduce((sum, p) => sum + p.dynastyValue, 0);
    const receiveValue = receivePlayers.reduce((sum, p) => sum + p.dynastyValue, 0);

    const totalValue = sendValue + receiveValue;
    if (totalValue === 0) return { score: 50, verdict: 'Even', sendValue, receiveValue };

    // Score: 100 means you're getting great value, 0 means you're getting robbed
    const ratio = receiveValue / Math.max(sendValue, 1);
    let score;

    if (ratio >= 0.9 && ratio <= 1.1) {
        score = 80 + (1 - Math.abs(1 - ratio)) * 20; // 80-100 for fair trades
    } else if (ratio > 1.1) {
        score = Math.min(100, 80 + (ratio - 1) * 30); // Good for you
    } else {
        score = Math.max(0, 80 - (1 - ratio) * 100); // Bad for you
    }

    let verdict;
    if (score >= 85) verdict = 'Great Value';
    else if (score >= 70) verdict = 'Fair Trade';
    else if (score >= 55) verdict = 'Slight Overpay';
    else if (score >= 40) verdict = 'Overpay';
    else verdict = 'Bad Deal';

    return {
        score: Math.round(score),
        verdict,
        sendValue,
        receiveValue,
        difference: receiveValue - sendValue,
    };
}

/**
 * Build a human-readable rationale for a trade.
 */
function buildTradeRationale(myPlayer, theirPlayer, myNeeds, theirNeeds) {
    const myNeed = myNeeds.find(n => n.position === theirPlayer.position);
    const theirNeed = theirNeeds.find(n => n.position === myPlayer.position);

    let rationale = `Trade ${myPlayer.name} (${myPlayer.position}, value: ${myPlayer.dynastyValue}) `;
    rationale += `for ${theirPlayer.name} (${theirPlayer.position}, value: ${theirPlayer.dynastyValue}). `;

    if (myNeed && myNeed.needScore > 15) {
        rationale += `Fills a ${theirPlayer.position} need (grade: ${myNeed.grade}). `;
    }
    if (theirNeed && theirNeed.needScore > 15) {
        rationale += `They need ${myPlayer.position} (grade: ${theirNeed.grade}), increasing acceptance odds. `;
    }

    if (theirPlayer.windowStatus === 'Long Window' || theirPlayer.windowStatus === 'Prime Window') {
        rationale += `${theirPlayer.name} has a ${theirPlayer.windowStatus.toLowerCase()}.`;
    }

    return rationale;
}

/**
 * Analyze an incoming trade offer.
 */
export function analyzeTrade(sendPlayerIds, receivePlayerIds, playerData) {
    const sendProfiles = sendPlayerIds.map(id => buildPlayerProfile(id, playerData)).filter(Boolean);
    const receiveProfiles = receivePlayerIds.map(id => buildPlayerProfile(id, playerData)).filter(Boolean);

    return {
        send: sendProfiles,
        receive: receiveProfiles,
        fairness: evaluateTradeFairness(sendProfiles, receiveProfiles),
    };
}
