import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Users, Wallet, Receipt, Info, CheckCircle2, Circle, ShieldCheck, RefreshCw, Loader2, History, Calendar, Lock } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- FIREBASE INITIALIZATION ---
// PENTING: Ganti object di bawah ini dengan config Firebase milikmu!
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
  apiKey: "AIzaSyD-LvUWxP1TMMOmIcNqRP01ibsNDRvWqv8",
  authDomain: "kas-kontrakan.firebaseapp.com",
  projectId: "kas-kontrakan",
  storageBucket: "kas-kontrakan.firebasestorage.app",
  messagingSenderId: "658531597863",
  appId: "1:658531597863:web:29279447fd5f526bd4d802"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'kontrakan-kita-v1';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  
  // --- STATE UNTUK ADMIN ---
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const ADMIN_PIN = '123456'; // Ganti dengan PIN rahasia kamu
  
  // --- STATE UNTUK MODAL NOTIFIKASI & TUTUP BULAN ---
  const [alertMsg, setAlertMsg] = useState({ show: false, title: '', message: '', type: 'info' });
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [monthNameInput, setMonthNameInput] = useState('');

  // Data Structure
  const [data, setData] = useState({
    expenses: [],
    residents: [],
    history: []
  });

  // --- AUTHENTICATION & DATA FETCHING ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (error) {
        console.error("Auth Error:", error);
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'kontrakan', 'state');
    
    const unsubscribe = onSnapshot(docRef, (snapshot) => {
      if (snapshot.exists()) {
        setData(snapshot.data());
        setLoading(false);
      } else {
        const initialData = {
          expenses: [
            { id: 1, name: 'WiFi', amount: 280000, paidAmount: 0 },
            { id: 2, name: 'Listrik', amount: 200000, paidAmount: 100000 },
            { id: 3, name: 'Air', amount: 140000, paidAmount: 0 },
          ],
          residents: Array.from({ length: 7 }, (_, i) => ({ 
            id: i + 1, 
            name: `Penghuni ${i + 1}`, 
            hasPaid: false 
          })),
          history: []
        };
        setDoc(docRef, initialData);
        setData(initialData);
        setLoading(false);
      }
    }, (error) => {
      console.error("Firestore Error:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // --- DATA MUTATIONS (SYNC TO FIRESTORE) ---
  const updateData = async (newData) => {
    setData(newData);
    if (!user) return;
    
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'kontrakan', 'state');
    try {
      await setDoc(docRef, newData);
    } catch (error) {
      console.error("Failed to save:", error);
    }
  };

  // --- CALCULATIONS ---
  const calc = useMemo(() => {
    const expenses = data.expenses || [];
    const residents = data.residents || [];

    const totalNormal = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalCurrent = expenses.reduce((sum, e) => sum + Math.max(0, e.amount - e.paidAmount), 0);
    const safePeopleCount = residents.length > 0 ? residents.length : 1;

    const perPersonNormal = totalNormal / safePeopleCount;
    const perPersonCurrent = totalCurrent / safePeopleCount;

    const roundedNormal = Math.ceil(perPersonNormal / 1000) * 1000;
    const roundedCurrent = Math.ceil(perPersonCurrent / 1000) * 1000;

    const totalCollected = residents.filter(r => r.hasPaid).length * roundedCurrent;
    const expectedCollection = residents.length * roundedCurrent;

    return {
      totalNormal, totalCurrent,
      perPersonNormal, perPersonCurrent,
      roundedNormal, roundedCurrent,
      totalCollected, expectedCollection,
      peopleCount: residents.length
    };
  }, [data]);

  // Handlers Expense & Residents
  const handleAddExpense = () => {
    if (!isAdmin) return;
    const newId = data.expenses.length > 0 ? Math.max(...data.expenses.map(e => e.id)) + 1 : 1;
    updateData({ ...data, expenses: [...data.expenses, { id: newId, name: '', amount: 0, paidAmount: 0 }] });
  };

  const handleRemoveExpense = (id) => {
    if (!isAdmin) return;
    updateData({ ...data, expenses: data.expenses.filter(e => e.id !== id) });
  };

  const handleUpdateExpense = (id, field, value) => {
    if (!isAdmin) return;
    updateData({
      ...data,
      expenses: data.expenses.map(e => {
        if (e.id === id) {
          let finalValue = value;
          if (field === 'amount' || field === 'paidAmount') {
            finalValue = parseInt(value) || 0;
            if (finalValue < 0) finalValue = 0;
          }
          return { ...e, [field]: finalValue };
        }
        return e;
      })
    });
  };

  const handleAddResident = () => {
    if (!isAdmin) return;
    const newId = data.residents.length > 0 ? Math.max(...data.residents.map(r => r.id)) + 1 : 1;
    updateData({ ...data, residents: [...data.residents, { id: newId, name: `Penghuni ${newId}`, hasPaid: false }] });
  };

  const handleRemoveResident = (id) => {
    if (!isAdmin) return;
    updateData({ ...data, residents: data.residents.filter(r => r.id !== id) });
  };

  const handleUpdateResidentName = (id, newName) => {
    if (!isAdmin) return;
    updateData({ ...data, residents: data.residents.map(r => r.id === id ? { ...r, name: newName } : r) });
  };

  const handleTogglePaid = (id) => {
    if (!isAdmin) return;
    updateData({ ...data, residents: data.residents.map(r => r.id === id ? { ...r, hasPaid: !r.hasPaid } : r) });
  };

  const handleFinishMonthClick = () => {
    if (!isAdmin) return;

    // Cek apakah semua penghuni sudah bayar
    const allPaid = data.residents.length > 0 && data.residents.every(r => r.hasPaid);
    if (!allPaid) {
      setAlertMsg({
        show: true,
        title: '⚠️ Belum Lunas Semua!',
        message: 'Masih ada penghuni yang belum membayar. Silakan selesaikan dan centang semua status pembayaran terlebih dahulu.',
        type: 'error'
      });
      return;
    }

    // Set default nama bulan (misal: Tagihan Mei 2026)
    const currentMonth = new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' });
    setMonthNameInput(`Tagihan ${currentMonth}`);
    setShowFinishModal(true);
  };

  const confirmFinishMonth = async () => {
    if (!monthNameInput.trim()) return;

    const historyRecord = {
      id: Date.now(),
      monthName: monthNameInput,
      totalTagihan: calc.totalCurrent,
      iuranPerOrang: calc.roundedCurrent,
      terkumpul: calc.totalCollected,
      lunas: data.residents.filter(r => r.hasPaid).length,
      totalPenghuni: data.residents.length,
      dateSaved: new Date().toISOString()
    };

    const newData = {
      ...data,
      // Mengosongkan cicilan/status agar siap dipakai bulan depan
      expenses: data.expenses.map(e => ({ ...e, paidAmount: 0 })),
      residents: data.residents.map(r => ({ ...r, hasPaid: false })),
      history: [...(data.history || []), historyRecord]
    };
    
    await updateData(newData);
    setShowFinishModal(false);
    
    setAlertMsg({
      show: true,
      title: '✅ BERHASIL!',
      message: 'Buku bulan ini telah ditutup. Data tersimpan di Riwayat dan tagihan kembali disiapkan untuk bulan depan.',
      type: 'success'
    });
  };

  const handleDeleteHistory = (historyId) => {
    if (!isAdmin) return;
    if (window.confirm("Yakin ingin menghapus riwayat ini?")) {
      updateData({
        ...data,
        history: (data.history || []).filter(h => h.id !== historyId)
      });
    }
  };

  // --- UTILS ---
  const formatRupiah = (number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency', currency: 'IDR', minimumFractionDigits: 0,
    }).format(number);
  };

  // --- LOGIN ADMIN HANDLERS ---
  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (pinInput === ADMIN_PIN) {
      setIsAdmin(true);
      setShowLoginModal(false);
      setPinInput('');
      setLoginError('');
    } else {
      setLoginError('PIN Admin salah!');
    }
  };

  const handleAdminLogout = () => {
    setIsAdmin(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center font-sans">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
        <p className="text-slate-500 font-medium">Memuat Data Kontrakan...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4 font-sans text-slate-800 pb-24 relative">
      
      {/* MODAL LOGIN ADMIN */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4 mx-auto">
              <Lock className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-center mb-1">Masuk sebagai Admin</h3>
            <p className="text-sm text-slate-500 text-center mb-6">Masukkan PIN untuk mengedit tagihan</p>
            
            <form onSubmit={handleAdminLogin}>
              <input
                type="password"
                value={pinInput}
                onChange={(e) => { setPinInput(e.target.value); setLoginError(''); }}
                placeholder="Masukkan PIN"
                className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-center tracking-[0.5em] mb-2"
                autoFocus
              />
              {loginError && <p className="text-red-500 text-sm text-center font-medium mb-2">{loginError}</p>}
              
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => {setShowLoginModal(false); setLoginError(''); setPinInput('');}} className="w-full py-2.5 rounded-xl font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">
                  Batal
                </button>
                <button type="submit" className="w-full py-2.5 rounded-xl font-semibold bg-blue-600 text-white hover:bg-blue-700 transition shadow-md">
                  Masuk
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ALERT (WARNING / SUCCESS) */}
      {alertMsg.show && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className={`flex items-center justify-center w-12 h-12 rounded-full mb-4 mx-auto ${alertMsg.type === 'error' ? 'bg-red-100' : 'bg-emerald-100'}`}>
              {alertMsg.type === 'error' ? <Info className="w-6 h-6 text-red-600" /> : <CheckCircle2 className="w-6 h-6 text-emerald-600" />}
            </div>
            <h3 className="text-xl font-bold text-center mb-2">{alertMsg.title}</h3>
            <p className="text-sm text-slate-600 text-center mb-6">{alertMsg.message}</p>
            <button onClick={() => setAlertMsg({ ...alertMsg, show: false })} className="w-full py-2.5 rounded-xl font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition">
              Mengerti
            </button>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI TUTUP BULAN */}
      {showFinishModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4 mx-auto">
              <Calendar className="w-6 h-6 text-blue-600" />
            </div>
            <h3 className="text-xl font-bold text-center mb-1">Tutup Buku Bulan Ini</h3>
            <p className="text-sm text-slate-500 text-center mb-4">Beri nama untuk arsip tagihan ini.</p>
            
            <input
              type="text"
              value={monthNameInput}
              onChange={(e) => setMonthNameInput(e.target.value)}
              placeholder="Contoh: Tagihan Mei 2026"
              className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-6 text-center font-medium"
              autoFocus
            />
            
            <div className="flex gap-2">
              <button onClick={() => setShowFinishModal(false)} className="w-full py-2.5 rounded-xl font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">
                Batal
              </button>
              <button onClick={confirmFinishMonth} className="w-full py-2.5 rounded-xl font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition shadow-md flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="bg-blue-600 rounded-2xl p-6 text-white shadow-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Wallet className="w-12 h-12 text-blue-200 opacity-90 hidden sm:block" />
            <div>
              <h1 className="text-2xl font-bold mb-1">Manajemen Kas Kontrakan</h1>
              <p className="text-blue-100 text-sm flex items-center gap-2">
                {isAdmin ? (
                  <><ShieldCheck className="w-4 h-4 text-amber-300" /> Mode Admin Aktif</>
                ) : (
                  <><Users className="w-4 h-4 text-emerald-300" /> Mode Penghuni (Hanya Lihat)</>
                )}
              </p>
            </div>
          </div>
          
          {isAdmin ? (
            <button onClick={handleAdminLogout} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all bg-amber-500 text-amber-950 hover:bg-amber-400 shadow-md">
              Keluar Mode Admin
            </button>
          ) : (
            <button onClick={() => setShowLoginModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm border border-white/20">
              <Lock className="w-4 h-4" /> Masuk Admin
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Content (Kiri & Tengah) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Rincian Biaya */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Receipt className="text-blue-500 w-5 h-5" />
                  <h2 className="text-lg font-semibold">Rincian Tagihan Bulan Ini</h2>
                </div>
                {isAdmin && (
                  <button onClick={handleAddExpense} className="flex items-center gap-1 text-sm bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition font-medium">
                    <Plus className="w-4 h-4" /> Tambah Biaya
                  </button>
                )}
              </div>

              <div className="space-y-4">
                {data.expenses.map((expense) => (
                  <div key={expense.id} className="p-4 border border-slate-200 rounded-xl bg-slate-50 relative group transition-all">
                    {isAdmin && (
                      <button onClick={() => handleRemoveExpense(expense.id)} className="absolute -top-3 -right-3 bg-red-100 text-red-500 p-1.5 rounded-full hover:bg-red-500 hover:text-white transition shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Nama Biaya</label>
                        <input type="text" value={expense.name} onChange={(e) => handleUpdateExpense(expense.id, 'name', e.target.value)} disabled={!isAdmin} placeholder="Misal: Air / Gas" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition text-sm disabled:bg-slate-100 disabled:text-slate-600 disabled:border-transparent"/>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Total Tagihan (Rp)</label>
                        <input type="number" value={expense.amount === 0 ? '' : expense.amount} onChange={(e) => handleUpdateExpense(expense.id, 'amount', e.target.value)} disabled={!isAdmin} placeholder="0" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition text-sm disabled:bg-slate-100 disabled:text-slate-600 disabled:border-transparent"/>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-500 mb-1">Sudah Dicicil (Rp)</label>
                        <input type="number" value={expense.paidAmount === 0 ? '' : expense.paidAmount} onChange={(e) => handleUpdateExpense(expense.id, 'paidAmount', e.target.value)} disabled={!isAdmin} placeholder="0" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition text-sm disabled:bg-slate-100 disabled:text-slate-600 disabled:border-transparent"/>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tracking Penghuni */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                <div className="flex items-center gap-2">
                  <Users className="text-indigo-500 w-5 h-5" />
                  <div>
                    <h2 className="text-lg font-semibold">Status Pembayaran</h2>
                    <p className="text-xs text-slate-500">Terkumpul: {formatRupiah(calc.totalCollected)} / {formatRupiah(calc.expectedCollection)}</p>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={handleAddResident} className="flex items-center gap-1 text-sm bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition font-medium w-max">
                    <Plus className="w-4 h-4" /> Tambah Orang
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {data.residents.map((resident) => (
                  <div key={resident.id} className={`flex items-center justify-between p-3 border rounded-xl transition-all ${resident.hasPaid ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:border-blue-300'}`}>
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <button onClick={() => handleTogglePaid(resident.id)} disabled={!isAdmin} className={`flex-shrink-0 transition-colors ${isAdmin ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}>
                        {resident.hasPaid ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Circle className="w-6 h-6 text-slate-300 hover:text-blue-400" />}
                      </button>
                      <input type="text" value={resident.name} onChange={(e) => handleUpdateResidentName(resident.id, e.target.value)} disabled={!isAdmin} className={`w-full bg-transparent text-sm font-medium outline-none truncate ${resident.hasPaid ? 'text-emerald-800' : 'text-slate-700'}`} placeholder="Nama Penghuni"/>
                    </div>
                    {isAdmin && (
                      <button onClick={() => handleRemoveResident(resident.id)} className="ml-2 text-slate-400 hover:text-red-500 transition-colors p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Riwayat Bulan Lalu */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center gap-2 mb-6">
                <History className="text-slate-500 w-5 h-5" />
                <h2 className="text-lg font-semibold text-slate-700">Riwayat Bulan Sebelumnya</h2>
              </div>
              
              <div className="space-y-3">
                {!(data.history && data.history.length > 0) ? (
                  <div className="text-center py-6 text-slate-400 text-sm bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    Belum ada riwayat. Saat admin klik "Selesai Bulan Ini", data akan otomatis tersimpan di sini.
                  </div>
                ) : (
                  [...data.history].reverse().map((item) => (
                    <div key={item.id} className="p-4 border border-slate-200 rounded-xl bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 group">
                      <div className="flex items-start gap-3">
                        <div className="bg-blue-100 p-2 rounded-lg text-blue-600 mt-1">
                          <Calendar className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-bold text-slate-800">{item.monthName}</h4>
                          <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                            <p>Iuran: {formatRupiah(item.iuranPerOrang)}/org</p>
                            <p>Lunas: {item.lunas}/{item.totalPenghuni} Orang</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto border-t sm:border-0 pt-3 sm:pt-0">
                        <div className="text-left sm:text-right">
                          <div className="text-xs text-slate-500 font-medium mb-1">Total Terkumpul</div>
                          <div className="font-bold text-emerald-600">{formatRupiah(item.terkumpul)}</div>
                        </div>
                        {isAdmin && (
                          <button onClick={() => handleDeleteHistory(item.id)} className="text-slate-400 hover:text-red-500 p-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Sidebar Kanan (Kalkulasi) */}
          <div className="space-y-6">
            
            {/* Card Iuran Aktif */}
            <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <Wallet className="w-32 h-32" />
              </div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-indigo-100 text-sm font-medium">Iuran Bulan Ini / Org</div>
                  <div className="bg-white/20 px-2 py-1 rounded text-xs backdrop-blur-sm">
                    {calc.peopleCount} Orang
                  </div>
                </div>
                <div className="text-3xl font-bold tracking-tight mb-2">
                  {formatRupiah(calc.roundedCurrent)}
                </div>
                <div className="text-xs text-indigo-200 mb-5 flex items-center gap-1">
                  <span>Asli: {formatRupiah(calc.perPersonCurrent)}</span>
                  <span className="bg-indigo-500/50 px-1.5 rounded">Dibulatkan</span>
                </div>
                
                <div className="border-t border-indigo-500/50 pt-3 mt-1 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-indigo-200">Sisa Tagihan Bersih:</span>
                    <span className="font-semibold">{formatRupiah(calc.totalCurrent)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-indigo-200">Kas Sisa Pembulatan:</span>
                    <span className="font-semibold text-amber-300">
                      {formatRupiah((calc.roundedCurrent * calc.peopleCount) - calc.totalCurrent)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Card Info Normal */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-200">
              <h3 className="text-slate-500 text-xs font-semibold uppercase tracking-wider mb-2">Estimasi Bulan Depan (Tanpa Cicilan)</h3>
              <div className="text-xl font-bold text-slate-800 mb-1">
                {formatRupiah(calc.roundedNormal)} <span className="text-sm font-normal text-slate-500">/ org</span>
              </div>
              <div className="flex justify-between text-xs text-slate-400 border-t border-slate-100 pt-2 mt-2">
                <span>Total Normal:</span>
                <span>{formatRupiah(calc.totalNormal)}</span>
              </div>
            </div>

            {/* Admin Actions */}
            {isAdmin && (
              <button 
                onClick={handleFinishMonthClick}
                className={`w-full rounded-xl p-4 flex items-center justify-center gap-2 font-semibold transition-all shadow-md ${
                  data.residents.length > 0 && data.residents.every(r => r.hasPaid)
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white hover:shadow-lg'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <CheckCircle2 className="w-5 h-5" />
                Selesai Bulan Ini & Simpan
              </button>
            )}

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
              <div className="flex gap-3">
                <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800 leading-relaxed">
                  Data yang tersimpan di riwayat tidak bisa diubah lagi. Saat admin klik <strong>Selesai Bulan Ini</strong>, sistem akan otomatis menyiapkan kolom kosong untuk tagihan bulan depannya.
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}