'use client';

import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BrainCircuit, ShieldCheck, Lock, Mail, ArrowRight, Stethoscope, UserCheck } from 'lucide-react';

export const LoginScreen: React.FC = () => {
  const { login, setActiveScreen } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login(email, password);
  };

  return (
    <div className="min-h-screen w-full flex bg-slate-50">
      {/* Left Column: Visual Brand Banner */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 text-white flex-col justify-between p-12 relative overflow-hidden">
        {/* Subtle background glow */}
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-96 h-96 bg-teal-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-900/40">
            <BrainCircuit className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-bold text-white text-lg tracking-tight">Neuro Psychiatry Clinic</h1>
            <p className="text-xs text-slate-300 font-semibold">Psychiatry Department</p>
            <p className="text-[11px] text-teal-400 font-medium mt-0.5">HOD & Consultant Psychiatrist</p>
          </div>
        </div>

        <div className="relative z-10 my-auto max-w-lg space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/90 border border-slate-700 text-teal-400 text-xs font-semibold">
            <ShieldCheck className="w-4 h-4" />
            HIPAA & ISO 27001 Clinical Data Security
          </div>

          <h2 className="text-3xl font-extrabold text-white tracking-tight leading-tight">
            Calm, precise & modern clinical management for specialist psychiatric practice.
          </h2>

          <p className="text-sm text-slate-400 leading-relaxed">
            Designed exclusively for consultant psychiatrists and clinical coordinators. Streamlined patient intakes, diagnostic tracking, prescription workflows, and instant appointment scheduling.
          </p>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-800">
            <div>
              <p className="text-2xl font-bold text-white font-mono">100%</p>
              <p className="text-xs text-slate-400 mt-0.5">Encrypted Health Records</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-teal-400 font-mono">&lt; 15s</p>
              <p className="text-xs text-slate-400 mt-0.5">Patient Intake & Booking</p>
            </div>
          </div>
        </div>

        <div className="relative z-10 pt-6 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <span>© 2026 Neuro Psychiatry Clinic</span>
          <span className="flex items-center gap-1 font-mono">
            <Lock className="w-3 h-3 text-emerald-400" /> Protected Session
          </span>
        </div>
      </div>

      {/* Right Column: Clean Medical Login Box */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 bg-slate-50">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 p-8 shadow-sm space-y-6">
          {/* Mobile Logo Header */}
          <div className="flex items-center gap-3 lg:hidden mb-2">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white">
              <BrainCircuit className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-slate-900 text-base">Neuro Psychiatry Clinic</h1>
              <p className="text-xs text-slate-500 font-medium">Psychiatry Department • HOD & Consultant Psychiatrist</p>
            </div>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">Neuro Psychiatry Clinic</h2>
            <p className="text-xs font-semibold text-blue-700 mt-0.5">Psychiatry Department</p>
            <p className="text-[11px] text-slate-500 font-medium mt-1">HOD & Consultant Psychiatrist</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Practice Email / User ID
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  placeholder="doctor@clinic.com"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-700">Password</label>
                <button 
                  type="button"
                  onClick={() => setActiveScreen('forgot-password')} 
                  className="text-xs text-blue-600 hover:underline font-semibold"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                />
                Remember this clinical workstation
              </label>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg text-xs shadow-xs transition-colors flex items-center justify-center gap-2"
            >
              <span>Sign In to Clinical Workspace</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Quick Demo Pre-fill Shortcuts for 4 Roles (Development / Test Only) */}
          {process.env.NODE_ENV !== 'production' && (
            <div className="pt-4 border-t border-slate-100 space-y-2">
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider text-center">
                Instant Role Presets
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEmail('dr.vance@vancepsychiatry.com');
                    setPassword('Vance2026!');
                    login('dr.vance@vancepsychiatry.com', 'Vance2026!');
                  }}
                  className="p-2 bg-blue-50 hover:bg-blue-100/80 border border-blue-200 text-blue-800 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1"
                >
                  <Stethoscope className="w-3.5 h-3.5" />
                  Doctor
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEmail('s.jenkins@vancepsychiatry.com');
                    setPassword('Jenkins2026!');
                    login('s.jenkins@vancepsychiatry.com', 'Jenkins2026!');
                  }}
                  className="p-2 bg-teal-50 hover:bg-teal-100/80 border border-teal-200 text-teal-800 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  Reception
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEmail('e.watson@vancepsychiatry.com');
                    setPassword('Watson2026!');
                    login('e.watson@vancepsychiatry.com', 'Watson2026!');
                  }}
                  className="p-2 bg-emerald-50 hover:bg-emerald-100/80 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1"
                >
                  Therapist
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setEmail('m.sterling@vancepsychiatry.com');
                    setPassword('Sterling2026!');
                    login('m.sterling@vancepsychiatry.com', 'Sterling2026!');
                  }}
                  className="p-2 bg-purple-50 hover:bg-purple-100/80 border border-purple-200 text-purple-800 rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Admin
                </button>
              </div>
            </div>
          )}

          <div className="text-center text-[11px] text-slate-400 flex items-center justify-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Your clinical data is protected by 256-bit AES encryption.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
