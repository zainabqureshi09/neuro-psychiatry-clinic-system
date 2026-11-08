'use client';

import React from 'react';
import { useApp } from '../../context/AppContext';
import { ShieldCheck, UserCheck, Stethoscope, HeartHandshake } from 'lucide-react';

export const RoleSwitcher: React.FC = () => {
  const { activeRole, switchRole, currentUser } = useApp();

  if (process.env.NODE_ENV === 'production') {
    return null;
  }

  return (
    <div className="bg-slate-900 text-white px-4 py-2 border-b border-slate-800 flex items-center justify-between text-xs">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-semibold text-[11px] uppercase tracking-wider">
          <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
          Role Demo Switcher
        </span>
        <span className="hidden sm:inline text-slate-400">
          Currently viewing as: <strong className="text-white font-medium">{currentUser.name}</strong> ({currentUser.title})
        </span>
      </div>

      <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700 overflow-x-auto">
        <button
          onClick={() => switchRole('DOCTOR')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
            activeRole === 'DOCTOR'
              ? 'bg-blue-600 text-white shadow-xs font-bold'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <Stethoscope className="w-3 h-3" />
          Doctor
        </button>

        <button
          onClick={() => switchRole('RECEPTIONIST')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
            activeRole === 'RECEPTIONIST'
              ? 'bg-teal-600 text-white shadow-xs font-bold'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <UserCheck className="w-3 h-3" />
          Receptionist
        </button>

        <button
          onClick={() => switchRole('THERAPIST')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
            activeRole === 'THERAPIST'
              ? 'bg-emerald-600 text-white shadow-xs font-bold'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <HeartHandshake className="w-3 h-3" />
          Therapist
        </button>

        <button
          onClick={() => switchRole('ADMIN')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all flex items-center gap-1.5 ${
            activeRole === 'ADMIN'
              ? 'bg-purple-600 text-white shadow-xs font-bold'
              : 'text-slate-300 hover:text-white hover:bg-slate-700/50'
          }`}
        >
          <ShieldCheck className="w-3 h-3" />
          Admin
        </button>
      </div>
    </div>
  );
};

