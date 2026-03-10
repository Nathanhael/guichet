import React, { useState } from 'react';
import Stars from '../shared/Stars';

export default function RatingStats({ ratings, users }) {
    const [selectedExpert, setSelectedExpert] = useState('ALL');

    if (!ratings || ratings.length === 0) {
        return (
            <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-8 text-center">
                <p className="text-gray-400 text-sm">No ratings submitted yet.</p>
            </div>
        );
    }

    // Helper to map agentId to dept and expertId to name
    const agentDeptMap = {};
    const expertNameMap = {};
    users.forEach((u) => {
        if (u.role === 'agent') agentDeptMap[u.id] = u.dept;
        if (u.role === 'expert') expertNameMap[u.id] = u.name;
    });

    // Rating stats per expert
    const expertRatings = {};
    ratings.forEach((r) => {
        const name = expertNameMap[r.expertId] || r.expertId || 'Unknown';
        if (!expertRatings[name]) {
            expertRatings[name] = { total: 0, sum: 0, ratings: [], depts: { DSC: { total: 0, sum: 0, count5: 0, countLow: 0 }, FOT: { total: 0, sum: 0, count5: 0, countLow: 0 } } };
        }
        expertRatings[name].total++;
        expertRatings[name].sum += r.rating;
        expertRatings[name].ratings.push(r);

        const dept = agentDeptMap[r.agentId];
        if (dept && expertRatings[name].depts[dept]) {
            const d = expertRatings[name].depts[dept];
            d.total++;
            d.sum += r.rating;
            if (r.rating === 5) d.count5++;
            if (r.rating <= 2) d.countLow++;
        }
    });

    const avgRating = (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1);

    return (
        <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Total ratings</p>
                    <p className="text-2xl font-bold text-gray-800 dark:text-white mt-1">{ratings.length}</p>
                </div>
                <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">Average</p>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-2xl font-bold text-amber-500">
                            {avgRating}
                        </p>
                        <Stars value={Math.round(avgRating)} />
                    </div>
                </div>
                <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">5-star</p>
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                        {ratings.filter((r) => r.rating === 5).length}
                    </p>
                </div>
                <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                    <p className="text-xs text-gray-500 dark:text-gray-400">1-2 star</p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                        {ratings.filter((r) => r.rating <= 2).length}
                    </p>
                </div>
            </div>

            {/* Rating distribution bar */}
            <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-4">
                <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 mb-3">Distribution</p>
                <div className="space-y-2">
                    {[5, 4, 3, 2, 1].map((star) => {
                        const count = ratings.filter((r) => r.rating === star).length;
                        const pct = ratings.length > 0 ? (count / ratings.length) * 100 : 0;
                        return (
                            <div key={star} className="flex items-center gap-2">
                                <span className="text-xs text-gray-500 dark:text-gray-400 w-3 text-right">{star}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                </svg>
                                <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-xs text-gray-400 w-8">{count}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Ratings by Expert */}
            {Object.keys(expertRatings).length > 0 && (
                <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mt-8 mb-4">
                        <p className="text-lg font-bold text-gray-800 dark:text-white">Ratings by Expert</p>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">View:</span>
                            <select
                                value={selectedExpert}
                                onChange={(e) => setSelectedExpert(e.target.value)}
                                className="text-sm bg-white dark:bg-brand-900 border border-gray-200 dark:border-brand-700 rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-brand-500 outline-none transition-all text-gray-700 dark:text-gray-200 shadow-sm"
                            >
                                <option value="ALL">All Experts (Overview)</option>
                                {Object.keys(expertRatings).sort().map(name => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {selectedExpert === 'ALL' ? (
                        <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 overflow-hidden shadow-sm animate-fade-in">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50/50 dark:bg-brand-900/40 border-b border-gray-100 dark:border-brand-700">
                                            <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300">Expert Name</th>
                                            <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-center">Avg Rating</th>
                                            <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-center">Trend</th>
                                            <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-center">Total</th>
                                            <th className="px-6 py-4 font-bold text-gray-700 dark:text-gray-300 text-right">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 dark:divide-brand-700/50">
                                        {Object.entries(expertRatings).sort((a, b) => b[1].total - a[1].total).map(([name, e]) => {
                                            const avg = (e.sum / e.total).toFixed(1);
                                            return (
                                                <tr key={name} className="hover:bg-gray-50/80 dark:hover:bg-brand-700/30 transition-colors">
                                                    <td className="px-6 py-4">
                                                        <span className="font-bold text-gray-800 dark:text-gray-100">{name}</span>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center justify-center gap-2">
                                                            <span className={`font-bold ${parseFloat(avg) >= 4 ? 'text-green-500' : parseFloat(avg) >= 3 ? 'text-amber-500' : 'text-red-500'}`}>{avg}</span>
                                                            <Stars value={Math.round(e.sum / e.total)} />
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <div className="flex items-center justify-center gap-4 text-xs font-semibold">
                                                            <span className="text-green-500">5★ ({e.ratings.filter(r => r.rating === 5).length})</span>
                                                            <span className="text-red-500">1-2★ ({e.ratings.filter(r => r.rating <= 2).length})</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <span className="bg-gray-100 dark:bg-brand-900/50 text-gray-600 dark:text-brand-300 px-2 py-1 rounded text-xs font-bold">{e.total}</span>
                                                    </td>
                                                    <td className="px-6 py-4 text-right">
                                                        <button
                                                            onClick={() => setSelectedExpert(name)}
                                                            className="text-brand-500 hover:text-brand-600 font-bold text-xs"
                                                        >
                                                            Details
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <div className="animate-fade-in">
                            {(() => {
                                const e = expertRatings[selectedExpert];
                                if (!e) return null;
                                const avg = (e.sum / e.total).toFixed(1);
                                return (
                                    <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 p-6 shadow-md shadow-brand-500/5">
                                        <div className="flex items-center justify-between mb-4 border-b border-gray-100 dark:border-brand-700 pb-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-12 h-12 rounded-full bg-brand-500 text-white flex items-center justify-center text-xl font-bold shadow-lg shadow-brand-500/20">
                                                    {selectedExpert[0]}
                                                </div>
                                                <h3 className="font-bold text-xl text-gray-800 dark:text-white">{selectedExpert}</h3>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                <div className="text-right">
                                                    <p className="text-2xl font-bold text-amber-500 leading-none">{avg}</p>
                                                    <div className="mt-1"><Stars value={Math.round(e.sum / e.total)} /></div>
                                                </div>
                                                <div className="h-10 w-px bg-gray-100 dark:bg-brand-700 mx-1" />
                                                <div className="bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300 px-4 py-2 rounded-xl text-center">
                                                    <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Total Ratings</p>
                                                    <p className="text-lg font-bold">{e.total}</p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                                            {/* DSC Breakdown */}
                                            <div className="bg-gray-50 dark:bg-brand-900/30 rounded-xl p-5 border border-gray-100 dark:border-brand-700/50 relative overflow-hidden group">
                                                <div className="flex justify-between items-center mb-4">
                                                    <div>
                                                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest">DSC</span>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Customer Support</p>
                                                    </div>
                                                    <span className="text-xs font-bold bg-white dark:bg-brand-800 text-brand-600 dark:text-brand-400 px-3 py-1 rounded-full shadow-sm">
                                                        {e.depts.DSC.total} ratings
                                                    </span>
                                                </div>
                                                {e.depts.DSC.total > 0 ? (
                                                    <div className="space-y-3">
                                                        <div className="flex justify-between items-center bg-white dark:bg-brand-800/50 p-2 rounded-lg">
                                                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Average Score</span>
                                                            <span className="text-lg font-bold text-amber-500">{(e.depts.DSC.sum / e.depts.DSC.total).toFixed(1)}</span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div className="bg-green-50/50 dark:bg-green-900/20 p-2 rounded-lg text-center border border-green-100 dark:border-green-900/30">
                                                                <span className="block text-[10px] text-green-600 dark:text-green-400 font-bold uppercase">5 Stars</span>
                                                                <span className="text-lg font-bold text-green-700 dark:text-green-300">{e.depts.DSC.count5}</span>
                                                            </div>
                                                            <div className="bg-red-50/50 dark:bg-red-900/20 p-2 rounded-lg text-center border border-red-100 dark:border-red-900/30">
                                                                <span className="block text-[10px] text-red-600 dark:text-red-400 font-bold uppercase">1-2 Stars</span>
                                                                <span className="text-lg font-bold text-red-700 dark:text-red-300">{e.depts.DSC.countLow}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="py-6 text-center border-2 border-dashed border-gray-100 dark:border-brand-700 rounded-xl">
                                                        <p className="text-sm text-gray-400">No DSC ratings</p>
                                                    </div>
                                                )}
                                            </div>

                                            {/* FOT Breakdown */}
                                            <div className="bg-gray-50 dark:bg-brand-900/30 rounded-xl p-5 border border-gray-100 dark:border-brand-700/50">
                                                <div className="flex justify-between items-center mb-4">
                                                    <div>
                                                        <span className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-widest">FOT</span>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400">Front Office Team</p>
                                                    </div>
                                                    <span className="text-xs font-bold bg-white dark:bg-brand-800 text-brand-600 dark:text-brand-400 px-3 py-1 rounded-full shadow-sm">
                                                        {e.depts.FOT.total} ratings
                                                    </span>
                                                </div>
                                                {e.depts.FOT.total > 0 ? (
                                                    <div className="space-y-3">
                                                        <div className="flex justify-between items-center bg-white dark:bg-brand-800/50 p-2 rounded-lg">
                                                            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Average Score</span>
                                                            <span className="text-lg font-bold text-amber-500">{(e.depts.FOT.sum / e.depts.FOT.total).toFixed(1)}</span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div className="bg-green-50/50 dark:bg-green-900/20 p-2 rounded-lg text-center border border-green-100 dark:border-green-900/30">
                                                                <span className="block text-[10px] text-green-600 dark:text-green-400 font-bold uppercase">5 Stars</span>
                                                                <span className="text-lg font-bold text-green-700 dark:text-green-300">{e.depts.FOT.count5}</span>
                                                            </div>
                                                            <div className="bg-red-50/50 dark:bg-red-900/20 p-2 rounded-lg text-center border border-red-100 dark:border-red-900/30">
                                                                <span className="block text-[10px] text-red-600 dark:text-red-400 font-bold uppercase">1-2 Stars</span>
                                                                <span className="text-lg font-bold text-red-700 dark:text-red-300">{e.depts.FOT.countLow}</span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="py-6 text-center border-2 border-dashed border-gray-100 dark:border-brand-700 rounded-xl">
                                                        <p className="text-sm text-gray-400">No FOT ratings</p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="mt-6 flex justify-center">
                                            <button
                                                onClick={() => setSelectedExpert('ALL')}
                                                className="text-xs font-bold text-gray-500 dark:text-gray-400 hover:text-brand-500 transition-colors flex items-center gap-2"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                                                </svg>
                                                Back to Overview
                                            </button>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )}

                    {/* Individual ratings */}
                    <div className="bg-white dark:bg-brand-800 rounded-xl border border-gray-100 dark:border-brand-700 overflow-hidden">
                        <p className="text-sm font-semibold text-gray-600 dark:text-gray-300 px-4 py-3 border-b border-gray-100 dark:border-brand-700">Recent ratings</p>
                        <div className="divide-y divide-gray-50 dark:divide-gray-700">
                            {ratings.slice(0, 50).map((r) => (
                                <div key={r.id} className="px-4 py-3 flex items-start gap-3">
                                    <Stars value={r.rating} />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                                Agent: <span className="font-medium text-gray-700 dark:text-gray-200">{r.agentId}</span>
                                            </span>
                                            {r.expertId && (
                                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                                    Expert: <span className="font-medium text-gray-700 dark:text-gray-200">{r.expertId}</span>
                                                </span>
                                            )}
                                            <span className="text-xs text-gray-400">
                                                {new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}
                                            </span>
                                        </div>
                                        {r.comment && (
                                            <p className="text-sm text-gray-700 dark:text-gray-200 mt-1">{r.comment}</p>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
