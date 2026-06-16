module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/test/**/*.spec.ts'],
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: {
    '^@angular/core$': '<rootDir>/test/__mocks__/angular-core.js',
    '^tabby-core$': '<rootDir>/test/__mocks__/tabby-core.js',
    '^tabby-terminal$': '<rootDir>/test/__mocks__/tabby-terminal.js',
  },
}
