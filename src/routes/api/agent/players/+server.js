import { json, error } from '@sveltejs/kit';
import { leagueID } from '$lib/utils/leagueInfo';
import { getPlayerProfile, searchPlayers } from '$lib/agent/index.js';

export async function GET({ url }) {
    const playerId = url.searchParams.get('id');
    const query = url.searchParams.get('q');

    if (playerId) {
        try {
            const profile = await getPlayerProfile(leagueID, playerId);
            if (!profile) throw error(404, 'Player not found');
            return json(profile);
        } catch (e) {
            if (e.status) throw e;
            throw error(500, e.message);
        }
    }

    if (query) {
        try {
            const results = await searchPlayers(query);
            return json(results);
        } catch (e) {
            throw error(500, e.message);
        }
    }

    throw error(400, 'Missing id or q parameter');
}
