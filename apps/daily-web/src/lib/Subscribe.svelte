<!-- A plain HTML form: it works with JavaScript switched off, and the API is
     reached on the same origin, so there is no CORS and no fetch wrapper. -->
<section class="subscribe">
	<h4>One email a day, in the evening</h4>
	<form method="POST" action="/api/subscriptions">
		<label class="hp" for="website">Leave this empty</label>
		<input class="hp" type="text" id="website" name="website" tabindex="-1" autocomplete="off" />
		<input
			type="email"
			name="email"
			id="email"
			required
			maxlength="254"
			autocomplete="email"
			inputmode="email"
			spellcheck="false"
			placeholder="you@example.com"
			aria-label="Your email"
		/>
		<button type="submit">Subscribe</button>
	</form>
	<p class="note">
		A confirmation link arrives first — nothing is sent until you click it. Every email carries a
		one-click unsubscribe.
	</p>
</section>
