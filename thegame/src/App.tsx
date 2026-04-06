/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { GameEngine } from './gameEngine';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const handleLog = (msg: string) => {
      setLogs(prev => {
        const newLogs = [...prev, ...msg.split('\n')];
        return newLogs.slice(-8);
      });
    };
    const handleScore = (s: number) => setScore(s);
    const handleGameOver = () => { setGameOver(true); setIsPlaying(false); };

    engineRef.current = new GameEngine(canvasRef.current, handleLog, handleScore, handleGameOver);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        engineRef.current?.jump();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); engineRef.current?.stop(); };
  }, []);

  const startGame = () => {
    setGameOver(false); setIsPlaying(true); setLogs([]); engineRef.current?.start();
  };

  return (
    <div className="w-full h-screen bg-gray-900 flex items-center justify-center font-mono overflow-hidden">
      <div className="relative w-full h-full overflow-hidden">
        <canvas ref={canvasRef} width={800} height={400} className="block w-full h-full cursor-pointer" style={{ objectFit: 'cover', imageRendering: 'pixelated' }} onClick={() => engineRef.current?.jump()} />
        
        <div className="absolute top-12 right-8 w-[22rem] bg-black/70 border-2 border-pink-500/50 rounded-xl p-5 text-sm text-pink-300 pointer-events-none shadow-2xl backdrop-blur-sm">
          <div className="mb-3 pb-2 border-b-2 border-pink-500/50 font-bold text-pink-400 flex justify-between text-base tracking-wider">
            <span>NODE_MONITOR_HUD</span><span>SCORE: {score}</span>
          </div>
          <div className="flex flex-col gap-1.5 h-48 overflow-hidden justify-end font-medium leading-relaxed">
            {logs.map((log, i) => <div key={i} className="opacity-90 drop-shadow-md">{log}</div>)}
            {logs.length === 0 && <div className="opacity-50 italic text-center mt-auto">Awaiting telemetry data...</div>}
          </div>
        </div>

        {!isPlaying && !gameOver && (
          <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center text-white">
            <h1 className="text-4xl font-bold text-pink-400 mb-4 tracking-widest">NODE RUNNER</h1>
            <p className="mb-6 text-pink-200">Press Space or Tap to Jump</p>
            <button onClick={startGame} className="px-6 py-2 bg-pink-500 hover:bg-pink-600 text-white font-bold rounded shadow-lg transition-colors">START MONITORING</button>
          </div>
        )}

        {gameOver && (
          <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center text-white">
            <h2 className="text-4xl font-bold text-red-500 mb-2">SYSTEM FAILURE</h2>
            <p className="text-xl mb-6 text-pink-200">Final Score: {score}</p>
            <button onClick={startGame} className="px-6 py-2 bg-pink-500 hover:bg-pink-600 text-white font-bold rounded shadow-lg transition-colors">REBOOT SYSTEM</button>
          </div>
        )}
      </div>
    </div>
  );
}
