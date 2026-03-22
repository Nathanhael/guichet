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
exports.setIo = setIo;
exports.getBusinessHoursStatus = getBusinessHoursStatus;
exports.isWithinBusinessHours = isWithinBusinessHours;
exports.broadcastAgentStatus = broadcastAgentStatus;
exports.broadcastQueuePositions = broadcastQueuePositions;
var date_fns_tz_1 = require("date-fns-tz");
var config_js_1 = require("../config.js");
var db_js_1 = require("../db.js");
var logger_js_1 = require("../utils/logger.js");
var io = null;
function setIo(socketIo) {
    io = socketIo;
}
var DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
var WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function isValidTimezone(timezone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
        return true;
    }
    catch (_a) {
        return false;
    }
}
function parseMinutes(value) {
    var _a = value.split(':').map(Number), hours = _a[0], minutes = _a[1];
    return hours * 60 + minutes;
}
function minutesToTime(value) {
    var normalized = ((value % 1440) + 1440) % 1440;
    var hours = Math.floor(normalized / 60);
    var minutes = normalized % 60;
    return "".concat(String(hours).padStart(2, '0'), ":").concat(String(minutes).padStart(2, '0'));
}
function startOfToday(now) {
    return now.getHours() * 60 + now.getMinutes();
}
function weekdayKey(now) {
    var _a;
    return (_a = DAY_KEYS[now.getDay()]) !== null && _a !== void 0 ? _a : 'mon';
}
function buildDefaultSchedule() {
    var defaultWindow = {
        start: config_js_1.default.BUSINESS_HOURS_START,
        end: config_js_1.default.BUSINESS_HOURS_END,
    };
    return {
        version: 1,
        timezone: 'Europe/Brussels',
        weekly: {
            mon: { closed: false, windows: [defaultWindow] },
            tue: { closed: false, windows: [defaultWindow] },
            wed: { closed: false, windows: [defaultWindow] },
            thu: { closed: false, windows: [defaultWindow] },
            fri: { closed: false, windows: [defaultWindow] },
            sat: { closed: true, windows: [] },
            sun: { closed: true, windows: [] },
        },
        exceptions: [],
    };
}
function normalizeSchedule(schedule) {
    var _a;
    var fallback = buildDefaultSchedule();
    if (!schedule)
        return fallback;
    return {
        version: 1,
        timezone: isValidTimezone(schedule.timezone) ? schedule.timezone : fallback.timezone,
        weekly: WEEKDAY_KEYS.reduce(function (acc, key) {
            var _a, _b;
            var value = (_a = schedule.weekly) === null || _a === void 0 ? void 0 : _a[key];
            acc[key] = value
                ? { closed: !!value.closed, windows: (_b = value.windows) !== null && _b !== void 0 ? _b : [] }
                : fallback.weekly[key];
            return acc;
        }, {}),
        exceptions: (_a = schedule.exceptions) !== null && _a !== void 0 ? _a : [],
    };
}
function fromLegacyBusinessHours(partner) {
    if (partner === null || partner === void 0 ? void 0 : partner.businessHoursSchedule) {
        return normalizeSchedule(partner.businessHoursSchedule);
    }
    if (!(partner === null || partner === void 0 ? void 0 : partner.businessHoursStart) || !(partner === null || partner === void 0 ? void 0 : partner.businessHoursEnd)) {
        return buildDefaultSchedule();
    }
    var timezone = partner.businessHoursTimezone && isValidTimezone(partner.businessHoursTimezone)
        ? partner.businessHoursTimezone
        : 'Europe/Brussels';
    var schedule = buildDefaultSchedule();
    schedule.timezone = timezone;
    schedule.weekly = WEEKDAY_KEYS.reduce(function (acc, key) {
        acc[key] = {
            closed: key === 'sat' || key === 'sun',
            windows: key === 'sat' || key === 'sun'
                ? []
                : [{ start: partner.businessHoursStart, end: partner.businessHoursEnd }],
        };
        return acc;
    }, {});
    return schedule;
}
function windowsForDate(schedule, now) {
    var _a, _b;
    var localDate = (0, date_fns_tz_1.formatInTimeZone)(now, schedule.timezone, 'yyyy-MM-dd');
    var exception = schedule.exceptions.find(function (item) { return item.date === localDate; });
    if (exception) {
        return {
            source: 'exception',
            windows: exception.closed ? [] : ((_a = exception.windows) !== null && _a !== void 0 ? _a : []),
        };
    }
    var day = weekdayKey((0, date_fns_tz_1.toZonedTime)(now, schedule.timezone));
    var daySchedule = schedule.weekly[day];
    return {
        source: 'weekly',
        windows: (daySchedule === null || daySchedule === void 0 ? void 0 : daySchedule.closed) ? [] : ((_b = daySchedule === null || daySchedule === void 0 ? void 0 : daySchedule.windows) !== null && _b !== void 0 ? _b : []),
    };
}
function statusMessage(status) {
    if (status.isOpen) {
        return status.nextCloseAt
            ? "Support is open. Closes at ".concat((0, date_fns_tz_1.formatInTimeZone)(status.nextCloseAt, status.timezone, 'EEE HH:mm'), ".")
            : 'Support is open.';
    }
    return status.nextOpenAt
        ? "Support is currently closed. Reopens at ".concat((0, date_fns_tz_1.formatInTimeZone)(status.nextOpenAt, status.timezone, 'EEE HH:mm'), ".")
        : 'Support is currently closed.';
}
function nextBoundary(schedule, now, kind) {
    var _a, _b, _c, _d;
    var zonedNow = (0, date_fns_tz_1.toZonedTime)(now, schedule.timezone);
    var currentMinutes = startOfToday(zonedNow);
    var _loop_1 = function (offset) {
        var candidate = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
        var zonedCandidate = (0, date_fns_tz_1.toZonedTime)(candidate, schedule.timezone);
        var dayKey = weekdayKey(zonedCandidate);
        var localDate = (0, date_fns_tz_1.formatInTimeZone)(candidate, schedule.timezone, 'yyyy-MM-dd');
        var exception = schedule.exceptions.find(function (item) { return item.date === localDate; });
        var windows = exception
            ? (exception.closed ? [] : ((_a = exception.windows) !== null && _a !== void 0 ? _a : []))
            : (((_b = schedule.weekly[dayKey]) === null || _b === void 0 ? void 0 : _b.closed) ? [] : ((_d = (_c = schedule.weekly[dayKey]) === null || _c === void 0 ? void 0 : _c.windows) !== null && _d !== void 0 ? _d : []));
        for (var _i = 0, windows_1 = windows; _i < windows_1.length; _i++) {
            var window_1 = windows_1[_i];
            var startMinutes = parseMinutes(window_1.start);
            var endMinutes = parseMinutes(window_1.end);
            var overnight = endMinutes <= startMinutes;
            var boundaryMinutes = kind === 'open' ? startMinutes : endMinutes;
            var dayOffset = offset + (kind === 'close' && overnight ? 1 : 0);
            if (offset === 0 && boundaryMinutes <= currentMinutes && !(kind === 'close' && overnight)) {
                continue;
            }
            var boundaryDate = new Date(now.getTime() + dayOffset * 24 * 60 * 60 * 1000);
            var boundaryIso = (0, date_fns_tz_1.formatInTimeZone)(boundaryDate, schedule.timezone, 'yyyy-MM-dd');
            return { value: "".concat(boundaryIso, "T").concat(minutesToTime(boundaryMinutes), ":00") };
        }
    };
    for (var offset = 0; offset < 8; offset++) {
        var state_1 = _loop_1(offset);
        if (typeof state_1 === "object")
            return state_1.value;
    }
    return undefined;
}
function getBusinessHoursStatus(partner, now) {
    if (now === void 0) { now = new Date(); }
    var schedule = fromLegacyBusinessHours(partner);
    var zonedNow = (0, date_fns_tz_1.toZonedTime)(now, schedule.timezone);
    var currentMinutes = startOfToday(zonedNow);
    var todayWindows = windowsForDate(schedule, now);
    var matchedWindow;
    for (var _i = 0, _a = todayWindows.windows; _i < _a.length; _i++) {
        var window_2 = _a[_i];
        var startMinutes = parseMinutes(window_2.start);
        var endMinutes = parseMinutes(window_2.end);
        var isOvernight = endMinutes <= startMinutes;
        var isOpen = isOvernight
            ? currentMinutes >= startMinutes || currentMinutes < endMinutes
            : currentMinutes >= startMinutes && currentMinutes < endMinutes;
        if (isOpen) {
            matchedWindow = window_2;
            break;
        }
    }
    var status = {
        isOpen: !!matchedWindow,
        timezone: schedule.timezone,
        source: todayWindows.source,
        matchedWindow: matchedWindow,
        evaluatedAt: now.toISOString(),
        nextOpenAt: matchedWindow ? undefined : nextBoundary(schedule, now, 'open'),
        nextCloseAt: matchedWindow ? nextBoundary(schedule, now, 'close') : undefined,
    };
    status.message = statusMessage(status);
    return status;
}
function isWithinBusinessHours(partner) {
    return getBusinessHoursStatus(partner).isOpen;
}
function broadcastAgentStatus(agentId, online) {
    return __awaiter(this, void 0, void 0, function () {
        var openTickets, _i, openTickets_1, ticket, err_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, db_js_1.query)('SELECT id FROM tickets WHERE agent_id = $1 AND status != $2', [agentId, 'closed'])];
                case 1:
                    openTickets = _a.sent();
                    for (_i = 0, openTickets_1 = openTickets; _i < openTickets_1.length; _i++) {
                        ticket = openTickets_1[_i];
                        io.to("ticket:".concat(ticket.id)).emit('agent:status', { ticketId: ticket.id, agentId: agentId, online: online });
                    }
                    return [3 /*break*/, 3];
                case 2:
                    err_1 = _a.sent();
                    logger_js_1.default.error({ err: err_1 instanceof Error ? err_1.message : String(err_1) }, '[agent:status] error');
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
function broadcastQueuePositions() {
    return __awaiter(this, void 0, void 0, function () {
        var openTickets, err_2;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 2, , 3]);
                    return [4 /*yield*/, (0, db_js_1.query)('SELECT id FROM tickets WHERE status = $1 AND support_id IS NULL ORDER BY created_at ASC', ['open'])];
                case 1:
                    openTickets = _a.sent();
                    openTickets.forEach(function (t, index) {
                        var position = index + 1;
                        io.to("ticket:".concat(t.id)).emit('queue:update', { position: position, etaMins: position * 2 });
                    });
                    return [3 /*break*/, 3];
                case 2:
                    err_2 = _a.sent();
                    logger_js_1.default.error({ err: err_2 instanceof Error ? err_2.message : String(err_2) }, '[broadcastQueuePositions] error');
                    return [3 /*break*/, 3];
                case 3: return [2 /*return*/];
            }
        });
    });
}
