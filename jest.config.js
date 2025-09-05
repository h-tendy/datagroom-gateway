module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    testTimeout: 30000, // 30 seconds for database operations
    collectCoverage: true,
    collectCoverageFrom: [
        'dbAbstraction.js',
        '!node_modules/**',
        '!tests/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    verbose: true
};