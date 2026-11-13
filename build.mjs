import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

const common = {
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  minify: true,
  logLevel: 'info',
};

async function copyStatics() {
  await cp('manifest.json', `${outdir}/manifest.json`);
  await cp('src/content.css', `${outdir}/content.css`);
  await cp('src/early.css', `${outdir}/early.css`);
  await cp('icons', `${outdir}/icons`, { recursive: true });
}

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

if (watch) {
  const ctx = await context({ ...common, entryPoints: ['src/content.ts', 'src/early.ts'], outdir });
  await ctx.watch();
  await copyStatics();
  console.log('watching…');
} else {
  await build({ ...common, entryPoints: ['src/content.ts', 'src/early.ts'], outdir });
  await copyStatics();
}