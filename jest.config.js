module.exports = {
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.js'],
    testTimeout: 30000, // 30 seconds for database operations
    collectCoverage: true,
    collectCoverageFrom: [
        'routes/mongoFilters.js',
        'dbAbstraction.js',
        '!node_modules/**',
        '!tests/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    verbose: false,
    // Add these options to handle async operations
    forceExit: true,
    // detectOpenHandles: true,
    // Clear mocks after each test
    clearMocks: true,
    resetMocks: true,
    restoreMocks: true
};