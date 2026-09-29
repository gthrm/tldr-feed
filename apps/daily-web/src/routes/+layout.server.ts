// Static from end to end: every page is built once, and no JavaScript is shipped
// to render it. The only script on the site is the theme switch.
export const prerender = true;
export const csr = false;
