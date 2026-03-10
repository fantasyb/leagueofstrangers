import { json, error } from '@sveltejs/kit';
import { leagueID } from '$lib/utils/leagueInfo';
import { getWaiverAnalysis } from '$lib/agent/index.js';

export async function GET({ url }) {
    const rosterId = url.searchParams.get('roster');

    if (!rosterId) {
        throw error(400, 'Missing roster parameter');
    }

    try {
        const waivers = await getWaiverAnalysis(leagueID, parseInt(rosterId));
        return json(waivers);
    } catch (e) {
        throw error(500, e.message);
    }
}
