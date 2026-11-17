/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      severity: 'error',
      comment:
        'Kernel and domain packages own invariants. Frameworks and drivers stay in adapters.',
      from: { path: '(^|/)packages/(kernel|domain-[^/]+)/' },
      to: {
        path: 'node_modules/(fastify|drizzle-orm|pg|amqplib|mongodb|mongoose|zod|pino|@opentelemetry)',
      },
    },
    {
      name: 'domain-does-not-import-adapters',
      severity: 'error',
      comment:
        'Dependencies point inward: adapters import the domain, never the reverse.',
      from: { path: '(^|/)packages/(kernel|domain-[^/]+)/' },
      to: {
        path: '(^|/)(apps/|packages/(persistence-pg|persistence-mongo|messaging|auth|observability|testkit)/)',
      },
    },
    {
      name: 'kernel-imports-no-other-package',
      severity: 'error',
      comment:
        'The shared kernel is IDs and errors only. Context rules live in domain packages.',
      from: { path: '(^|/)packages/kernel/' },
      to: { path: '(^|/)packages/(?!kernel/)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}
