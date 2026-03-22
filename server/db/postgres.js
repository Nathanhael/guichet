"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transaction = exports.run = exports.get = exports.query = exports.db = void 0;
var node_postgres_1 = require("drizzle-orm/node-postgres");
var pg_1 = require("pg");
var schema = require("./schema.js");
var logger_js_1 = require("../utils/logger.js");
var Pool = pg_1.default.Pool, types = pg_1.default.types;
// Return timestamp/timestamptz columns as raw strings instead of Date objects.
// The codebase treats these as ISO strings (matching Drizzle's `mode: 'string'`).
types.setTypeParser(1114, function (val) { return val; }); // timestamp
types.setTypeParser(1184, function (val) { return val; }); // timestamptz
var pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/tessera',
});
pool.on('error', function (err) {
    logger_js_1.default.error({ err: err.message }, 'Unexpected error on idle PostgreSQL client');
});
exports.db = (0, node_postgres_1.drizzle)(pool, { schema: schema });
// Convert snake_case keys to camelCase
function toCamelCase(str) {
    return str.toLowerCase().replace(/_([a-z0-9])/g, function (_, c) { return c.toUpperCase(); });
}
function camelCaseRows(rows) {
    return rows.map(function (row) {
        var out = {};
        for (var _i = 0, _a = Object.keys(row); _i < _a.length; _i++) {
            var key = _a[_i];
            out[toCamelCase(key)] = row[key];
        }
        return out;
    });
}
// Helper for traditional query patterns if needed, though drizzle is preferred
var query = function (text, params) { return __awaiter(void 0, void 0, void 0, function () {
    var start, res, duration, err_1;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                start = Date.now();
                _a.label = 1;
            case 1:
                _a.trys.push([1, 3, , 4]);
                return [4 /*yield*/, pool.query(text, params)];
            case 2:
                res = _a.sent();
                duration = Date.now() - start;
                logger_js_1.default.debug({ text: text, duration: duration, rows: res.rowCount }, 'Executed query');
                return [2 /*return*/, camelCaseRows(res.rows)];
            case 3:
                err_1 = _a.sent();
                logger_js_1.default.error({ err: err_1 instanceof Error ? err_1.message : String(err_1), text: text, params: params }, 'Database query error');
                throw err_1;
            case 4: return [2 /*return*/];
        }
    });
}); };
exports.query = query;
var get = function (text, params) { return __awaiter(void 0, void 0, void 0, function () {
    var rows;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, exports.query)(text, params)];
            case 1:
                rows = _a.sent();
                return [2 /*return*/, rows[0]];
        }
    });
}); };
exports.get = get;
var run = function (text, params) { return __awaiter(void 0, void 0, void 0, function () {
    var res;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, pool.query(text, params)];
            case 1:
                res = _a.sent();
                return [2 /*return*/, { changes: res.rowCount }];
        }
    });
}); };
exports.run = run;
var transaction = function (cb) { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, exports.db.transaction(function (tx) { return __awaiter(void 0, void 0, void 0, function () {
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0: return [4 /*yield*/, cb(tx)];
                            case 1: return [2 /*return*/, _a.sent()];
                        }
                    });
                }); })];
            case 1: return [2 /*return*/, _a.sent()];
        }
    });
}); };
exports.transaction = transaction;
