/**
 * Bundled by jsDelivr using Rollup v2.79.2 and Terser v5.39.0.
 * Original file: /npm/ml-array-min@1.2.3/lib-es6/index.js
 *
 * Do NOT use SRI with dynamically generated files! More information: https://www.jsdelivr.com/using-sri-with-dynamic-files
 */
import { isAnyArray as e } from "./is-any-array.js"; function r(r) { var t = arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {}; if (!e(r)) throw new TypeError("input must be an array"); if (0 === r.length) throw new TypeError("input must not be empty"); var n = t.fromIndex, o = void 0 === n ? 0 : n, a = t.toIndex, i = void 0 === a ? r.length : a; if (o < 0 || o >= r.length || !Number.isInteger(o)) throw new Error("fromIndex must be a positive integer smaller than length"); if (i <= o || i > r.length || !Number.isInteger(i)) throw new Error("toIndex must be an integer greater than fromIndex and at most equal to length"); for (var m = r[o], h = o + 1; h < i; h++)r[h] < m && (m = r[h]); return m } export { r as default };
//# sourceMappingURL=/sm/61c977b01e8e9c50d3df9b8974bf5aa3ccf34c2ab434f12523e0c95eb28df1ca.map
