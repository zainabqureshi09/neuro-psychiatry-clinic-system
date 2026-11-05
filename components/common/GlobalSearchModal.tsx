'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Search, X, User, Calendar, FilePlus, ChevronRight, Phone } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { Patient } from '../../types';
import { StatusBadge } from './StatusBadge';

export const GlobalSearchModal: React.FC = () => {
  const { 
    isGlobalSearchOpen, 
    setIsGlobalSearchOpen, 
    patients, 
    navigateToPatientProfile,
    navigateToBookAppointment,
    navigateToNewConsultation
  } = useApp();

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Patient[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isGlobalSearchOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setDebouncedQuery('');
      setSearchResults(null);
    }
  }, [isGlobalSearchOpen]);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  // Fetch search results from server
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults(null);
      return;
    }
    let active = true;
    // All API traffic goes to the Express backend (single authoritative API).
    // Relative /api calls would hit Next.js route handlers, which are frozen and
    // non-authoritative in production (Nginx routes /api/ to Express).
    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${BACKEND_API}/api/patients?q=${encodeURIComponent(debouncedQuery)}`, {
      headers,
      credentials: 'include',
    })
      .then(res => res.json())
      .then(json => {
        if (active && json.success) {
          setSearchResults(json.data || []);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [debouncedQuery]);

  if (!isGlobalSearchOpen) return null;

  const filteredPatients = (searchResults !== null ? searchResults : patients.filter(p => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      p.fullName.toLowerCase().includes(q) ||
      p.id.toLowerCase().includes(q) ||
      p.phone.includes(q)
    );
  })).slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-start justify-center pt-16 px-4">
      <div 
        className="fixed inset-0" 
        onClick={() => setIsGlobalSearchOpen(false)} 
      />

      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Input Header */}
        <div className="flex items-center px-4 py-3.5 border-b border-slate-200">
          <Search className="w-5 h-5 text-slate-400 mr-3 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Fast Patient Search (by ID, Name, Phone, or Diagnosis)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-none text-slate-900 text-sm focus:outline-none placeholder-slate-400"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 text-xs text-slate-400 bg-slate-100 rounded-md border border-slate-200 mr-2 font-mono">
            <span>ESC</span>
          </kbd>
          <button
            onClick={() => setIsGlobalSearchOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Results List */}
        <div className="max-h-96 overflow-y-auto p-2">
          {filteredPatients.length > 0 ? (
            <div className="space-y-1">
              <p className="px-3 py-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Matching Patients ({filteredPatients.length})
              </p>
              {filteredPatients.map((patient) => (
                <div
                  key={patient.id}
                  className="group flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200"
                >
                  <div 
                    onClick={() => {
                      navigateToPatientProfile(patient.id);
                      setIsGlobalSearchOpen(false);
                    }}
                    className="flex items-start gap-3 cursor-pointer flex-1"
                  >
                    <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0 mt-0.5">
                      {patient.fullName.split(' ').map((n: string) => n[0]).join('')}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900 text-sm group-hover:text-blue-700 transition-colors">
                          {patient.fullName}
                        </span>
                        <span className="text-xs font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md border border-slate-200">
                          {patient.id}
                        </span>
                        <StatusBadge status={patient.status} size="sm" />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-3">
                        <span>{patient.age} yrs • {patient.gender}</span>
                        <span className="flex items-center text-slate-400">
                          <Phone className="w-3 h-3 mr-1" />
                          {patient.phone}
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 mt-2 sm:mt-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                    <button
                      onClick={() => {
                        navigateToPatientProfile(patient.id);
                        setIsGlobalSearchOpen(false);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-700 hover:bg-slate-200/80 transition-colors flex items-center"
                      title="View Clinical Profile"
                    >
                      <User className="w-3.5 h-3.5 mr-1 text-slate-500" />
                      Chart
                    </button>

                    <button
                      onClick={() => {
                        navigateToBookAppointment(patient.id);
                        setIsGlobalSearchOpen(false);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors flex items-center"
                      title="Book Appointment"
                    >
                      <Calendar className="w-3.5 h-3.5 mr-1" />
                      Book
                    </button>

                    <button
                      onClick={() => {
                        navigateToNewConsultation(patient.id);
                        setIsGlobalSearchOpen(false);
                      }}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium text-teal-700 hover:bg-teal-50 transition-colors flex items-center"
                      title="Start Consultation"
                    >
                      <FilePlus className="w-3.5 h-3.5 mr-1" />
                      Consult
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500">
              <p className="text-sm font-medium">No matching patient records found.</p>
              <p className="text-xs text-slate-400 mt-1">Try searching by ID (e.g. PX-9402) or phone number.</p>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Search tip: Fast receptionist search enabled</span>
          <span className="font-mono text-[11px] text-slate-400">Esc to close</span>
        </div>
      </div>
    </div>
  );
};
