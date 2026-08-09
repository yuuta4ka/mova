import { useState } from 'react';
import { ChatNavigator, ConversationView, DirectConversationView, MovaTopbar, SpaceNavigator } from './components/Product';
import { ToastProvider } from './components/Primitives';
import { channels, currentUser, messages, spaces, users, voiceState } from './data';

export function App() {
  const [section, setSection] = useState<'chats' | 'spaces'>('spaces');
  const [selectedChatId, setSelectedChatId] = useState(users[0].id);
  const selectedChat = users.find((user) => user.id === selectedChatId) ?? users[0];
  return (
    <ToastProvider>
      <main className="mova-app-shell">
        <MovaTopbar currentUser={currentUser} section={section} onSectionChange={setSection} />
        {section === 'spaces' ? <><SpaceNavigator spaces={spaces} channels={channels} /><ConversationView messages={messages} users={[currentUser, ...users]} /></> : <><ChatNavigator users={users} selectedId={selectedChatId} onSelect={setSelectedChatId} /><DirectConversationView user={selectedChat} /></>}
      </main>
    </ToastProvider>
  );
}
