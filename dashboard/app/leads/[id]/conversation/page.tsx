'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { fetchApi, safeArray, API_URL } from '@/lib/api';
import type { ConversationResponse, ConversationMessage } from '@/types/api';
import { ErrorState } from '@/components/LoadingState';
import { ArrowLeft, Image as ImageIcon, FileText, Mic, Sparkles } from 'lucide-react';
import { getToken } from '@/lib/auth';

function formatTime(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

function formatDateKey(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function MediaPill({ type, duration }: { type: string; duration?: number }) {
  const icon =
    type === 'audio' ? <Mic className="w-3 h-3" /> :
    type === 'image' ? <ImageIcon className="w-3 h-3" /> :
    <FileText className="w-3 h-3" />;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 uppercase">
      {icon} {type}
      {duration ? ` · ${duration}s` : ''}
    </span>
  );
}

function MessageBubble({ msg }: { msg: ConversationMessage }) {
  const isAdvisor = msg.sender === 'asesor';
  const bubbleClass = isAdvisor
    ? 'bg-emerald-100 text-slate-900 rounded-tr-sm'
    : 'bg-white text-slate-900 border border-slate-200 rounded-tl-sm';
  const containerClass = isAdvisor ? 'justify-end' : 'justify-start';

  const hasMedia = ['audio', 'image', 'video', 'document'].includes(msg.message_type);
  const transcript = msg.transcription_text;
  const confidence = msg.transcription_confidence as number | undefined;
  const isLowConf = confidence !== undefined && confidence < 0.80;

  return (
    <div className={`flex ${containerClass} mb-2 px-2`}>
      <div className={`max-w-[78%] md:max-w-[60%] rounded-2xl px-3 py-2 shadow-sm ${bubbleClass}`}>
        {msg.sender_name && !isAdvisor && (
          <div className="text-[11px] font-medium text-brand-700 mb-0.5">
            {msg.sender_name}
          </div>
        )}

        {hasMedia && (
          <div className="mb-1">
            <MediaPill type={msg.message_type} duration={msg.media_duration_sec} />
          </div>
        )}

        {msg.message_type === 'image' && msg.media_path && (
          <div className="my-1 max-w-xs">
            <div className="w-full bg-slate-100 rounded p-3 text-xs text-slate-500 text-center">
              📷 Imagen disponible en {msg.media_path.split('/').pop()}
            </div>
          </div>
        )}

        {msg.message_type === 'audio' && (
          <div className="my-1">
            <div className="bg-slate-100 rounded p-2 text-xs text-slate-600 text-center">
              🎙️ Audio {msg.media_duration_sec ? `(${msg.media_duration_sec}s)` : ''}
            </div>
            {transcript && (
              <div className="mt-2 text-sm text-slate-800 border-l-2 border-brand-400 pl-2 italic">
                {transcript}
                <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500 not-italic">
                  <Sparkles className="w-3 h-3" />
                  Transcrito por IA
                  {confidence !== undefined && ` · confianza ${Math.round(confidence * 100)}%`}
                  {isLowConf && ' · BAJA CONFIANZA'}
                </div>
              </div>
            )}
          </div>
        )}

        {msg.message_type === 'document' && (
          <div className="my-1 bg-slate-100 rounded p-2 text-xs text-slate-600">
            📄 Documento: {msg.media_path?.split('/').pop() || 'archivo'}
          </div>
        )}

        {msg.body && (
          <div className="text-sm whitespace-pre-wrap break-words">{msg.body}</div>
        )}

        <div className="text-[10px] text-slate-500 text-right mt-0.5" title={msg.timestamp}>
          {formatTime(msg.timestamp)}
          {msg.is_forwarded && ' · reenviado'}
        </div>
      </div>
    </div>
  );
}

export default function ConversationPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const [data, setData] = useState<ConversationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    (async () => {
      try {
        const res = await fetchApi<ConversationResponse>(`/api/leads/${id}/conversation`);
        if (active) setData(res);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Error');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [id]);

  if (loading) {
    return <div className="p-6"><div className="skeleton h-40" /></div>;
  }
  if (error || !data) {
    return <ErrorState message={error || 'Conversación no encontrada'} />;
  }

  const messages = safeArray<ConversationMessage>(data.messages);

  // Group by date for date dividers
  const groups: { dateKey: string; messages: ConversationMessage[] }[] = [];
  let lastKey = '';
  for (const msg of messages) {
    const key = formatDateKey(msg.timestamp);
    if (key !== lastKey) {
      groups.push({ dateKey: key, messages: [] });
      lastKey = key;
    }
    groups[groups.length - 1].messages.push(msg);
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-emerald-700 text-white shadow-sm">
        <div className="max-w-4xl mx-auto flex items-center gap-3 px-4 py-3">
          <Link
            href={`/leads/${id}`}
            className="flex items-center gap-1 text-sm opacity-90 hover:opacity-100"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="flex-1">
            <div className="font-medium">{data.chat_name || data.phone || 'Chat'}</div>
            <div className="text-xs opacity-80">
              {data.phone} · {data.total} mensajes
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="max-w-4xl mx-auto py-4 min-h-[calc(100vh-64px)]"
        style={{
          backgroundImage: "url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCI+PHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjZWVmMmU5Ii8+PC9zdmc+')",
        }}
      >
        {messages.length === 0 ? (
          <div className="text-center text-slate-500 py-10">Sin mensajes en esta conversación.</div>
        ) : (
          groups.map((g, gi) => (
            <div key={gi}>
              <div className="flex justify-center my-3">
                <span className="text-xs bg-white text-slate-600 px-3 py-1 rounded-full shadow-sm">
                  {g.dateKey}
                </span>
              </div>
              {g.messages.map((m, mi) => (
                <MessageBubble key={`${m.id}-${mi}`} msg={m} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
