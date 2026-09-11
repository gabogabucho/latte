import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(resolve(process.cwd(), 'package.json'));
const { load } = require('js-yaml') as {
  load(source: string): unknown;
};

interface ReleaseWorkflow {
  concurrency?: {
    group?: string;
    'cancel-in-progress'?: boolean;
  };
  on?: {
    push?: {
      tags?: string[];
    };
  };
  jobs?: {
    build?: {
      steps?: Array<{
        uses?: string;
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
  },
  {
    platform: 'windows',
    file: '.github/workflows/release-windows.yml',
    assets: ['release/Latte-Setup.exe', 'release/latest.yml'],
  },
  {
    platform: 'macos',
    file: '.github/workflows/release-macos.yml',
    assets: ['release/*.dmg', 'release/*.zip', 'release/latest-mac.yml'],
  },
] as const;

function readWorkflow(file: string): ReleaseWorkflow {
  return load(readFileSync(resolve(process.cwd(), file), 'utf8')) as ReleaseWorkflow;
}

describe('release workflows', () => {
  it.each(workflows)('serializes $platform draft uploads by tag', ({ file }) => {
    const workflow = readWorkflow(file);

    expect(workflow.concurrency).toEqual({
      group: 'release-${{ github.ref_name }}',
      'cancel-in-progress': false,
    });
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
