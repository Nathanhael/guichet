import useStore from '../store/useStore';
import UserAvatar from './UserAvatar';
import BionicText from './BionicText';
import { Message } from '../types';

interface MessageBubbleProps {
  message: Message;
  ticketId: string;
  searchQuery?: string;
  isGroupStart?: boolean;
  isGroupEnd?: boolean;
}

export default function MessageBubble({ message, ticketId, isGroupStart = true, isGroupEnd = true }: MessageBubbleProps) {
  const { user, participantsOnline, bionicReading } = useStore();

  if (message.system) {
    return (
      <div className="flex justify-center py-2">
        <span className="text-[10px] uppercase tracking-widest px-4 py-1 font-black bg-white dark:bg-black text-slate-500 border border-black dark:border-white">
          {message.text}
        </span>
      </div>
    );
  }

  const isMine = message.senderId === user?.id;
  const isWhisper = !!message.whisper;

  const mainText = message.text || '';
  const displayText = mainText;

  const time = new Date(message.timestamp).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const bubbleClasses = isMine
    ? 'bubble-sent'
    : isWhisper
      ? 'bubble-whisper'
      : 'bubble-received';

  return (
    <div className={`flex w-full ${isGroupEnd ? 'mb-4' : 'mb-1'} px-4 ${isMine ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex flex-col justify-end w-8 shrink-0 ${isMine ? 'ml-3' : 'mr-3'}`}>
        {!isMine && isGroupStart && !isWhisper && (
          <UserAvatar 
            userId={message.senderId} 
            name={message.senderName || 'User'} 
            size="sm" 
            showStatus 
            isOnline={participantsOnline[ticketId]}
          />
        )}
      </div>

      <div className={`relative max-w-[75%] min-w-[60px] px-4 py-2.5 ${
        isMine 
          ? (isGroupStart ? '' : '') 
          : (isGroupStart ? '' : '')
      } ${bubbleClasses}`}>
        
        {!isMine && !isWhisper && isGroupStart && (
          <div className="text-[11px] font-black mb-1 uppercase tracking-tight opacity-60">
            {message.senderName}
          </div>
        )}
        
        {isWhisper && isGroupStart && (
          <div className="flex items-center gap-1.5 mb-1 text-[10px] font-black uppercase tracking-widest">
            Internal Note
          </div>
        )}

        <div className="relative">
          <div className="text-[15px] break-words whitespace-pre-wrap leading-normal font-medium tracking-tight uppercase">
            {bionicReading ? (
              <BionicText text={displayText} />
            ) : (
              displayText
            )}
          </div>

          {message.mediaUrl && (
            <div className="mt-3 border-2 border-black dark:border-white">
              <img
                src={message.mediaUrl}
                alt="attachment"
                className="w-full h-auto object-cover max-h-96 grayscale"
              />
            </div>
          )}
        </div>

        <div className={`flex items-center justify-end gap-2 mt-2 -mr-1 opacity-40`}>
          <span className="text-[10px] font-black tracking-tight uppercase">
            {time}
          </span>
          {isMine && (
            <span className="text-[10px] font-black">{message.readAt ? 'R' : 'D'}</span>
          )}
        </div>
      </div>
    </div>
  );
}
