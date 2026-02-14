<script>
	import LinearProgress from '@smui/linear-progress';
	import { goto } from '$app/navigation';

	export let data;

	let selectedRoster = '';
	let activeTab = 'overview';
	let tradeData = null;
	let loadingTrades = false;
	let playerSearchQuery = '';
	let playerSearchResults = [];
	let searchingPlayers = false;

	function selectRoster() {
		if (selectedRoster) {
			goto(`/agent?roster=${selectedRoster}`);
		}
	}

	async function loadTrades(rosterId) {
		loadingTrades = true;
		try {
			const res = await fetch(`/api/agent/trades?roster=${rosterId}`);
			tradeData = await res.json();
		} catch (e) {
			console.error('Failed to load trades:', e);
		}
		loadingTrades = false;
	}

	async function searchPlayers() {
		if (!playerSearchQuery || playerSearchQuery.length < 2) return;
		searchingPlayers = true;
		try {
			const res = await fetch(`/api/agent/players?q=${encodeURIComponent(playerSearchQuery)}`);
			playerSearchResults = await res.json();
		} catch (e) {
			console.error('Search failed:', e);
		}
		searchingPlayers = false;
	}

	function getGradeColor(grade) {
		if (!grade) return '#888';
		if (grade.startsWith('A')) return '#22c55e';
		if (grade.startsWith('B')) return '#3b82f6';
		if (grade.startsWith('C')) return '#eab308';
		if (grade.startsWith('D')) return '#f97316';
		return '#ef4444';
	}

	function getTierColor(tier) {
		const colors = {
			elite: '#a855f7',
			starter: '#22c55e',
			flex: '#3b82f6',
			bench: '#eab308',
			roster: '#6b7280',
		};
		return colors[tier] || '#6b7280';
	}

	function getStrategyColor(strategy) {
		if (strategy === 'Win Now') return '#22c55e';
		if (strategy === 'Retool') return '#eab308';
		return '#ef4444';
	}
</script>

<style>
	.agent-page {
		max-width: 1200px;
		margin: 0 auto;
		padding: 20px;
		position: relative;
		z-index: 1;
	}

	.agent-header {
		text-align: center;
		margin-bottom: 30px;
	}

	.agent-header h1 {
		font-size: 2em;
		margin-bottom: 5px;
		background: linear-gradient(135deg, #a855f7, #3b82f6);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.agent-header p {
		color: #94a3b8;
		font-size: 0.95em;
	}

	.roster-select {
		max-width: 500px;
		margin: 40px auto;
		text-align: center;
	}

	.roster-select select {
		width: 100%;
		padding: 12px;
		border-radius: 8px;
		border: 1px solid #334155;
		background: #1e293b;
		color: #e2e8f0;
		font-size: 1em;
		margin-bottom: 15px;
	}

	.roster-select button, .tab-bar button {
		padding: 10px 24px;
		border-radius: 8px;
		border: none;
		background: linear-gradient(135deg, #a855f7, #3b82f6);
		color: white;
		font-weight: 600;
		cursor: pointer;
		font-size: 0.95em;
	}

	.roster-select button:hover, .tab-bar button.active {
		opacity: 0.9;
	}

	.tab-bar {
		display: flex;
		gap: 8px;
		margin-bottom: 25px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.tab-bar button {
		padding: 8px 18px;
		font-size: 0.85em;
		background: #1e293b;
		border: 1px solid #334155;
	}

	.tab-bar button.active {
		background: linear-gradient(135deg, #a855f7, #3b82f6);
		border-color: transparent;
	}

	.team-banner {
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: #1e293b;
		border-radius: 12px;
		padding: 20px 25px;
		margin-bottom: 20px;
		flex-wrap: wrap;
		gap: 15px;
	}

	.team-info h2 { margin: 0 0 5px; font-size: 1.4em; }
	.team-info p { margin: 0; color: #94a3b8; font-size: 0.9em; }

	.team-stats {
		display: flex;
		gap: 25px;
		flex-wrap: wrap;
	}

	.stat-box {
		text-align: center;
	}

	.stat-box .value {
		font-size: 1.5em;
		font-weight: 700;
	}

	.stat-box .label {
		font-size: 0.75em;
		color: #94a3b8;
		text-transform: uppercase;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 15px;
		margin-bottom: 20px;
	}

	.card {
		background: #1e293b;
		border-radius: 12px;
		padding: 18px;
		border: 1px solid #334155;
	}

	.card h3 {
		margin: 0 0 12px;
		font-size: 1em;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.grade-badge {
		display: inline-block;
		padding: 4px 12px;
		border-radius: 6px;
		font-weight: 700;
		font-size: 1.1em;
	}

	.position-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 0;
		border-bottom: 1px solid #334155;
	}

	.position-row:last-child { border-bottom: none; }

	.player-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 0;
		border-bottom: 1px solid #1e293b;
	}

	.player-row:last-child { border-bottom: none; }

	.player-name { font-weight: 500; }
	.player-meta { color: #94a3b8; font-size: 0.85em; }
	.player-value { font-weight: 600; }

	.trade-card {
		background: #1e293b;
		border-radius: 12px;
		padding: 18px;
		margin-bottom: 12px;
		border: 1px solid #334155;
	}

	.trade-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 12px;
	}

	.trade-sides {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		gap: 10px;
		align-items: center;
	}

	.trade-arrow {
		font-size: 1.5em;
		color: #64748b;
	}

	.trade-side { padding: 10px; background: #0f172a; border-radius: 8px; }
	.trade-side h4 { margin: 0 0 8px; font-size: 0.85em; color: #94a3b8; }

	.action-card {
		padding: 12px;
		background: #0f172a;
		border-radius: 8px;
		margin-bottom: 8px;
		border-left: 3px solid;
	}

	.action-card.High { border-left-color: #ef4444; }
	.action-card.Medium { border-left-color: #eab308; }
	.action-card.Low { border-left-color: #3b82f6; }

	.action-card h4 { margin: 0 0 4px; font-size: 0.95em; }
	.action-card p { margin: 0; font-size: 0.85em; color: #94a3b8; }

	.strategy-banner {
		text-align: center;
		padding: 25px;
		background: #1e293b;
		border-radius: 12px;
		margin-bottom: 20px;
	}

	.strategy-badge {
		display: inline-block;
		font-size: 1.8em;
		font-weight: 800;
		padding: 8px 30px;
		border-radius: 10px;
		margin-bottom: 10px;
	}

	.power-rank-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 12px;
		border-radius: 8px;
		margin-bottom: 4px;
	}

	.power-rank-row.mine { background: #1e3a5f; border: 1px solid #3b82f6; }
	.power-rank-row:not(.mine) { background: #0f172a; }

	.rank-number {
		font-weight: 800;
		font-size: 1.2em;
		width: 30px;
		text-align: center;
	}

	.lineup-slot {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 12px;
		margin-bottom: 4px;
		background: #0f172a;
		border-radius: 8px;
	}

	.slot-label {
		background: #334155;
		padding: 2px 8px;
		border-radius: 4px;
		font-size: 0.8em;
		font-weight: 600;
		min-width: 50px;
		text-align: center;
	}

	.warning-box {
		padding: 10px;
		border-radius: 8px;
		margin-top: 8px;
		font-size: 0.85em;
	}

	.warning-box.warning { background: #422006; color: #fbbf24; }
	.warning-box.info { background: #0c2d48; color: #60a5fa; }
	.warning-box.error { background: #3b0764; color: #f472b6; }

	.search-box {
		display: flex;
		gap: 10px;
		margin-bottom: 20px;
	}

	.search-box input {
		flex: 1;
		padding: 10px;
		border-radius: 8px;
		border: 1px solid #334155;
		background: #1e293b;
		color: #e2e8f0;
		font-size: 0.95em;
	}

	.search-box button {
		padding: 10px 20px;
		border-radius: 8px;
		border: none;
		background: #3b82f6;
		color: white;
		cursor: pointer;
	}

	.loading {
		display: block;
		width: 85%;
		max-width: 500px;
		margin: 80px auto;
		text-align: center;
	}

	.age-bar {
		display: flex;
		height: 24px;
		border-radius: 6px;
		overflow: hidden;
		margin-top: 8px;
	}

	.age-bar .young { background: #22c55e; }
	.age-bar .prime { background: #3b82f6; }
	.age-bar .veteran { background: #ef4444; }

	.age-legend {
		display: flex;
		gap: 15px;
		margin-top: 6px;
		font-size: 0.8em;
		color: #94a3b8;
	}

	.age-legend span::before {
		content: '';
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 2px;
		margin-right: 4px;
	}

	.draft-card {
		background: #0f172a;
		padding: 15px;
		border-radius: 8px;
		margin-bottom: 10px;
	}

	.draft-card h4 { margin: 0 0 6px; color: #e2e8f0; }
	.draft-card p { margin: 0; font-size: 0.85em; color: #94a3b8; }
</style>

<div class="agent-page">
	<div class="agent-header">
		<h1>AI Dynasty Manager</h1>
		<p>Your intelligent co-pilot for dynasty domination</p>
	</div>

	{#if data.needsRosterSelection}
		<div class="roster-select">
			<h2>Select Your Team</h2>
			<p style="color: #94a3b8; margin-bottom: 20px;">Choose the roster you manage to get started</p>

			{#if data.rosters && data.rosters.length > 0}
				<select bind:value={selectedRoster}>
					<option value="">-- Choose your roster --</option>
					{#each data.rosters as roster}
						<option value={roster.rosterId}>
							{roster.ownerName} (Roster {roster.rosterId}) - {roster.record} - {roster.playerCount} players
						</option>
					{/each}
				</select>
				<br />
				<button on:click={selectRoster}>Launch Agent</button>
			{:else}
				<p>Loading rosters...</p>
				<LinearProgress indeterminate />
			{/if}
		</div>
	{:else}
		{#await data.analysisPromise}
			<div class="loading">
				<p>AI Agent is analyzing your league...</p>
				<p style="color: #94a3b8; font-size: 0.85em;">Pulling rosters, grading players, finding trades...</p>
				<br />
				<LinearProgress indeterminate />
			</div>
		{:then analysis}
			<!-- Tab Navigation -->
			<div class="tab-bar">
				<button class:active={activeTab === 'overview'} on:click={() => activeTab = 'overview'}>Overview</button>
				<button class:active={activeTab === 'roster'} on:click={() => activeTab = 'roster'}>Roster</button>
				<button class:active={activeTab === 'lineup'} on:click={() => activeTab = 'lineup'}>Lineup</button>
				<button class:active={activeTab === 'trades'} on:click={() => { activeTab = 'trades'; if (!tradeData) loadTrades(data.rosterId); }}>Trades</button>
				<button class:active={activeTab === 'strategy'} on:click={() => activeTab = 'strategy'}>Strategy</button>
				<button class:active={activeTab === 'rankings'} on:click={() => activeTab = 'rankings'}>Power Rankings</button>
				<button class:active={activeTab === 'players'} on:click={() => activeTab = 'players'}>Player Search</button>
			</div>

			<!-- Team Banner -->
			<div class="team-banner">
				<div class="team-info">
					<h2>{analysis.team.name}</h2>
					<p>{analysis.league.name} - {analysis.league.season} Season (Week {analysis.league.week})</p>
				</div>
				<div class="team-stats">
					<div class="stat-box">
						<div class="value">{analysis.team.record}</div>
						<div class="label">Record</div>
					</div>
					<div class="stat-box">
						<div class="value" style="color: {getGradeColor(analysis.roster.overallGrade)}">{analysis.roster.overallGrade}</div>
						<div class="label">Roster Grade</div>
					</div>
					<div class="stat-box">
						<div class="value">#{analysis.team.rank}</div>
						<div class="label">Power Rank</div>
					</div>
					<div class="stat-box">
						<div class="value" style="color: {getStrategyColor(analysis.strategy.strategy.recommendation)}">{analysis.strategy.strategy.recommendation}</div>
						<div class="label">Strategy</div>
					</div>
				</div>
			</div>

			<!-- OVERVIEW TAB -->
			{#if activeTab === 'overview'}
				<div class="grid">
					<!-- Roster Grade -->
					<div class="card">
						<h3>Roster Overview</h3>
						<div style="text-align: center; margin-bottom: 15px;">
							<span class="grade-badge" style="background: {getGradeColor(analysis.roster.overallGrade)}20; color: {getGradeColor(analysis.roster.overallGrade)}">
								{analysis.roster.overallGrade}
							</span>
						</div>
						<div class="position-row"><span>Total Value</span><span>{analysis.roster.totalValue.toLocaleString()}</span></div>
						<div class="position-row"><span>Players</span><span>{analysis.roster.playerCount}</span></div>
						<div class="position-row"><span>Starters</span><span>{analysis.roster.starterCount}</span></div>
						<div class="position-row"><span>Avg Age</span><span>{analysis.roster.avgAge}</span></div>
					</div>

					<!-- Position Grades -->
					<div class="card">
						<h3>Position Grades</h3>
						{#each Object.entries(analysis.roster.breakdown) as [pos, group]}
							{#if pos !== 'K' && pos !== 'DEF'}
								<div class="position-row">
									<span><strong>{pos}</strong> ({group.count})</span>
									<span>
										<span class="grade-badge" style="background: {getGradeColor(group.grade)}20; color: {getGradeColor(group.grade)}; font-size: 0.85em; padding: 2px 8px;">
											{group.grade}
										</span>
									</span>
								</div>
							{/if}
						{/each}
					</div>

					<!-- Strategy Quick Look -->
					<div class="card">
						<h3>Dynasty Strategy</h3>
						<div style="text-align: center; margin-bottom: 12px;">
							<span class="grade-badge" style="background: {getStrategyColor(analysis.strategy.strategy.recommendation)}20; color: {getStrategyColor(analysis.strategy.strategy.recommendation)}">
								{analysis.strategy.strategy.recommendation}
							</span>
							<div style="font-size: 0.8em; color: #94a3b8; margin-top: 4px;">
								{analysis.strategy.strategy.confidence}% confidence
							</div>
						</div>
						<p style="font-size: 0.85em; color: #cbd5e1; line-height: 1.5;">
							{analysis.strategy.strategy.summary}
						</p>
					</div>

					<!-- Top Players -->
					<div class="card">
						<h3>Most Valuable Players</h3>
						{#each analysis.roster.topPlayers as player, i}
							<div class="player-row">
								<div>
									<div class="player-name">{i + 1}. {player.name}</div>
									<div class="player-meta">{player.position} - {player.team} - Age {player.age}</div>
								</div>
								<div class="player-value" style="color: {getTierColor(player.tier)}">{player.dynastyValue.toLocaleString()}</div>
							</div>
						{/each}
					</div>

					<!-- Strengths -->
					{#if analysis.roster.strengths.length > 0}
						<div class="card">
							<h3>Strengths</h3>
							{#each analysis.roster.strengths as s}
								<div class="position-row">
									<div>
										<strong style="color: #22c55e">{s.position}</strong> - {s.grade}
										<div style="font-size: 0.8em; color: #94a3b8">{s.reason}. Best: {s.topPlayer}</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Weaknesses -->
					{#if analysis.roster.weaknesses.length > 0}
						<div class="card">
							<h3>Weaknesses</h3>
							{#each analysis.roster.weaknesses as w}
								<div class="position-row">
									<div>
										<strong style="color: #ef4444">{w.position}</strong> - {w.grade}
										<div style="font-size: 0.8em; color: #94a3b8">{w.reason}. Best: {w.topPlayer}</div>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					<!-- Top Trades Preview -->
					{#if analysis.trades.length > 0}
						<div class="card" style="grid-column: 1 / -1;">
							<h3>Top Trade Suggestions</h3>
							{#each analysis.trades.slice(0, 3) as trade}
								<div style="padding: 10px; background: #0f172a; border-radius: 8px; margin-bottom: 8px;">
									<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
										<strong>Trade with {trade.partnerTeamName}</strong>
										<span class="grade-badge" style="background: {trade.fairness.score >= 70 ? '#22c55e' : '#eab308'}20; color: {trade.fairness.score >= 70 ? '#22c55e' : '#eab308'}; font-size: 0.8em; padding: 2px 8px;">
											{trade.fairness.verdict} ({trade.fairness.score})
										</span>
									</div>
									<div style="font-size: 0.85em; color: #94a3b8;">
										Send: {trade.send.map(p => `${p.name} (${p.position})`).join(', ')} |
										Receive: {trade.receive.map(p => `${p.name} (${p.position})`).join(', ')}
									</div>
								</div>
							{/each}
							<button on:click={() => { activeTab = 'trades'; if (!tradeData) loadTrades(data.rosterId); }} style="margin-top: 8px; padding: 8px 16px; border-radius: 6px; border: 1px solid #334155; background: transparent; color: #94a3b8; cursor: pointer;">
								View All Trades
							</button>
						</div>
					{/if}
				</div>

			<!-- ROSTER TAB -->
			{:else if activeTab === 'roster'}
				<div class="grid">
					{#each Object.entries(analysis.roster.breakdown) as [pos, group]}
						<div class="card">
							<h3>
								{pos}
								<span class="grade-badge" style="background: {getGradeColor(group.grade)}20; color: {getGradeColor(group.grade)}; font-size: 0.75em; padding: 2px 6px; margin-left: 8px;">
									{group.grade}
								</span>
								<span style="font-size: 0.75em; color: #64748b; margin-left: 5px;">Avg Age: {group.avgAge}</span>
							</h3>
							{#each group.players as player}
								<div class="player-row">
									<div>
										<div class="player-name">{player.name}</div>
										<div class="player-meta">
											{player.team} - Age {player.age}
											{#if player.injuryStatus}
												<span style="color: #ef4444;"> ({player.injuryStatus})</span>
											{/if}
										</div>
									</div>
									<div style="text-align: right;">
										<div class="player-value">{player.dynastyValue.toLocaleString()}</div>
										<div style="font-size: 0.75em; color: {getTierColor(player.tier)}">{player.tier}</div>
									</div>
								</div>
							{/each}
						</div>
					{/each}
				</div>

			<!-- LINEUP TAB -->
			{:else if activeTab === 'lineup'}
				<div class="card" style="margin-bottom: 20px;">
					<h3>Optimal Lineup - Week {analysis.lineup.week || 'Current'}</h3>
					<div style="text-align: center; margin-bottom: 15px;">
						<span style="font-size: 1.5em; font-weight: 700;">{analysis.lineup.totalProjected}</span>
						<span style="color: #94a3b8;"> projected points</span>
					</div>

					<h4 style="color: #22c55e; margin: 15px 0 8px;">Starters</h4>
					{#each analysis.lineup.starters as player}
						<div class="lineup-slot">
							<div style="display: flex; align-items: center; gap: 10px;">
								<span class="slot-label">{player.slot}</span>
								<div>
									<div class="player-name">{player.name}</div>
									<div class="player-meta">{player.position} - {player.team}</div>
								</div>
							</div>
							<div style="text-align: right;">
								<div style="font-weight: 600;">{player.projectedPts.toFixed(1)}</div>
								<div style="font-size: 0.75em; color: #94a3b8;">projected</div>
							</div>
						</div>
					{/each}

					<h4 style="color: #eab308; margin: 20px 0 8px;">Bench</h4>
					{#each analysis.lineup.bench.slice(0, 8) as player}
						<div class="lineup-slot" style="opacity: 0.7;">
							<div style="display: flex; align-items: center; gap: 10px;">
								<span class="slot-label" style="background: #1e293b;">BN</span>
								<div>
									<div class="player-name">{player.name}</div>
									<div class="player-meta">{player.position} - {player.team}</div>
								</div>
							</div>
							<div style="text-align: right;">
								<div>{player.projectedPts.toFixed(1)}</div>
							</div>
						</div>
					{/each}

					{#if analysis.lineup.warnings.length > 0}
						<h4 style="margin: 20px 0 8px;">Alerts</h4>
						{#each analysis.lineup.warnings as warning}
							<div class="warning-box {warning.severity}">
								{warning.message}
							</div>
						{/each}
					{/if}
				</div>

			<!-- TRADES TAB -->
			{:else if activeTab === 'trades'}
				{#if loadingTrades}
					<div class="loading">
						<p>Finding trade opportunities...</p>
						<br />
						<LinearProgress indeterminate />
					</div>
				{:else if tradeData}
					<!-- Positional Needs -->
					<div class="card" style="margin-bottom: 20px;">
						<h3>Your Positional Needs</h3>
						<div class="grid" style="margin-bottom: 0;">
							{#each tradeData.myNeeds.filter(n => n.position !== 'K' && n.position !== 'DEF').slice(0, 4) as need}
								<div class="position-row">
									<div>
										<strong>{need.position}</strong>
										<span class="grade-badge" style="background: {getGradeColor(need.grade)}20; color: {getGradeColor(need.grade)}; font-size: 0.75em; padding: 1px 6px; margin-left: 5px;">{need.grade}</span>
									</div>
									<div style="font-size: 0.85em; color: #94a3b8;">
										{need.qualityStarters}/{need.requiredStarters} starters | Depth: {need.depth}
									</div>
								</div>
							{/each}
						</div>
					</div>

					<!-- Trade Packages -->
					<h3 style="margin-bottom: 12px;">Recommended Trade Packages</h3>
					{#each tradeData.packages as trade, i}
						<div class="trade-card">
							<div class="trade-header">
								<strong>#{i + 1} - Trade with {trade.partnerTeamName}</strong>
								<span class="grade-badge" style="background: {trade.fairness.score >= 70 ? '#22c55e' : trade.fairness.score >= 50 ? '#eab308' : '#ef4444'}20; color: {trade.fairness.score >= 70 ? '#22c55e' : trade.fairness.score >= 50 ? '#eab308' : '#ef4444'}; font-size: 0.85em; padding: 3px 10px;">
									{trade.fairness.verdict} ({trade.fairness.score}/100)
								</span>
							</div>
							<div class="trade-sides">
								<div class="trade-side">
									<h4>You Send</h4>
									{#each trade.send as player}
										<div class="player-row">
											<span class="player-name">{player.name}</span>
											<span class="player-meta">{player.position} | {player.dynastyValue.toLocaleString()}</span>
										</div>
									{/each}
									<div style="text-align: right; font-weight: 600; margin-top: 5px;">Total: {trade.fairness.sendValue.toLocaleString()}</div>
								</div>
								<div class="trade-arrow">&#8644;</div>
								<div class="trade-side">
									<h4>You Receive</h4>
									{#each trade.receive as player}
										<div class="player-row">
											<span class="player-name">{player.name}</span>
											<span class="player-meta">{player.position} | {player.dynastyValue.toLocaleString()}</span>
										</div>
									{/each}
									<div style="text-align: right; font-weight: 600; margin-top: 5px;">Total: {trade.fairness.receiveValue.toLocaleString()}</div>
								</div>
							</div>
							<p style="font-size: 0.85em; color: #94a3b8; margin-top: 10px;">
								{trade.rationale}
							</p>
						</div>
					{/each}

					{#if tradeData.packages.length === 0}
						<div class="card">
							<p style="text-align: center; color: #94a3b8;">No trade packages found. Your roster may be well-balanced or league rosters don't have matching trade partners.</p>
						</div>
					{/if}
				{:else}
					<div class="card">
						<p style="text-align: center;">
							<button on:click={() => loadTrades(data.rosterId)}>Load Trade Suggestions</button>
						</p>
					</div>
				{/if}

			<!-- STRATEGY TAB -->
			{:else if activeTab === 'strategy'}
				<div class="strategy-banner">
					<span class="strategy-badge" style="background: {getStrategyColor(analysis.strategy.strategy.recommendation)}25; color: {getStrategyColor(analysis.strategy.strategy.recommendation)}">
						{analysis.strategy.strategy.recommendation}
					</span>
					<div style="font-size: 0.9em; color: #94a3b8; margin-top: 5px;">
						{analysis.strategy.strategy.confidence}% confidence
					</div>
				</div>

				<div class="card" style="margin-bottom: 20px;">
					<h3>Strategy Summary</h3>
					<p style="line-height: 1.6; color: #cbd5e1;">{analysis.strategy.strategy.summary}</p>
				</div>

				<div class="grid">
					<!-- Championship Window -->
					<div class="card">
						<h3>Championship Window</h3>
						<div class="position-row"><span>Window Status</span><strong>{analysis.strategy.windowAnalysis.windowStatus}</strong></div>
						<div class="position-row"><span>Years Left</span><strong>{analysis.strategy.windowAnalysis.windowYears}</strong></div>
						<div class="position-row"><span>Core Players</span><strong>{analysis.strategy.windowAnalysis.corePlayerCount}</strong></div>
						<div class="position-row"><span>Competitive Score</span><strong>{analysis.strategy.windowAnalysis.competitiveScore}/100</strong></div>
						<div class="position-row"><span>Elite QB</span><strong>{analysis.strategy.windowAnalysis.hasEliteQB ? 'Yes' : 'No'}</strong></div>
						<div class="position-row"><span>Elite RBs (2+)</span><strong>{analysis.strategy.windowAnalysis.hasEliteRBs ? 'Yes' : 'No'}</strong></div>
						<div class="position-row"><span>Elite WRs (2+)</span><strong>{analysis.strategy.windowAnalysis.hasEliteWRs ? 'Yes' : 'No'}</strong></div>
					</div>

					<!-- Age Profile -->
					<div class="card">
						<h3>Age Profile</h3>
						<div class="position-row"><span>Average Age</span><strong>{analysis.strategy.ageProfile.avgAge}</strong></div>
						<div class="position-row"><span>Value-Weighted Age</span><strong>{analysis.strategy.ageProfile.weightedAge}</strong></div>
						<div class="age-bar">
							<div class="young" style="width: {analysis.strategy.ageProfile.youngPercent}%"></div>
							<div class="prime" style="width: {analysis.strategy.ageProfile.primePercent}%"></div>
							<div class="veteran" style="width: {analysis.strategy.ageProfile.veteranPercent}%"></div>
						</div>
						<div class="age-legend">
							<span style="color: #22c55e">Young (&le;24): {analysis.strategy.ageProfile.youngCount}</span>
							<span style="color: #3b82f6">Prime (25-29): {analysis.strategy.ageProfile.primeCount}</span>
							<span style="color: #ef4444">Veteran (30+): {analysis.strategy.ageProfile.veteranCount}</span>
						</div>
					</div>

					<!-- Draft Strategy -->
					<div class="card">
						<h3>Draft Strategy</h3>
						<div class="draft-card">
							<h4>Approach</h4>
							<p>{analysis.strategy.draftStrategy.approach}</p>
						</div>
						<div class="draft-card">
							<h4>Pick Strategy</h4>
							<p>{analysis.strategy.draftStrategy.pickStrategy}</p>
						</div>
						<div class="draft-card">
							<h4>Target Profile</h4>
							<p>{analysis.strategy.draftStrategy.targets}</p>
						</div>
						{#if analysis.strategy.draftStrategy.positionPriority.length > 0}
							<div class="draft-card">
								<h4>Position Priority</h4>
								<p>{analysis.strategy.draftStrategy.positionPriority.join(' > ')}</p>
							</div>
						{/if}
					</div>
				</div>

				<!-- Action Plan -->
				<div class="card" style="margin-top: 15px;">
					<h3>Action Plan</h3>
					{#each analysis.strategy.actionPlan as action}
						<div class="action-card {action.priority}">
							<h4>{action.priority} Priority: {action.action}</h4>
							<p>{action.detail}</p>
						</div>
					{/each}
				</div>

			<!-- POWER RANKINGS TAB -->
			{:else if activeTab === 'rankings'}
				<div class="card">
					<h3>Dynasty Power Rankings</h3>
					{#each analysis.powerRankings as team}
						<div class="power-rank-row" class:mine={team.rosterId === data.rosterId}>
							<div style="display: flex; align-items: center; gap: 12px;">
								<span class="rank-number">#{team.rank}</span>
								<div>
									<div class="player-name">{team.teamName}</div>
									<div class="player-meta">{team.record} | Grade: {team.overallGrade} | Age: {team.avgAge}</div>
								</div>
							</div>
							<div style="text-align: right;">
								<div class="player-value">{team.totalValue.toLocaleString()}</div>
								<div class="player-meta">dynasty value</div>
							</div>
						</div>
					{/each}
				</div>

			<!-- PLAYER SEARCH TAB -->
			{:else if activeTab === 'players'}
				<div class="card">
					<h3>Player Search</h3>
					<div class="search-box">
						<input
							bind:value={playerSearchQuery}
							placeholder="Search for a player..."
							on:keydown={(e) => e.key === 'Enter' && searchPlayers()}
						/>
						<button on:click={searchPlayers}>Search</button>
					</div>

					{#if searchingPlayers}
						<LinearProgress indeterminate />
					{/if}

					{#each playerSearchResults as player}
						<div class="player-row">
							<div>
								<div class="player-name">{player.name}</div>
								<div class="player-meta">{player.position} - {player.team}</div>
							</div>
							<div class="player-meta">ID: {player.id}</div>
						</div>
					{/each}

					{#if playerSearchResults.length === 0 && playerSearchQuery.length >= 2 && !searchingPlayers}
						<p style="text-align: center; color: #94a3b8;">No players found. Try a different search.</p>
					{/if}
				</div>
			{/if}

		{:catch error}
			<div class="card" style="text-align: center;">
				<h3 style="color: #ef4444;">Analysis Error</h3>
				<p style="color: #94a3b8;">{error.message || 'Failed to load analysis. Please try again.'}</p>
				<button on:click={() => location.reload()} style="margin-top: 15px; padding: 10px 20px; border-radius: 8px; border: 1px solid #334155; background: transparent; color: #94a3b8; cursor: pointer;">
					Retry
				</button>
			</div>
		{/await}
	{/if}
</div>
