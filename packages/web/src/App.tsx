import { useCallback, useEffect, useState } from "react";
import { fetchMe, type AuthUser } from "./api";
import BottomNav, { type Tab } from "./components/BottomNav";
import AuthScreen from "./screens/AuthScreen";
import OnboardingScreen from "./screens/OnboardingScreen";
import PracticeScreen from "./screens/PracticeScreen";
import ProfileScreen from "./screens/ProfileScreen";
import RoadmapScreen from "./screens/RoadmapScreen";

const ONBOARDED_KEY = "reason_onboarded";

export default function App() {
  const [tab, setTab] = useState<Tab>("practice");
  const [requestedSlug, setRequestedSlug] = useState<string | null>(null);
  const [placementQueue, setPlacementQueue] = useState<string[]>([]);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then((user) => {
        setAuthUser(user);
        const local = localStorage.getItem(ONBOARDED_KEY) === "1";
        setNeedsOnboarding(!(user.onboarded || local));
      })
      .catch(() => {
        setAuthUser(null);
      })
      .finally(() => setAuthChecked(true));
  }, []);

  const consumeSlug = useCallback(() => {
    setRequestedSlug(null);
  }, []);

  const startPractice = useCallback((slug: string) => {
    setRequestedSlug(slug);
    setTab("practice");
  }, []);

  const handleAuthed = (user: AuthUser) => {
    setAuthUser(user);
    const local = localStorage.getItem(ONBOARDED_KEY) === "1";
    setNeedsOnboarding(!(user.onboarded || local));
    setError(null);
  };

  const handleLogout = () => {
    localStorage.removeItem(ONBOARDED_KEY);
    setAuthUser(null);
    setNeedsOnboarding(false);
    setTab("practice");
  };

  if (!authChecked) {
    return (
      <div className="app">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (!authUser) {
    return <AuthScreen onAuthed={handleAuthed} />;
  }

  if (needsOnboarding) {
    return (
      <div className="app">
        <OnboardingScreen
          onDone={(slugs) => {
            localStorage.setItem(ONBOARDED_KEY, "1");
            setNeedsOnboarding(false);
            if (slugs && slugs.length > 0) {
              setPlacementQueue(slugs.slice(1));
              startPractice(slugs[0]);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <main className="app-main">
        <div className={tab === "roadmap" ? "screen-panel" : "screen-panel hidden"}>
          <RoadmapScreen active={tab === "roadmap"} onPractice={startPractice} />
        </div>
        <div className={tab === "practice" ? "screen-panel" : "screen-panel hidden"}>
          <PracticeScreen
            requestedSlug={requestedSlug}
            queuedSlugs={placementQueue}
            onOpenRoadmap={() => setTab("roadmap")}
            onConsumedSlug={consumeSlug}
            onShiftQueue={() => setPlacementQueue((queue) => queue.slice(1))}
          />
        </div>
        <div className={tab === "profile" ? "screen-panel" : "screen-panel hidden"}>
          <ProfileScreen username={authUser.username} onLogout={handleLogout} />
        </div>
      </main>
      {error && <p className="error">{error}</p>}
      <BottomNav tab={tab} onChange={setTab} />
    </div>
  );
}
