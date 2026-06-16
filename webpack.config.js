const path = require('path')

module.exports = {
  target: 'node',
  entry: path.resolve(__dirname, 'src/index.ts'),
  context: __dirname,
  devtool: 'source-map',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'index.js',
    pathinfo: true,
    libraryTarget: 'umd',
    devtoolModuleFilenameTemplate: 'webpack-tabby-markdown-preview:///[resource-path]',
  },
  mode: process.env.CI ? 'production' : 'development',
  resolve: {
    modules: ['.', 'src', 'node_modules'].map(x => path.join(__dirname, x)),
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: { loader: 'ts-loader', options: { configFile: path.resolve(__dirname, 'tsconfig.json') } },
      },
      { test: /\.pug$/, use: ['apply-loader', 'pug-loader'] },
      { test: /\.scss$/, use: ['to-string-loader', 'css-loader', 'sass-loader'] },
      { test: /\.svg$/, type: 'asset/source' },
    ],
  },
  externals: [
    'fs', 'os', 'path', 'url', 'electron',
    /^rxjs/, /^@angular/, /^@ng-bootstrap/, /^tabby-/,
  ],
}
