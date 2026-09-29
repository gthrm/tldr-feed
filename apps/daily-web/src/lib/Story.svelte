<script lang="ts">
	import type { Entry } from './types.js';
	let { entry }: { entry: Entry } = $props();
</script>

<!-- One shape for every source, exactly as the channel posts it: the headline is
     the only link and it points at the article itself. -->
<article>
	<a class="story" href={entry.url} rel="noopener noreferrer" target="_blank">
		<h3>
			{entry.title}
			<span class="when">— {entry.slot}</span>
		</h3>
		<p>{entry.summary}</p>
		<p class="meta">{entry.domain} · {entry.minutes} min read</p>
	</a>
</article>
