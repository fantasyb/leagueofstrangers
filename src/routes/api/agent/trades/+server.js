import { json, error } from '@sveltejs/kit';
import { leagueID } from '$lib/utils/leagueInfo';
import { getTradeRecommendations, evaluateTrade } from '$lib/agent/index.js';

export async function GET({ url }) {
    const rosterId = url.searchParams.get('roster');

    if (!rosterId) {
        throw error(400, 'Missing roster parameter');
    }

    try {
        const trades = await getTradeRecommendations(leagueID, parseInt(rosterId));
        return json(trades);
    } catch (e) {
        throw error(500, e.message);
    }
}

export async function POST({ request }) {
    const { sendIds, receiveIds } = await request.json();

    if (!sendIds?.length || !receiveIds?.length) {
        throw error(400, 'Missing sendIds or receiveIds');
    }

    try {
        const evaluation = await evaluateTrade(leagueID, sendIds, receiveIds);
        return json(evaluation);
    } catch (e) {
        throw error(500, e.message);
    }
}
