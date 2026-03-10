import { Star } from 'lucide-react';
import Panel from '../shared/Panel';

export default function SatisfactionByDept({ stats }) {
    if (!stats || !stats.ratingsByDept || Object.keys(stats.ratingsByDept).length === 0) return null;

    const renderStars = (rating) => {
        return (
            <div className="flex items-center justify-center gap-0.5 mt-1">
                {[1, 2, 3, 4, 5].map((s) => (
                    <Star
                        key={s}
                        size={12}
                        className={s <= Math.round(rating) ? 'fill-current text-amber-400' : 'text-slate-300 dark:text-slate-700'}
                    />
                ))}
            </div>
        );
    };

    return (
        <Panel title="Satisfaction by Department">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(stats.ratingsByDept).map(([dept, data]) => (
                    <div key={dept} className={`rounded-xl p-3 border text-center ${dept === 'DSC' ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800' : 'bg-teal-50 dark:bg-teal-900/20 border-teal-200 dark:border-teal-800'}`}>
                        <p className={`text-[10px] font-black uppercase tracking-widest ${dept === 'DSC' ? 'text-purple-500' : 'text-teal-500'}`}>{dept}</p>
                        <p className={`text-2xl font-black mt-1 ${dept === 'DSC' ? 'text-purple-700 dark:text-purple-300' : 'text-teal-700 dark:text-teal-300'}`}>
                            {data.avg != null ? data.avg : '—'}
                        </p>
                        {data.avg != null && renderStars(data.avg)}
                        <p className="text-[10px] text-gray-400 font-medium italic mt-1">{data.count} ratings</p>
                    </div>
                ))}
            </div>
        </Panel>
    );
}
