// node scripts/minify.mjs in.css out.css [targetsJson]
import { transform, browserslistToTargets } from "lightningcss";
import browserslist from "browserslist";
import fs from "node:fs";
import zlib from "node:zlib";

const [, , inFile, outFile, query] = process.argv;
const targets = query ? browserslistToTargets(browserslist(query)) : undefined;
// errorRecovery: a rule lightningcss cannot parse is DROPPED and the build
// carries on. That is the right call for a stylesheet we do not fully control
// (Tailwind and two plugins feed into it), but a dropped rule is invisible in
// the output — so every warning is fatal. A CSS feature newer than the pinned
// lightningcss is the way this bites: bump the dependency, or write the rule
// another way. Never silence it here.
const { code, warnings } = transform({
  filename: inFile,
  code: fs.readFileSync(inFile),
  minify: true,
  targets,
  errorRecovery: true,
});
for (const w of warnings.slice(0, 10)) console.log("warn:", w.message);
if (warnings.length > 10) console.log(`warn: …and ${warnings.length - 10} more`);
if (warnings.length) {
  console.error(
    `\n${inFile}: lightningcss reported ${warnings.length} warning(s), and it drops what it ` +
      `cannot parse. ${outFile} was NOT written.`,
  );
  process.exit(1);
}
fs.writeFileSync(outFile, code);
const gz = zlib.gzipSync(code, { level: 9 }).length;
const br = zlib.brotliCompressSync(code).length;
console.log(
  `${outFile}  raw=${code.length}  gzip=${gz}  brotli=${br}  warnings=0  targets=${query ?? "(none)"}`,
);
