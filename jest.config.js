module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['**/test/**/*.spec.ts'],
  setupFiles: ['./jest.setup.js'],
}
