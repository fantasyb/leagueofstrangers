/**
 * Trade Recommendation Engine (Enhanced)
 *
 * Identifies trade targets, evaluates trade fairness, generates
 * trade packages with sell-high/buy-low intelligence, draft pick
 * valuation, championship window alignment, and multi-player deals.
 */

import { calculateDynastyValue, buildPlayerProfile, getPositionBreakdown, rankRosterPlayers, classifyMarketSignal } from './playerAnalysis.js';
import { assessStrategy } from './dynastyStrategy.js';

// Draft pick dynasty values by round and projected quality
const PICK_VALUES = {
    1: { early: 7000, mid: 5500, late: 4500 },
    2: { early: 3500, mid: 2800, late: 2200 },
    3: { early: 1500, mid: 1200, late: 800 },
    4: { early: 600, mid: 400, late: 300 },
};

// Future pick discount (picks further out are worth less)
const FUTURE_PICK_DISCOUNT = {
    0: 1.0,    // Current year
    1: 0.85,   // Next year
    2: 0.70,   // 2 years out
};

/**
 * Value a draft pick based on round, projected quality, and timing.
 */
export function valueDraftPick(round, quality = 'mid', yearsOut = 0) {
    const roundValues = PICK_VALUES[round];
    if (!roundValues) return 200;

    const baseValue = roundValues[quality] || roundValues.mid;
    const discount = FUTURE_PICK_DISCOUNT[yearsOut] || 0.60;
    return Math.round(baseValue * discount);
}

/**
 * Classify pick quality based on team's projected finish.
 * Uses current record/standings to estimate where picks land.
 */
export function classifyPickQuality(roster) {
    if (!roster?.settings) return 'mid';
    const wins = roster.settings.wins || 0;
    const losses = roster.settings.losses || 0;
    const total = wins + losses;
    if (total === 0) return 'mid';

    const winPct = wins / total;
    if (winPct <= 0.35) return 'early';
    if (winPct >= 0.65) return 'late';
    return 'mid';
}

/**
 * Analyze positional needs based on roster composition.
 */
export function analyzeNeeds(rosterPositions, rankedPlayers) {
    const breakdown = getPositionBreakdown(rankedPlayers);

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

        let needScore = 0;
        needScore += starterGap * 30;
        needScore += (5 - gradeToNum(group.grade)) * 15;
        needScore -= Math.min(depthScore, 3) * 5;

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
 * Match trade partners by strategy alignment.
 * Win-Now teams want proven players; Rebuilders want picks/youth.
 */
export function matchTradePartnersByStrategy(myRosterId, rosters, playerData, rosterPositions) {
    const partners = [];

    // Determine each team's strategy
    for (const rid in rosters) {
        if (parseInt(rid) === parseInt(myRosterId)) continue;

        const roster = rosters[rid];
        const players = rankRosterPlayers(roster, playerData);
        const breakdown = getPositionBreakdown(players);
        const needs = analyzeNeeds(rosterPositions, players);

        // Quick strategy assessment based on roster age
        const avgAge = players.length > 0
            ? players.reduce((s, p) => s + p.age, 0) / players.length
            : 26;
        const eliteCount = players.filter(p => p.tier === 'elite').length;
        const youngCount = players.filter(p => p.age <= 24).length;

        let strategy;
        if (eliteCount >= 3 && avgAge <= 27) strategy = 'Win Now';
        else if (eliteCount >= 2 || avgAge <= 26) strategy = 'Contending';
        else if (youngCount >= players.length * 0.4) strategy = 'Rebuilding';
        else strategy = 'Retooling';

        partners.push({
            rosterId: parseInt(rid),
            ownerName: roster.ownerName || `Team ${rid}`,
            strategy,
            avgAge: Math.round(avgAge * 10) / 10,
            eliteCount,
            needs: needs.slice(0, 3),
            pickQuality: classifyPickQuality(roster),
        });
    }

    return partners;
}

/**
 * Find trade targets across the league.
 * Now includes sell-high/buy-low classification and strategy matching.
 */
export function findTradeTargets(myRosterId, rosters, playerData, rosterPositions, enrichment = {}) {
    const myRoster = rosters[myRosterId];
    if (!myRoster) return [];

    const myPlayers = rankRosterPlayers(myRoster, playerData, enrichment);
    const myNeeds = analyzeNeeds(rosterPositions, myPlayers);
    const topNeeds = myNeeds.filter(n => n.needScore > 10).slice(0, 4);

    if (topNeeds.length === 0) return [];

    const targetPositions = topNeeds.map(n => n.position);
    const targets = [];
    const partners = matchTradePartnersByStrategy(myRosterId, rosters, playerData, rosterPositions);
    const partnerMap = {};
    for (const p of partners) partnerMap[p.rosterId] = p;

    for (const rosterId in rosters) {
        if (parseInt(rosterId) === parseInt(myRosterId)) continue;

        const roster = rosters[rosterId];
        const theirPlayers = rankRosterPlayers(roster, playerData, enrichment);
        const theirNeeds = analyzeNeeds(rosterPositions, theirPlayers);
        const partner = partnerMap[parseInt(rosterId)];

        for (const player of theirPlayers) {
            if (!targetPositions.includes(player.position)) continue;
            if (player.tier === 'roster') continue;

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
                partnerStrategy: partner?.strategy || 'Unknown',
                buyLow: player.marketSignal?.signal === 'Buy Low',
            });
        }
    }

    // Sort: buy-low targets first, then by tradeability and value
    return targets.sort((a, b) => {
        if (a.buyLow && !b.buyLow) return -1;
        if (!a.buyLow && b.buyLow) return 1;
        const tradeOrder = { High: 3, Medium: 2, Low: 1 };
        const tradeScore = (tradeOrder[b.tradeability] || 0) - (tradeOrder[a.tradeability] || 0);
        if (tradeScore !== 0) return tradeScore;
        return b.player.dynastyValue - a.player.dynastyValue;
    });
}

/**
 * Generate trade packages including sell-high/buy-low and draft pick trades.
 */
export function generateTradePackages(myRosterId, rosters, playerData, rosterPositions, enrichment = {}, tradedPicks = []) {
    const myRoster = rosters[myRosterId];
    if (!myRoster) return [];

    const myPlayers = rankRosterPlayers(myRoster, playerData, enrichment);
    const myNeeds = analyzeNeeds(rosterPositions, myPlayers);
    const targets = findTradeTargets(myRosterId, rosters, playerData, rosterPositions, enrichment);
    const partners = matchTradePartnersByStrategy(myRosterId, rosters, playerData, rosterPositions);

    if (targets.length === 0) return [];

    const packages = [];

    // === STANDARD TRADE PACKAGES ===
    for (const target of targets.slice(0, 20)) {
        const targetValue = target.player.dynastyValue;
        const theirNeedPositions = target.theirNeeds
            .filter(n => n.needScore > 10)
            .map(n => n.position);

        const myTradeable = myPlayers.filter(p => {
            const myNeed = myNeeds.find(n => n.position === p.position);
            if (myNeed && myNeed.needScore > 20 && p.tier === 'elite') return false;
            if (theirNeedPositions.length > 0 && !theirNeedPositions.includes(p.position)) {
                if (p.dynastyValue < targetValue * 0.5) return false;
            }
            return p.tier !== 'roster' && p.dynastyValue > 500;
        });

        // 1-for-1 trades
        for (const myPlayer of myTradeable) {
            const valueRatio = Math.min(myPlayer.dynastyValue, targetValue) /
                             Math.max(myPlayer.dynastyValue, targetValue);

            if (valueRatio >= 0.75) {
                const fairness = evaluateTradeFairness([myPlayer], [target.player]);
                packages.push({
                    type: '1-for-1',
                    send: [myPlayer],
                    receive: [target.player],
                    sendPicks: [],
                    receivePicks: [],
                    partnerRosterId: target.fromRosterId,
                    partnerTeamName: target.fromTeamName,
                    partnerStrategy: target.partnerStrategy,
                    fairness,
                    rationale: buildTradeRationale(myPlayer, target.player, myNeeds, target.theirNeeds),
                    tags: buildTradeTags(myPlayer, target.player),
                });
            }
        }

        // 2-for-1 consolidation trades
        if (myTradeable.length >= 2) {
            for (let i = 0; i < Math.min(myTradeable.length, 6); i++) {
                for (let j = i + 1; j < Math.min(myTradeable.length, 6); j++) {
                    const combinedValue = myTradeable[i].dynastyValue + myTradeable[j].dynastyValue;
                    const valueRatio = combinedValue / targetValue;

                    if (valueRatio >= 0.85 && valueRatio <= 1.35) {
                        const fairness = evaluateTradeFairness(
                            [myTradeable[i], myTradeable[j]], [target.player]
                        );
                        if (fairness.score >= 55) {
                            packages.push({
                                type: '2-for-1',
                                send: [myTradeable[i], myTradeable[j]],
                                receive: [target.player],
                                sendPicks: [],
                                receivePicks: [],
                                partnerRosterId: target.fromRosterId,
                                partnerTeamName: target.fromTeamName,
                                partnerStrategy: target.partnerStrategy,
                                fairness,
                                rationale: `Package deal: Send ${myTradeable[i].name} + ${myTradeable[j].name} for ${target.player.name}. Consolidates talent at ${target.player.position}.`,
                                tags: ['Consolidation'],
                            });
                        }
                    }
                }
            }
        }

        // Player + Pick packages
        const partner = partners.find(p => p.rosterId === target.fromRosterId);
        if (partner) {
            // I send player + pick for their player (when my player is less valuable)
            for (const myPlayer of myTradeable) {
                if (myPlayer.dynastyValue >= targetValue * 0.5 && myPlayer.dynastyValue < targetValue * 0.85) {
                    const gap = targetValue - myPlayer.dynastyValue;
                    // Find a pick that fills the gap
                    const pickRound = gap >= 4000 ? 1 : gap >= 2000 ? 2 : gap >= 800 ? 3 : 4;
                    const pickValue = valueDraftPick(pickRound, classifyPickQuality(myRoster), 1);
                    const totalSend = myPlayer.dynastyValue + pickValue;

                    if (totalSend >= targetValue * 0.85 && totalSend <= targetValue * 1.20) {
                        const fairness = evaluateTradeWithPicks(
                            [myPlayer], [target.player],
                            [{ round: pickRound, value: pickValue }], []
                        );
                        if (fairness.score >= 55) {
                            packages.push({
                                type: 'player+pick',
                                send: [myPlayer],
                                receive: [target.player],
                                sendPicks: [{ round: pickRound, year: 'next', value: pickValue, label: `${pickRound}${ordinal(pickRound)} Round Pick` }],
                                receivePicks: [],
                                partnerRosterId: target.fromRosterId,
                                partnerTeamName: target.fromTeamName,
                                partnerStrategy: target.partnerStrategy,
                                fairness,
                                rationale: `Send ${myPlayer.name} + ${pickRound}${ordinal(pickRound)} round pick for ${target.player.name}. Sweetens the deal with draft capital.`,
                                tags: ['Includes Picks'],
                            });
                        }
                    }
                }
            }
        }
    }

    // === SELL-HIGH PACKAGES ===
    const sellHighPlayers = myPlayers.filter(p =>
        p.marketSignal?.signal === 'Sell High' && p.dynastyValue > 1500
    );

    for (const sellPlayer of sellHighPlayers) {
        // Find buy-low targets on other teams
        for (const target of targets) {
            if (target.buyLow && target.player.position === sellPlayer.position) {
                const fairness = evaluateTradeFairness([sellPlayer], [target.player]);
                if (fairness.score >= 50) {
                    packages.push({
                        type: 'sell-high-buy-low',
                        send: [sellPlayer],
                        receive: [target.player],
                        sendPicks: [],
                        receivePicks: [],
                        partnerRosterId: target.fromRosterId,
                        partnerTeamName: target.fromTeamName,
                        partnerStrategy: target.partnerStrategy,
                        fairness,
                        rationale: `Sell high on ${sellPlayer.name} (${sellPlayer.marketSignal.reasons[0]}) for buy-low ${target.player.name} (${target.player.marketSignal?.reasons?.[0] || 'undervalued'}).`,
                        tags: ['Sell High', 'Buy Low'],
                    });
                }
            }
        }

        // Sell veteran for picks (to rebuilding teams)
        for (const partner of partners) {
            if (partner.strategy === 'Rebuilding' || partner.strategy === 'Retooling') {
                const pickRound = sellPlayer.dynastyValue >= 5000 ? 1 : sellPlayer.dynastyValue >= 2500 ? 2 : 3;
                const pickValue = valueDraftPick(pickRound, partner.pickQuality, 1);
                const numPicks = Math.ceil(sellPlayer.dynastyValue / pickValue);

                if (numPicks <= 2) {
                    const picks = [];
                    let totalPickValue = 0;
                    for (let i = 0; i < numPicks; i++) {
                        const round = i === 0 ? pickRound : pickRound + 1;
                        const pv = valueDraftPick(round, partner.pickQuality, 1);
                        picks.push({ round, year: 'next', value: pv, label: `${round}${ordinal(round)} Round Pick` });
                        totalPickValue += pv;
                    }

                    if (totalPickValue >= sellPlayer.dynastyValue * 0.75) {
                        packages.push({
                            type: 'player-for-picks',
                            send: [sellPlayer],
                            receive: [],
                            sendPicks: [],
                            receivePicks: picks,
                            partnerRosterId: partner.rosterId,
                            partnerTeamName: partner.ownerName,
                            partnerStrategy: partner.strategy,
                            fairness: {
                                score: Math.round((totalPickValue / sellPlayer.dynastyValue) * 80),
                                verdict: totalPickValue >= sellPlayer.dynastyValue * 0.9 ? 'Fair Trade' : 'Slight Underpay',
                                sendValue: sellPlayer.dynastyValue,
                                receiveValue: totalPickValue,
                                difference: totalPickValue - sellPlayer.dynastyValue,
                            },
                            rationale: `Sell ${sellPlayer.name} to ${partner.ownerName} (${partner.strategy}) for draft picks. They need the production, you stockpile capital.`,
                            tags: ['Sell High', 'Picks Return'],
                        });
                    }
                }
            }
        }
    }

    // === GODFATHER OFFERS ===
    // For top need targets, generate slight overpay packages that are hard to refuse
    const topNeedTargets = targets
        .filter(t => t.player.tier === 'elite' || t.player.tier === 'starter')
        .slice(0, 5);

    for (const target of topNeedTargets) {
        for (const myPlayer of myPlayers) {
            if (myPlayer.tier === 'roster' || myPlayer.tier === 'bench') continue;
            if (myPlayer.position === target.player.position) continue;

            const myNeed = myNeeds.find(n => n.position === myPlayer.position);
            if (myNeed && myNeed.needScore > 25) continue;

            const ratio = myPlayer.dynastyValue / target.player.dynastyValue;
            if (ratio >= 1.10 && ratio <= 1.25) {
                packages.push({
                    type: 'godfather',
                    send: [myPlayer],
                    receive: [target.player],
                    sendPicks: [],
                    receivePicks: [],
                    partnerRosterId: target.fromRosterId,
                    partnerTeamName: target.fromTeamName,
                    partnerStrategy: target.partnerStrategy,
                    fairness: evaluateTradeFairness([myPlayer], [target.player]),
                    rationale: `Overpay with ${myPlayer.name} (value: ${myPlayer.dynastyValue}) for ${target.player.name} (value: ${target.player.dynastyValue}). Fills a critical need and is hard to refuse.`,
                    tags: ['Godfather Offer', 'Overpay'],
                });
            }
        }
    }

    // Deduplicate and sort
    const seen = new Set();
    return packages
        .filter(pkg => {
            const key = [
                ...pkg.send.map(p => p.id),
                '|',
                ...pkg.receive.map(p => p.id),
                '|',
                ...pkg.sendPicks.map(p => `${p.round}-${p.year}`),
                '|',
                ...pkg.receivePicks.map(p => `${p.round}-${p.year}`),
            ].join(',');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .sort((a, b) => {
            // Prioritize: sell-high, godfather offers, then by fairness
            const typeOrder = { 'sell-high-buy-low': 5, 'godfather': 4, 'player+pick': 3, '1-for-1': 2, '2-for-1': 2, 'player-for-picks': 1 };
            const typeDiff = (typeOrder[b.type] || 0) - (typeOrder[a.type] || 0);
            if (typeDiff !== 0) return typeDiff;
            return b.fairness.score - a.fairness.score;
        })
        .slice(0, 25);
}

/**
 * Evaluate trade fairness (players only).
 */
export function evaluateTradeFairness(sendPlayers, receivePlayers) {
    const sendValue = sendPlayers.reduce((sum, p) => sum + p.dynastyValue, 0);
    const receiveValue = receivePlayers.reduce((sum, p) => sum + p.dynastyValue, 0);

    return computeFairness(sendValue, receiveValue);
}

/**
 * Evaluate trade fairness including draft picks.
 */
export function evaluateTradeWithPicks(sendPlayers, receivePlayers, sendPicks = [], receivePicks = []) {
    const sendValue = sendPlayers.reduce((sum, p) => sum + p.dynastyValue, 0)
                    + sendPicks.reduce((sum, p) => sum + p.value, 0);
    const receiveValue = receivePlayers.reduce((sum, p) => sum + p.dynastyValue, 0)
                       + receivePicks.reduce((sum, p) => sum + p.value, 0);

    return computeFairness(sendValue, receiveValue);
}

function computeFairness(sendValue, receiveValue) {
    const totalValue = sendValue + receiveValue;
    if (totalValue === 0) return { score: 50, verdict: 'Even', sendValue, receiveValue, difference: 0 };

    const ratio = receiveValue / Math.max(sendValue, 1);
    let score;

    if (ratio >= 0.9 && ratio <= 1.1) {
        score = 80 + (1 - Math.abs(1 - ratio)) * 20;
    } else if (ratio > 1.1) {
        score = Math.min(100, 80 + (ratio - 1) * 30);
    } else {
        score = Math.max(0, 80 - (1 - ratio) * 100);
    }

    let verdict;
    if (score >= 85) verdict = 'Great Value';
    else if (score >= 70) verdict = 'Fair Trade';
    else if (score >= 55) verdict = 'Slight Overpay';
    else if (score >= 40) verdict = 'Overpay';
    else verdict = 'Bad Deal';

    return { score: Math.round(score), verdict, sendValue, receiveValue, difference: receiveValue - sendValue };
}

/**
 * Build trade tags for categorization.
 */
function buildTradeTags(myPlayer, theirPlayer) {
    const tags = [];

    if (myPlayer.marketSignal?.signal === 'Sell High') tags.push('Sell High');
    if (theirPlayer.marketSignal?.signal === 'Buy Low') tags.push('Buy Low');
    if (myPlayer.age >= 28 && theirPlayer.age <= 25) tags.push('Youth Swap');
    if (myPlayer.position !== theirPlayer.position) tags.push('Position Swap');

    return tags;
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
        rationale += `Fills your ${theirPlayer.position} need (grade: ${myNeed.grade}). `;
    }
    if (theirNeed && theirNeed.needScore > 15) {
        rationale += `They need ${myPlayer.position} (grade: ${theirNeed.grade}), increasing acceptance odds. `;
    }

    if (theirPlayer.marketSignal?.signal === 'Buy Low') {
        rationale += `${theirPlayer.name} is a buy-low candidate — value could rebound. `;
    }
    if (myPlayer.marketSignal?.signal === 'Sell High') {
        rationale += `${myPlayer.name} is a sell-high — lock in peak value now. `;
    }

    if (theirPlayer.windowStatus === 'Long Window' || theirPlayer.windowStatus === 'Prime Window') {
        rationale += `${theirPlayer.name} has a ${theirPlayer.windowStatus.toLowerCase()}.`;
    }

    return rationale;
}

/**
 * Analyze an incoming trade offer.
 */
export function analyzeTrade(sendPlayerIds, receivePlayerIds, playerData, enrichment = {}) {
    const sendProfiles = sendPlayerIds.map(id => buildPlayerProfile(id, playerData, enrichment)).filter(Boolean);
    const receiveProfiles = receivePlayerIds.map(id => buildPlayerProfile(id, playerData, enrichment)).filter(Boolean);

    return {
        send: sendProfiles,
        receive: receiveProfiles,
        fairness: evaluateTradeFairness(sendProfiles, receiveProfiles),
    };
}

function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}
