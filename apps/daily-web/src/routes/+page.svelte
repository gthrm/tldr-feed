<script lang="ts">
	import Story from '$lib/Story.svelte';
	import Subscribe from '$lib/Subscribe.svelte';
	import { SECTIONS, formatDay } from '$lib/sections.js';
	let { data } = $props();
	const day = $derived(data.day);
	const inSection = (key: string) => day?.entries.filter((e) => e.section === key) ?? [];
</script>

<svelte:head>
	<title>TLDR daily</title>
	<meta
		name="description"
		content="One page a day of tech, science and the odd corners of the web."
	/>
</svelte:head>

{#if day}
	<h1>{formatDay(day.day)}</h1>
	<div class="day-nav">
		<span>
			{#if data.previous}<a href="/{data.previous}">← {formatDay(data.previous)}</a>{/if}
		</span>
		<span>{day.entries.length} stories</span>
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
	<p><a href="/archive">Earlier days →</a></p>
{:else}
	<h1>Nothing yet</h1>
	<p class="empty">The first digest appears after the first evening run.</p>
	<Subscribe />
{/if}
