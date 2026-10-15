/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sim-no-render-ui-worker',
      comment: 'src/sim must stay pure: no render, ui or worker imports.',
      severity: 'error',
      from: { path: '^src/sim' },
      to: { path: '^src/(render|ui|worker)' },
    },
    {
      name: 'render-ui-no-sim-or-worker',
      comment: 'src/render and src/ui read only src/shared, never src/sim or src/worker.',
      severity: 'error',
      from: { path: '^src/(render|ui)' },
      to: { path: '^src/(sim|worker)' },
    },
    {
      name: 'sim-no-three',
      severity: 'error',
      from: { path: '^src/sim' },
      to: { path: '(^|/)node_modules/three(/|$)|^three$' },
    },
    {
      name: 'shared-only-shared-and-data',
      comment: 'src/shared may import only src/shared and src/data (LoadoutMath reads the tables).',
      severity: 'error',
      from: { path: '^src/shared' },
      to: {
        path: '^src/(sim|worker|render|ui)|(^|/)node_modules/three(/|$)|^three$',
      },
    },
    {
      name: 'render-ui-no-direct-data',
      comment:
        'src/render and src/ui get the content tables through src/shared (LoadoutMath); no direct src/data imports are needed today.',
      severity: 'error',
      from: { path: '^src/(render|ui)' },
      to: { path: '^src/data' },
    },
  ],
  options: { tsConfig: { fileName: 'tsconfig.json' }, doNotFollow: { path: 'node_modules' } },
};
