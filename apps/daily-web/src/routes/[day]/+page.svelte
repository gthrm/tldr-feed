<script lang="ts">
	import Story from '$lib/Story.svelte';
	import Subscribe from '$lib/Subscribe.svelte';
	import { SECTIONS, formatDay } from '$lib/sections.js';
	let { data } = $props();
	const day = $derived(data.day);
	const inSection = (key: string) => day.entries.filter((e) => e.section === key);
</script>

<svelte:head>
	<title>TLDR daily — {formatDay(day.day)}</title>
	<meta name="description" content="{day.entries.length} stories from {formatDay(day.day)}." />
</svelte:head>

<h1>{formatDay(day.day)}</h1>
<div class="day-nav">
	<span>
		{#if data.older}<a href="/{data.older}">← {formatDay(data.older)}</a>{/if}
	</span>
	<span>
		{#if data.newer}<a href="/{data.newer}">{formatDay(data.newer)} →</a>{/if}
	</span>
</div>

{#each SECTIONS as [key, label] (key)}
	{#if inSection(key).length}
		<h4 class="section-heading">{label}</h4>
		{#each inSection(key) as entry (entry.url)}
			<Story {entry} />
		{/each}
	{/if}
{/each}

<Subscribe />
<p><a href="/archive">All days →</a></p>
