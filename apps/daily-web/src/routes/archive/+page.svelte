<script lang="ts">
	import { formatDay } from '$lib/sections.js';
	let { data } = $props();
</script>

<svelte:head><title>TLDR daily — archive</title></svelte:head>

<h1>Archive</h1>
{#if data.days.length}
	{#each data.days as d (d.day)}
		<div class="archive-row">
			<a href="/{d.day}">{formatDay(d.day)}</a>
			<span class="count">{d.count}</span>
		</div>
	{/each}
{:else}
	<p class="empty">Empty for now.</p>
{/if}
