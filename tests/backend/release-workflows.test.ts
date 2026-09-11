import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(resolve(process.cwd(), 'package.json'));
const { load } = require('js-yaml') as {
  load(source: string): unknown;
};

interface ReleaseWorkflow {
  concurrency?: unknown;
  on?: {
    push?: {
      tags?: string[];
    };
  };
  jobs?: {
    build?: {
      steps?: Array<{
        name?: string;
        uses?: string;
        env?: {
          GH_TOKEN?: string;
        };
        run?: string;
        with?: {
          path?: string;
        };
      }>;
    };
  };
}

const workflows = [
  {
    platform: 'linux',
    file: '.github/workflows/release-linux.yml',
    assets: ['release/*.AppImage', 'release/*.deb', 'release/latest-linux.yml'],
    releaseAssets: 'release/*.AppImage release/*.deb release/latest-linux.yml',
  },
  {
    platform: 'windows',
    file: '.github/workflows/release-windows.yml',
    assets: ['release/Latte-Setup.exe', 'release/latest.yml', 'release/*.exe.blockmap'],
    releaseAssets: 'release/Latte-Setup.exe release/latest.yml release/*.exe.blockmap',
  },
  {
    platform: 'macos',
    file: '.github/workflows/release-macos.yml',
    assets: ['release/*.dmg', 'release/*.zip', 'release/latest-mac.yml'],
    releaseAssets: '"${assets[@]}"',
  },
] as const;

function readWorkflow(file: string): ReleaseWorkflow {
  return load(readFileSync(resolve(process.cwd(), file), 'utf8')) as ReleaseWorkflow;
}

describe('release workflows', () => {
  it.each(workflows)('uses a bounded race-safe $platform draft release protocol', ({ file, releaseAssets }) => {
    const workflow = readWorkflow(file);
    const releaseStep = workflow.jobs?.build?.steps?.find(
      (step) => step.env?.GH_TOKEN && step.run?.includes('gh release'),
    );
    const script = releaseStep?.run ?? '';
    const initialView = script.indexOf('if ! gh release view "$tag"');
    const create = script.indexOf('if ! gh release create "$tag" \\');
    const retry = script.indexOf('for attempt in {1..10}; do');
    const upload = script.indexOf(`gh release upload "$tag" ${releaseAssets}`);

    expect(workflow.concurrency).toBeUndefined();
    expect(releaseStep).toBeDefined();
    expect(initialView).toBeGreaterThanOrEqual(0);
    expect(create).toBeGreaterThan(initialView);
    expect(script).not.toMatch(/gh release create "\$tag"[^\n]*(?:release\/|"\$\{assets\[@\]\}")/);
    expect(script).toContain('echo "::warning::No se pudo crear la release; puede haberla creado otro workflow."');
    expect(retry).toBeGreaterThan(create);
    expect(script).toContain('if gh release view "$tag" --repo "$GITHUB_REPOSITORY" >/dev/null 2>&1; then');
    expect(script).toContain('if [ "$attempt" -eq 10 ]; then');
    expect(script).toContain('echo "::error::La release $tag no apareció después de 10 intentos."');
    expect(script).toMatch(/if \[ "\$attempt" -eq 10 \]; then\s+echo [^\n]+\s+exit 1\s+fi\s+sleep 2/);
    expect(upload).toBeGreaterThan(retry);
    expect(script).toMatch(
      new RegExp(`done\\s+gh release upload "\\$tag" ${releaseAssets.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]* --clobber`),
    );
  });

  it.each(workflows)('retains the $platform tag trigger and assets', ({ file, assets }) => {
    const workflow = readWorkflow(file);
    const upload = workflow.jobs?.build?.steps?.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    );
    const uploadedAssets = upload?.with?.path
      ?.split('\n')
      .map((asset) => asset.trim())
      .filter(Boolean);

    expect(workflow.on?.push?.tags).toEqual(['v*']);
    expect(uploadedAssets).toEqual(assets);
  });
});
