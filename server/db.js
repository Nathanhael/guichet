"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.transaction = exports.run = exports.get = exports.query = exports.db = void 0;
var postgres_js_1 = require("./db/postgres.js");
Object.defineProperty(exports, "db", { enumerable: true, get: function () { return postgres_js_1.db; } });
Object.defineProperty(exports, "query", { enumerable: true, get: function () { return postgres_js_1.query; } });
Object.defineProperty(exports, "get", { enumerable: true, get: function () { return postgres_js_1.get; } });
Object.defineProperty(exports, "run", { enumerable: true, get: function () { return postgres_js_1.run; } });
Object.defineProperty(exports, "transaction", { enumerable: true, get: function () { return postgres_js_1.transaction; } });
