export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'chore', 'ci', 'refactor', 'test', 'perf', 'build']],
    'scope-enum': [2, 'always', ['api', 'web', 'data', 'infra', 'docs']],
    'header-max-length': [2, 'always', 72],
  },
};
