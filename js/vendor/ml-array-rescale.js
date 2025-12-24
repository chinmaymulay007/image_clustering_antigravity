/**
 * Bundled by jsDelivr using Rollup v2.79.2 and Terser v5.39.0.
 * Original file: /npm/ml-array-rescale@1.3.5/lib-es6/index.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
import r from "./is-any-array.js"; import a from "./ml-array-max.js"; import t from "./ml-array-min.js"; function n(n) { var o, e = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {}; if (!r(n)) throw new TypeError("input must be an array"); if (0 === n.length) throw new TypeError("input must not be empty"); if (void 0 !== e.output) { if (!r(e.output)) throw new TypeError("output option must be an array if specified"); o = e.output } else o = new Array(n.length); var i = t(n), m = a(n); if (i === m) throw new RangeError("minimum and maximum input values are equal. Cannot rescale a constant array"); var u = e.min, p = void 0 === u ? e.autoMinMax ? i : 0 : u, s = e.max, f = void 0 === s ? e.autoMinMax ? m : 1 : s; if (p >= f) throw new RangeError("min option must be smaller than max option"); for (var l = (f - p) / (m - i), y = 0; y < n.length; y++)o[y] = (n[y] - i) * l + p; return o } export { n as default };
//# sourceMappingURL=/sm/5a66b3af8602c7c4db5034803c8672ae9ddf60578b7080f38bec13c164a06d3f.map