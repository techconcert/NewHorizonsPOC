import tseslint from 'typescript-eslint';

const banned = (object, property, message) => ({ object, property, message });

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...[
          'window',
          'document',
          'localStorage',
          'sessionStorage',
          'setTimeout',
          'setInterval',
          'self',
          'performance',
          'navigator',
          'requestAnimationFrame',
          'queueMicrotask',
        ].map((name) => ({ name, message: 'Not allowed in src/sim (pure, deterministic).' })),
      ],
      'no-restricted-properties': [
        'error',
        banned('Math', 'random', 'Use the seeded PRNG.'),
        banned('Math', 'sin', 'Non-deterministic across browsers.'),
        banned('Math', 'cos', 'Non-deterministic across browsers.'),
        banned('Math', 'exp', 'Non-deterministic across browsers.'),
        banned('Math', 'pow', 'Non-deterministic across browsers.'),
        banned('Math', 'log', 'Non-deterministic across browsers.'),
        banned('Math', 'atan2', 'Non-deterministic across browsers.'),
        banned('Math', 'tan', 'Non-deterministic across browsers.'),
        banned('Math', 'asin', 'Non-deterministic across browsers.'),
        banned('Math', 'acos', 'Non-deterministic across browsers.'),
        banned('Math', 'atan', 'Non-deterministic across browsers.'),
        banned('Math', 'hypot', 'Non-deterministic across browsers.'),
        banned('Math', 'cbrt', 'Non-deterministic across browsers.'),
        banned('Math', 'log2', 'Non-deterministic across browsers.'),
        banned('Math', 'log10', 'Non-deterministic across browsers.'),
        banned('Math', 'expm1', 'Non-deterministic across browsers.'),
        banned('Math', 'sinh', 'Non-deterministic across browsers.'),
        banned('Math', 'cosh', 'Non-deterministic across browsers.'),
        banned('Math', 'tanh', 'Non-deterministic across browsers.'),
        banned('Date', 'now', 'No wall clock in sim.'),
        banned('performance', 'now', 'No wall clock in sim.'),
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='**']",
          message: 'The ** operator is not allowed in src/sim (non-deterministic).',
        },
        {
          selector: "AssignmentExpression[operator='**=']",
          message: 'The **= operator is not allowed in src/sim (non-deterministic).',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'No wall clock in sim.',
        },
      ],
    },
  },
);
