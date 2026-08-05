import { useState } from 'react';
import { getPollWinner, mockFoodPolls, type MockFoodPoll } from '@shared/mocks/food';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { PollTab } from '../types';

/** Poll list (seeded, mutable for the session so Create/Close persist), tab filter, and Results selection. Close/useWinner mirror Stayo App.dc.html's closePoll/useWinner exactly — neither recomputes vote percentages. */
export function useFoodPolls() {
  const [polls, setPolls] = useState<MockFoodPoll[]>(mockFoodPolls);
  const [pollTab, setPollTab] = useState<PollTab>('active');
  const [resultsPollId, setResultsPollId] = useState<string | null>(null);

  const publishPoll = (poll: MockFoodPoll, notify: boolean) => {
    setPolls((p) => [poll, ...p]);
    setPollTab('active');
    stayoToast.success(notify ? 'Poll published · tenants notified' : 'Poll published');
  };

  const closePoll = (id: string) => {
    setPolls((p) => p.map((poll) => (poll.id === id ? { ...poll, status: 'closed', closeIn: 'Closed' } : poll)));
    stayoToast.success('Voting closed · winner announced');
  };

  const openResults = (id: string) => setResultsPollId(id);
  const closeResults = () => setResultsPollId(null);

  const useWinner = (onSwitchToMenu: () => void) => {
    const poll = polls.find((p) => p.id === resultsPollId);
    if (!poll) return;
    const winner = getPollWinner(poll);
    setResultsPollId(null);
    onSwitchToMenu();
    stayoToast.success(`"${winner.name}" added to menu · edit before publishing`);
  };

  return { polls, pollTab, setPollTab, resultsPollId, publishPoll, closePoll, openResults, closeResults, useWinner };
}
