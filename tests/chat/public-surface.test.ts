/**
 * The public surface of `@talk2view/sdk/chat`, held to the agreed contract.
 *
 * Two things go wrong quietly here. An export slips into `index.ts` during
 * implementation and becomes something partners depend on before anyone
 * decides it should be public. Or a prop is renamed in `provider.tsx` and the
 * docs, the example and the partner's code all still compile against the old
 * name because nothing compares the two.
 *
 * So this file checks the shipped declarations, not the source: it asks the
 * TypeScript compiler what `dist/chat/index.d.ts` exports and what shape the
 * two prop types have. Adding an export is then a deliberate act — the test
 * fails and the list below has to be edited.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

const ENTRY = path.resolve('dist/chat/index.d.ts');

/** Everything `@talk2view/sdk/chat` exports — values and types. */
const CONTRACT_EXPORTS = [
  // Values
  'Talk2ViewChat',
  'Talk2ViewChatLauncher',
  'injectTalk2ViewChatStyles',
  'useTalk2ViewChatClient',
  'VoiceButton',
  // Types
  'Talk2ViewChatProps',
  'Talk2ViewChatLauncherProps',
  'Talk2ViewChatFeatures',
  'Talk2ViewChatWelcome',
  'LauncherColourway',
  'VoiceButtonProps',
].sort();

/** The props named in the contract, beyond what `T2VConfig` already carries. */
const CHAT_PROPS = [
  'partnerKey',
  'client',
  'tools',
  'systemPrompt',
  'welcome',
  'allowAnonymous',
  'features',
  'fontFamily',
  'resetPasswordUrl',
  'footer',
  'describeToolActivity',
  'isToolDestructive',
  'destructiveWarning',
  'className',
];

/**
 * …and what `T2VConfig` carries, enumerated rather than waved at.
 *
 * `Talk2ViewChatProps` spreads the config, so without this list the prop
 * assertions could only catch a prop that was REMOVED — and an added prop is
 * the failure this file exists to catch: a partner starts using it, and it is
 * public for good before anyone decided it should be. `partnerKey` is spread
 * out and re-declared by the components, so it lives in CHAT_PROPS instead.
 */
const CONFIG_PROPS = [
  'baseUrl',
  'voiceApiUrl',
  'model',
  'requestTimeout',
  'debug',
  'anonymousAutoStart',
];

/** What the launcher adds on top. */
const LAUNCHER_PROPS = ['label', 'colourway', 'visitorColourway', 'keepClearOf', 'sheetBelow'];

let checker: ts.TypeChecker;
let entryFile: ts.SourceFile;

beforeAll(() => {
  if (!existsSync(ENTRY)) {
    execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
  }
  const program = ts.createProgram([ENTRY], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    strict: true,
    jsx: ts.JsxEmit.ReactJSX,
  });
  checker = program.getTypeChecker();
  entryFile = program.getSourceFile(ENTRY)!;
}, 600_000);

function exportedNames(): string[] {
  const moduleSymbol = checker.getSymbolAtLocation(entryFile)!;
  return checker
    .getExportsOfModule(moduleSymbol)
    .map((s) => s.getName())
    .sort();
}

function propertyNames(typeName: string): string[] {
  const symbol = checker
    .getExportsOfModule(checker.getSymbolAtLocation(entryFile)!)
    .find((s) => s.getName() === typeName);
  expect(symbol, `${typeName} is not exported`).toBeDefined();
  const declared = checker.getDeclaredTypeOfSymbol(symbol!);
  return checker.getPropertiesOfType(declared).map((s) => s.getName());
}

describe('the `/chat` entry point', () => {
  it('exports exactly the contract, and nothing that slipped in', () => {
    expect(exportedNames()).toEqual(CONTRACT_EXPORTS);
  });

  it('exports the five documented functions as callable values', async () => {
    const chat = await import('../../src/chat/index.js');
    const values = Object.keys(chat).sort();
    expect(values).toEqual(
      [
        'Talk2ViewChat',
        'Talk2ViewChatLauncher',
        'VoiceButton',
        'injectTalk2ViewChatStyles',
        'useTalk2ViewChatClient',
      ].sort(),
    );
    for (const name of values) {
      expect(typeof (chat as Record<string, unknown>)[name], `${name} is not a function`).toBe('function');
    }
  });

  // Exact, not `toContain`: a prop that slips in has to fail here the same way
  // an export that slips into index.ts does. Adding one is then a deliberate
  // act — edit the list, and the docs' Props table with it.
  it('gives `Talk2ViewChatProps` exactly the contract, config included', () => {
    expect(propertyNames('Talk2ViewChatProps').sort()).toEqual(
      [...CHAT_PROPS, ...CONFIG_PROPS].sort(),
    );
  });

  it('gives `Talk2ViewChatLauncherProps` exactly the chat props plus its own', () => {
    expect(propertyNames('Talk2ViewChatLauncherProps').sort()).toEqual(
      [...CHAT_PROPS, ...CONFIG_PROPS, ...LAUNCHER_PROPS].sort(),
    );
  });

  it('offers the three documented colourways', () => {
    const symbol = checker
      .getExportsOfModule(checker.getSymbolAtLocation(entryFile)!)
      .find((s) => s.getName() === 'LauncherColourway')!;
    const union = checker.getDeclaredTypeOfSymbol(symbol);
    const members = (union.isUnion() ? union.types : [union])
      .map((t) => checker.typeToString(t).replaceAll('"', ''))
      .sort();
    expect(members).toEqual(['smoke-teal', 'teal-smoke', 'teal-white']);
  });
});
