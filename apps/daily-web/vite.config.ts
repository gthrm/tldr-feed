import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// In production Caddy puts the API behind /api on the same origin; in dev
	// this proxy does the same, so the sign-up form works locally as it will live.
	server: {
		proxy: {
			'/api': { target: process.env.API_URL ?? 'http://localhost:3090', changeOrigin: true }
		}
	},
	plugins: [
		sveltekit({
			// Absolute asset paths. With relative ones, /28-09/sun.png is looked up
			// under the day rather than at the root, and the icons vanish on any URL
			// that carries a trailing slash.
			paths: { relative: false },
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Every page is prerendered: a reader gets a file, never a query.
			// SITE_OUT lets the nightly build write straight into the volume Caddy
			// serves, so nothing has to be copied afterwards.
			adapter: adapter({
				pages: process.env.SITE_OUT ?? 'build',
				assets: process.env.SITE_OUT ?? 'build',
				fallback: '404.html',
				strict: false
			})
		})
	]
});
