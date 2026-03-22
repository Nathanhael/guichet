import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';

export default function AdminDepartments() {
  const { memberships, activeMembershipId } = useStore();
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  
  const [departments, setDepartments] = useState<{ id: string; name: string; description: string }[]>(
    activeMembership?.manifest?.departments?.map(d => ({ 
      id: d.id, 
      name: (d as any).name || d.name || '', 
      description: (d as any).description || '' 
    })) || []
  );
  const [isSaving, setIsSaving] = useState(false);

  const updateDeptsMutation = trpc.partner.updateDepartments.useMutation({
    onSuccess: () => {
      setIsSaving(false);
      // Let the natural re-fetch or socket update the store, or reload window for simplicity
      window.location.reload(); 
    },
    onError: (err) => {
      setIsSaving(false);
      alert('Failed to update departments: ' + err.message);
    }
  });

  const handleAdd = () => {
    setDepartments([...departments, { id: '', name: '', description: '' }]);
  };

  const handleRemove = (index: number) => {
    const newDepts = [...departments];
    newDepts.splice(index, 1);
    setDepartments(newDepts);
  };

  const handleChange = (index: number, field: 'name' | 'description', value: string) => {
    const newDepts = [...departments];
    newDepts[index][field] = value;
    setDepartments(newDepts);
  };

  const handleSave = () => {
    // Validate
    if (departments.some(d => !d.name.trim())) {
      alert('All departments must have a name.');
      return;
    }
    
    setIsSaving(true);
    updateDeptsMutation.mutate({
      departments: departments.map(d => ({
        id: d.id || undefined,
        name: d.name.trim(),
        description: d.description.trim()
      }))
    });
  };

  return (
    <div className="max-w-4xl border-2 border-black dark:border-white p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">Departments</h2>
          <p className="text-xs uppercase opacity-60 mt-1">Manage the structure of your organization</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={isSaving}
          className="px-6 py-2 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-xs tracking-widest hover:invert transition-all disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className="space-y-4 mb-6">
        {departments.map((dept, idx) => (
          <div key={idx} className="flex items-start gap-4 p-4 border border-black/20 dark:border-white/20">
            <div className="w-1/3">
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Name *</label>
              <input 
                type="text" 
                value={dept.name}
                onChange={(e) => handleChange(idx, 'name', e.target.value)}
                className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold uppercase"
                placeholder="e.g. Sales"
              />
              {dept.id && (
                <div className="mt-1 flex gap-2 items-center">
                  <span className="text-[9px] uppercase opacity-50 font-black">ID:</span>
                  <span className="text-[9px] font-mono opacity-50">{dept.id}</span>
                </div>
              )}
            </div>
            
            <div className="flex-1">
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Description</label>
              <input 
                type="text" 
                value={dept.description}
                onChange={(e) => handleChange(idx, 'description', e.target.value)}
                className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm"
                placeholder="Briefly describe the purpose of this department"
              />
            </div>
            
            <button 
              onClick={() => handleRemove(idx)}
              className="mt-6 w-10 h-10 flex items-center justify-center border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-colors"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <button 
        onClick={handleAdd}
        className="w-full py-4 border-2 border-dashed border-black/40 dark:border-white/40 hover:border-solid hover:bg-black/5 dark:hover:bg-white/5 font-black uppercase text-xs tracking-widest transition-all"
      >
        + Add Department
      </button>
    </div>
  );
}