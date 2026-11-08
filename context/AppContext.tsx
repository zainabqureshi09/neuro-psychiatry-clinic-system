'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { 
  SystemUser, 
  UserRole, 
  Patient, 
  Appointment, 
  Consultation, 
  Prescription, 
  FollowUp, 
  TherapySession,
  PaymentRecord,
  FeeCategory,
  AuditLogEntry,
  BackupLogEntry,
  ClinicSettings, 
  ScreenId, 
  ToastMessage 
} from '../types';
import { 
  INITIAL_THERAPY_SESSIONS, 
  INITIAL_PAYMENTS, 
  INITIAL_FEE_CATEGORIES, 
  INITIAL_AUDIT_LOGS, 
  INITIAL_BACKUP_LOGS 
} from '../lib/mockData';

export type PatientProfileTab = 
  | 'overview' 
  | 'psychiatric-history' 
  | 'medical-history' 
  | 'personal-history' 
  | 'family-history' 
  | 'social-history' 
  | 'mse-risk' 
  | 'psychometrics' 
  | 'medications-allergies' 
  | 'consultations' 
  | 'appointments' 
  | 'prescriptions' 
  | 'followups';

interface AppContextType {
  // Navigation & Authentication state
  isAuthenticated: boolean;
  currentUser: SystemUser;
  activeRole: UserRole;
  activeScreen: ScreenId;
  selectedPatientId: string | null;
  draftPrescription: Partial<Prescription> | null;
  setDraftPrescription: (draft: Partial<Prescription> | null) => void;
  reusePrescription: (rx: Prescription) => void;
  activePatientProfileTab: PatientProfileTab;
  isLoading: boolean;
  error: string | null;
  
  // UI Controls
  isGlobalSearchOpen: boolean;
  setIsGlobalSearchOpen: (open: boolean) => void;
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;
  toasts: ToastMessage[];
  showToast: (type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => void;
  removeToast: (id: string) => void;
  
  // Navigation Helpers
  login: (email?: string, arg2?: string, arg3?: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setActiveScreen: (screen: ScreenId) => void;
  switchRole: (role: UserRole) => void;
  navigateToPatientProfile: (patientId: string, tab?: PatientProfileTab) => void;
  navigateToNewConsultation: (patientId?: string) => void;
  navigateToBookAppointment: (patientId?: string) => void;
  navigateToPrescriptions: (patientId?: string) => void;
  navigateToTherapy: (patientId?: string) => void;
  navigateToBilling: (patientId?: string) => void;

  // Data Collections
  users: SystemUser[];
  patients: Patient[];
  appointments: Appointment[];
  consultations: Consultation[];
  prescriptions: Prescription[];
  followUps: FollowUp[];
  therapySessions: TherapySession[];
  payments: PaymentRecord[];
  feeCategories: FeeCategory[];
  auditLogs: AuditLogEntry[];
  backupLogs: BackupLogEntry[];
  clinicSettings: ClinicSettings;

  // CRUD & Search Functions
  addPatient: (patient: Omit<Patient, 'id' | 'registeredDate'>) => Patient;
  updatePatient: (id: string, updates: Partial<Patient>) => Promise<void>;
  deletePatient: (id: string) => Promise<boolean>;
  bookAppointment: (appointment: Omit<Appointment, 'id'>) => Appointment;
  updateAppointmentStatus: (id: string, status: Appointment['status'], updates?: Partial<Appointment>) => Promise<void>;
  addConsultation: (consultation: Omit<Consultation, 'id'>) => Consultation;
  updateConsultation: (id: string, updates: Partial<Consultation>) => Promise<boolean>;
  addPrescription: (prescription: Omit<Prescription, 'id'>) => Prescription;
  updatePrescription: (id: string, updates: Partial<Prescription>) => Promise<boolean>;
  addFollowUp: (followUp: Omit<FollowUp, 'id'>) => FollowUp;
  updateFollowUpStatus: (id: string, status: FollowUp['status']) => Promise<void>;
  addTherapySession: (session: Omit<TherapySession, 'id'>) => TherapySession;
  updateTherapySession: (id: string, updates: Partial<TherapySession>) => Promise<boolean>;
  addPayment: (payment: Omit<PaymentRecord, 'id' | 'receiptNumber'>) => PaymentRecord;
  updateFeeCategory: (id: string, updates: Partial<FeeCategory>) => Promise<void>;
  addFeeCategory: (category: Omit<FeeCategory, 'id'>) => Promise<void>;
  createBackup: (type?: BackupLogEntry['type']) => Promise<BackupLogEntry>;
  logAuditEvent: (action: string, moduleName: string, description: string, patientRef?: string) => void;
  updateClinicSettings: (settings: Partial<ClinicSettings>) => Promise<void>;
  addUser: (user: Omit<SystemUser, 'id' | 'lastActive'>) => SystemUser;
  updateUserRole: (userId: string, role: UserRole) => Promise<void>;
  searchPatients: (term: string) => Promise<Patient[]>;
  refetchData: () => Promise<void>;
}

const DEFAULT_USER: SystemUser = {
  id: 'USR-001',
  name: 'DR SHAHAB MUHAMMAD',
  email: 'dr.vance@vancepsychiatry.com',
  role: 'DOCTOR',
  avatar: 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=150&auto=format&fit=crop&q=80',
  title: 'HOD & Consultant Psychiatrist',
  designation: 'HOD & Consultant Psychiatrist',
  education: 'MBBS, MCPS, FCPS, CHPE',
  department: 'Psychiatry',
  status: 'ACTIVE',
  lastActive: 'Just now',
  permissions: {
    canWriteClinicalNotes: true,
    canPrescribe: true,
    canManagePatients: true,
    canManageAppointments: true,
    canManageUsers: true,
    canViewReports: true,
  },
};

const DEFAULT_SETTINGS: ClinicSettings = {
  clinicName: 'Neuro Psychiatry Clinic',
  department: 'Psychiatry',
  doctorDesignation: 'HOD & Consultant Psychiatrist',
  education: 'MBBS, MCPS, FCPS, CHPE',
  practiceName: 'Neuro Psychiatry Clinic',
  tagline: 'Psychiatry Department • HOD & Consultant Psychiatrist',
  doctorName: 'DR SHAHAB MUHAMMAD',
  licenseNumber: 'NY-MED-849201',
  phone: '+1 (555) 800-VANCE',
  email: 'appointments@vancepsychiatry.com',
  address: '680 Fifth Avenue, Suite 1800, New York, NY 10019',
  workingDays: ['Monday', 'Wednesday', 'Friday'],
  clinicStart: '18:00',
  clinicEnd: '20:00',
  slotDurationMinutes: 45,
  breakStart: '',
  breakEnd: '',
  notifyEmail: true,
  notifySMS: true,
  autoRemind24h: true,
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation & Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
  const [currentUser, setCurrentUser] = useState<SystemUser>(DEFAULT_USER);
  const [activeRole, setActiveRole] = useState<UserRole>('DOCTOR');
  const [activeScreen, setActiveScreenState] = useState<ScreenId>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>('PX-9402');
  const [draftPrescription, setDraftPrescription] = useState<Partial<Prescription> | null>(null);
  const [activePatientProfileTab, setActivePatientProfileTab] = useState<PatientProfileTab>('overview');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState<boolean>(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Collections
  const [users, setUsers] = useState<SystemUser[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [consultations, setConsultations] = useState<Consultation[]>([]);
  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [therapySessions, setTherapySessions] = useState<TherapySession[]>(INITIAL_THERAPY_SESSIONS);
  const [payments, setPayments] = useState<PaymentRecord[]>(INITIAL_PAYMENTS);
  const [feeCategories, setFeeCategories] = useState<FeeCategory[]>(INITIAL_FEE_CATEGORIES);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(INITIAL_AUDIT_LOGS);
  const [backupLogs, setBackupLogs] = useState<BackupLogEntry[]>(INITIAL_BACKUP_LOGS);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings>(DEFAULT_SETTINGS);

  const showToast = (type: 'success' | 'error' | 'warning' | 'info', title: string, message: string) => {
    const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4);
    setToasts(prev => [...prev, { id, type, title, message }]);

    setTimeout(() => {
      removeToast(id);
    }, 4500);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // Audit Log Helper
  const logAuditEvent = (action: string, moduleName: string, description: string, patientRef?: string) => {
    const newLog: AuditLogEntry = {
      id: `LOG-${Math.floor(9000 + auditLogs.length + 1)}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: activeRole,
      action,
      module: moduleName,
      patientRef: patientRef || '',
      description,
    };
    setAuditLogs(prev => [newLog, ...prev]);

    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    fetch('/api/audit-logs', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(newLog),
    }).catch(() => {});
  };

  // Helper to fetch data from API
  const refetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // 1. Fetch Patients from Express Backend
      const patientsRes = await fetch(`${BACKEND_API}/api/patients`, {
        headers,
        credentials: 'include',
      });
      const patientsJson = await patientsRes.json();

      if (patientsJson.success && Array.isArray(patientsJson.data)) {
        const mappedPatients = patientsJson.data.map((p: any) => ({
          ...p,
          id: p.patientId || p.id || p._id,
        }));
        setPatients(mappedPatients);
      }

      // 2. Fetch Appointments
      try {
        const apptsRes = await fetch('/api/appointments');
        const apptsJson = await apptsRes.json();
        if (apptsJson.success && apptsJson.data?.length > 0) setAppointments(apptsJson.data);
      } catch {}

      // 3. Fetch Consultations
      try {
        const consultsRes = await fetch('/api/consultations');
        const consultsJson = await consultsRes.json();
        if (consultsJson.success && consultsJson.data?.length > 0) setConsultations(consultsJson.data);
      } catch {}

      // 4. Fetch Prescriptions
      try {
        const rxRes = await fetch('/api/prescriptions');
        const rxJson = await rxRes.json();
        if (rxJson.success && rxJson.data?.length > 0) setPrescriptions(rxJson.data);
      } catch {}

      // 5. Fetch Follow-ups
      try {
        const flpRes = await fetch('/api/follow-ups');
        const flpJson = await flpRes.json();
        if (flpJson.success && flpJson.data?.length > 0) setFollowUps(flpJson.data);
      } catch {}

      // 6. Fetch Users
      try {
        const usersRes = await fetch('/api/users');
        const usersJson = await usersRes.json();
        if (usersJson.success && usersJson.data && usersJson.data.length > 0) {
          setUsers(usersJson.data);
        }
      } catch {}

      // 7. Fetch Therapy Sessions
      try {
        const therapyUrl = selectedPatientId
          ? `${BACKEND_API}/api/patients/${selectedPatientId}/therapy-sessions`
          : `${BACKEND_API}/api/therapy-sessions`;
        const therapyRes = await fetch(therapyUrl, { headers, credentials: 'include' });
        const therapyJson = await therapyRes.json();
        if (therapyJson.success && Array.isArray(therapyJson.data) && therapyJson.data.length > 0) {
          setTherapySessions(therapyJson.data.map((ts: any) => ({ ...ts, id: ts.sessionId || ts.id || ts._id })));
        }
      } catch {}

      // 8. Fetch Payments
      try {
        const payRes = await fetch(`${BACKEND_API}/api/payments`, { headers, credentials: 'include' });
        const payJson = await payRes.json();
        if (payJson.success && Array.isArray(payJson.data)) {
          setPayments(payJson.data.map((p: any) => ({
            ...p,
            id: p.paymentId || p.id || p._id,
            patientName: typeof p.patientId === 'object' ? (p.patientId.fullName || p.patientName) : (p.patientName || p.patientId),
            patientId: typeof p.patientId === 'object' ? (p.patientId.patientId || p.patientId._id) : p.patientId,
          })));
        }
      } catch {}

      // 9. Fetch Fee Categories
      try {
        const feeRes = await fetch(`${BACKEND_API}/api/fee-categories`, { headers, credentials: 'include' });
        const feeJson = await feeRes.json();
        if (feeJson.success && Array.isArray(feeJson.data)) {
          setFeeCategories(feeJson.data.map((fc: any) => ({
            ...fc,
            id: fc.categoryId || fc.id || fc._id,
            defaultFee: fc.defaultFee ?? fc.amount,
          })));
        }
      } catch {}

      // 10. Fetch Audit Logs
      try {
        const logRes = await fetch(`${BACKEND_API}/api/audit-logs`, { headers, credentials: 'include' });
        const logJson = await logRes.json();
        if (logJson.success && Array.isArray(logJson.data) && logJson.data.length > 0) setAuditLogs(logJson.data);
      } catch {}

      // 11. Fetch Backup Logs
      try {
        const bkpRes = await fetch(`${BACKEND_API}/api/backup`, { headers, credentials: 'include' });
        const bkpJson = await bkpRes.json();
        if (bkpJson.success && Array.isArray(bkpJson.data) && bkpJson.data.length > 0) setBackupLogs(bkpJson.data);
      } catch {}

      // 12. Fetch Settings
      try {
        const settingsRes = await fetch(`${BACKEND_API}/api/settings`, { headers, credentials: 'include' });
        const settingsJson = await settingsRes.json();
        if (settingsJson.success && settingsJson.data) {
          setClinicSettings(settingsJson.data);
        }
      } catch {}
    } catch (err: any) {
      console.error('Error loading database data:', err);
      setError('Could not connect to database backend.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Check auth session on load & load collections
  useEffect(() => {
    async function checkAuthAndLoad() {
      try {
        const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
        const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
        const headers: Record<string, string> = {};
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const meRes = await fetch(`${BACKEND_API}/api/auth/me`, {
          headers,
          credentials: 'include',
        });

        if (meRes.ok) {
          const meJson = await meRes.json();
          const userObj = meJson.data || meJson.user;
          if (meJson.success && userObj) {
            const authUser: SystemUser = {
              id: userObj.userId || userObj.id || userObj._id || 'USR-001',
              name: userObj.name,
              email: userObj.email,
              role: userObj.role,
              avatar: userObj.avatar || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=150&auto=format&fit=crop&q=80',
              title: userObj.title || 'Clinic Staff',
              department: userObj.department || 'Psychiatry',
              status: userObj.isActive ? 'ACTIVE' : 'INACTIVE',
              lastActive: userObj.lastActive || 'Just now',
              permissions: userObj.permissions || {
                canWriteClinicalNotes: true,
                canPrescribe: true,
                canManagePatients: true,
                canManageAppointments: true,
                canManageUsers: userObj.role === 'ADMIN',
                canViewReports: true,
              },
            };
            setCurrentUser(authUser);
            setActiveRole(authUser.role);
            setIsAuthenticated(true);
            setActiveScreenState(prev => prev === 'login' ? 'dashboard' : prev);
          } else {
            setIsAuthenticated(false);
            setActiveScreenState('login');
          }
        } else {
          setIsAuthenticated(false);
          setActiveScreenState('login');
        }
      } catch {
        setIsAuthenticated(false);
        setActiveScreenState('login');
      }
      await refetchData();
    }
    checkAuthAndLoad();
  }, [refetchData]);

  // Keyboard shortcut listener for Global Search (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const setActiveScreen = (screen: ScreenId) => {
    setActiveScreenState(screen);
    setIsMobileSidebarOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const login = async (email?: string, arg2?: string, arg3?: string): Promise<boolean> => {
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const isProd = process.env.NODE_ENV === 'production';
      let targetEmail = email || (isProd ? '' : 'dr.vance@vancepsychiatry.com');
      let targetPassword = isProd ? '' : 'Vance2026!';

      if (arg3) {
        targetPassword = arg3;
      } else if (arg2) {
        if (!isProd && ['ADMIN', 'DOCTOR', 'RECEPTION', 'RECEPTIONIST', 'THERAPIST'].includes(arg2)) {
          if (arg2 === 'ADMIN') targetEmail = 'm.sterling@vancepsychiatry.com';
          if (arg2 === 'RECEPTION' || arg2 === 'RECEPTIONIST') targetEmail = 's.jenkins@vancepsychiatry.com';
          if (arg2 === 'THERAPIST') targetEmail = 'e.watson@vancepsychiatry.com';
          if (arg2 === 'DOCTOR') targetEmail = 'dr.vance@vancepsychiatry.com';
        } else {
          targetPassword = arg2;
        }
      }

      if (!targetEmail || !targetPassword) {
        showToast('error', 'Authentication Required', 'Please enter both your email address and password.');
        return false;
      }

      const res = await fetch(`${BACKEND_API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: targetEmail, password: targetPassword }),
      });

      let json: any;
      try {
        json = await res.json();
      } catch {
        showToast('error', 'Backend Error', 'Failed to parse authentication server response.');
        return false;
      }

      if (!res.ok || !json.success) {
        const errorMessage = json.error || 'Invalid email or password.';
        showToast('error', 'Authentication Failed', errorMessage);
        return false;
      }

      const backendUser = json.user;
      const token = json.token;

      if (token && typeof window !== 'undefined') {
        localStorage.setItem('psychiatrist_token', token);
      }

      const authUser: SystemUser = {
        id: backendUser.userId || backendUser.id || backendUser._id || 'USR-001',
        name: backendUser.name,
        email: backendUser.email,
        role: backendUser.role,
        avatar: backendUser.avatar || 'https://images.unsplash.com/photo-1622253692010-333f2da6031d?w=150&auto=format&fit=crop&q=80',
        title: backendUser.title || 'Clinic Staff',
        department: backendUser.department || 'Psychiatry',
        status: backendUser.isActive ? 'ACTIVE' : 'INACTIVE',
        lastActive: backendUser.lastActive || 'Just now',
        permissions: backendUser.permissions || {
          canWriteClinicalNotes: true,
          canPrescribe: true,
          canManagePatients: true,
          canManageAppointments: true,
          canManageUsers: backendUser.role === 'ADMIN',
          canViewReports: true,
        },
      };

      setCurrentUser(authUser);
      setActiveRole(authUser.role);
      setIsAuthenticated(true);
      setActiveScreenState('dashboard');
      showToast('success', 'Authenticated Successfully', json.message || `Welcome back, ${authUser.name}`);
      logAuditEvent('LOGIN', 'AUTH', `User ${authUser.name} logged in successfully.`);
      await refetchData();
      return true;
    } catch (err: any) {
      showToast('error', 'Backend Unavailable', 'Could not connect to authentication server at http://localhost:5000.');
      return false;
    }
  };

  const logout = async () => {
    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    logAuditEvent('LOGOUT', 'AUTH', `User ${currentUser.name} signed out.`);
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      await fetch(`${BACKEND_API}/api/auth/logout`, {
        method: 'POST',
        headers,
        credentials: 'include',
      });
    } catch {}

    if (typeof window !== 'undefined') {
      localStorage.removeItem('psychiatrist_token');
    }
    setIsAuthenticated(false);
    setActiveScreenState('login');
    showToast('info', 'Signed Out', 'You have been securely signed out.');
  };

  const switchRole = (role: UserRole) => {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    const matchingUser = users.find(u => u.role === role) || {
      ...currentUser,
      role,
      name: role === 'DOCTOR' ? 'DR SHAHAB MUHAMMAD' : role === 'RECEPTIONIST' ? 'Sarah Jenkins' : role === 'THERAPIST' ? 'Dr. Emily Watson, PsyD' : 'Marcus Sterling',
      title: role === 'DOCTOR' ? 'Consultant Neuropsychiatrist' : role === 'RECEPTIONIST' ? 'Clinical Coordinator' : role === 'THERAPIST' ? 'Senior Clinical Psychologist' : 'Practice Director',
    };
    setCurrentUser(matchingUser);
    setActiveRole(role);
    showToast('info', 'Role Switched', `Active session view switched to ${role} (${matchingUser.name}).`);
    logAuditEvent('ROLE_SWITCH', 'SYSTEM', `Switched view mode to ${role}`);
  };

  const navigateToPatientProfile = (
    patientId: string, 
    tab: PatientProfileTab = 'overview'
  ) => {
    setSelectedPatientId(patientId);
    setActivePatientProfileTab(tab);
    setActiveScreenState('patient-profile');
  };

  const navigateToNewConsultation = (patientId?: string) => {
    if (patientId) setSelectedPatientId(patientId);
    setActiveScreenState('new-consultation');
  };

  const navigateToBookAppointment = (patientId?: string) => {
    if (patientId) setSelectedPatientId(patientId);
    setActiveScreenState('book-appointment');
  };

  const navigateToPrescriptions = (patientId?: string) => {
    if (patientId) setSelectedPatientId(patientId);
    setActiveScreenState('prescriptions');
  };

  const reusePrescription = (rx: Prescription) => {
    setDraftPrescription({
      patientId: rx.patientId,
      patientName: rx.patientName,
      patientAge: rx.patientAge,
      patientGender: rx.patientGender,
      diagnosis: rx.diagnosis,
      medications: rx.medications ? rx.medications.map(m => ({ ...m, id: `m-${Date.now()}-${Math.random().toString(36).substr(2, 4)}` })) : [],
      treatmentNotes: rx.treatmentNotes,
      status: 'Active',
    });
    setSelectedPatientId(rx.patientId);
    setActiveScreenState('prescriptions');
  };

  const navigateToTherapy = (patientId?: string) => {
    if (patientId) setSelectedPatientId(patientId);
    setActiveScreenState('therapy');
  };

  const navigateToBilling = (patientId?: string) => {
    if (patientId) setSelectedPatientId(patientId);
    setActiveScreenState('billing');
  };

  // Server-side Patient Search helper
  const searchPatients = async (term: string): Promise<Patient[]> => {
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_API}/api/patients?search=${encodeURIComponent(term)}`, {
        headers,
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        return json.data.map((p: any) => ({
          ...p,
          id: p.patientId || p.id || p._id,
        }));
      }
    } catch (e) {
      console.error('Search patients failed:', e);
    }
    return patients;
  };

  // CRUD implementations
  const addPatient = (patientData: Omit<Patient, 'id' | 'registeredDate'>): Patient => {
    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const tempId = `PX-${Math.floor(9400 + patients.length + 1)}`;
    const tempPatient: Patient = {
      ...patientData,
      id: tempId,
      registeredDate: new Date().toISOString().split('T')[0],
    };

    setPatients(prev => [tempPatient, ...prev]);

    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${BACKEND_API}/api/patients`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(patientData),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          const realPatient: Patient = {
            ...json.data,
            id: json.data.patientId || json.data.id || tempId,
          };
          setPatients(prev => prev.map(p => p.id === tempId ? realPatient : p));
          showToast('success', 'Patient Registered', json.message || `Patient ${patientData.fullName} registered.`);
          logAuditEvent('CREATE', 'PATIENTS', `Registered new patient ${patientData.fullName} (${realPatient.id})`, realPatient.id);
        } else {
          showToast('error', 'Error Registering Patient', json.error || 'Failed to save patient to database.');
        }
      })
      .catch(() => {
        showToast('error', 'Database Error', 'Failed to register patient in MongoDB.');
      });

    return tempPatient;
  };

  const updatePatient = async (id: string, updates: Partial<Patient>) => {
    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    setPatients(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_API}/api/patients/${id}`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const realPatient: Patient = {
          ...json.data,
          id: json.data.patientId || json.data.id || id,
        };
        setPatients(prev => prev.map(p => p.id === id ? realPatient : p));
        showToast('success', 'Patient Updated', json.message || 'Record updated in database successfully.');
        logAuditEvent('UPDATE', 'PATIENTS', `Updated chart for patient ID ${id}`, id);
      } else {
        showToast('error', 'Update Failed', json.error || 'Failed to update patient in MongoDB.');
      }
    } catch {
      showToast('error', 'Database Error', 'Could not save updates to database.');
    }
  };

  const deletePatient = async (id: string): Promise<boolean> => {
    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_API}/api/patients/${id}`, {
        method: 'DELETE',
        headers,
        credentials: 'include',
      });
      const json = await res.json();
      if (json.success) {
        setPatients(prev => prev.filter(p => p.id !== id));
        showToast('success', 'Patient Deleted', json.message || 'Patient record removed.');
        logAuditEvent('DELETE', 'PATIENTS', `Deleted patient record ${id}`, id);
        return true;
      } else {
        showToast('error', 'Delete Failed', json.error || 'Could not delete patient.');
        return false;
      }
    } catch {
      showToast('error', 'Database Error', 'Could not execute delete command.');
      return false;
    }
  };

  const bookAppointment = (appData: Omit<Appointment, 'id'>): Appointment => {
    const tempId = `APT-${Math.floor(1000 + appointments.length + 1)}`;
    const tempAppt: Appointment = {
      ...appData,
      id: tempId,
    };

    setAppointments(prev => [tempAppt, ...prev]);

    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${BACKEND_API}/api/patients/${appData.patientId}/appointments`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(appData),
    })
      .then(async res => {
        const json = await res.json();
        if (res.ok && json.success && json.data) {
          const realAppt = {
            ...json.data,
            id: json.data.appointmentId || json.data.id || tempId,
            date: json.data.appointmentDate || json.data.date || appData.date,
            time: json.data.appointmentTime || json.data.time || appData.time,
            type: json.data.appointmentType || json.data.type || appData.type,
          };
          setAppointments(prev => prev.map(a => a.id === tempId ? realAppt : a));
          showToast('success', 'Appointment Booked', json.message || `Appointment confirmed for ${appData.patientName}.`);
          logAuditEvent('CREATE', 'APPOINTMENTS', `Booked ${appData.type} for ${appData.patientName} on ${appData.date}`, appData.patientId);
          refetchData();
        } else {
          setAppointments(prev => prev.filter(a => a.id !== tempId));
          const errTitle = res.status === 409 ? 'Time Slot Conflict' : 'Booking Failed';
          showToast('error', errTitle, json.error || 'Failed to book appointment.');
        }
      })
      .catch(() => {
        setAppointments(prev => prev.filter(a => a.id !== tempId));
        showToast('error', 'Database Error', 'Could not save appointment to MongoDB.');
      });

    return tempAppt;
  };

  const updateAppointmentStatus = async (id: string, status: Appointment['status'], updates: Partial<Appointment> = {}) => {
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status, ...updates } : a));
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_API}/api/appointments/${id}`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify({ status, ...updates }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        showToast('info', 'Status Updated', json.message || `Appointment status updated to ${status}.`);
        logAuditEvent('UPDATE', 'APPOINTMENTS', `Updated status of appointment ${id} to ${status}`);
        refetchData();
      } else {
        const errTitle = res.status === 409 ? 'Rescheduling Conflict' : 'Update Failed';
        showToast('error', errTitle, json.error || 'Failed to update appointment.');
        refetchData();
      }
    } catch {
      showToast('error', 'Database Error', 'Could not update appointment status.');
    }
  };

  const addConsultation = (consultData: Omit<Consultation, 'id'>): Consultation => {
    const tempId = `CNS-${Math.floor(5000 + consultations.length + 1)}`;
    const tempConsult: Consultation = {
      ...consultData,
      id: tempId,
    };

    setConsultations(prev => [tempConsult, ...prev]);

    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${BACKEND_API}/api/patients/${consultData.patientId}/consultations`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(consultData),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          const realConsult = {
            ...json.data,
            id: json.data.consultationId || json.data.id || tempId,
            date: json.data.consultationDate || json.data.date,
          };
          setConsultations(prev => prev.map(c => (c.id === tempId ? realConsult : c)));
          showToast('success', 'Consultation Saved', json.message || 'Clinical consultation entry saved.');
          logAuditEvent('CREATE', 'CONSULTATION', `Recorded consultation entry ${realConsult.id} for ${consultData.patientName}`, consultData.patientId);
          refetchData();
        } else {
          showToast('error', 'Save Failed', json.error || 'Failed to save consultation.');
        }
      })
      .catch(() => {
        showToast('error', 'Database Error', 'Failed to save consultation to MongoDB.');
      });

    return tempConsult;
  };

  const updateConsultation = async (id: string, updates: Partial<Consultation>): Promise<boolean> => {
    setConsultations(prev => prev.map(c => (c.id === id ? { ...c, ...updates } : c)));
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const targetPatientId = updates.patientId || selectedPatientId || 'PX-9402';
      const res = await fetch(`${BACKEND_API}/api/patients/${targetPatientId}/consultations/${id}`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const realConsult = {
          ...json.data,
          id: json.data.consultationId || json.data.id || id,
          date: json.data.consultationDate || json.data.date,
        };
        setConsultations(prev => prev.map(c => (c.id === id ? realConsult : c)));
        showToast('success', 'Consultation Updated', json.message || 'Consultation record updated successfully.');
        logAuditEvent('UPDATE', 'CONSULTATION', `Updated consultation record ${id}`, targetPatientId);
        refetchData();
        return true;
      } else {
        showToast('error', 'Update Failed', json.error || 'Could not update consultation.');
        return false;
      }
    } catch {
      showToast('error', 'Database Error', 'Could not save consultation updates.');
      return false;
    }
  };

  const addPrescription = (rxData: Omit<Prescription, 'id'>): Prescription => {
    const tempId = `RX-${Math.floor(900 + prescriptions.length + 1)}`;
    const tempRx: Prescription = {
      ...rxData,
      id: tempId,
    };

    setPrescriptions(prev => [tempRx, ...prev]);

    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${BACKEND_API}/api/patients/${rxData.patientId}/prescriptions`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(rxData),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          const realRx = {
            ...json.data,
            id: json.data.prescriptionId || json.data.id || tempId,
            dateIssued: json.data.prescriptionDate || json.data.dateIssued,
          };
          setPrescriptions(prev => prev.map(r => (r.id === tempId ? realRx : r)));
          showToast('success', 'Prescription Issued', json.message || 'Prescription saved to MongoDB.');
          logAuditEvent('CREATE', 'PRESCRIPTION', `Issued digital prescription ${realRx.id} for ${rxData.patientName}`, rxData.patientId);
          refetchData();
        } else {
          showToast('error', 'Issuance Failed', json.error || 'Failed to issue prescription.');
        }
      })
      .catch(() => {
        showToast('error', 'Database Error', 'Failed to save prescription.');
      });

    return tempRx;
  };

  const updatePrescription = async (id: string, updates: Partial<Prescription>): Promise<boolean> => {
    setPrescriptions(prev => prev.map(r => (r.id === id ? { ...r, ...updates } : r)));
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const targetPatientId = updates.patientId || selectedPatientId || 'PX-9402';
      const res = await fetch(`${BACKEND_API}/api/patients/${targetPatientId}/prescriptions/${id}`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const realRx = {
          ...json.data,
          id: json.data.prescriptionId || json.data.id || id,
          dateIssued: json.data.prescriptionDate || json.data.dateIssued,
        };
        setPrescriptions(prev => prev.map(r => (r.id === id ? realRx : r)));
        showToast('success', 'Prescription Updated', json.message || 'Prescription updated successfully.');
        logAuditEvent('UPDATE', 'PRESCRIPTION', `Updated prescription record ${id}`, targetPatientId);
        refetchData();
        return true;
      } else {
        showToast('error', 'Update Failed', json.error || 'Could not update prescription.');
        return false;
      }
    } catch {
      showToast('error', 'Database Error', 'Could not save prescription updates.');
      return false;
    }
  };

  const addFollowUp = (flpData: Omit<FollowUp, 'id'>): FollowUp => {
    const tempId = `FLP-${Math.floor(300 + followUps.length + 1)}`;
    const tempFlp: FollowUp = {
      ...flpData,
      id: tempId,
    };

    setFollowUps(prev => [tempFlp, ...prev]);

    fetch('/api/follow-ups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(flpData),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          setFollowUps(prev => prev.map(f => f.id === tempId ? json.data : f));
          showToast('success', 'Follow-up Scheduled', json.message);
        } else {
          showToast('error', 'Follow-up Creation Failed', json.error);
        }
      })
      .catch(() => {
        showToast('error', 'Database Error', 'Failed to save follow-up task.');
      });

    return tempFlp;
  };

  const updateFollowUpStatus = async (id: string, status: FollowUp['status']) => {
    setFollowUps(prev => prev.map(f => f.id === id ? { ...f, status } : f));
    try {
      const res = await fetch(`/api/follow-ups/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('info', 'Follow-up Updated', `Follow-up status marked as ${status}.`);
      } else {
        showToast('error', 'Update Failed', json.error);
      }
    } catch {
      showToast('error', 'Database Error', 'Could not update follow-up status.');
    }
  };

  const addTherapySession = (sessionData: Omit<TherapySession, 'id'>): TherapySession => {
    const tempId = `TS-${Math.floor(700 + therapySessions.length + 1)}`;
    const tempSession: TherapySession = {
      ...sessionData,
      id: tempId,
    };

    setTherapySessions(prev => [tempSession, ...prev]);

    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${BACKEND_API}/api/patients/${sessionData.patientId}/therapy-sessions`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(sessionData),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          const realSession = {
            ...json.data,
            id: json.data.sessionId || json.data.id || tempId,
          };
          setTherapySessions(prev => prev.map(ts => (ts.id === tempId ? realSession : ts)));
          showToast('success', 'Therapy Session Saved', json.message || 'Extended psychotherapy session notes saved.');
          logAuditEvent('CREATE', 'THERAPY', `Documented ${sessionData.sessionType} session for ${sessionData.patientName}`, sessionData.patientId);
          refetchData();
        } else {
          showToast('error', 'Save Failed', json.error || 'Failed to save therapy session.');
        }
      })
      .catch(() => {
        showToast('error', 'Database Error', 'Failed to save therapy session.');
      });

    return tempSession;
  };

  const updateTherapySession = async (id: string, updates: Partial<TherapySession>): Promise<boolean> => {
    setTherapySessions(prev => prev.map(ts => (ts.id === id ? { ...ts, ...updates } : ts)));
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const targetPatientId = updates.patientId || selectedPatientId || 'PX-9402';
      const res = await fetch(`${BACKEND_API}/api/patients/${targetPatientId}/therapy-sessions/${id}`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const realSession = {
          ...json.data,
          id: json.data.sessionId || json.data.id || id,
        };
        setTherapySessions(prev => prev.map(ts => (ts.id === id ? realSession : ts)));
        showToast('success', 'Therapy Session Updated', json.message || 'Therapy session record updated.');
        logAuditEvent('UPDATE', 'THERAPY', `Updated therapy session ${id}`, targetPatientId);
        refetchData();
        return true;
      } else {
        showToast('error', 'Update Failed', json.error || 'Could not update therapy session.');
        return false;
      }
    } catch {
      showToast('error', 'Database Error', 'Could not save therapy session updates.');
      return false;
    }
  };

  const addPayment = (paymentData: Omit<PaymentRecord, 'id' | 'receiptNumber'>): PaymentRecord => {
    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const tempId = `PY-${Math.floor(400 + payments.length + 1)}`;
    const receiptNum = `RCP-2026-${String(payments.length + 89).padStart(4, '0')}`;
    const tempPayment: PaymentRecord = {
      ...paymentData,
      id: tempId,
      receiptNumber: receiptNum,
    };

    setPayments(prev => [tempPayment, ...prev]);

    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${BACKEND_API}/api/payments`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(paymentData),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          const realPayment: PaymentRecord = {
            ...json.data,
            id: json.data.paymentId || json.data.id || tempId,
            receiptNumber: json.data.receiptNumber || receiptNum,
          };
          setPayments(prev => prev.map(p => p.id === tempId ? realPayment : p));
          showToast('success', 'Payment Recorded', json.message || `Receipt ${realPayment.receiptNumber} generated.`);
          logAuditEvent('CREATE', 'BILLING', `Recorded $${paymentData.amount} payment (${realPayment.receiptNumber}) for ${paymentData.patientName}`, paymentData.patientId);
          refetchData();
        } else {
          setPayments(prev => prev.filter(p => p.id !== tempId));
          showToast('error', 'Payment Failed', json.error || 'Failed to record payment.');
        }
      })
      .catch(() => {
        setPayments(prev => prev.filter(p => p.id !== tempId));
        showToast('error', 'Database Error', 'Failed to record payment in database.');
      });

    return tempPayment;
  };

  const updateFeeCategory = async (id: string, updates: Partial<FeeCategory>) => {
    setFeeCategories(prev => prev.map(fc => fc.id === id ? { ...fc, ...updates } : fc));
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_API}/api/fee-categories/${id}`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          ...updates,
          defaultFee: updates.defaultFee,
        }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', 'Fee Schedule Updated', json.message || 'Fee category updated in database.');
        logAuditEvent('UPDATE', 'BILLING', `Updated fee category ${id}`);
        refetchData();
      } else {
        showToast('error', 'Update Failed', json.error || 'Failed to update fee category.');
        refetchData();
      }
    } catch {
      showToast('error', 'Database Error', 'Failed to update fee category.');
    }
  };

  const addFeeCategory = async (categoryData: Omit<FeeCategory, 'id'>) => {
    const tempId = `FEE-${Math.floor(100 + feeCategories.length + 1)}`;
    const newCategory: FeeCategory = { ...categoryData, id: tempId };
    setFeeCategories(prev => [...prev, newCategory]);

    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_API}/api/fee-categories`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          ...categoryData,
          amount: categoryData.defaultFee,
        }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const realCat: FeeCategory = {
          ...json.data,
          id: json.data.categoryId || json.data.id || tempId,
          defaultFee: json.data.defaultFee ?? json.data.amount,
        };
        setFeeCategories(prev => prev.map(c => c.id === tempId ? realCat : c));
        showToast('success', 'Fee Category Added', json.message || `Created fee category '${categoryData.name}'.`);
        logAuditEvent('CREATE', 'BILLING', `Added fee category ${categoryData.name}`);
        refetchData();
      } else {
        setFeeCategories(prev => prev.filter(c => c.id !== tempId));
        showToast('error', 'Category Creation Failed', json.error || 'Failed to create fee category.');
      }
    } catch {
      setFeeCategories(prev => prev.filter(c => c.id !== tempId));
      showToast('error', 'Database Error', 'Failed to add fee category.');
    }
  };

  const createBackup = async (type: BackupLogEntry['type'] = 'Full System'): Promise<BackupLogEntry> => {
    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const tempId = `BKP-${Math.floor(100 + backupLogs.length + 1)}`;
    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const newBackup: BackupLogEntry = {
      id: tempId,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      fileName: `clinic-backup-${dateStr}-${type.toLowerCase().replace(/\s+/g, '')}.json`,
      fileSize: '4.8 MB',
      type,
      status: 'Completed',
      createdByName: currentUser.name,
    };

    setBackupLogs(prev => [newBackup, ...prev]);

    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_API}/api/backup`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({ type }),
      });
      const json = await res.json();
      if (json.success && json.data) {
        const realBackup = {
          ...json.data,
          id: json.data.backupId || json.data.id || tempId,
        };
        setBackupLogs(prev => prev.map(b => b.id === tempId ? realBackup : b));
        showToast('success', 'Backup Archive Created', json.message || `Archive ${realBackup.fileName} generated.`);
        logAuditEvent('BACKUP', 'BACKUP', `Created manual ${type} database backup archive.`);
        return realBackup;
      }
    } catch {}

    return newBackup;
  };

  const updateClinicSettings = async (settingsData: Partial<ClinicSettings>) => {
    setClinicSettings(prev => ({ ...prev, ...settingsData }));
    try {
      const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
      const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`${BACKEND_API}/api/settings`, {
        method: 'PUT',
        headers,
        credentials: 'include',
        body: JSON.stringify(settingsData),
      });
      const json = await res.json();
      if (json.success) {
        showToast('success', 'Settings Saved', json.message || 'Clinic configuration updated in database.');
        logAuditEvent('UPDATE', 'SETTINGS', 'Updated clinic profile configuration & preferences.');
      } else {
        showToast('error', 'Save Failed', json.error || 'Could not update settings.');
      }
    } catch {
      showToast('error', 'Database Error', 'Could not save clinic settings.');
    }
  };

  const addUser = (userData: Omit<SystemUser, 'id' | 'lastActive'>): SystemUser => {
    const BACKEND_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
    const tempId = `USR-00${users.length + 1}`;
    const tempUser: SystemUser = {
      ...userData,
      id: tempId,
      lastActive: 'Never',
    };

    setUsers(prev => [...prev, tempUser]);

    const token = typeof window !== 'undefined' ? localStorage.getItem('psychiatrist_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    fetch(`${BACKEND_API}/api/users`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({
        ...userData,
        password: (userData as any).password || 'Staff@123456',
      }),
    })
      .then(res => res.json())
      .then(json => {
        if (json.success && (json.data || json.user)) {
          const createdUser = json.data || json.user;
          const mappedUser: SystemUser = {
            id: createdUser.userId || createdUser.id || tempId,
            name: createdUser.name,
            email: createdUser.email,
            role: createdUser.role,
            avatar: createdUser.avatar || userData.avatar,
            title: createdUser.title || userData.title,
            department: createdUser.department || userData.department,
            status: createdUser.isActive !== false ? 'ACTIVE' : 'INACTIVE',
            lastActive: createdUser.lastActive || 'Never',
            permissions: createdUser.permissions || userData.permissions,
          };
          setUsers(prev => prev.map(u => u.id === tempId ? mappedUser : u));
          showToast('success', 'Staff User Created', json.message || `Account created for ${userData.name}.`);
          logAuditEvent('CREATE', 'USERS', `Created user account ${userData.name} with role ${userData.role}`);
        } else {
          showToast('error', 'User Creation Failed', json.error || 'Failed to create user in database.');
        }
      })
      .catch(() => {
        // Fallback to Next.js API route if Express backend is unreachable
        fetch('/api/users', {
          method: 'POST',
          headers,
          body: JSON.stringify(userData),
        })
          .then(res => res.json())
          .then(json => {
            if (json.success && json.data) {
              setUsers(prev => prev.map(u => u.id === tempId ? json.data : u));
              showToast('success', 'Staff User Created', json.message);
              logAuditEvent('CREATE', 'USERS', `Created user account ${userData.name} with role ${userData.role}`);
            } else {
              showToast('error', 'User Creation Failed', json.error || 'Failed to create user.');
            }
          })
          .catch(() => {
            showToast('error', 'Database Error', 'Could not create staff user account.');
          });
      });

    return tempUser;
  };


  const updateUserRole = async (userId: string, role: UserRole) => {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const json = await res.json();
      if (json.success) {
        showToast('info', 'Permissions Updated', `User role updated to ${role} in database.`);
        logAuditEvent('ROLE_CHANGE', 'USERS', `Changed role of user ${userId} to ${role}`);
      } else {
        showToast('error', 'Update Failed', json.error);
      }
    } catch {
      showToast('error', 'Database Error', 'Could not update user role.');
    }
  };

  return (
    <AppContext.Provider
      value={{
        isAuthenticated,
        currentUser,
        activeRole,
        activeScreen,
        selectedPatientId,
        draftPrescription,
        setDraftPrescription,
        reusePrescription,
        activePatientProfileTab,
        isLoading,
        error,
        isGlobalSearchOpen,
        setIsGlobalSearchOpen,
        isMobileSidebarOpen,
        setIsMobileSidebarOpen,
        toasts,
        showToast,
        removeToast,
        login,
        logout,
        setActiveScreen,
        switchRole,
        navigateToPatientProfile,
        navigateToNewConsultation,
        navigateToBookAppointment,
        navigateToPrescriptions,
        navigateToTherapy,
        navigateToBilling,
        users,
        patients,
        appointments,
        consultations,
        prescriptions,
        followUps,
        therapySessions,
        payments,
        feeCategories,
        auditLogs,
        backupLogs,
        clinicSettings,
        addPatient,
        updatePatient,
        deletePatient,
        bookAppointment,
        updateAppointmentStatus,
        addConsultation,
        updateConsultation,
        addPrescription,
        updatePrescription,
        addFollowUp,
        updateFollowUpStatus,
        addTherapySession,
        updateTherapySession,
        addPayment,
        updateFeeCategory,
        addFeeCategory,
        createBackup,
        logAuditEvent,
        updateClinicSettings,
        addUser,
        updateUserRole,
        searchPatients,
        refetchData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

