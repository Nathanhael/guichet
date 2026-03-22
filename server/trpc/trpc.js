"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roleProcedure = exports.adminProcedure = exports.platformProcedure = exports.protectedProcedure = exports.publicProcedure = exports.router = void 0;
var server_1 = require("@trpc/server");
var t = server_1.initTRPC.context().create();
exports.router = t.router;
exports.publicProcedure = t.procedure;
// Middleware for authenticated users
exports.protectedProcedure = t.procedure.use(function (_a) {
    var ctx = _a.ctx, next = _a.next;
    if (!ctx.user) {
        throw new server_1.TRPCError({ code: 'UNAUTHORIZED' });
    }
    return next({
        ctx: {
            user: ctx.user,
        },
    });
});
// Middleware for Platform Operators (Developers)
exports.platformProcedure = exports.protectedProcedure.use(function (_a) {
    var ctx = _a.ctx, next = _a.next;
    if (!ctx.user.isPlatformOperator) {
        throw new server_1.TRPCError({ code: 'FORBIDDEN', message: 'Platform Operator role required' });
    }
    return next();
});
// Middleware for admin users (Partner Admins)
exports.adminProcedure = exports.protectedProcedure.use(function (_a) {
    var ctx = _a.ctx, next = _a.next;
    if (ctx.user.role !== 'admin' && !ctx.user.isPlatformOperator) {
        throw new server_1.TRPCError({ code: 'FORBIDDEN' });
    }
    return next();
});
// Helper for dynamic role checks
var roleProcedure = function (roles) {
    return exports.protectedProcedure.use(function (_a) {
        var ctx = _a.ctx, next = _a.next;
        // Platform operators can bypass role checks to manage data across any partner
        if (!roles.includes(ctx.user.role) && !ctx.user.isPlatformOperator) {
            throw new server_1.TRPCError({ code: 'FORBIDDEN' });
        }
        return next();
    });
};
exports.roleProcedure = roleProcedure;
