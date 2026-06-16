// jsdom (v20) does not expose TextDecoder/TextEncoder globally.
// Copy them from Node's 'util' module so tests that rely on these globals work.
const { TextDecoder, TextEncoder } = require('util')
global.TextDecoder = TextDecoder
global.TextEncoder = TextEncoder
