import React, { useState } from 'react';

interface CricYuvaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onShowToast: (msg: string) => void;
}

interface PlayerStats {
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  outStatus: string;
}

interface BowlerStats {
  name: string;
  overs: number;
  ballsInOver: number;
  runsConceded: number;
  wickets: number;
  maidens: number;
}

export const CricYuvaModal: React.FC<CricYuvaModalProps> = ({
  isOpen,
  onClose,
  onShowToast
}) => {
  // Screens: 'dashboard' | 'setup' | 'toss' | 'scoring' | 'result'
  const [screen, setScreen] = useState<'dashboard' | 'setup' | 'toss' | 'scoring' | 'result'>('dashboard');

  // Match setup form state
  const [teamAName, setTeamAName] = useState('Mumbai Indians');
  const [teamBName, setTeamBName] = useState('Chennai Super Kings');
  const [totalOvers, setTotalOvers] = useState<number>(5);
  const [ballType, setBallType] = useState('Tennis');

  // Toss form state
  const [tossWinner, setTossWinner] = useState('');
  const [tossDecision, setTossDecision] = useState<'Batting' | 'Bowling'>('Batting');
  const [strikerName, setStrikerName] = useState('Rohit');
  const [nonStrikerName, setNonStrikerName] = useState('Virat');
  const [bowlerName, setBowlerName] = useState('Bumrah');
  const [ballDirection, setBallDirection] = useState('Straight');

  // Live match state
  const [battingTeam, setBattingTeam] = useState('');
  const [bowlingTeam, setBowlingTeam] = useState('');
  const [innings, setInnings] = useState<1 | 2>(1);
  const [runs, setRuns] = useState(0);
  const [wickets, setWickets] = useState(0);
  const [completedOvers, setCompletedOvers] = useState(0);
  const [ballsInOver, setBallsInOver] = useState(0);
  const [targetRuns, setTargetRuns] = useState<number | null>(null);

  const [striker, setStriker] = useState<PlayerStats>({
    name: 'Rohit',
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    outStatus: 'Not Out'
  });
  const [nonStriker, setNonStriker] = useState<PlayerStats>({
    name: 'Virat',
    runs: 0,
    balls: 0,
    fours: 0,
    sixes: 0,
    outStatus: 'Not Out'
  });
  const [currentBowler, setCurrentBowler] = useState<BowlerStats>({
    name: 'Bumrah',
    overs: 0,
    ballsInOver: 0,
    runsConceded: 0,
    wickets: 0,
    maidens: 0
  });

  const [thisOverBalls, setThisOverBalls] = useState<string[]>([]);
  const [resultMessage, setResultMessage] = useState('');

  // Next Bowler / Batsman prompt modals
  const [showNextBowlerModal, setShowNextBowlerModal] = useState(false);
  const [nextBowlerInput, setNextBowlerInput] = useState('');

  const [showNextBatsmanModal, setShowNextBatsmanModal] = useState(false);
  const [nextBatsmanInput, setNextBatsmanInput] = useState('');

  const [showNoBallPrompt, setShowNoBallPrompt] = useState(false);

  if (!isOpen) return null;

  const startSetup = () => {
    setScreen('setup');
  };

  const handleSetupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamAName.trim() || !teamBName.trim()) {
      onShowToast('कृपया दोनों टीमों का नाम दर्ज करें!');
      return;
    }
    if (teamAName.trim().toLowerCase() === teamBName.trim().toLowerCase()) {
      onShowToast('दोनों टीमें अलग-अलग होनी चाहिए!');
      return;
    }
    setTossWinner(teamAName);
    setScreen('toss');
  };

  const handleStartMatch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!strikerName.trim() || !nonStrikerName.trim() || !bowlerName.trim()) {
      onShowToast('कृपया सभी ओपनिंग खिलाड़ियों के नाम दर्ज करें!');
      return;
    }

    const winner = tossWinner || teamAName;
    const isWinnerBatting = tossDecision === 'Batting';
    const batting = isWinnerBatting ? winner : (winner === teamAName ? teamBName : teamAName);
    const bowling = batting === teamAName ? teamBName : teamAName;

    setBattingTeam(batting);
    setBowlingTeam(bowling);
    setInnings(1);
    setRuns(0);
    setWickets(0);
    setCompletedOvers(0);
    setBallsInOver(0);
    setTargetRuns(null);
    setThisOverBalls([]);

    setStriker({
      name: strikerName.trim(),
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      outStatus: 'Not Out'
    });

    setNonStriker({
      name: nonStrikerName.trim(),
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      outStatus: 'Not Out'
    });

    setCurrentBowler({
      name: bowlerName.trim(),
      overs: 0,
      ballsInOver: 0,
      runsConceded: 0,
      wickets: 0,
      maidens: 0
    });

    setScreen('scoring');
    onShowToast(`मैच शुरू: ${batting} vs ${bowling}`);
  };

  const checkMatchEnd = (newRuns: number, newWickets: number, newCompletedOvers: number) => {
    if (innings === 2 && targetRuns !== null) {
      if (newRuns >= targetRuns) {
        setResultMessage(`🏆 ${battingTeam} ने यह मैच जीत लिया!`);
        setScreen('result');
        return true;
      }
      if (newWickets >= 10 || newCompletedOvers >= totalOvers) {
        if (newRuns === targetRuns - 1) {
          setResultMessage('🤝 मैच टाई (Tie) हो गया!');
        } else {
          setResultMessage(`🏆 ${bowlingTeam} ने यह मैच जीत लिया!`);
        }
        setScreen('result');
        return true;
      }
    } else if (innings === 1) {
      if (newWickets >= 10 || newCompletedOvers >= totalOvers) {
        // Transition to 2nd innings
        const target = newRuns + 1;
        setTargetRuns(target);
        onShowToast(`पहली पारी समाप्त! ${bowlingTeam} को जीत के लिए ${target} रन चाहिए।`);
        // Swap teams
        const nextBatting = bowlingTeam;
        const nextBowling = battingTeam;
        setBattingTeam(nextBatting);
        setBowlingTeam(nextBowling);
        setInnings(2);
        setRuns(0);
        setWickets(0);
        setCompletedOvers(0);
        setBallsInOver(0);
        setThisOverBalls([]);

        setStriker({
          name: 'Opener 1',
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          outStatus: 'Not Out'
        });
        setNonStriker({
          name: 'Opener 2',
          runs: 0,
          balls: 0,
          fours: 0,
          sixes: 0,
          outStatus: 'Not Out'
        });
        setCurrentBowler({
          name: 'New Bowler',
          overs: 0,
          ballsInOver: 0,
          runsConceded: 0,
          wickets: 0,
          maidens: 0
        });
        return true;
      }
    }
    return false;
  };

  const handleLegalBall = (runCount: number, isWicket: boolean = false, wicketType: string = 'Bowled') => {
    const newRuns = runs + runCount;
    let newWickets = wickets;

    // Update striker stats
    setStriker(prev => {
      const addedFours = runCount === 4 ? 1 : 0;
      const addedSixes = runCount === 6 ? 1 : 0;
      return {
        ...prev,
        runs: prev.runs + runCount,
        balls: prev.balls + 1,
        fours: prev.fours + addedFours,
        sixes: prev.sixes + addedSixes,
        outStatus: isWicket ? wicketType : 'Not Out'
      };
    });

    if (isWicket) {
      newWickets += 1;
      setWickets(newWickets);
    }

    // Update bowler stats
    const nextBallsInOver = ballsInOver + 1;
    setCurrentBowler(prev => ({
      ...prev,
      runsConceded: prev.runsConceded + runCount,
      ballsInOver: nextBallsInOver === 6 ? 0 : nextBallsInOver,
      overs: nextBallsInOver === 6 ? prev.overs + 1 : prev.overs,
      wickets: isWicket ? prev.wickets + 1 : prev.wickets
    }));

    setRuns(newRuns);
    setThisOverBalls(prev => [...prev, isWicket ? 'W' : String(runCount)]);

    // Strike rotation on odd runs (1 or 3)
    if (runCount % 2 !== 0 && !isWicket) {
      setStriker(nonStriker);
      setNonStriker(striker);
    }

    if (isWicket) {
      if (newWickets < 10) {
        setNextBatsmanInput('');
        setShowNextBatsmanModal(true);
      }
    }

    // Over completion
    if (nextBallsInOver === 6) {
      const newCompleted = completedOvers + 1;
      setCompletedOvers(newCompleted);
      setBallsInOver(0);

      // Strike rotation at end of over
      setStriker(nonStriker);
      setNonStriker(striker);

      const isEnded = checkMatchEnd(newRuns, newWickets, newCompleted);
      if (!isEnded && newCompleted < totalOvers) {
        setNextBowlerInput('');
        setShowNextBowlerModal(true);
      }
    } else {
      checkMatchEnd(newRuns, newWickets, completedOvers);
    }
  };

  const handleWide = () => {
    setRuns(prev => prev + 1);
    setCurrentBowler(prev => ({
      ...prev,
      runsConceded: prev.runsConceded + 1
    }));
    setThisOverBalls(prev => [...prev, 'WD']);
    checkMatchEnd(runs + 1, wickets, completedOvers);
  };

  const handleNoBall = (batsmanRuns: number) => {
    const totalAdded = 1 + batsmanRuns;
    setRuns(prev => prev + totalAdded);
    setStriker(prev => ({
      ...prev,
      runs: prev.runs + batsmanRuns,
      balls: prev.balls + 1,
      fours: prev.fours + (batsmanRuns === 4 ? 1 : 0),
      sixes: prev.sixes + (batsmanRuns === 6 ? 1 : 0)
    }));
    setCurrentBowler(prev => ({
      ...prev,
      runsConceded: prev.runsConceded + totalAdded
    }));
    setThisOverBalls(prev => [...prev, batsmanRuns > 0 ? `NB+${batsmanRuns}` : 'NB']);

    if (batsmanRuns % 2 !== 0) {
      setStriker(nonStriker);
      setNonStriker(striker);
    }
    setShowNoBallPrompt(false);
    checkMatchEnd(runs + totalAdded, wickets, completedOvers);
  };

  const confirmNextBowler = () => {
    const name = nextBowlerInput.trim() || 'Bowler';
    setCurrentBowler({
      name,
      overs: 0,
      ballsInOver: 0,
      runsConceded: 0,
      wickets: 0,
      maidens: 0
    });
    setThisOverBalls([]);
    setShowNextBowlerModal(false);
  };

  const confirmNextBatsman = () => {
    const name = nextBatsmanInput.trim() || 'New Batsman';
    setStriker({
      name,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      outStatus: 'Not Out'
    });
    setShowNextBatsmanModal(false);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fade-in">
      <div className="w-full max-w-xl bg-gradient-to-br from-[#1b1424] to-[#120b20] border-2 border-[#b987e0] rounded-[28px] p-4 sm:p-6 text-white shadow-2xl relative max-h-[92vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-[#352044] hover:bg-[#ff8500] text-white font-bold text-sm flex items-center justify-center transition-colors cursor-pointer z-10"
          title="Close Cric Yuva"
        >
          ✕
        </button>

        {/* Branding Header */}
        <div className="flex items-center gap-3 border-b border-[#523765] pb-3 mb-4">
          <img
            src="/cric-yuva-2-logo.png"
            alt="Cric Yuva"
            className="w-12 h-12 rounded-full border-2 border-[#ff8500] object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = '/icon-512.png';
            }}
          />
          <div>
            <h2 className="text-xl font-black text-white m-0">
              CRIC <span className="text-[#ff8500]">YUVA 2</span>
            </h2>
            <small className="text-[#eadcff] text-[10px] tracking-widest font-semibold uppercase">
              Play Together, Win Together • Live Scoring Engine
            </small>
          </div>
        </div>

        {/* SCREEN 1: DASHBOARD */}
        {screen === 'dashboard' && (
          <div className="space-y-4 text-center py-2">
            <div className="p-6 rounded-2xl bg-gradient-to-br from-[#352044] to-[#201527] border border-[#62447a] shadow-lg">
              <span className="text-4xl block mb-2">🏏</span>
              <h3 className="text-2xl font-black text-white mb-1">
                Cricket Match Scorer
              </h3>
              <p className="text-[#eadcff] text-xs sm:text-sm max-w-md mx-auto">
                Real-time ball-by-ball scorepad, toss manager, striker rotation, and live statistics.
              </p>
              <button
                onClick={startSetup}
                className="mt-5 w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-[#ff8500] to-[#ffb300] hover:opacity-95 text-white font-extrabold text-base tracking-wide shadow-[0_8px_22px_rgba(255,140,0,0.3)] transition-all cursor-pointer active:scale-95"
              >
                + START NEW MATCH
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="p-4 rounded-xl bg-[#2b1c38] border border-[#5b3b70]">
                <div className="text-xs text-[#dacde5] font-semibold">Trophy Format</div>
                <div className="text-base font-bold text-white mt-1">Limited Overs T5 - T50</div>
                <div className="text-[11px] text-[#ffb300] mt-1">Automatic strike swap</div>
              </div>
              <div className="p-4 rounded-xl bg-[#2b1c38] border border-[#5b3b70]">
                <div className="text-xs text-[#dacde5] font-semibold">Ball Ticker</div>
                <div className="text-base font-bold text-white mt-1">Real-time Over Log</div>
                <div className="text-[11px] text-[#38d85b] mt-1">Runs, Wickets, Extras</div>
              </div>
            </div>
          </div>
        )}

        {/* SCREEN 2: SETUP */}
        {screen === 'setup' && (
          <form onSubmit={handleSetupSubmit} className="space-y-4">
            <h3 className="text-lg font-bold text-[#ffb300]">Create Match</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-[#2b1c38] border border-[#5b3b70]">
                <label className="text-xs font-bold text-[#eadcff] block mb-1">Team A</label>
                <input
                  type="text"
                  value={teamAName}
                  onChange={(e) => setTeamAName(e.target.value)}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#ffb300]"
                  placeholder="Team A Name"
                  required
                />
              </div>

              <div className="p-3.5 rounded-xl bg-[#2b1c38] border border-[#5b3b70]">
                <label className="text-xs font-bold text-[#eadcff] block mb-1">Team B</label>
                <input
                  type="text"
                  value={teamBName}
                  onChange={(e) => setTeamBName(e.target.value)}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-[#ffb300]"
                  placeholder="Team B Name"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-xl bg-[#2b1c38] border border-[#5b3b70]">
                <label className="text-xs font-bold text-[#eadcff] block mb-1">Overs</label>
                <select
                  value={totalOvers}
                  onChange={(e) => setTotalOvers(Number(e.target.value))}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm outline-none"
                >
                  <option value={2}>2 Overs</option>
                  <option value={5}>5 Overs</option>
                  <option value={10}>10 Overs</option>
                  <option value={20}>20 Overs (T20)</option>
                  <option value={50}>50 Overs (ODI)</option>
                </select>
              </div>

              <div className="p-3.5 rounded-xl bg-[#2b1c38] border border-[#5b3b70]">
                <label className="text-xs font-bold text-[#eadcff] block mb-1">Ball Type</label>
                <select
                  value={ballType}
                  onChange={(e) => setBallType(e.target.value)}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm outline-none"
                >
                  <option value="Tennis">Tennis Ball</option>
                  <option value="Leather">Leather Ball</option>
                  <option value="Rubber">Rubber Ball</option>
                </select>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setScreen('dashboard')}
                className="py-3 px-4 rounded-xl bg-[#292929] text-[#aaa] font-bold text-sm cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#ff8500] to-[#ffb300] text-white font-extrabold text-sm shadow-md cursor-pointer"
              >
                NEXT: TOSS & PLAYERS →
              </button>
            </div>
          </form>
        )}

        {/* SCREEN 3: TOSS & PLAYERS */}
        {screen === 'toss' && (
          <form onSubmit={handleStartMatch} className="space-y-4">
            <h3 className="text-lg font-bold text-[#ffb300]">Toss & Opening Setup</h3>

            <div className="p-3.5 rounded-xl bg-[#2b1c38] border border-[#5b3b70] space-y-3">
              <div>
                <label className="text-xs font-bold text-[#eadcff] block mb-1">Toss Winner</label>
                <select
                  value={tossWinner}
                  onChange={(e) => setTossWinner(e.target.value)}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm outline-none"
                >
                  <option value={teamAName}>{teamAName}</option>
                  <option value={teamBName}>{teamBName}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-[#eadcff] block mb-1">Elected To</label>
                <select
                  value={tossDecision}
                  onChange={(e) => setTossDecision(e.target.value as 'Batting' | 'Bowling')}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm outline-none"
                >
                  <option value="Batting">Batting First</option>
                  <option value="Bowling">Bowling First</option>
                </select>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-[#2b1c38] border border-[#5b3b70] space-y-3">
              <div className="text-xs font-bold text-amber-400">Opening Batsmen & Bowler</div>
              <div>
                <label className="text-xs text-[#dacde5] block mb-1">Striker (On Strike)</label>
                <input
                  type="text"
                  value={strikerName}
                  onChange={(e) => setStrikerName(e.target.value)}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm"
                  placeholder="Striker Name"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-[#dacde5] block mb-1">Non-Striker</label>
                <input
                  type="text"
                  value={nonStrikerName}
                  onChange={(e) => setNonStrikerName(e.target.value)}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm"
                  placeholder="Non-Striker Name"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-[#dacde5] block mb-1">Opening Bowler</label>
                <input
                  type="text"
                  value={bowlerName}
                  onChange={(e) => setBowlerName(e.target.value)}
                  className="w-full bg-[#17111e] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm"
                  placeholder="Opening Bowler Name"
                  required
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setScreen('setup')}
                className="py-3 px-4 rounded-xl bg-[#292929] text-[#aaa] font-bold text-sm cursor-pointer"
              >
                Back
              </button>
              <button
                type="submit"
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#ff8500] to-[#ffb300] text-white font-extrabold text-sm shadow-md cursor-pointer"
              >
                START SCORING 🏏
              </button>
            </div>
          </form>
        )}

        {/* SCREEN 4: LIVE SCORING PAD */}
        {screen === 'scoring' && (
          <div className="space-y-3">
            {/* Top Score Banner */}
            <div className="p-4 rounded-2xl bg-gradient-to-r from-[#2b1c38] to-[#171022] border border-[#62447a] shadow-lg">
              <div className="flex justify-between items-center text-xs text-[#eadcff] font-semibold mb-1">
                <span>Innings {innings}: {battingTeam}</span>
                <span>Bowling: {bowlingTeam}</span>
              </div>

              <div className="flex justify-between items-end">
                <div>
                  <span className="text-4xl sm:text-5xl font-black text-white">
                    {runs} / {wickets}
                  </span>
                  <div className="text-sm font-bold text-[#ffb300] mt-0.5">
                    Overs: {completedOvers}.{ballsInOver} / {totalOvers}
                  </div>
                </div>

                {targetRuns !== null && (
                  <div className="text-right bg-[#3d2355] px-3 py-1.5 rounded-lg border border-[#ffb300]/40">
                    <div className="text-[10px] text-[#dacde5] font-semibold uppercase">Target</div>
                    <div className="text-xl font-black text-[#63d636]">{targetRuns}</div>
                    <div className="text-[10px] text-gray-300">
                      Need {Math.max(0, targetRuns - runs)} in {Math.max(0, (totalOvers * 6) - (completedOvers * 6 + ballsInOver))}b
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Batsmen on Crease */}
            <div className="p-3 rounded-xl bg-[#251c31] border border-[#523765] space-y-1.5 text-xs">
              <div className="flex justify-between items-center text-amber-300 font-bold border-b border-[#523765]/60 pb-1">
                <span>Batsmen</span>
                <span>R (B) • 4s • 6s</span>
              </div>
              <div className="flex justify-between items-center text-white font-semibold">
                <span>* {striker.name} (Striker)</span>
                <span>{striker.runs} ({striker.balls}) [4s:{striker.fours} 6s:{striker.sixes}]</span>
              </div>
              <div className="flex justify-between items-center text-gray-300">
                <span>{nonStriker.name}</span>
                <span>{nonStriker.runs} ({nonStriker.balls}) [4s:{nonStriker.fours} 6s:{nonStriker.sixes}]</span>
              </div>
            </div>

            {/* Current Bowler */}
            <div className="p-2.5 rounded-xl bg-[#1b1424] border border-[#523765] text-xs flex justify-between items-center text-[#dacde5]">
              <span>🔴 Bowler: <strong className="text-white">{currentBowler.name}</strong></span>
              <span>
                {currentBowler.overs}.{currentBowler.ballsInOver} ov • {currentBowler.runsConceded} r • {currentBowler.wickets} w
              </span>
            </div>

            {/* Over Ball Strip */}
            <div className="p-2 rounded-xl bg-[#0e0a14] border border-[#443058] flex items-center gap-2 overflow-x-auto min-h-[42px]">
              <span className="text-[11px] font-bold text-gray-400 shrink-0">This Over:</span>
              <div className="flex items-center gap-1.5 flex-1">
                {thisOverBalls.length === 0 ? (
                  <span className="text-xs text-gray-500 italic">No balls yet in this over</span>
                ) : (
                  thisOverBalls.map((b, i) => (
                    <span
                      key={i}
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                        b === 'W'
                          ? 'bg-red-600 text-white'
                          : b === '4' || b === '6'
                          ? 'bg-[#ff8500] text-black'
                          : b.startsWith('NB') || b === 'WD'
                          ? 'bg-amber-500 text-black'
                          : 'bg-[#291b36] text-white border border-[#523765]'
                      }`}
                    >
                      {b}
                    </span>
                  ))
                )}
              </div>
            </div>

            {/* Ball Direction Selector */}
            <div className="flex items-center gap-2 text-xs">
              <label className="text-gray-400 font-semibold shrink-0">Direction:</label>
              <select
                value={ballDirection}
                onChange={(e) => setBallDirection(e.target.value)}
                className="bg-[#21182b] border border-[#67497c] rounded-lg px-2 py-1 text-white text-xs outline-none flex-1"
              >
                <option value="Straight">Straight (Long Off / On)</option>
                <option value="Cover">Cover / Extra Cover</option>
                <option value="Point">Point / Backward Point</option>
                <option value="MidWicket">Mid Wicket / Cow Corner</option>
                <option value="SquareLeg">Square Leg / Fine Leg</option>
                <option value="ThirdMan">Third Man</option>
              </select>
            </div>

            {/* Scoring Buttons Keypad */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              {[0, 1, 2, 3].map(run => (
                <button
                  key={run}
                  onClick={() => handleLegalBall(run)}
                  className="py-3 rounded-xl bg-[#322340] hover:bg-[#443058] text-white font-extrabold text-lg active:scale-95 transition-transform cursor-pointer border border-[#5b3b70]"
                >
                  {run}
                </button>
              ))}

              <button
                onClick={() => handleLegalBall(4)}
                className="py-3 rounded-xl bg-gradient-to-r from-[#ff8500] to-[#ffb300] text-black font-black text-lg active:scale-95 transition-transform cursor-pointer shadow-sm"
              >
                4
              </button>
              <button
                onClick={() => handleLegalBall(6)}
                className="py-3 rounded-xl bg-gradient-to-r from-[#ff8500] to-[#ffb300] text-black font-black text-lg active:scale-95 transition-transform cursor-pointer shadow-sm"
              >
                6
              </button>
              <button
                onClick={handleWide}
                className="py-3 rounded-xl bg-[#4b3363] hover:bg-[#5f417d] text-amber-300 font-extrabold text-sm active:scale-95 transition-transform cursor-pointer border border-[#74469a]"
              >
                WIDE
              </button>
              <button
                onClick={() => setShowNoBallPrompt(true)}
                className="py-3 rounded-xl bg-[#4b3363] hover:bg-[#5f417d] text-amber-300 font-extrabold text-sm active:scale-95 transition-transform cursor-pointer border border-[#74469a]"
              >
                NO BALL
              </button>

              <button
                onClick={() => handleLegalBall(0, true, 'Bowled')}
                className="col-span-2 py-3 rounded-xl bg-red-700 hover:bg-red-600 text-white font-black text-sm active:scale-95 transition-transform cursor-pointer shadow-md"
              >
                ⚡ WICKET (OUT)
              </button>

              <button
                onClick={() => {
                  setStriker(nonStriker);
                  setNonStriker(striker);
                  onShowToast('बल्लेबाजों की स्ट्राइक बदल दी गई!');
                }}
                className="col-span-2 py-3 rounded-xl bg-[#21182b] hover:bg-[#2e213b] text-white font-bold text-xs active:scale-95 transition-transform cursor-pointer border border-[#67497c]"
              >
                ⇄ Swap Strike
              </button>
            </div>
          </div>
        )}

        {/* SCREEN 5: MATCH RESULT */}
        {screen === 'result' && (
          <div className="space-y-5 text-center py-4">
            <div className="p-6 rounded-2xl bg-[#2b1c38] border-2 border-[#ff8500] shadow-2xl">
              <span className="text-5xl block mb-3">🏆</span>
              <h3 className="text-2xl font-black text-[#ffb300] mb-2">
                MATCH FINISHED
              </h3>
              <p className="text-lg font-bold text-white mb-4">
                {resultMessage}
              </p>
              <div className="text-sm text-gray-300 bg-[#171022] p-3 rounded-xl max-w-sm mx-auto mb-4 border border-[#523765]">
                <div className="flex justify-between">
                  <span>Match Format:</span>
                  <span className="font-bold text-white">{totalOvers} Overs</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Ball Type:</span>
                  <span className="font-bold text-white">{ballType}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setScreen('setup');
                  }}
                  className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-[#ff8500] to-[#ffb300] text-black font-black text-sm shadow-md cursor-pointer"
                >
                  PLAY ANOTHER MATCH 🏏
                </button>
                <button
                  onClick={onClose}
                  className="py-3 px-4 rounded-xl bg-[#292929] text-white font-bold text-sm cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* POPUP MODAL: NEXT BOWLER */}
        {showNextBowlerModal && (
          <div className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4">
            <div className="w-full max-w-xs bg-[#241830] border-2 border-[#ff8500] rounded-2xl p-4 text-center shadow-xl">
              <h4 className="text-base font-bold text-amber-400 mb-1">
                ओवर पूरा हुआ!
              </h4>
              <p className="text-xs text-gray-300 mb-3">अगले बॉलर का नाम दर्ज करें:</p>
              <input
                type="text"
                value={nextBowlerInput}
                onChange={(e) => setNextBowlerInput(e.target.value)}
                placeholder="Next Bowler Name"
                className="w-full bg-[#150f1d] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm mb-3 outline-none focus:border-[#ff8500]"
                autoFocus
              />
              <button
                onClick={confirmNextBowler}
                className="w-full py-2.5 rounded-xl bg-[#ff8500] text-black font-extrabold text-sm"
              >
                SUBMIT BOWLER
              </button>
            </div>
          </div>
        )}

        {/* POPUP MODAL: NEXT BATSMAN */}
        {showNextBatsmanModal && (
          <div className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4">
            <div className="w-full max-w-xs bg-[#241830] border-2 border-red-500 rounded-2xl p-4 text-center shadow-xl">
              <h4 className="text-base font-bold text-red-400 mb-1">
                विकेट गिरा!
              </h4>
              <p className="text-xs text-gray-300 mb-3">नए बल्लेबाज का नाम दर्ज करें:</p>
              <input
                type="text"
                value={nextBatsmanInput}
                onChange={(e) => setNextBatsmanInput(e.target.value)}
                placeholder="Next Batsman Name"
                className="w-full bg-[#150f1d] border border-[#67497c] rounded-lg px-3 py-2 text-white text-sm mb-3 outline-none focus:border-red-500"
                autoFocus
              />
              <button
                onClick={confirmNextBatsman}
                className="w-full py-2.5 rounded-xl bg-red-600 text-white font-extrabold text-sm"
              >
                SUBMIT BATSMAN
              </button>
            </div>
          </div>
        )}

        {/* POPUP MODAL: NO BALL RUNS */}
        {showNoBallPrompt && (
          <div className="fixed inset-0 z-60 bg-black/80 flex items-center justify-center p-4">
            <div className="w-full max-w-xs bg-[#241830] border-2 border-amber-400 rounded-2xl p-4 text-center shadow-xl">
              <h4 className="text-base font-bold text-amber-400 mb-1">
                नो-बॉल (No Ball)
              </h4>
              <p className="text-xs text-gray-300 mb-3">बल्लेबाज ने कितने रन बनाए?</p>
              <div className="grid grid-cols-5 gap-1.5 mb-3">
                {[0, 1, 2, 4, 6].map(r => (
                  <button
                    key={r}
                    onClick={() => handleNoBall(r)}
                    className="py-2 rounded-lg bg-[#3d2355] hover:bg-[#ff8500] hover:text-black text-white font-black text-sm border border-[#67497c]"
                  >
                    {r}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowNoBallPrompt(false)}
                className="text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
