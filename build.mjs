/* Generates js/config.js from environment variables at deploy time,
   so no project keys are committed to the repo.

   Required env:
     SUPABASE_URL
     SUPABASE_ANON_KEY

   Locally:  SUPABASE_URL=... SUPABASE_ANON_KEY=... node build.mjs
*/
import fs from 'node:fs';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
const missing = Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY })
  .filter(([, v]) => !v || !v.trim())
  .map(([k]) => k);

if (missing.length) {
  console.error(`build failed — missing env var(s): ${missing.join(', ')}`);
  console.error('Set them in Vercel under Settings → Environment Variables.');
  process.exit(1);
}

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(SUPABASE_URL.trim())) {
  console.error(`build failed — SUPABASE_URL does not look like a Supabase URL: ${SUPABASE_URL}`);
  process.exit(1);
}

// Optional: when set, the Join form fills the invite code in itself and hides
// the field, so nobody has to retype a code on a phone keyboard. The database
// still enforces it, plus the hard two-player cap.
const INVITE_CODE = (process.env.INVITE_CODE || '').trim();

const out = `// GENERATED AT BUILD TIME by build.mjs — do not edit, do not commit.
// The anon key is public by design: it only identifies the project, and every
// table is guarded by Row Level Security.
window.APP_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(SUPABASE_URL.trim().replace(/\/$/, ''))},
  SUPABASE_ANON_KEY: ${JSON.stringify(SUPABASE_ANON_KEY.trim())},
  INVITE_CODE: ${JSON.stringify(INVITE_CODE)},
};
`;

fs.writeFileSync('js/config.js', out);
console.log(`wrote js/config.js  (${SUPABASE_URL.trim()})`);
