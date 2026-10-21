// Stops a Netlify deploy that is not connected to Supabase.
//
// Without VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY the app runs in preview mode, where
// accounts and everything else are kept only in that browser: nothing reaches Supabase Auth
// (Authentication > Users) or the database. That is fine on your own computer, never on a real
// site, so a Netlify build without them fails here with what to set.
// Set VITE_ELUM_PREVIEW=true to deploy a browser-only preview on purpose.
const env = process.env;
if (env.NETLIFY !== 'true' || env.VITE_ELUM_PREVIEW === 'true') process.exit(0);

const url = (env.VITE_SUPABASE_URL ?? '').trim() || 'https://afdnnvngrpdodsfwpaqo.supabase.co';
const key = (env.VITE_SUPABASE_ANON_KEY ?? '').trim() || 'sb_publishable_0o6tXC51UwLFHi8j8d9zcQ_xeB1eKyz';
const problems = [];
if (!url) problems.push('VITE_SUPABASE_URL is not set.');
else if (!/^https:\/\/\S+$/.test(url)) {
  problems.push(`VITE_SUPABASE_URL should look like https://abcd.supabase.co (it is "${url}").`);
}
if (!key) problems.push('VITE_SUPABASE_ANON_KEY is not set.');
else if (key.length < 30) problems.push('VITE_SUPABASE_ANON_KEY looks too short to be the anon (public) key.');

if (problems.length) {
  console.error(`
This site is not connected to Supabase, so accounts would never be saved:
  - ${problems.join('\n  - ')}

Fix: in Netlify, open this site > Site configuration > Environment variables, and add
  VITE_SUPABASE_URL       your project URL (Supabase > Project Settings > API > Project URL)
  VITE_SUPABASE_ANON_KEY  the anon public key (same page, "Project API keys")
for all deploy contexts. Then trigger a new deploy (Deploys > Trigger deploy > Clear cache and deploy).
`);
  process.exit(1);
}
console.log(`Connected to Supabase at ${url}.`);
