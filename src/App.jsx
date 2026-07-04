import React, { useState, useMemo, useEffect } from 'react';
import { Plus, Trash2, Users, Wallet, Receipt, Info, CheckCircle2, Circle, ShieldCheck, RefreshCw, Loader2, History, Calendar, Lock, MessageCircle, Phone, X, Eye, Calculator, ArrowDownCircle } from 'lucide-react';
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
  
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const ADMIN_PIN = '123456';
  
  const [alertMsg, setAlertMsg] = useState({ show: false, title: '', message: '', type: 'info' });
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [monthNameInput, setMonthNameInput] = useState('');
  const [selectedHistory, setSelectedHistory] = useState(null);

  const [data, setData] = useState({
    expenses: [],
    residents: [],
    history: []
  });

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
        const dbData = snapshot.data();
        
        // MIGRATION / FALLBACK: Memastikan data lama kompatibel dengan fitur baru
        const allResidentIds = (dbData.residents || []).map(r => r.id);
        const safeExpenses = (dbData.expenses || []).map(e => ({
          ...e,
          // Jika belum ada field assignedTo (data lama), assign ke semua orang
          assignedTo: e.assignedTo || allResidentIds
        }));
        const safeResidents = (dbData.residents || []).map(r => ({
          ...r,
          // Jika belum ada field deduction (data lama), set 0
          deduction: r.deduction || 0
        }));

        setData({ ...dbData, expenses: safeExpenses, residents: safeResidents });
        setLoading(false);
      } else {
        const defaultResidentIds = [1, 2, 3, 4, 5, 6, 7];
        const initialData = {
          expenses: [
            { id: 1, name: 'WiFi', amount: 280000, paidAmount: 0, hasInstallment: false, assignedTo: [...defaultResidentIds] },
            { id: 2, name: 'Listrik', amount: 200000, paidAmount: 0, hasInstallment: false, assignedTo: [...defaultResidentIds] },
            { id: 3, name: 'Air', amount: 140000, paidAmount: 0, hasInstallment: false, assignedTo: [...defaultResidentIds] },
          ],
          residents: Array.from({ length: 7 }, (_, i) => ({ 
            id: i + 1, 
            name: `Penghuni ${i + 1}`,
            phone: '', 
            hasPaid: false,
            deduction: 0
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

  // --- LOGIKA PERHITUNGAN BARU (SPLIT BILL) ---
  const calc = useMemo(() => {
    const expenses = data.expenses || [];
    const residents = data.residents || [];

    // Objek untuk menyimpan detail tagihan tiap orang
    const bills = {};
    residents.forEach(r => {
      bills[r.id] = { gross: 0, net: 0, roundedNet: 0, details: [], deduction: r.deduction || 0 };
    });

    let totalNormal = 0; // Total Asli tanpa cicilan
    let totalCurrent = 0; // Total sisa tagihan real

    expenses.forEach(e => {
      totalNormal += e.amount;
      const activeAmount = Math.max(0, e.amount - (e.paidAmount || 0));
      totalCurrent += activeAmount;

      const assignedIds = e.assignedTo || [];
      if (assignedIds.length > 0 && activeAmount > 0) {
        const perPerson = activeAmount / assignedIds.length;
        assignedIds.forEach(id => {
          if (bills[id]) {
            bills[id].gross += perPerson;
            bills[id].details.push(e.name);
          }
        });
      }
    });

    let totalExpectedCollection = 0;
    let totalCollected = 0;

    // Hitung akhir per orang (Potongan Talangan & Pembulatan)
    residents.forEach(r => {
      const b = bills[r.id];
      // Jika talangan lebih besar dari tagihan, jadikan 0 (tidak minus)
      b.net = Math.max(0, b.gross - b.deduction); 
      // Bulatkan ke atas ke ribuan terdekat
      b.roundedNet = Math.ceil(b.net / 1000) * 1000;
      
      totalExpectedCollection += b.roundedNet;
      if (r.hasPaid) {
        totalCollected += b.roundedNet;
      }
    });

    return {
      bills,
      totalNormal, totalCurrent,
      totalCollected, totalExpectedCollection,
      peopleCount: residents.length
    };
  }, [data]);

  // --- HANDLERS ---
  const handleAddExpense = () => {
    if (!isAdmin) return;
    const newId = data.expenses.length > 0 ? Math.max(...data.expenses.map(e => e.id)) + 1 : 1;
    // Otomatis menugaskan biaya baru ini ke semua orang
    const allResidentIds = data.residents.map(r => r.id);
    updateData({ ...data, expenses: [...data.expenses, { id: newId, name: '', amount: 0, paidAmount: 0, hasInstallment: false, assignedTo: allResidentIds }] });
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
          if (field === 'hasInstallment') return { ...e, hasInstallment: value, paidAmount: value ? e.paidAmount : 0 };
          let finalValue = value;
          if (field === 'amount' || field === 'paidAmount') finalValue = Math.max(0, parseInt(value) || 0);
          return { ...e, [field]: finalValue };
        }
        return e;
      })
    });
  };

  const handleToggleExpenseAssignment = (expenseId, residentId) => {
    if (!isAdmin) return;
    updateData({
      ...data,
      expenses: data.expenses.map(e => {
        if (e.id === expenseId) {
          const isAssigned = e.assignedTo.includes(residentId);
          const newAssigned = isAssigned 
            ? e.assignedTo.filter(id => id !== residentId) // Hapus jika sudah ada
            : [...e.assignedTo, residentId]; // Tambah jika belum ada
          return { ...e, assignedTo: newAssigned };
        }
        return e;
      })
    });
  };

  const handleAddResident = () => {
    if (!isAdmin) return;
    const newId = data.residents.length > 0 ? Math.max(...data.residents.map(r => r.id)) + 1 : 1;
    const newResident = { id: newId, name: `Penghuni ${newId}`, phone: '', hasPaid: false, deduction: 0 };
    
    // Tambahkan orang baru ke semua tagihan yang ada agar dia ikut patungan
    const updatedExpenses = data.expenses.map(e => ({ ...e, assignedTo: [...e.assignedTo, newId] }));
    
    updateData({ ...data, residents: [...data.residents, newResident], expenses: updatedExpenses });
  };

  const handleRemoveResident = (id) => {
    if (!isAdmin) return;
    // Hapus juga orang ini dari daftar patungan di tagihan
    const updatedExpenses = data.expenses.map(e => ({ ...e, assignedTo: e.assignedTo.filter(rId => rId !== id) }));
    updateData({ ...data, residents: data.residents.filter(r => r.id !== id), expenses: updatedExpenses });
  };

  const handleUpdateResidentField = (id, field, value) => {
    if (!isAdmin) return;
    updateData({
      ...data,
      residents: data.residents.map(r => {
        if (r.id === id) {
          if (field === 'deduction') return { ...r, [field]: Math.max(0, parseInt(value) || 0) };
          return { ...r, [field]: value };
        }
        return r;
      })
    });
  };

  const handleTogglePaid = (id) => {
    if (!isAdmin) return;
    updateData({ ...data, residents: data.residents.map(r => r.id === id ? { ...r, hasPaid: !r.hasPaid } : r) });
  };

  const handleRestoreDefault = () => {
    if (!isAdmin) return;
    if (!window.confirm("Pulihkan otomatis data default? Data saat ini akan ditimpa.")) return;
    const defaultResidentIds = [1, 2, 3, 4, 5, 6, 7];
    updateData({
      ...data,
      expenses: [
        { id: 1, name: 'WiFi', amount: 280000, paidAmount: 0, hasInstallment: false, assignedTo: [...defaultResidentIds] },
        { id: 2, name: 'Listrik', amount: 200000, paidAmount: 0, hasInstallment: false, assignedTo: [...defaultResidentIds] },
        { id: 3, name: 'Air', amount: 140000, paidAmount: 0, hasInstallment: false, assignedTo: [...defaultResidentIds] },
      ],
      residents: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, name: `Penghuni ${i + 1}`, phone: '', hasPaid: false, deduction: 0 }))
    });
  };

  const handleFinishMonthClick = () => {
    if (!isAdmin) return;
    const allPaid = data.residents.length > 0 && data.residents.every(r => r.hasPaid);
    if (!allPaid) {
      setAlertMsg({ show: true, title: '⚠️ Belum Lunas Semua!', message: 'Masih ada penghuni yang belum membayar.', type: 'error' });
      return;
    }
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
      terkumpul: calc.totalCollected,
      lunas: data.residents.filter(r => r.hasPaid).length,
      totalPenghuni: data.residents.length,
      dateSaved: new Date().toISOString(),
      expensesSnapshot: data.expenses,
      residentsSnapshot: data.residents,
      billsSnapshot: calc.bills // Simpan rincian perhitungan per orang saat itu
    };

    const newData = {
      ...data,
      expenses: data.expenses.map(e => ({ ...e, paidAmount: 0, hasInstallment: false })), // Tagihan kembali utuh (tanpa cicilan)
      residents: data.residents.map(r => ({ ...r, hasPaid: false, deduction: 0 })), // Centang hilang, talangan di-reset 0
      history: [...(data.history || []), historyRecord]
    };
    
    await updateData(newData);
    setShowFinishModal(false);
    setAlertMsg({ show: true, title: '✅ BERHASIL!', message: 'Buku bulan ini telah ditutup dan disimpan ke Riwayat.', type: 'success' });
  };

  const handleDeleteHistory = (e, historyId) => {
    e.stopPropagation();
    if (!isAdmin) return;
    if (window.confirm("Yakin ingin menghapus riwayat ini?")) {
      updateData({ ...data, history: (data.history || []).filter(h => h.id !== historyId) });
    }
  };

  const formatRupiah = (number) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(number);

  const handleAdminLogin = (e) => {
    e.preventDefault();
    if (pinInput === ADMIN_PIN) { setIsAdmin(true); setShowLoginModal(false); setPinInput(''); setLoginError(''); } 
    else { setLoginError('PIN Admin salah!'); }
  };

  const handleAdminLogout = () => { setIsAdmin(false); };

  const getWhatsAppLink = (resident) => {
    let phone = resident.phone || '';
    phone = phone.replace(/\D/g, ''); 
    if (phone.startsWith('0')) phone = '62' + phone.substring(1);
    
    const currentMonth = new Date().toLocaleString('id-ID', { month: 'long', year: 'numeric' });
    const bill = calc.bills[resident.id];
    
    // Bikin rincian text pintar
    let detailsText = bill.details.length > 0 ? bill.details.join(', ') : 'Tidak ada tagihan aktif';
    let msgBody = `Sekadar mengingatkan otomatis dari kas, iuran kontrakan untuk *${currentMonth}* sebesar *${formatRupiah(bill.roundedNet)}* terpantau belum lunas.\n\n*Rincian Kamu:*\n- Beban Patungan: ${detailsText}\n- Total Kotor: ${formatRupiah(bill.gross)}`;
    
    if (bill.deduction > 0) {
      msgBody += `\n- Potongan Talangan: -${formatRupiah(bill.deduction)}`;
    }
    
    const message = `Halo *${resident.name}*! 🙏\n\n${msgBody}\n\nBoleh minta tolong untuk segera diselesaikan yaa ke rekening kas. Terima kasih kerjasamanya! 💸😊`;
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
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
            <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4 mx-auto"><Lock className="w-6 h-6 text-blue-600" /></div>
            <h3 className="text-xl font-bold text-center mb-1">Masuk sebagai Admin</h3>
            <p className="text-sm text-slate-500 text-center mb-6">Masukkan PIN untuk mengedit tagihan</p>
            <form onSubmit={handleAdminLogin}>
              <input type="password" value={pinInput} onChange={(e) => { setPinInput(e.target.value); setLoginError(''); }} placeholder="Masukkan PIN" className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-center tracking-[0.5em] mb-2" autoFocus />
              {loginError && <p className="text-red-500 text-sm text-center font-medium mb-2">{loginError}</p>}
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => {setShowLoginModal(false); setLoginError(''); setPinInput('');}} className="w-full py-2.5 rounded-xl font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">Batal</button>
                <button type="submit" className="w-full py-2.5 rounded-xl font-semibold bg-blue-600 text-white hover:bg-blue-700 transition shadow-md">Masuk</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ALERT */}
      {alertMsg.show && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 z-[60]">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className={`flex items-center justify-center w-12 h-12 rounded-full mb-4 mx-auto ${alertMsg.type === 'error' ? 'bg-red-100' : 'bg-emerald-100'}`}>
              {alertMsg.type === 'error' ? <Info className="w-6 h-6 text-red-600" /> : <CheckCircle2 className="w-6 h-6 text-emerald-600" />}
            </div>
            <h3 className="text-xl font-bold text-center mb-2">{alertMsg.title}</h3>
            <p className="text-sm text-slate-600 text-center mb-6">{alertMsg.message}</p>
            <button onClick={() => setAlertMsg({ ...alertMsg, show: false })} className="w-full py-2.5 rounded-xl font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 transition">Mengerti</button>
          </div>
        </div>
      )}

      {/* MODAL KONFIRMASI TUTUP BULAN */}
      {showFinishModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-full mb-4 mx-auto"><Calendar className="w-6 h-6 text-blue-600" /></div>
            <h3 className="text-xl font-bold text-center mb-1">Tutup Buku Bulan Ini</h3>
            <p className="text-sm text-slate-500 text-center mb-4">Pastikan tidak ada data yang tertinggal.</p>
            <input type="text" value={monthNameInput} onChange={(e) => setMonthNameInput(e.target.value)} placeholder="Contoh: Tagihan Mei 2026" className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none mb-6 text-center font-medium" autoFocus />
            <div className="flex gap-2">
              <button onClick={() => setShowFinishModal(false)} className="w-full py-2.5 rounded-xl font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition">Batal</button>
              <button onClick={confirmFinishMonth} className="w-full py-2.5 rounded-xl font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition shadow-md flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" /> Simpan
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETAIL RIWAYAT */}
      {selectedHistory && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl animate-in fade-in zoom-in-95 duration-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="bg-blue-100 p-2 rounded-lg text-blue-600"><History className="w-5 h-5" /></div>
                <div>
                  <h3 className="text-lg font-bold text-slate-800">{selectedHistory.monthName}</h3>
                  <p className="text-xs text-slate-500">Lunas: {selectedHistory.lunas}/{selectedHistory.totalPenghuni} Orang</p>
                </div>
              </div>
              <button onClick={() => setSelectedHistory(null)} className="text-slate-400 hover:bg-slate-200 p-2 rounded-lg transition-colors"><X className="w-5 h-5" /></button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Receipt className="w-4 h-4 text-blue-500" /> Rincian Biaya Kas</h4>
                <div className="space-y-2">
                  {selectedHistory.expensesSnapshot ? selectedHistory.expensesSnapshot.map(exp => (
                    <div key={exp.id} className="flex justify-between items-center text-sm p-3 bg-slate-50 rounded-xl border border-slate-100">
                      <div>
                        <div className="font-medium text-slate-700">{exp.name}</div>
                        {exp.paidAmount > 0 && <div className="text-[10px] text-blue-500 mt-0.5">Diskon/Cicilan: {formatRupiah(exp.paidAmount)}</div>}
                      </div>
                      <span className="font-bold text-slate-800">{formatRupiah(exp.amount - (exp.paidAmount || 0))}</span>
                    </div>
                  )) : (
                    <div className="text-xs text-slate-400 italic p-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">Arsip versi lama tidak tersedia.</div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Users className="w-4 h-4 text-indigo-500" /> Bukti Pembayaran Penghuni</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {selectedHistory.residentsSnapshot ? selectedHistory.residentsSnapshot.map(res => {
                    // Cari record pembayarannya
                    const historyBill = selectedHistory.billsSnapshot ? selectedHistory.billsSnapshot[res.id] : null;
                    return (
                      <div key={res.id} className="flex flex-col p-2.5 bg-emerald-50 rounded-lg border border-emerald-100">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                          <span className="text-emerald-800 font-medium text-sm">{res.name}</span>
                        </div>
                        {historyBill && (
                          <div className="pl-6 text-[10px] text-emerald-700 flex flex-col">
                            <span>Bayar: {formatRupiah(historyBill.roundedNet)}</span>
                            {historyBill.deduction > 0 && <span>(Potongan Talangan: {formatRupiah(historyBill.deduction)})</span>}
                          </div>
                        )}
                      </div>
                    )
                  }) : (
                    <div className="text-xs text-slate-400 italic p-4 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200 col-span-full">Arsip versi lama tidak tersedia.</div>
                  )}
                </div>
              </div>
            </div>
            
            <div className="p-5 border-t border-slate-100 bg-emerald-500 flex justify-between items-center text-white">
               <span className="text-sm font-medium opacity-90">Total Kas Terkumpul</span>
               <span className="text-xl font-bold">{formatRupiah(selectedHistory.terkumpul)}</span>
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
                {isAdmin ? ( <><ShieldCheck className="w-4 h-4 text-amber-300" /> Mode Admin Aktif</> ) : ( <><Users className="w-4 h-4 text-emerald-300" /> Mode Penghuni (Hanya Lihat)</> )}
              </p>
            </div>
          </div>
          
          {isAdmin ? (
            <button onClick={handleAdminLogout} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all bg-amber-500 text-amber-950 hover:bg-amber-400 shadow-md">Keluar Mode Admin</button>
          ) : (
            <button onClick={() => setShowLoginModal(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all bg-white/20 text-white hover:bg-white/30 backdrop-blur-sm border border-white/20"><Lock className="w-4 h-4" /> Masuk Admin</button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Rincian Biaya (UPDATE: Ada opsi Split Bill) */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Receipt className="text-blue-500 w-5 h-5" />
                  <h2 className="text-lg font-semibold">Rincian Tagihan Kas</h2>
                </div>
                {isAdmin && (
                  <button onClick={handleAddExpense} className="flex items-center gap-1 text-sm bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition font-medium"><Plus className="w-4 h-4" /> Tambah Biaya</button>
                )}
              </div>

              <div className="space-y-5">
                {data.expenses.length === 0 && (
                  <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">Belum ada rincian biaya yang terdaftar.</div>
                )}
                
                {data.expenses.map((expense) => {
                  const isInstallmentActive = expense.hasInstallment ?? (expense.paidAmount > 0);
                  const assignedCount = expense.assignedTo ? expense.assignedTo.length : 0;
                  const activeAmount = Math.max(0, expense.amount - (expense.paidAmount || 0));
                  const costPerPerson = assignedCount > 0 ? (activeAmount / assignedCount) : 0;
                  
                  return (
                    <div key={expense.id} className="p-4 border border-slate-200 rounded-xl bg-slate-50 relative group transition-all">
                      {isAdmin && ( <button onClick={() => handleRemoveExpense(expense.id)} className="absolute -top-3 -right-3 bg-red-100 text-red-500 p-1.5 rounded-full hover:bg-red-500 hover:text-white transition shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100"><Trash2 className="w-4 h-4" /></button> )}
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Nama Biaya</label>
                          <input type="text" value={expense.name} onChange={(e) => handleUpdateExpense(expense.id, 'name', e.target.value)} disabled={!isAdmin} placeholder="Misal: Listrik" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition text-sm disabled:bg-slate-100 disabled:text-slate-600 disabled:border-transparent"/>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Total Tagihan (Rp)</label>
                          <input type="number" value={expense.amount === 0 ? '' : expense.amount} onChange={(e) => handleUpdateExpense(expense.id, 'amount', e.target.value)} disabled={!isAdmin} placeholder="0" className="w-full p-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition text-sm disabled:bg-slate-100 disabled:text-slate-600 disabled:border-transparent"/>
                        </div>
                      </div>

                      {/* AREA SPLIT BILL (Pilih Penanggung Jawab) */}
                      <div className="bg-white p-3 rounded-lg border border-slate-200">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-xs font-medium text-slate-600">Ditanggung oleh: <span className="text-blue-600 font-bold">{assignedCount} Orang</span></span>
                          {assignedCount > 0 && <span className="text-xs text-slate-400">({formatRupiah(costPerPerson)}/org)</span>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {data.residents.map(r => {
                            const isAssigned = expense.assignedTo && expense.assignedTo.includes(r.id);
                            return (
                              <button 
                                key={r.id} 
                                onClick={() => handleToggleExpenseAssignment(expense.id, r.id)}
                                disabled={!isAdmin}
                                className={`px-2 py-1 text-[10px] sm:text-xs font-medium rounded-full transition-all border ${
                                  isAssigned 
                                    ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' 
                                    : 'bg-slate-50 border-slate-200 text-slate-400 opacity-60 hover:opacity-100'
                                } ${!isAdmin && 'cursor-default'}`}
                              >
                                {r.name || `Penghuni ${r.id}`}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {isAdmin && (
                        <div className="mt-4 pt-3 border-t border-slate-200/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <label className="flex items-center gap-3 cursor-pointer">
                            <button type="button" onClick={() => handleUpdateExpense(expense.id, 'hasInstallment', !isInstallmentActive)} className={`w-11 h-6 rounded-full relative transition-colors duration-300 ${isInstallmentActive ? 'bg-blue-500' : 'bg-slate-300'}`}>
                              <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform duration-300 shadow-sm ${isInstallmentActive ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                            <span className="text-sm font-medium text-slate-600 select-none">Sudah dicicil kas?</span>
                          </label>
                          
                          {isInstallmentActive && (
                            <div className="w-full sm:w-1/3 animate-in fade-in slide-in-from-top-2">
                              <div className="relative">
                                <span className="absolute left-3 top-2 text-slate-400 text-sm font-medium">Rp</span>
                                <input type="number" value={expense.paidAmount === 0 ? '' : expense.paidAmount} onChange={(e) => handleUpdateExpense(expense.id, 'paidAmount', e.target.value)} placeholder="0" className="w-full pl-9 p-2 border border-blue-200 bg-blue-50 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none transition text-sm font-medium text-blue-900 placeholder:text-blue-300"/>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tracking Penghuni (UPDATE: Ada Input Talangan & Tagihan Personal) */}
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
                <div className="flex items-center gap-2">
                  <Users className="text-indigo-500 w-5 h-5" />
                  <div>
                    <h2 className="text-lg font-semibold">Status Pembayaran Individu</h2>
                    <p className="text-xs text-slate-500">Tagihan tiap orang menyesuaikan rincian di atas.</p>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={handleAddResident} className="flex items-center gap-1 text-sm bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition font-medium w-max"><Plus className="w-4 h-4" /> Tambah Orang</button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {data.residents.length === 0 && (
                  <div className="col-span-full text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl bg-slate-50">Belum ada data penghuni.</div>
                )}
                
                {data.residents.map((resident) => {
                  const bill = calc.bills[resident.id];
                  
                  return (
                    <div key={resident.id} className={`flex flex-col p-4 border rounded-xl transition-all ${resident.hasPaid ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:border-blue-300'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <button onClick={() => handleTogglePaid(resident.id)} disabled={!isAdmin} className={`flex-shrink-0 transition-colors ${isAdmin ? 'cursor-pointer hover:scale-110' : 'cursor-default'}`}>
                            {resident.hasPaid ? <CheckCircle2 className="w-6 h-6 text-emerald-500" /> : <Circle className="w-6 h-6 text-slate-300 hover:text-blue-400" />}
                          </button>
                          <input type="text" value={resident.name} onChange={(e) => handleUpdateResidentField(resident.id, 'name', e.target.value)} disabled={!isAdmin} className={`w-full bg-transparent text-sm font-bold outline-none truncate ${resident.hasPaid ? 'text-emerald-800' : 'text-slate-700'}`} placeholder="Nama Penghuni"/>
                        </div>
                        {isAdmin && ( <button onClick={() => handleRemoveResident(resident.id)} className="ml-2 text-slate-400 hover:text-red-500 transition-colors p-1"><Trash2 className="w-4 h-4" /></button> )}
                      </div>
                      
                      {/* Rincian Tagihan Personal */}
                      <div className="pl-9 mb-3">
                        <div className={`text-xl font-black tracking-tight mb-1 ${resident.hasPaid ? 'text-emerald-600' : 'text-slate-800'}`}>
                          {formatRupiah(bill.roundedNet)}
                        </div>
                        {bill.roundedNet !== bill.gross && (
                           <div className="text-[10px] text-slate-400 font-medium line-through">{formatRupiah(bill.gross)} (Kotor)</div>
                        )}
                        <div className="text-[10px] text-slate-500 mt-1 flex flex-wrap gap-1">
                          {bill.details.length > 0 ? bill.details.map((d, i) => <span key={i} className="bg-slate-100 px-1.5 py-0.5 rounded">{d}</span>) : <span className="text-slate-400 italic">Bebas Tagihan</span>}
                        </div>
                      </div>
                      
                      {isAdmin && (
                        <div className="pl-9 space-y-2 border-t border-slate-100 pt-3 mt-auto">
                          {/* Input Talangan / Potongan Khusus Admin */}
                          <div>
                            <label className="block text-[10px] font-semibold text-amber-600 mb-1 flex items-center gap-1"><ArrowDownCircle className="w-3 h-3" /> Potongan Talangan / Kasbon</label>
                            <div className="relative">
                               <span className="absolute left-2 top-1.5 text-slate-400 text-xs font-medium">Rp</span>
                               <input type="number" value={resident.deduction === 0 ? '' : resident.deduction} onChange={(e) => handleUpdateResidentField(resident.id, 'deduction', e.target.value)} placeholder="0" className="w-full pl-7 p-1.5 bg-amber-50 border border-amber-200 rounded-lg outline-none text-xs text-amber-900 placeholder:text-amber-300 focus:ring-1 focus:ring-amber-500" />
                            </div>
                          </div>

                          {/* Tombol Nomor WA */}
                          <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-1.5 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-400 transition-all mt-1">
                            <Phone className="w-3 h-3 text-slate-400 ml-1" />
                            <input type="tel" value={resident.phone || ''} onChange={(e) => handleUpdateResidentField(resident.id, 'phone', e.target.value)} placeholder="No. WA (08...)" className="w-full bg-transparent outline-none text-slate-600 placeholder:text-slate-400 font-mono" />
                          </div>
                          {!resident.hasPaid && resident.phone && resident.phone.length >= 10 && bill.roundedNet > 0 && (
                            <a href={getWhatsAppLink(resident)} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-1.5 text-xs bg-[#25D366] hover:bg-[#128C7E] text-white py-1.5 rounded-lg font-medium transition-colors shadow-sm"><MessageCircle className="w-3.5 h-3.5" /> Tagih by WA</a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
                  <div className="text-center py-6 text-slate-400 text-sm bg-slate-50 rounded-xl border border-dashed border-slate-200">Belum ada riwayat.</div>
                ) : (
                  [...data.history].reverse().map((item) => (
                    <div key={item.id} onClick={() => setSelectedHistory(item)} className="p-4 border border-slate-200 rounded-xl bg-white hover:bg-blue-50/50 hover:border-blue-200 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 group transition-all">
                      <div className="flex items-start gap-3">
                        <div className="bg-blue-100 group-hover:bg-blue-500 group-hover:text-white p-2 rounded-lg text-blue-600 transition-colors mt-1"><Calendar className="w-5 h-5" /></div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-800">{item.monthName}</h4>
                            <Eye className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                          </div>
                          <div className="text-xs text-slate-500 mt-1 space-y-0.5"><p>Lunas: {item.lunas}/{item.totalPenghuni} Orang</p></div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto border-t sm:border-0 pt-3 sm:pt-0">
                        <div className="text-left sm:text-right">
                          <div className="text-xs text-slate-500 font-medium mb-1">Total Terkumpul</div>
                          <div className="font-bold text-emerald-600">{formatRupiah(item.terkumpul)}</div>
                        </div>
                        {isAdmin && ( <button onClick={(e) => handleDeleteHistory(e, item.id)} className="text-slate-400 hover:text-red-500 p-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button> )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>

          {/* Sidebar Kanan (Kalkulasi Cerdas) */}
          <div className="space-y-6">
            
            {/* Card Summary Dashboard */}
            <div className="bg-indigo-600 rounded-2xl p-6 text-white shadow-md relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10"><Calculator className="w-32 h-32" /></div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-indigo-100 text-sm font-medium">Ekspektasi Uang Masuk</div>
                </div>
                <div className="text-3xl font-bold tracking-tight mb-1">{formatRupiah(calc.totalExpectedCollection)}</div>
                <div className="text-xs text-indigo-200 mb-6">Jika semua orang bayar lunas</div>
                
                <div className="space-y-3">
                  <div className="bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/10">
                    <div className="text-xs text-indigo-200 mb-1">Total Uang Terkumpul Saat Ini</div>
                    <div className="text-lg font-bold text-emerald-300">{formatRupiah(calc.totalCollected)}</div>
                  </div>
                  
                  <div className="bg-white/10 rounded-xl p-3 backdrop-blur-sm border border-white/10">
                    <div className="text-xs text-indigo-200 mb-1">Total Tagihan Bersih (Kas Keluar)</div>
                    <div className="text-lg font-bold text-amber-200">{formatRupiah(calc.totalCurrent)}</div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-indigo-500/50 flex justify-between items-center text-sm">
                  <span className="text-indigo-200 font-medium">Estimasi Uang Sisa/Kas:</span>
                  <span className="font-bold text-white">{formatRupiah(calc.totalExpectedCollection - calc.totalCurrent)}</span>
                </div>
              </div>
            </div>

            {/* Admin Actions */}
            {isAdmin && (
              <div className="space-y-3">
                {data.expenses.length === 0 && data.residents.length === 0 && (
                  <button onClick={handleRestoreDefault} className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-xl p-4 flex items-center justify-center gap-2 font-semibold transition-all shadow-md"><RefreshCw className="w-5 h-5" /> Pulihkan Data Default</button>
                )}
                <button onClick={handleFinishMonthClick} className={`w-full rounded-xl p-4 flex items-center justify-center gap-2 font-semibold transition-all shadow-md ${data.residents.length > 0 && data.residents.every(r => r.hasPaid) ? 'bg-emerald-500 hover:bg-emerald-600 text-white hover:shadow-lg' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}><CheckCircle2 className="w-5 h-5" /> Selesai Bulan Ini & Simpan</button>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5">
              <div className="flex gap-3">
                <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-800 leading-relaxed space-y-2">
                  <p><strong>Cara Split Bill:</strong> Klik nama penghuni di bawah setiap rincian tagihan kas untuk memasukkan/mengeluarkan mereka dari patungan biaya tersebut.</p>
                  <p><strong>Uang Talangan:</strong> Gunakan kolom "Potongan Talangan" jika ada penghuni yang menalangi uang kas menggunakan uang pribadinya terlebih dahulu.</p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}