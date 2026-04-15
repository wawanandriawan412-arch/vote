/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User,
  signOut
} from 'firebase/auth';
import { 
  doc, 
  setDoc, 
  onSnapshot, 
  collection, 
  query, 
  orderBy, 
  limit, 
  serverTimestamp, 
  runTransaction,
  getDoc,
  where
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { 
  TrendingUp, 
  Users, 
  LogOut, 
  Plus, 
  Minus,
  CheckCircle2,
  AlertCircle,
  RotateCcw
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
// --- Types ---
interface VotingStats {
  totalScore: number;
  voteCount: number;
  targetAudience?: number;
  sessionId?: string;
}

interface VoteEntry {
  id: string;
  value: number;
  userId: string;
  timestamp: any;
  sessionId: string;
}

// --- Audio Helper ---
const playSound = (type: 'vote' | 'win') => {
  const audio = new Audio();
  if (type === 'vote') {
    audio.src = 'https://assets.mixkit.co/active_storage/sfx/2571/2571-preview.mp3'; // Pop/Ding
  } else {
    audio.src = 'https://assets.mixkit.co/active_storage/sfx/1435/1435-preview.mp3'; // Fanfare/Win
  }
  audio.play().catch(e => console.log("Audio play blocked by browser", e));
};

// --- Components ---

const ErrorDisplay = ({ message }: { message: string }) => (
  <motion.div 
    initial={{ opacity: 0, y: -20 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-center gap-3 mb-6"
  >
    <AlertCircle className="w-5 h-5 flex-shrink-0" />
    <p className="text-sm font-medium">{message}</p>
  </motion.div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [stats, setStats] = useState<VotingStats>({ totalScore: 0, voteCount: 0 });
  const [recentVotes, setRecentVotes] = useState<VoteEntry[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [voteValue, setVoteValue] = useState(50);
  const [isVoting, setIsVoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [audienceInput, setAudienceInput] = useState("");
  const [isSettingAudience, setIsSettingAudience] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [hasPlayedWinSound, setHasPlayedWinSound] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Real-time Stats Listener
  useEffect(() => {
    if (!isAuthReady) return;

    const statsRef = doc(db, 'stats', 'global');
    const unsubscribe = onSnapshot(statsRef, (docSnap) => {
      if (docSnap.exists()) {
        const newStats = docSnap.data() as VotingStats;
        
        // Reset local state if session changed
        setStats(prev => {
          if (newStats.sessionId !== prev.sessionId) {
            setHasPlayedWinSound(false);
            setSuccess(false);
          }
          if (newStats.totalScore > prev.totalScore && newStats.sessionId === prev.sessionId) {
            playSound('vote');
          }
          return newStats;
        });
      }
    }, (err) => {
      console.error("Stats listener error:", err);
    });

    return () => unsubscribe();
  }, [isAuthReady]);

  // Win Sound Logic
  useEffect(() => {
    if (stats.targetAudience && stats.sessionId) {
      const maxPossibleScore = stats.targetAudience * 100;
      const progressPercent = (stats.totalScore / maxPossibleScore) * 100;
      if (progressPercent >= 70 && !hasPlayedWinSound) {
        playSound('win');
        setHasPlayedWinSound(true);
      }
    }
  }, [stats.totalScore, stats.targetAudience, stats.sessionId, hasPlayedWinSound]);

  // Check if user has voted in CURRENT session
  useEffect(() => {
    if (!isAuthReady || !user || !stats.sessionId) {
      setHasVoted(false);
      return;
    }

    const voteRef = doc(db, 'votes', `${stats.sessionId}_${user.uid}`);
    const unsubscribe = onSnapshot(voteRef, (docSnap) => {
      setHasVoted(docSnap.exists());
    });

    return () => unsubscribe();
  }, [isAuthReady, user, stats.sessionId]);

  // Real-time Recent Votes Listener
  useEffect(() => {
    if (!isAuthReady || !stats.sessionId) return;

    const votesRef = collection(db, 'votes');
    const q = query(
      votesRef, 
      where('sessionId', '==', stats.sessionId),
      orderBy('timestamp', 'desc'), 
      limit(10)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const votes: VoteEntry[] = [];
      snapshot.forEach((doc) => {
        votes.push({ id: doc.id, ...doc.data() } as VoteEntry);
      });
      setRecentVotes(votes);
    }, (err) => {
      // If index is missing, it might fail initially. 
      // For simplicity in this demo, we'll fallback to a simpler query if needed
      console.error("Votes listener error:", err);
    });

    return () => unsubscribe();
  }, [isAuthReady, stats.sessionId]);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setError(null);
    } catch (err: any) {
      console.error("Login error:", err);
      setError("Gagal masuk dengan Google.");
    }
  };

  const handleLogout = () => signOut(auth);

  const setupAudience = async () => {
    const count = parseInt(audienceInput);
    if (isNaN(count) || count <= 0) {
      setError("Masukkan jumlah audiens yang valid.");
      return;
    }

    setIsSettingAudience(true);
    try {
      const newSessionId = Date.now().toString();
      await setDoc(doc(db, 'stats', 'global'), {
        totalScore: 0,
        voteCount: 0,
        targetAudience: count,
        sessionId: newSessionId
      });
      setError(null);
    } catch (err) {
      console.error("Setup error:", err);
      setError("Gagal mengatur jumlah audiens.");
    } finally {
      setIsSettingAudience(false);
    }
  };

  const handleReset = async () => {
    setShowResetModal(false);
    setIsResetting(true);
    try {
      await setDoc(doc(db, 'stats', 'global'), {
        totalScore: 0,
        voteCount: 0,
        targetAudience: null,
        sessionId: null
      });
      setHasPlayedWinSound(false);
      setError(null);
    } catch (err) {
      console.error("Reset error:", err);
      setError("Gagal mereset data.");
    } finally {
      setIsResetting(false);
    }
  };

  const submitVote = async () => {
    if (!user || hasVoted || !stats.sessionId) return;
    setIsVoting(true);
    setError(null);
    setSuccess(false);

    try {
      await runTransaction(db, async (transaction) => {
        const statsRef = doc(db, 'stats', 'global');
        const statsDoc = await transaction.get(statsRef);
        
        if (!statsDoc.exists()) throw new Error("Stats not initialized");
        
        const currentStats = statsDoc.data() as VotingStats;
        const newVoteRef = doc(db, 'votes', `${currentStats.sessionId}_${user.uid}`);
        
        transaction.set(newVoteRef, {
          value: voteValue,
          userId: user.uid,
          timestamp: serverTimestamp(),
          sessionId: currentStats.sessionId
        });

        transaction.update(statsRef, {
          totalScore: currentStats.totalScore + voteValue,
          voteCount: currentStats.voteCount + 1,
          lastVoteValue: voteValue
        });
      });

      setSuccess(true);
    } catch (err: any) {
      console.error("Voting error:", err);
      setError("Gagal mengirim suara. Silakan coba lagi.");
    } finally {
      setIsVoting(false);
    }
  };

  const isAdmin = user?.email === "wawanandriawan412@gmail.com";
  const maxPossibleScore = (stats.targetAudience || 0) * 100;
  const progressPercent = maxPossibleScore > 0 ? Math.min(100, (stats.totalScore / maxPossibleScore) * 100) : 0;
  const thresholdPercent = 70; // 70% to pass
  const isPassed = progressPercent >= thresholdPercent;

  if (!isAuthReady) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="animate-pulse text-blue-500 font-bold tracking-widest uppercase">Initializing...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30 overflow-x-hidden">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-900/20 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-900/10 rounded-full blur-[120px]" />
      </div>

      {/* Header - Always Visible */}
      <header className="relative z-20 border-b border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-blue-500 to-blue-700 p-2 rounded-xl shadow-lg shadow-blue-500/20">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <span className="text-2xl font-black tracking-tighter uppercase italic">X-FACTOR VOTE</span>
          </div>
          
          <div className="flex items-center gap-4">
            {/* Reset Button - Always Visible for testing */}
            <button 
              onClick={() => setShowResetModal(true)}
              disabled={isResetting}
              className="flex items-center gap-2 bg-red-600/10 text-red-500 px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest border border-red-500/20 hover:bg-red-600 hover:text-white transition-all shadow-lg shadow-red-600/5"
            >
              <RotateCcw className={`w-3 h-3 ${isResetting ? 'animate-spin' : ''}`} />
              RESET & MULAI BARU
            </button>

            {user ? (
              <div className="flex items-center gap-4 pl-4 border-l border-white/10">
                <div className="hidden sm:block text-right">
                  <p className="text-sm font-black leading-none">{user.displayName}</p>
                  <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest font-bold">{user.email}</p>
                </div>
                <button onClick={handleLogout} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            ) : (
              <button onClick={handleLogin} className="bg-white text-black px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest hover:bg-gray-200 transition-all active:scale-95">
                LOGIN GOOGLE
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Reset Confirmation Modal */}
      <AnimatePresence>
        {showResetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#111] p-8 rounded-[32px] border border-white/10 max-w-sm w-full text-center shadow-2xl"
            >
              <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h3 className="text-2xl font-black mb-2 uppercase italic">Reset Voting?</h3>
              <p className="text-gray-400 mb-8 font-medium">Semua data voting saat ini akan dihapus dan sesi baru akan dimulai.</p>
              <div className="flex gap-4">
                <button 
                  onClick={() => setShowResetModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl font-bold bg-white/5 hover:bg-white/10 transition-colors"
                >
                  BATAL
                </button>
                <button 
                  onClick={handleReset}
                  className="flex-1 px-4 py-3 rounded-xl font-bold bg-red-600 hover:bg-red-700 text-white transition-colors"
                >
                  YA, RESET
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      {!stats.targetAudience ? (
        /* Setup Screen */
        <div className="min-h-[calc(100vh-80px)] flex items-center justify-center p-6 relative z-10">
          <motion.div 
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            className="max-w-md w-full bg-[#111] p-12 rounded-[50px] border border-white/10 text-center shadow-2xl"
          >
            <div className="bg-gradient-to-br from-blue-500 to-blue-700 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-blue-500/30">
              <Users className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-4xl font-black mb-3 tracking-tighter uppercase italic">SESI BARU</h1>
            <p className="text-gray-500 mb-10 font-medium">Masukkan jumlah audiens untuk memulai kompetisi voting.</p>
            
            <div className="space-y-6">
              <div className="relative">
                <input 
                  type="number" 
                  placeholder="0"
                  value={audienceInput}
                  onChange={(e) => setAudienceInput(e.target.value)}
                  className="w-full bg-black/50 border-2 border-white/5 rounded-3xl px-6 py-6 text-center text-5xl font-black text-blue-500 focus:border-blue-500 outline-none transition-all placeholder:text-white/5"
                />
                <span className="absolute bottom-4 left-0 right-0 text-[10px] font-black text-gray-600 uppercase tracking-widest">JUMLAH AUDIENS</span>
              </div>
              
              {error && <p className="text-red-400 text-sm font-bold bg-red-400/10 py-2 rounded-xl">{error}</p>}
              
              <button 
                onClick={setupAudience}
                disabled={isSettingAudience}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black py-5 rounded-3xl text-xl transition-all active:scale-[0.98] shadow-2xl shadow-blue-600/30 uppercase italic tracking-tighter"
              >
                {isSettingAudience ? "MEMPROSES..." : "MULAI SEKARANG"}
              </button>
            </div>
          </motion.div>
        </div>
      ) : (
        /* Voting Screen */
        <>
          <main className="relative z-10 max-w-6xl mx-auto px-6 py-12">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
              
              {/* Left: X-Factor Meter */}
              <div className="lg:col-span-4 flex flex-col items-center">
                <div className="relative w-32 h-[500px] bg-[#111] rounded-full border-4 border-white/10 p-2 shadow-2xl">
                  {/* Threshold Line */}
                  <div 
                    className="absolute left-0 right-0 border-t-2 border-dashed border-white/30 z-20"
                    style={{ bottom: `${thresholdPercent}%` }}
                  >
                    <span className="absolute -right-16 -top-3 text-[10px] font-black text-white/50 uppercase tracking-tighter">AMBANG BATAS</span>
                  </div>

                  {/* Meter Fill */}
                  <div className="absolute inset-2 rounded-full overflow-hidden bg-black/50">
                    <motion.div 
                      initial={{ height: 0 }}
                      animate={{ height: `${progressPercent}%` }}
                      transition={{ type: "spring", stiffness: 50 }}
                      className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t ${isPassed ? 'from-green-600 to-green-400 shadow-[0_0_40px_rgba(34,197,94,0.4)]' : 'from-blue-600 to-blue-400 shadow-[0_0_40px_rgba(37,99,235,0.4)]'}`}
                    >
                      {/* Bubbles effect */}
                      <div className="absolute inset-0 opacity-30">
                        {[...Array(5)].map((_, i) => (
                          <motion.div 
                            key={i}
                            animate={{ y: [-20, -100], opacity: [0, 1, 0] }}
                            transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
                            className="absolute w-2 h-2 bg-white rounded-full"
                            style={{ left: `${20 + i * 15}%`, bottom: '0%' }}
                          />
                        ))}
                      </div>
                    </motion.div>
                  </div>
                </div>
                <div className="mt-8 text-center">
                  <motion.div 
                    key={stats.totalScore}
                    initial={{ scale: 1.2 }}
                    animate={{ scale: 1 }}
                    className="text-6xl font-black tracking-tighter"
                  >
                    {stats.totalScore.toLocaleString()}
                  </motion.div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.3em] mt-2">TOTAL POIN</p>
                </div>
              </div>

              {/* Right: Interaction & Messages */}
              <div className="lg:col-span-8 space-y-8">
                
                {/* Success Message */}
                <AnimatePresence>
                  {isPassed && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.8, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      className="bg-gradient-to-r from-green-600 to-emerald-600 p-8 rounded-[40px] text-center shadow-2xl shadow-green-900/20 border border-white/20"
                    >
                      <CheckCircle2 className="w-16 h-16 text-white mx-auto mb-4" />
                      <h2 className="text-3xl font-black mb-2 uppercase italic tracking-tight">CONGRATULATIONS!</h2>
                      <p className="text-lg font-medium text-white/90">Selamat, karya anda layak untuk dipamerkan!</p>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Voting Card */}
                <div className="bg-[#111] p-10 rounded-[40px] border border-white/5 shadow-2xl">
                  {!user ? (
                    <div className="text-center py-10">
                      <h2 className="text-2xl font-black mb-4 uppercase italic">Siap Memberikan Suara?</h2>
                      <button onClick={handleLogin} className="bg-blue-600 text-white px-10 py-4 rounded-2xl font-black uppercase tracking-widest hover:bg-blue-700 transition-all active:scale-95 shadow-xl shadow-blue-600/20">
                        LOGIN UNTUK VOTE
                      </button>
                    </div>
                  ) : hasVoted ? (
                    <div className="text-center py-10">
                      <div className="bg-white/5 w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 className="w-10 h-10 text-green-500" />
                      </div>
                      <h2 className="text-2xl font-black mb-2 uppercase italic">SUARA ANDA TERKUNCI</h2>
                      <p className="text-gray-500 font-medium">Terima kasih telah berpartisipasi dalam voting ini.</p>
                    </div>
                  ) : (
                    <div className="space-y-10">
                      <div className="flex items-center justify-between">
                        <h2 className="text-2xl font-black uppercase italic tracking-tight">BERIKAN NILAI</h2>
                        <div className="bg-blue-600/10 text-blue-500 px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-blue-500/20">
                          1X KESEMPATAN
                        </div>
                      </div>

                      <div className="flex items-center gap-8">
                        <button onClick={() => setVoteValue(v => Math.max(1, v-5))} className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all active:scale-90 border border-white/5">
                          <Minus className="w-6 h-6" />
                        </button>
                        <div className="flex-1 text-center">
                          <motion.span 
                            key={voteValue}
                            initial={{ y: 10, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            className="text-8xl font-black tracking-tighter text-blue-500"
                          >
                            {voteValue}
                          </motion.span>
                        </div>
                        <button onClick={() => setVoteValue(v => Math.min(100, v+5))} className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-all active:scale-90 border border-white/5">
                          <Plus className="w-6 h-6" />
                        </button>
                      </div>

                      <input 
                        type="range" min="1" max="100" value={voteValue}
                        onChange={(e) => setVoteValue(parseInt(e.target.value))}
                        className="w-full h-3 bg-white/5 rounded-full appearance-none cursor-pointer accent-blue-600"
                      />

                      <button 
                        onClick={submitVote}
                        disabled={isVoting}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-black py-5 rounded-2xl text-xl transition-all active:scale-[0.98] shadow-2xl shadow-blue-600/30 uppercase italic tracking-tighter"
                      >
                        {isVoting ? "MENGIRIM..." : "KIRIM SUARA SEKARANG"}
                      </button>
                    </div>
                  )}
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-[#111] p-6 rounded-[32px] border border-white/5">
                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">PARTISIPASI</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black">{stats.voteCount}</span>
                      <span className="text-xs text-gray-600 font-bold">/ {stats.targetAudience}</span>
                    </div>
                  </div>
                  <div className="bg-[#111] p-6 rounded-[32px] border border-white/5">
                    <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1">PROGRESS</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black">{progressPercent.toFixed(0)}%</span>
                      <span className="text-xs text-gray-600 font-bold">MENUJU GOAL</span>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </main>

          {/* Recent Activity Footer */}
          <div className="max-w-6xl mx-auto px-6 pb-20">
            <div className="bg-[#111] p-8 rounded-[40px] border border-white/5">
              <h3 className="text-xs font-black text-gray-500 uppercase tracking-[0.4em] mb-6 text-center">LIVE ACTIVITY FEED</h3>
              <div className="flex flex-wrap justify-center gap-4">
                <AnimatePresence>
                  {recentVotes.map((vote) => (
                    <motion.div 
                      key={vote.id}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="bg-white/5 px-4 py-2 rounded-xl border border-white/5 flex items-center gap-3"
                    >
                      <span className="text-blue-500 font-black">+{vote.value}</span>
                      <span className="text-[10px] font-bold text-gray-600">#{vote.id.slice(0,4)}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
