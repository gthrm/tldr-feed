<script lang="ts">
	import { base } from '$app/paths';
	import '../app.css';
	let { children } = $props();
</script>

<div class="container">
	<header class="masthead">
		<div>
			<a href="/"><h3>TLDR daily</h3></a>
		</div>
		<nav>
			<a href="/archive">Archive</a>
			<a href="/feed.xml">RSS</a>
		</nav>
		<button
			class="toggle"
			type="button"
			aria-label="Switch between light and dark"
			data-theme-toggle
		>
			<img class="face sun" src="{base}/sun.png" width="16" height="16" alt="" />
			<img class="face moon" src="{base}/moon.png" width="16" height="16" alt="" />
			<span class="thumb"></span>
		</button>
	</header>

	{@render children()}

	<footer>
		<ul>
			<li><a href="https://t.me/tldr_here">👉 telegram</a></li>
			<li><a href="https://cdroma.me">👉 cdroma.me</a></li>
			<li><a href="/archive">👉 archive</a></li>
			<li><a href="/feed.xml">👉 rss</a></li>
		</ul>
	</footer>
</div>
