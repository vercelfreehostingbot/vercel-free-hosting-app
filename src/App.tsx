import React, { useEffect, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  AlertCircle,
  Radio,
  Database,
  ShieldCheck,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  Send,
  Users,
  Layers,
  Terminal,
  Globe,
  Zap,
  KeyRound,
} from 'lucide-react';

interface SystemStatus {
  status: string;
  app_name?: string;
  bot_username: string;
  super_admin_id?: number;
  webhook?: {
    url?: string;
    has_custom_certificate?: boolean;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
    max_connections?: number;
  };
  watchdog?: {
    target_webhook: string;
    last_heartbeat: number;
    consecutive_failures: number;
    is_active: boolean;
    mode: string;
  };
  services: {
    telegram: boolean;
    github: boolean;
    vercel: boolean;
    firebase: boolean;
  };
  stats?: {
    totalUsers: number;
    totalProjects: number;
    activeProjects: number;
    todayDeployments: number;
    bannedUsers: number;
    firebaseConnected: boolean;
  };
  polling?: {
    isPolling: boolean;
    lastUpdateId: number;
  };
}

export default function App() {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [lastChecked, setLastChecked] = useState<string>(new Date().toLocaleTimeString());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isConnectingWebhook, setIsConnectingWebhook] = useState(false);
  const [webhookMsg, setWebhookMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setLastChecked(new Date().toLocaleTimeString());
      }
    } catch {
      // Fallback
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const connectWebhook = async () => {
    setIsConnectingWebhook(true);
    setWebhookMsg(null);
    try {
      const res = await fetch('/api/set-webhook', { method: 'POST' });
      const json = await res.json();
      if (json.ok) {
        setWebhookMsg({ type: 'success', text: '✅ Webhook সফলভাবে Telegram-এ যুক্ত হয়েছে! বট এখন সক্রিয়।' });
      } else {
        setWebhookMsg({ type: 'error', text: `❌ ${json.description || json.error || 'Webhook সেট করা যায়নি'}` });
      }
      await checkStatus();
    } catch (err: any) {
      setWebhookMsg({ type: 'error', text: `❌ নেটওয়ার্ক এরর: ${err.message}` });
    } finally {
      setIsConnectingWebhook(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const isFirebaseActive = data?.services?.firebase || data?.stats?.firebaseConnected;
  const botHandle = data?.bot_username ? data.bot_username.replace('@', '') : 'Vercel_Free_Hosting_Bot';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-start p-4 sm:p-8 font-sans">
      <div className="max-w-2xl w-full space-y-6">
        {/* Main Status Header Card */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 flex items-center justify-center shadow-lg">
                <Bot className="w-8 h-8 text-emerald-400" />
              </div>
              <span className="absolute -bottom-1 -right-1 flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-slate-900" />
              </span>
            </div>

            <div className="space-y-1.5 flex-1">
              <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Engine Active & Ready</span>
              </div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                {data?.app_name || '𝗩𝗘𝗥𝗖𝗘𝗟 𝗙𝗥𝗘𝗘 𝗛𝗢𝗦𝗧𝗜𝗡𝗚 𝗕𝗢𝗧'}
              </h1>
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                <a
                  href={`https://t.me/${botHandle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-lg text-sky-400 text-xs font-semibold transition"
                >
                  <Send className="w-3 h-3" />
                  <span>@{botHandle}</span>
                  <ExternalLink className="w-3 h-3 opacity-60" />
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* 1-Click Telegram Webhook Connect Action */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-900/90 border border-sky-500/30 rounded-2xl p-5 shadow-lg space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-bold text-white">১-ক্লিকে টেলিগ্রাম বট সক্রিয় করুন</h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                ভার্সেলে ডিপ্লয় করার পর টেলিগ্রাম যাতে আপনার বটে মেসেজ পাঠাতে পারে, সেজন্য নিচের বাটনে ক্লিক করুন।
              </p>
            </div>
            <button
              onClick={connectWebhook}
              disabled={isConnectingWebhook}
              className="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
            >
              {isConnectingWebhook ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>কানেক্ট হচ্ছে...</span>
                </>
              ) : (
                <>
                  <Globe className="w-4 h-4" />
                  <span>কানেক্ট Webhook</span>
                </>
              )}
            </button>
          </div>

          {webhookMsg && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                webhookMsg.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {webhookMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span>{webhookMsg.text}</span>
            </div>
          )}
        </div>

        {/* 1-Click Copyable Credentials & IDs Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              ⚡️ এক ক্লিকে কপি করুন (1-Click Copy Quick Items)
            </h3>
            <span className="text-[11px] text-slate-500">Tap copy icon</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            {/* Super Admin ID */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase font-semibold text-amber-400">Super Admin ID</div>
                <div className="font-mono text-slate-200 text-xs">
                  {data?.super_admin_id || 6919025708}
                </div>
              </div>
              <button
                onClick={() =>
                  copyToClipboard(
                    String(data?.super_admin_id || 6919025708),
                    'admin_id'
                  )
                }
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition flex items-center gap-1"
              >
                {copiedKey === 'admin_id' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="text-[10px]">
                  {copiedKey === 'admin_id' ? 'Copied!' : 'Copy'}
                </span>
              </button>
            </div>

            {/* Active Bot Username */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase font-semibold text-sky-400">Bot Username</div>
                <div className="font-mono text-slate-200 text-xs">
                  @{botHandle}
                </div>
              </div>
              <button
                onClick={() => copyToClipboard(`@${botHandle}`, 'bot_user')}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition flex items-center gap-1"
              >
                {copiedKey === 'bot_user' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="text-[10px]">
                  {copiedKey === 'bot_user' ? 'Copied!' : 'Copy'}
                </span>
              </button>
            </div>

            {/* Admin Command */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase font-semibold text-purple-400">Admin Command</div>
                <div className="font-mono text-slate-200 text-xs">/admin</div>
              </div>
              <button
                onClick={() => copyToClipboard('/admin', 'admin_cmd')}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition flex items-center gap-1"
              >
                {copiedKey === 'admin_cmd' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="text-[10px]">
                  {copiedKey === 'admin_cmd' ? 'Copied!' : 'Copy'}
                </span>
              </button>
            </div>

            {/* Start Command */}
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3 flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase font-semibold text-emerald-400">Start Command</div>
                <div className="font-mono text-slate-200 text-xs">/start</div>
              </div>
              <button
                onClick={() => copyToClipboard('/start', 'start_cmd')}
                className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 transition flex items-center gap-1"
              >
                {copiedKey === 'start_cmd' ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span className="text-[10px]">
                  {copiedKey === 'start_cmd' ? 'Copied!' : 'Copy'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Webhook Management Card */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-sky-400" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                🌐 Telegram Webhook Configuration
              </h3>
            </div>
            {data?.webhook?.url ? (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold">
                Webhook Active
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[11px] font-semibold">
                Webhook Pending
              </span>
            )}
          </div>

          <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-3.5 text-xs space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <span className="text-slate-400">Current Webhook:</span>
              <span className="font-mono text-slate-200 break-all">
                {data?.webhook?.url || 'কানেক্ট করা হয়নি (উপরে "কানেক্ট Webhook" চাপুন)'}
              </span>
            </div>
            {data?.webhook?.pending_update_count !== undefined && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Pending Updates:</span>
                <span className="font-mono text-emerald-400">{data.webhook.pending_update_count}</span>
              </div>
            )}
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
              <span className="text-slate-400">24/7 Watchdog Daemon:</span>
              <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Permanent Self-Healing Active (Protected)
              </span>
            </div>
          </div>
        </div>

        {/* Environment Keys Status Check */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-purple-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
              🔑 Environment Variables Status
            </h3>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className={`p-3 rounded-xl border ${data?.services?.telegram ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
              <div className="font-bold">BOT_TOKEN</div>
              <div className="text-[10px] opacity-80">{data?.services?.telegram ? 'Connected' : 'Missing'}</div>
            </div>

            <div className={`p-3 rounded-xl border ${data?.services?.github ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
              <div className="font-bold">GITHUB_TOKEN</div>
              <div className="text-[10px] opacity-80">{data?.services?.github ? 'Connected' : 'Missing'}</div>
            </div>

            <div className={`p-3 rounded-xl border ${data?.services?.vercel ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-rose-500/10 border-rose-500/30 text-rose-400'}`}>
              <div className="font-bold">VERCEL_TOKEN</div>
              <div className="text-[10px] opacity-80">{data?.services?.vercel ? 'Connected' : 'Missing'}</div>
            </div>

            <div className={`p-3 rounded-xl border ${isFirebaseActive ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-amber-500/10 border-amber-500/30 text-amber-400'}`}>
              <div className="font-bold">FIREBASE</div>
              <div className="text-[10px] opacity-80">{isFirebaseActive ? 'Connected' : 'Optional'}</div>
            </div>
          </div>
        </div>

        {/* Live System Telemetry Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span>Users</span>
            </div>
            <div className="text-lg font-bold text-white">
              {data?.stats?.totalUsers ?? 0}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Layers className="w-3.5 h-3.5 text-sky-400" />
              <span>Projects</span>
            </div>
            <div className="text-lg font-bold text-white">
              {data?.stats?.totalProjects ?? 0}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span>Deployments</span>
            </div>
            <div className="text-lg font-bold text-white">
              {data?.stats?.todayDeployments ?? 0}
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3.5">
            <div className="flex items-center gap-2 text-slate-400 text-xs mb-1">
              <ShieldCheck className="w-3.5 h-3.5 text-red-400" />
              <span>Banned</span>
            </div>
            <div className="text-lg font-bold text-white">
              {data?.stats?.bannedUsers ?? 0}
            </div>
          </div>
        </div>

        {/* Service Integrations Health */}
        <div className="grid grid-cols-2 gap-3 text-left">
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                isFirebaseActive
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-emerald-500/10 text-emerald-400'
              }`}
            >
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Database
              </div>
              <div className="text-xs font-semibold text-slate-200">
                {isFirebaseActive ? 'Firestore Live' : 'Durable Storage'}
              </div>
            </div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Admin Engine
              </div>
              <div className="text-xs font-semibold text-slate-200">
                Full Control Active
              </div>
            </div>
          </div>
        </div>

        {/* Footer info & manual refresh */}
        <div className="pt-2 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>Telegram Webhook Serverless Ready</span>
          </div>

          <div className="flex items-center gap-3">
            <span>Last sync: {lastChecked}</span>
            <button
              onClick={checkStatus}
              className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition cursor-pointer"
              title="Refresh status"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
