import React, { useState } from 'react';
import { Download, Mic, Shield, Sparkles, Volume2, X, CheckCircle, ExternalLink, HelpCircle } from 'lucide-react';

interface HiRamModalProps {
  isOpen: boolean;
  onClose: () => void;
  apkUrl?: string;
  onShowToast: (msg: string) => void;
}

export const HiRamModal: React.FC<HiRamModalProps> = ({
  isOpen,
  onClose,
  apkUrl = '/HI-RAM.apk',
  onShowToast,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'commands' | 'setup' | 'security'>('overview');
  const [simulatedStatus, setSimulatedStatus] = useState<string>('Ready • Tap a command or mic');
  const [transcript, setTranscript] = useState<string>('Namaste! Say "Hi Ram" to command.');

  if (!isOpen) return null;

  const handleCommandClick = (cmd: string, reply: string) => {
    setTranscript(cmd);
    setSimulatedStatus('Processing…');
    setTimeout(() => {
      setSimulatedStatus('Command Executed: ' + reply);
      if ('speechSynthesis' in window) {
        try {
          const utterance = new SpeechSynthesisUtterance(reply);
          utterance.lang = 'hi-IN';
          window.speechSynthesis.speak(utterance);
        } catch {
          // Ignore audio errors in iframe
        }
      }
      onShowToast(`Hi Ram: ${reply}`);
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 backdrop-blur-sm sm:p-5">
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-[#1f3a66] bg-[#070e1e] text-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#1f3a66] bg-[#0d192e] px-5 py-4">
          <div className="flex items-center gap-3">
            <img
              src="/icon-512.png"
              alt="Hi Ram Robot"
              className="h-10 w-10 rounded-xl border border-[#4cc9f0] object-cover shadow-[0_0_12px_rgba(76,201,240,0.3)]"
            />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black tracking-wide text-white">HI RAM</h2>
                <span className="rounded-full bg-[#4cc9f0]/20 px-2 py-0.5 text-[10px] font-bold text-[#4cc9f0]">
                  Native Android Operator
                </span>
              </div>
              <p className="text-xs text-[#a3b8d7]">Voice Controlled Mobile Operator • Wake Word: &quot;Hi Ram&quot;</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#14233c] text-gray-300 hover:bg-red-900/60 hover:text-white"
            title="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-[#1f3a66] bg-[#091322] px-3">
          {[
            { id: 'overview', label: 'Overview & Try' },
            { id: 'commands', label: 'Voice Commands' },
            { id: 'setup', label: 'Accessibility & Setup' },
            { id: 'security', label: 'Security & Auth' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex-1 py-2.5 text-xs font-bold transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-[#4cc9f0] text-[#4cc9f0]'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Interactive Demo Mic Card */}
              <div className="flex flex-col items-center rounded-2xl border border-[#1f3a66] bg-[#0d192e] p-5 text-center">
                <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-[#4cc9f0]/15 px-3 py-1 text-xs font-bold text-[#4cc9f0]">
                  <Sparkles size={13} />
                  <span>Wake Word: &quot;Hi Ram&quot; • Offline Architecture</span>
                </div>

                <div className="relative my-4 flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-tr from-[#1688ff] to-[#4cc9f0] shadow-[0_0_30px_rgba(76,201,240,0.4)]">
                  <Mic size={38} className="text-white" />
                </div>

                <div className="text-xs font-semibold text-[#8da4c4]">{simulatedStatus}</div>
                <div className="mt-1 max-w-md rounded-xl bg-[#070e1e] px-4 py-2 text-sm font-bold text-white">
                  &ldquo;{transcript}&rdquo;
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => handleCommandClick('YouTube kholo', 'YouTube khol raha hoon.')}
                    className="rounded-full bg-[#14233c] px-3 py-1 text-xs font-semibold text-gray-200 hover:border hover:border-[#4cc9f0]"
                  >
                    ▶ YouTube kholo
                  </button>
                  <button
                    onClick={() => handleCommandClick('WhatsApp kholo', 'WhatsApp open kar raha hoon.')}
                    className="rounded-full bg-[#14233c] px-3 py-1 text-xs font-semibold text-gray-200 hover:border hover:border-[#4cc9f0]"
                  >
                    💬 WhatsApp kholo
                  </button>
                  <button
                    onClick={() => handleCommandClick('Flashlight on karo', 'Flashlight on kar di hai.')}
                    className="rounded-full bg-[#14233c] px-3 py-1 text-xs font-semibold text-gray-200 hover:border hover:border-[#4cc9f0]"
                  >
                    🔦 Flashlight on
                  </button>
                  <button
                    onClick={() => handleCommandClick('Battery kitni hai?', 'Battery 84% hai aur phone normal hai.')}
                    className="rounded-full bg-[#14233c] px-3 py-1 text-xs font-semibold text-gray-200 hover:border hover:border-[#4cc9f0]"
                  >
                    🔋 Battery kitni hai?
                  </button>
                  <button
                    onClick={() => handleCommandClick('Music chalao', 'Music chala raha hoon.')}
                    className="rounded-full bg-[#14233c] px-3 py-1 text-xs font-semibold text-gray-200 hover:border hover:border-[#4cc9f0]"
                  >
                    🎵 Music chalao
                  </button>
                  <button
                    onClick={() => handleCommandClick('Home screen par jao', 'Home screen par ja rahe hain.')}
                    className="rounded-full bg-[#14233c] px-3 py-1 text-xs font-semibold text-gray-200 hover:border hover:border-[#4cc9f0]"
                  >
                    🏠 Home screen
                  </button>
                </div>
              </div>

              {/* Highlights */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[#1f3a66] bg-[#0d192e] p-3.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-[#4cc9f0]">
                    <CheckCircle size={14} /> Full Mobile Operator
                  </h4>
                  <p className="mt-1 text-[11px] text-[#9bb1d0]">
                    Controls hardware flashlight, volume, battery status, contacts, and opens installed apps with Hindi &amp; English natural commands.
                  </p>
                </div>

                <div className="rounded-xl border border-[#1f3a66] bg-[#0d192e] p-3.5">
                  <h4 className="flex items-center gap-1.5 text-xs font-extrabold text-[#4cc9f0]">
                    <Shield size={14} /> Offline &amp; Privacy First
                  </h4>
                  <p className="mt-1 text-[11px] text-[#9bb1d0]">
                    Zero continuous cloud streaming. Wake-word spots offline. Sensitive actions require device PIN/biometric authentication.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'commands' && (
            <div className="space-y-3">
              <p className="text-xs text-[#a3b8d7]">
                Hi Ram understands Hindi, English, and Hinglish commands naturally. Here are the core actions:
              </p>

              <div className="space-y-2">
                {[
                  { cmd: 'YouTube kholo / search [topic]', desc: 'Opens YouTube or searches directly for videos' },
                  { cmd: 'WhatsApp kholo', desc: 'Launches WhatsApp messenger' },
                  { cmd: 'Music chalao / Gana bajao', desc: 'Starts media playback with default music player' },
                  { cmd: 'Flashlight on karo / off karo', desc: 'Toggles camera torch hardware on or off' },
                  { cmd: 'Battery kitni hai?', desc: 'Queries BatteryManager for percentage and charging state' },
                  { cmd: 'Volume badhao / kam karo / mute', desc: 'Adjusts Android stream volume with UI feedback' },
                  { cmd: 'Contact search karo [naam]', desc: 'Finds contact name and phone number from address book' },
                  { cmd: 'Call karo [naam]', desc: 'Prepares phone call with on-screen confirmation & device auth' },
                  { cmd: 'Home screen par jao', desc: 'Navigates to Home screen via AccessibilityService' },
                  { cmd: 'Peeche jao / Back jao', desc: 'Triggers system Back action via Accessibility' },
                  { cmd: 'Recent apps dikhao', desc: 'Opens recent app switcher overview' },
                  { cmd: 'Notification dikhao', desc: 'Pulls down the system notification shade' },
                  { cmd: 'Screen par [button] click karo', desc: 'Finds and clicks visible text elements on screen' },
                ].map((item, idx) => (
                  <div key={idx} className="flex items-start justify-between rounded-xl border border-[#182d4f] bg-[#0d192e] p-3">
                    <div>
                      <div className="text-xs font-bold text-[#4cc9f0]">&ldquo;{item.cmd}&rdquo;</div>
                      <div className="mt-0.5 text-[11px] text-[#8ea4c2]">{item.desc}</div>
                    </div>
                    <button
                      onClick={() => handleCommandClick(item.cmd, item.desc)}
                      className="ml-3 shrink-0 rounded-lg bg-[#14233c] px-2.5 py-1 text-[10px] font-bold text-gray-300 hover:bg-[#1a345c]"
                    >
                      Test
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'setup' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#1f3a66] bg-[#0d192e] p-4">
                <h3 className="text-sm font-bold text-white">Android Accessibility Service Setup</h3>
                <p className="mt-1 text-xs text-[#9bb1d0]">
                  To navigate Home, Back, Recent Apps, and tap screen elements without touching your phone, Android requires you to enable the Accessibility Service in Android Settings.
                </p>
                <div className="mt-3 space-y-1.5 text-xs text-[#a8bcd9]">
                  <div>1. Open <strong>Android Settings</strong> &rarr; <strong>Accessibility</strong>.</div>
                  <div>2. Select <strong>Installed Services</strong> &rarr; <strong>Hi Ram</strong>.</div>
                  <div>3. Toggle the switch to <strong>ON</strong> and grant the prompt.</div>
                  <div>4. You can disable this anytime in the same settings menu.</div>
                </div>
              </div>

              <div className="rounded-xl border border-[#1f3a66] bg-[#0d192e] p-4">
                <h3 className="text-sm font-bold text-white">Foreground Microphone Service</h3>
                <p className="mt-1 text-xs text-[#9bb1d0]">
                  When active, Hi Ram shows an ongoing notification with dedicated <strong>Pause</strong> and <strong>Stop</strong> buttons so you are always aware of microphone usage. Android battery optimization can be disabled for continuous listening.
                </p>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-[#1f3a66] bg-[#0d192e] p-4">
                <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-400">
                  <Shield size={16} /> Device Authentication &amp; Privacy Policy
                </h3>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-[#9bb1d0]">
                  <li>
                    <strong>No False Security Claims:</strong> Voice recognition alone is not used as authentication (due to replay attack vulnerabilities). Sensitive actions (calls, settings modifications) require phone PIN, pattern, or biometric authentication.
                  </li>
                  <li>
                    <strong>Zero Audio Recording Storage:</strong> Raw microphone audio is processed in volatile memory only and never saved or transmitted.
                  </li>
                  <li>
                    <strong>Safe AI Layer:</strong> The optional AI command processor runs against a strict local action whitelist, preventing arbitrary shell execution or sandbox escapes.
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#1f3a66] bg-[#0d192e] px-5 py-3.5">
          <div className="text-[11px] text-[#8ea4c2]">
            Build source in <code className="rounded bg-[#14233c] px-1 text-[#4cc9f0]">/hi-ram-android/</code>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/hi-ram-android-source.zip"
              download="hi-ram-android-source.zip"
              className="flex items-center gap-1.5 rounded-xl border border-[#1f3a66] bg-[#14233c] px-3.5 py-2 text-xs font-bold text-[#b8c7e0] shadow hover:bg-[#1a345c] hover:text-white"
            >
              <Download size={13} /> Source ZIP
            </a>
            <a
              href={apkUrl}
              download="HI-RAM.apk"
              className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#1688ff] to-[#4cc9f0] px-4 py-2 text-xs font-bold text-[#041122] shadow hover:brightness-110"
            >
              <Download size={14} /> Download Hi Ram APK (6.2 MB)
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};
