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
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.partnerRouter = exports.validatedBusinessHoursScheduleSchema = void 0;
var zod_1 = require("zod");
var trpc_js_1 = require("../trpc.js");
var db_js_1 = require("../../db.js");
var schema_js_1 = require("../../db/schema.js");
var drizzle_orm_1 = require("drizzle-orm");
var server_1 = require("@trpc/server");
var logger_js_1 = require("../../utils/logger.js");
var uuid_1 = require("uuid");
var crypto_1 = require("crypto");
var businessHours_js_1 = require("../../services/businessHours.js");
// simple slugify helper
function makeSlug(text) {
    return text.toString().toLowerCase().trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
}
function scheduleFromLegacyBusinessHours(input) {
    var timezone = input.businessHoursTimezone || 'Europe/Brussels';
    var start = input.businessHoursStart || '07:30';
    var end = input.businessHoursEnd || '22:30';
    return {
        version: 1,
        timezone: timezone,
        weekly: {
            mon: { closed: false, windows: [{ start: start, end: end }] },
            tue: { closed: false, windows: [{ start: start, end: end }] },
            wed: { closed: false, windows: [{ start: start, end: end }] },
            thu: { closed: false, windows: [{ start: start, end: end }] },
            fri: { closed: false, windows: [{ start: start, end: end }] },
            sat: { closed: true, windows: [] },
            sun: { closed: true, windows: [] },
        },
        exceptions: [],
    };
}
var businessHoursWindowSchema = zod_1.z.object({
    start: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
    end: zod_1.z.string().regex(/^\d{2}:\d{2}$/),
});
var businessHoursDayScheduleSchema = zod_1.z.object({
    closed: zod_1.z.boolean(),
    windows: zod_1.z.array(businessHoursWindowSchema),
});
var businessHoursExceptionSchema = zod_1.z.object({
    id: zod_1.z.string(),
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    closed: zod_1.z.boolean().optional(),
    windows: zod_1.z.array(businessHoursWindowSchema).optional(),
    note: zod_1.z.string().optional(),
});
var businessHoursScheduleSchema = zod_1.z.object({
    version: zod_1.z.literal(1),
    timezone: zod_1.z.string().min(1),
    weekly: zod_1.z.object({
        mon: businessHoursDayScheduleSchema,
        tue: businessHoursDayScheduleSchema,
        wed: businessHoursDayScheduleSchema,
        thu: businessHoursDayScheduleSchema,
        fri: businessHoursDayScheduleSchema,
        sat: businessHoursDayScheduleSchema,
        sun: businessHoursDayScheduleSchema,
    }),
    exceptions: zod_1.z.array(businessHoursExceptionSchema),
});
function isValidTimezone(timezone) {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
        return true;
    }
    catch (_a) {
        return false;
    }
}
function toMinutes(value) {
    var _a = value.split(':').map(Number), hours = _a[0], minutes = _a[1];
    return hours * 60 + minutes;
}
function validateWindows(windows, ctx, path) {
    var normalized = windows.map(function (window, index) {
        var start = toMinutes(window.start);
        var end = toMinutes(window.end);
        if (start === end) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Window start and end cannot be the same.',
                path: __spreadArray(__spreadArray([], path, true), [index], false),
            });
        }
        return {
            index: index,
            start: start,
            end: end <= start ? end + 1440 : end,
        };
    }).sort(function (a, b) { return a.start - b.start; });
    for (var i = 1; i < normalized.length; i++) {
        var prev = normalized[i - 1];
        var current = normalized[i];
        if (current.start < prev.end) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Windows cannot overlap.',
                path: path,
            });
            break;
        }
    }
}
exports.validatedBusinessHoursScheduleSchema = businessHoursScheduleSchema.superRefine(function (schedule, ctx) {
    if (!isValidTimezone(schedule.timezone)) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            message: 'Invalid timezone.',
            path: ['timezone'],
        });
    }
    for (var _i = 0, _a = Object.entries(schedule.weekly); _i < _a.length; _i++) {
        var _b = _a[_i], dayKey = _b[0], daySchedule = _b[1];
        if (daySchedule.closed && daySchedule.windows.length > 0) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Closed days cannot contain windows.',
                path: ['weekly', dayKey, 'windows'],
            });
        }
        if (!daySchedule.closed && daySchedule.windows.length === 0) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Open days must contain at least one window.',
                path: ['weekly', dayKey, 'windows'],
            });
        }
        if (daySchedule.windows.length > 4) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'A day can have at most 4 windows.',
                path: ['weekly', dayKey, 'windows'],
            });
        }
        validateWindows(daySchedule.windows, ctx, ['weekly', dayKey, 'windows']);
    }
    var seenDates = new Set();
    schedule.exceptions.forEach(function (exception, index) {
        var _a, _b, _c;
        if (seenDates.has(exception.date)) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Exception dates must be unique.',
                path: ['exceptions', index, 'date'],
            });
        }
        seenDates.add(exception.date);
        if (exception.closed && exception.windows && exception.windows.length > 0) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Closed exceptions cannot include windows.',
                path: ['exceptions', index, 'windows'],
            });
        }
        if (!exception.closed && (!exception.windows || exception.windows.length === 0)) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'Open exceptions must include at least one window.',
                path: ['exceptions', index, 'windows'],
            });
        }
        if (((_b = (_a = exception.windows) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 4) {
            ctx.addIssue({
                code: zod_1.z.ZodIssueCode.custom,
                message: 'An exception can have at most 4 windows.',
                path: ['exceptions', index, 'windows'],
            });
        }
        validateWindows((_c = exception.windows) !== null && _c !== void 0 ? _c : [], ctx, ['exceptions', index, 'windows']);
    });
});
exports.partnerRouter = (0, trpc_js_1.router)({
    getManifest: trpc_js_1.adminProcedure.query(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, result, err_1;
        var ctx = _b.ctx;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 2, , 3]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    return [4 /*yield*/, db_js_1.db.select().from(schema_js_1.partners).where((0, drizzle_orm_1.eq)(schema_js_1.partners.id, partnerId)).limit(1)];
                case 1:
                    result = _c.sent();
                    if (result.length === 0)
                        throw new server_1.TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
                    return [2 /*return*/, result[0]];
                case 2:
                    err_1 = _c.sent();
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_1) });
                case 3: return [2 /*return*/];
            }
        });
    }); }),
    getBusinessHours: trpc_js_1.protectedProcedure.query(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, result, row, schedule, status_1, err_2;
        var _c;
        var ctx = _b.ctx;
        return __generator(this, function (_d) {
            switch (_d.label) {
                case 0:
                    _d.trys.push([0, 2, , 3]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    return [4 /*yield*/, db_js_1.db.select({
                            businessHoursSchedule: schema_js_1.partners.businessHoursSchedule,
                            businessHoursStart: schema_js_1.partners.businessHoursStart,
                            businessHoursEnd: schema_js_1.partners.businessHoursEnd,
                            businessHoursTimezone: schema_js_1.partners.businessHoursTimezone,
                        }).from(schema_js_1.partners).where((0, drizzle_orm_1.eq)(schema_js_1.partners.id, partnerId)).limit(1)];
                case 1:
                    result = _d.sent();
                    if (result.length === 0)
                        throw new server_1.TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
                    row = result[0];
                    schedule = (_c = row.businessHoursSchedule) !== null && _c !== void 0 ? _c : null;
                    status_1 = (0, businessHours_js_1.getBusinessHoursStatus)({
                        businessHoursSchedule: schedule,
                        businessHoursStart: row.businessHoursStart,
                        businessHoursEnd: row.businessHoursEnd,
                        businessHoursTimezone: row.businessHoursTimezone,
                    });
                    return [2 /*return*/, {
                            schedule: schedule,
                            status: status_1,
                        }];
                case 2:
                    err_2 = _d.sent();
                    if (err_2 instanceof server_1.TRPCError)
                        throw err_2;
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_2) });
                case 3: return [2 /*return*/];
            }
        });
    }); }),
    updateBusinessHours: trpc_js_1.adminProcedure
        .input(zod_1.z.object({
        schedule: exports.validatedBusinessHoursScheduleSchema.optional(),
        businessHoursStart: zod_1.z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        businessHoursEnd: zod_1.z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
        businessHoursTimezone: zod_1.z.string().min(1).nullable().optional(),
    }))
        .mutation(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, schedule_1, weekdays, primaryWindow, err_3;
        var _c, _d, _e, _f, _g, _h;
        var input = _b.input, ctx = _b.ctx;
        return __generator(this, function (_j) {
            switch (_j.label) {
                case 0:
                    _j.trys.push([0, 3, , 4]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    schedule_1 = (_c = input.schedule) !== null && _c !== void 0 ? _c : scheduleFromLegacyBusinessHours({
                        businessHoursStart: (_d = input.businessHoursStart) !== null && _d !== void 0 ? _d : null,
                        businessHoursEnd: (_e = input.businessHoursEnd) !== null && _e !== void 0 ? _e : null,
                        businessHoursTimezone: (_f = input.businessHoursTimezone) !== null && _f !== void 0 ? _f : null,
                    });
                    weekdays = ['mon', 'tue', 'wed', 'thu', 'fri'];
                    primaryWindow = weekdays
                        .map(function (day) { return schedule_1.weekly[day].windows[0]; })
                        .find(Boolean);
                    return [4 /*yield*/, db_js_1.db.update(schema_js_1.partners)
                            .set({
                            businessHoursSchedule: schedule_1,
                            businessHoursStart: (_g = primaryWindow === null || primaryWindow === void 0 ? void 0 : primaryWindow.start) !== null && _g !== void 0 ? _g : null,
                            businessHoursEnd: (_h = primaryWindow === null || primaryWindow === void 0 ? void 0 : primaryWindow.end) !== null && _h !== void 0 ? _h : null,
                            businessHoursTimezone: schedule_1.timezone,
                        })
                            .where((0, drizzle_orm_1.eq)(schema_js_1.partners.id, partnerId))];
                case 1:
                    _j.sent();
                    return [4 /*yield*/, db_js_1.db.insert(schema_js_1.auditLog).values({
                            action: 'partner.config_updated',
                            actorId: ctx.user.id,
                            partnerId: partnerId,
                            targetType: 'partner',
                            targetId: partnerId,
                            metadata: { details: 'Business hours updated', timezone: schedule_1.timezone },
                        })];
                case 2:
                    _j.sent();
                    logger_js_1.default.info({ partnerId: partnerId }, 'Business Hours updated by Partner Admin');
                    return [2 /*return*/, {
                            success: true,
                            schedule: schedule_1,
                            status: (0, businessHours_js_1.getBusinessHoursStatus)({ businessHoursSchedule: schedule_1 }),
                        }];
                case 3:
                    err_3 = _j.sent();
                    if (err_3 instanceof server_1.TRPCError)
                        throw err_3;
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_3) });
                case 4: return [2 /*return*/];
            }
        });
    }); }),
    updateDepartments: trpc_js_1.adminProcedure
        .input(zod_1.z.object({
        departments: zod_1.z.array(zod_1.z.object({
            id: zod_1.z.string().optional(),
            name: zod_1.z.string().min(1),
            description: zod_1.z.string().optional(),
        })),
    }))
        .mutation(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, mappedDepartments, err_4;
        var input = _b.input, ctx = _b.ctx;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 3, , 4]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    mappedDepartments = input.departments.map(function (d) { return ({
                        id: d.id ? d.id : makeSlug(d.name),
                        name: d.name,
                        description: d.description || ''
                    }); });
                    return [4 /*yield*/, db_js_1.db.update(schema_js_1.partners)
                            .set({ departments: mappedDepartments })
                            .where((0, drizzle_orm_1.eq)(schema_js_1.partners.id, partnerId))];
                case 1:
                    _c.sent();
                    return [4 /*yield*/, db_js_1.db.insert(schema_js_1.auditLog).values({
                            action: 'partner.config_updated',
                            actorId: ctx.user.id,
                            partnerId: partnerId,
                            targetType: 'partner',
                            targetId: partnerId,
                            metadata: { details: 'Departments updated' }
                        })];
                case 2:
                    _c.sent();
                    logger_js_1.default.info({ partnerId: partnerId, count: mappedDepartments.length }, 'Departments updated by Partner Admin');
                    return [2 /*return*/, { success: true }];
                case 3:
                    err_4 = _c.sent();
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_4) });
                case 4: return [2 /*return*/];
            }
        });
    }); }),
    listMembers: trpc_js_1.adminProcedure
        .input(zod_1.z.object({
        limit: zod_1.z.number().min(1).max(100).default(50),
        offset: zod_1.z.number().min(0).default(0),
    }))
        .query(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, result, err_5;
        var input = _b.input, ctx = _b.ctx;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 2, , 3]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    return [4 /*yield*/, db_js_1.db
                            .select({
                            membershipId: schema_js_1.memberships.id,
                            userId: schema_js_1.users.id,
                            name: schema_js_1.users.name,
                            email: schema_js_1.users.email,
                            role: schema_js_1.memberships.role,
                            departments: schema_js_1.memberships.departments,
                            createdAt: schema_js_1.memberships.createdAt
                        })
                            .from(schema_js_1.memberships)
                            .innerJoin(schema_js_1.users, (0, drizzle_orm_1.eq)(schema_js_1.memberships.userId, schema_js_1.users.id))
                            .where((0, drizzle_orm_1.eq)(schema_js_1.memberships.partnerId, partnerId))
                            .limit(input.limit)
                            .offset(input.offset)];
                case 1:
                    result = _c.sent();
                    return [2 /*return*/, result];
                case 2:
                    err_5 = _c.sent();
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_5) });
                case 3: return [2 /*return*/];
            }
        });
    }); }),
    addMemberByEmail: trpc_js_1.adminProcedure
        .input(zod_1.z.object({
        email: zod_1.z.string().email(),
        role: zod_1.z.enum(['agent', 'support']),
        departments: zod_1.z.array(zod_1.z.string()).optional()
    }))
        .mutation(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, targetUser, userId, existingMembership, newMembershipId, err_6;
        var input = _b.input, ctx = _b.ctx;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 5, , 6]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    return [4 /*yield*/, db_js_1.db.select().from(schema_js_1.users).where((0, drizzle_orm_1.eq)(schema_js_1.users.email, input.email)).limit(1)];
                case 1:
                    targetUser = _c.sent();
                    if (targetUser.length === 0) {
                        throw new server_1.TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
                    }
                    userId = targetUser[0].id;
                    return [4 /*yield*/, db_js_1.db.select().from(schema_js_1.memberships)
                            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.memberships.userId, userId), (0, drizzle_orm_1.eq)(schema_js_1.memberships.partnerId, partnerId))).limit(1)];
                case 2:
                    existingMembership = _c.sent();
                    if (existingMembership.length > 0) {
                        throw new server_1.TRPCError({ code: 'CONFLICT', message: 'User already on this partner' });
                    }
                    newMembershipId = (0, uuid_1.v4)();
                    return [4 /*yield*/, db_js_1.db.insert(schema_js_1.memberships).values({
                            id: newMembershipId,
                            userId: userId,
                            partnerId: partnerId,
                            role: input.role,
                            departments: input.departments || []
                        })];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, db_js_1.db.insert(schema_js_1.auditLog).values({
                            action: 'member.added',
                            actorId: ctx.user.id,
                            partnerId: partnerId,
                            targetType: 'user',
                            targetId: userId,
                            metadata: { role: input.role, departments: input.departments }
                        })];
                case 4:
                    _c.sent();
                    return [2 /*return*/, { success: true }];
                case 5:
                    err_6 = _c.sent();
                    if (err_6 instanceof server_1.TRPCError)
                        throw err_6;
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_6) });
                case 6: return [2 /*return*/];
            }
        });
    }); }),
    inviteExternalUser: trpc_js_1.adminProcedure
        .input(zod_1.z.object({
        email: zod_1.z.string().email(),
        name: zod_1.z.string().min(1),
        role: zod_1.z.enum(['agent', 'support']),
        departments: zod_1.z.array(zod_1.z.string()).optional()
    }))
        .mutation(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, partner, isLocal, existingUser, tempPassword, newUserId, hashedPassword, hash, newMembershipId, err_7;
        var input = _b.input, ctx = _b.ctx;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 9, , 10]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    return [4 /*yield*/, db_js_1.db.select({ authMethod: schema_js_1.partners.authMethod })
                            .from(schema_js_1.partners)
                            .where((0, drizzle_orm_1.eq)(schema_js_1.partners.id, partnerId))
                            .limit(1)];
                case 1:
                    partner = _c.sent();
                    if (partner.length === 0) {
                        throw new server_1.TRPCError({ code: 'NOT_FOUND', message: 'Partner not found' });
                    }
                    isLocal = partner[0].authMethod === 'local';
                    return [4 /*yield*/, db_js_1.db.select().from(schema_js_1.users).where((0, drizzle_orm_1.eq)(schema_js_1.users.email, input.email)).limit(1)];
                case 2:
                    existingUser = _c.sent();
                    if (existingUser.length > 0) {
                        throw new server_1.TRPCError({ code: 'CONFLICT', message: 'Email already in use' });
                    }
                    tempPassword = null;
                    newUserId = (0, uuid_1.v4)();
                    hashedPassword = void 0;
                    if (!isLocal) return [3 /*break*/, 5];
                    tempPassword = (0, crypto_1.randomBytes)(12).toString('base64url');
                    return [4 /*yield*/, Promise.resolve().then(function () { return require('bcryptjs'); })];
                case 3:
                    hash = (_c.sent()).hash;
                    return [4 /*yield*/, hash(tempPassword, 10)];
                case 4:
                    hashedPassword = _c.sent();
                    _c.label = 5;
                case 5: return [4 /*yield*/, db_js_1.db.insert(schema_js_1.users).values({
                        id: newUserId,
                        email: input.email,
                        name: input.name,
                        password: hashedPassword,
                    })];
                case 6:
                    _c.sent();
                    newMembershipId = (0, uuid_1.v4)();
                    return [4 /*yield*/, db_js_1.db.insert(schema_js_1.memberships).values({
                            id: newMembershipId,
                            userId: newUserId,
                            partnerId: partnerId,
                            role: input.role,
                            departments: input.departments || []
                        })];
                case 7:
                    _c.sent();
                    // 5. Audit log
                    return [4 /*yield*/, db_js_1.db.insert(schema_js_1.auditLog).values({
                            action: 'member.invited',
                            actorId: ctx.user.id,
                            partnerId: partnerId,
                            targetType: 'user',
                            targetId: newUserId,
                            metadata: { role: input.role, departments: input.departments, email: input.email, authMethod: partner[0].authMethod }
                        })];
                case 8:
                    // 5. Audit log
                    _c.sent();
                    // Never log plaintext passwords
                    logger_js_1.default.info({ userId: newUserId, authMethod: partner[0].authMethod }, '[inviteExternalUser] User created');
                    return [2 /*return*/, { success: true, userId: newUserId, tempPassword: tempPassword !== null && tempPassword !== void 0 ? tempPassword : '' }];
                case 9:
                    err_7 = _c.sent();
                    if (err_7 instanceof server_1.TRPCError)
                        throw err_7;
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_7) });
                case 10: return [2 /*return*/];
            }
        });
    }); }),
    updateMember: trpc_js_1.adminProcedure
        .input(zod_1.z.object({
        membershipId: zod_1.z.string(),
        departments: zod_1.z.array(zod_1.z.string()).optional()
    }))
        .mutation(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, membership, err_8;
        var input = _b.input, ctx = _b.ctx;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 4, , 5]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    return [4 /*yield*/, db_js_1.db.select().from(schema_js_1.memberships)
                            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.memberships.id, input.membershipId), (0, drizzle_orm_1.eq)(schema_js_1.memberships.partnerId, partnerId))).limit(1)];
                case 1:
                    membership = _c.sent();
                    if (membership.length === 0) {
                        throw new server_1.TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
                    }
                    return [4 /*yield*/, db_js_1.db.update(schema_js_1.memberships)
                            .set({ departments: input.departments || [] })
                            .where((0, drizzle_orm_1.eq)(schema_js_1.memberships.id, input.membershipId))];
                case 2:
                    _c.sent();
                    return [4 /*yield*/, db_js_1.db.insert(schema_js_1.auditLog).values({
                            action: 'member.updated',
                            actorId: ctx.user.id,
                            partnerId: partnerId,
                            targetType: 'user',
                            targetId: membership[0].userId,
                            metadata: { departments: input.departments }
                        })];
                case 3:
                    _c.sent();
                    return [2 /*return*/, { success: true }];
                case 4:
                    err_8 = _c.sent();
                    if (err_8 instanceof server_1.TRPCError)
                        throw err_8;
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_8) });
                case 5: return [2 /*return*/];
            }
        });
    }); }),
    removeMember: trpc_js_1.adminProcedure
        .input(zod_1.z.object({
        membershipId: zod_1.z.string(),
    }))
        .mutation(function (_a) { return __awaiter(void 0, [_a], void 0, function (_b) {
        var partnerId, membership, userMemberships, err_9;
        var input = _b.input, ctx = _b.ctx;
        return __generator(this, function (_c) {
            switch (_c.label) {
                case 0:
                    _c.trys.push([0, 5, , 6]);
                    partnerId = ctx.user.partnerId;
                    if (!partnerId)
                        throw new server_1.TRPCError({ code: 'BAD_REQUEST', message: 'No active partner context' });
                    return [4 /*yield*/, db_js_1.db.select().from(schema_js_1.memberships)
                            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.memberships.id, input.membershipId), (0, drizzle_orm_1.eq)(schema_js_1.memberships.partnerId, partnerId))).limit(1)];
                case 1:
                    membership = _c.sent();
                    if (membership.length === 0) {
                        throw new server_1.TRPCError({ code: 'NOT_FOUND', message: 'Membership not found' });
                    }
                    if (membership[0].userId === ctx.user.id) {
                        throw new server_1.TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove yourself' });
                    }
                    return [4 /*yield*/, db_js_1.db.select().from(schema_js_1.memberships)
                            .where((0, drizzle_orm_1.eq)(schema_js_1.memberships.userId, membership[0].userId))];
                case 2:
                    userMemberships = _c.sent();
                    if (userMemberships.length <= 1) {
                        throw new server_1.TRPCError({ code: 'FORBIDDEN', message: 'Cannot remove user\'s last membership. Platform Operator must handle this.' });
                    }
                    return [4 /*yield*/, db_js_1.db.delete(schema_js_1.memberships).where((0, drizzle_orm_1.eq)(schema_js_1.memberships.id, input.membershipId))];
                case 3:
                    _c.sent();
                    return [4 /*yield*/, db_js_1.db.insert(schema_js_1.auditLog).values({
                            action: 'member.removed',
                            actorId: ctx.user.id,
                            partnerId: partnerId,
                            targetType: 'user',
                            targetId: membership[0].userId,
                            metadata: {}
                        })];
                case 4:
                    _c.sent();
                    return [2 /*return*/, { success: true }];
                case 5:
                    err_9 = _c.sent();
                    if (err_9 instanceof server_1.TRPCError)
                        throw err_9;
                    throw new server_1.TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: String(err_9) });
                case 6: return [2 /*return*/];
            }
        });
    }); }),
});
